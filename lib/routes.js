'use strict';

/**
 * Routes module — thin dispatcher for HTTP requests, WS messages, and slash commands.
 *
 * All handler functions and configuration are injected via the `deps` object.
 * This module contains zero business logic — it only parses and dispatches.
 */

function createRouter(deps) {
  const {
    // --- Node built-ins (injected for testability) ---
    fs,
    path,
    crypto,
    https,

    // --- Config / constants ---
    PUBLIC_DIR,
    MIME_TYPES,
    COMMANDS_FOR_CLIENT,
    CHANGELOG_PATH,
    PACKAGE_JSON_PATH,

    // --- Auth ---
    ensureAuthLoaded,
    isTokenValid,
    isBanned,
    recordAuthFailure,
    activeTokens,
    getPassword,
    getAuthConfig,

    // --- Logging ---
    plog,

    // --- Utilities ---
    wsSend,
    jsonResponse,
    extractBearerToken,
    isPathInside,
    safeFilename,
    sanitizeId,
    extFromMime,

    // --- Attachment constants & helpers ---
    IMAGE_MIME_TYPES,
    MAX_ATTACHMENT_SIZE,
    ATTACHMENT_TTL_MS,
    attachmentDataPath,
    attachmentMetaPath,
    saveAttachmentMeta,
    removeAttachmentById,

    // --- Agent / session utilities ---
    normalizeAgent,
    agentDisplayName,
    normalizePermissionModeForAgent,
    getSessionAgent,
    sessionModelLabel,
    modelShortName,
    resolveDefaultCodexModel,
    getRuntimeSessionId,
    setRuntimeSessionId,
    clearRuntimeSessionId,
    loadSession,
    saveSession,
    sendSessionList,

    // --- Formatting helpers (slash commands) ---
    formatSessionStatus,
    formatUsageMessage,
    formatDoctorMessage,
    formatResumeMessage,
    commandVersionLine,
    compactStartMessage,
    initStartMessage,
    buildCodexInitPrompt,

    // --- Shared mutable state ---
    activeProcesses,
    pendingSlashCommands,

    // --- Process management ---
    killProcess,
    cleanRunDir,

    // --- Config masked getters ---
    getNotifyConfigMasked,
    getModelConfigMasked,
    getCodexConfigMasked,
    getDevConfigMasked,

    // --- WS message handlers ---
    handleMessage,
    handleAbort,
    handleNewSession,
    handleLoadSession,
    handleDeleteSession,
    handleRenameSession,
    handleSetMode,
    handleDetachView,
    handleSaveNotifyConfig,
    handleTestNotify,
    handleChangePassword,
    handleSaveModelConfig,
    handleSaveCodexConfig,
    handleGetCcSwitchState,
    handleSwitchCcSwitchProvider,
    handleRefreshCcSwitchDesktop,
    handleFetchModels,
    handleReadClaudeLocalConfig,
    handleReadCodexLocalConfig,
    handleSaveLocalSnapshot,
    handleRestoreClaudeLocalSnapshot,
    handleSaveDevConfig,
    handleListNativeSessions,
    handleImportNativeSession,
    handleListCodexSessions,
    handleImportCodexSession,
    handleListCwdSuggestions,
    handleBrowsePaths,
    handleDisconnect,
    handleCheckUpdate,

    // --- Constants used by slash commands ---
    MODEL_MAP,
    VALID_PERMISSION_MODES,
    DEV_CONFIG_PATH,
    COMMAND_MANIFEST,
    HERMES_API_BASE,
    CLAUDE_PATH,
    CODEX_PATH,
    GEMINI_PATH,
  } = deps;

  // ── Slash command helpers ──────────────────────────────────────────────────

  const NATIVE_CLI_COMMANDS = new Set(
    COMMAND_MANIFEST
      .filter((command) => command.kind === 'native')
      .map((command) => command.cmd)
  );

  function nativeCliCommandMessage(cmd, agent) {
    const normalizedAgent = normalizeAgent(agent);
    const name = agentDisplayName(normalizedAgent);
    const run = (command) =>
      `这是 ${name} 的原生 CLI 管理命令。cc-web 保留这个命令名，但不会在网页里直接执行会改全局配置或需要 TTY 交互的操作。\n请在本机终端运行：\n${command}`;

    if (cmd === '/exit' || cmd === '/quit') {
      return 'cc-web 是浏览器会话，不需要执行 /exit。要停止当前任务请点停止按钮；要离开会话直接关闭页面或切换会话。';
    }

    if (normalizedAgent === 'claude') {
      if (cmd === '/auth' || cmd === '/login') return run('claude auth');
      if (cmd === '/setup-token') return run('claude setup-token');
      if (cmd === '/logout') return run('claude auth logout');
      if (cmd === '/mcp') return run('claude mcp');
      if (cmd === '/plugin' || cmd === '/plugins') return run('claude plugin');
      if (cmd === '/agents') return run('claude agents');
      if (cmd === '/doctor') return formatDoctorMessage(normalizedAgent);
      if (cmd === '/update' || cmd === '/upgrade') return run('claude update');
      if (cmd === '/ide') return run('claude --ide');
      return `已识别 Claude 原生命令 ${cmd}。这个命令依赖 Claude Code 交互式 TTY，cc-web 当前不会直接执行；请在终端 Claude Code 中使用。`;
    }

    if (normalizedAgent === 'codex') {
      if (cmd === '/login' || cmd === '/auth') return run('codex login');
      if (cmd === '/logout') return run('codex logout');
      if (cmd === '/mcp') return run('codex mcp');
      if (cmd === '/plugin' || cmd === '/plugins') return run('codex plugin');
      if (cmd === '/review') return run('codex review');
      if (cmd === '/apply') return run('codex apply');
      if (cmd === '/fork') return run('codex fork');
      if (cmd === '/features') return run('codex features');
      return `已识别 Codex 原生命令 ${cmd}。这个命令属于 Codex 交互式/管理命令，cc-web 当前不会直接执行；请在终端 Codex 中使用。`;
    }

    if (normalizedAgent === 'gemini') {
      if (cmd === '/mcp') return run('gemini mcp');
      if (cmd === '/extensions' || cmd === '/extension') return run('gemini extensions');
      if (cmd === '/skills' || cmd === '/skill') return run('gemini skills');
      if (cmd === '/hooks' || cmd === '/hook') return run('gemini hooks');
      if (cmd === '/login' || cmd === '/auth') return run('gemini');
      return `已识别 Gemini 原生命令 ${cmd}。这个命令依赖 Gemini CLI 交互式 TTY，cc-web 当前不会直接执行；请在终端 Gemini CLI 中使用。`;
    }

    return `已识别原生 CLI 命令 ${cmd}。Hermes 由 WSL Gateway 提供，cc-web 当前只保留命令名说明，不直接执行本机 CLI 管理命令。`;
  }

  // ── Slash command dispatcher ───────────────────────────────────────────────

  function handleSlashCommand(ws, text, sessionId, fallbackAgent) {
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    let session = sessionId ? loadSession(sessionId) : null;
    const agent = session ? getSessionAgent(session) : normalizeAgent(fallbackAgent);

    switch (cmd) {
      case '/clear': {
        if (session) {
          if (activeProcesses.has(sessionId)) {
            const entry = activeProcesses.get(sessionId);
            if (entry.agent === 'hermes' && entry.abortController) {
              entry.abortRequested = true;
              try { entry.abortController.abort(); } catch {}
            } else {
              killProcess(entry.pid);
            }
            if (entry.tailer) entry.tailer.stop();
            activeProcesses.delete(sessionId);
            cleanRunDir(sessionId);
          }
          session.messages = [];
          clearRuntimeSessionId(session);
          session.updated = new Date().toISOString();
          saveSession(session);
          wsSend(ws, {
            type: 'session_info',
            sessionId: session.id,
            messages: [],
            title: session.title,
            mode: session.permissionMode || 'yolo',
            model: sessionModelLabel(session),
            agent: getSessionAgent(session),
            cwd: session.cwd || null,
            totalCost: session.totalCost || 0,
            totalUsage: session.totalUsage || null,
            taskMode: session.taskMode || 'local',
            sshHostId: session.sshHostId || '',
            remoteCwd: session.remoteCwd || '',
          });
        }
        wsSend(ws, { type: 'system_message', message: '会话已清除，上下文已重置。' });
        break;
      }

      case '/model': {
        const modelInput = parts[1];
        if (agent === 'hermes') {
          wsSend(ws, { type: 'system_message', message: 'Hermes 使用 WSL 中 Hermes Gateway 的当前默认模型。cc-web 暂不直接切换 Hermes provider/model。' });
        } else if (agent === 'gemini') {
          if (!modelInput) {
            const current = session?.model || 'Gemini CLI 默认模型';
            wsSend(ws, { type: 'system_message', message: `当前 Gemini 模型: ${current}\n用法: /model <模型名>` });
          } else {
            if (session) {
              session.model = modelInput;
              session.updated = new Date().toISOString();
              saveSession(session);
            }
            wsSend(ws, { type: 'model_changed', model: modelInput });
            wsSend(ws, { type: 'system_message', message: `Gemini 模型已切换为: ${modelInput}` });
          }
        } else if (agent === 'codex') {
          if (!modelInput) {
            const current = session?.model || resolveDefaultCodexModel() || '配置默认模型';
            wsSend(ws, { type: 'system_message', message: `当前 Codex 模型: ${current}\n用法: /model <模型名>` });
          } else {
            if (session) {
              session.model = modelInput;
              session.updated = new Date().toISOString();
              saveSession(session);
            }
            wsSend(ws, { type: 'model_changed', model: modelInput });
            wsSend(ws, { type: 'system_message', message: `Codex 模型已切换为: ${modelInput}` });
          }
        } else if (!modelInput) {
          const current = session?.model ? modelShortName(session.model) || session.model : 'opus (默认)';
          wsSend(ws, { type: 'system_message', message: `当前模型: ${current}\n可选: opus, sonnet, haiku` });
        } else {
          const modelKey = modelInput.toLowerCase();
          if (!MODEL_MAP[modelKey]) {
            wsSend(ws, { type: 'system_message', message: `无效模型: ${modelInput}\n可选: opus, sonnet, haiku` });
          } else {
            const model = MODEL_MAP[modelKey];
            if (session) {
              session.model = model;
              session.updated = new Date().toISOString();
              saveSession(session);
            }
            wsSend(ws, { type: 'model_changed', model: modelKey });
            wsSend(ws, { type: 'system_message', message: `模型已切换为: ${modelKey}` });
          }
        }
        break;
      }

      case '/cost':
      case '/usage': {
        wsSend(ws, { type: 'system_message', message: formatUsageMessage(session, agent) });
        break;
      }

      case '/status': {
        wsSend(ws, { type: 'system_message', message: formatSessionStatus(session, agent) });
        break;
      }

      case '/resume': {
        wsSend(ws, { type: 'system_message', message: formatResumeMessage(session, agent) });
        break;
      }

      case '/doctor': {
        wsSend(ws, { type: 'system_message', message: formatDoctorMessage(agent) });
        break;
      }

      case '/login':
      case '/logout':
      case '/auth':
      case '/setup-token':
      case '/mcp':
      case '/plugin':
      case '/plugins':
      case '/agents':
      case '/extensions':
      case '/extension':
      case '/skills':
      case '/skill':
      case '/hooks':
      case '/hook':
      case '/memory':
      case '/config':
      case '/update':
      case '/upgrade':
      case '/release-notes':
      case '/review':
      case '/apply':
      case '/fork':
      case '/cloud':
      case '/features':
      case '/ide':
      case '/terminal-setup':
      case '/vim':
      case '/export':
      case '/bug':
      case '/pr-comments':
      case '/pr_comments':
      case '/exit':
      case '/quit': {
        wsSend(ws, { type: 'system_message', message: nativeCliCommandMessage(cmd, agent) });
        break;
      }

      case '/compact': {
        if (!sessionId || !session) {
          wsSend(ws, { type: 'system_message', message: '当前没有可压缩的会话。请先进入一个已进行过对话的会话后再执行 /compact。' });
          break;
        }
        if (activeProcesses.has(sessionId)) {
          wsSend(ws, { type: 'system_message', message: '当前会话正在处理中，请先等待完成或点击停止，再执行 /compact。' });
          break;
        }
        if (agent === 'hermes' || agent === 'gemini') {
          wsSend(ws, { type: 'system_message', message: `${agent === 'hermes' ? 'Hermes' : 'Gemini'} 会话暂不支持通过 cc-web 执行 /compact。` });
          break;
        }
        const runtimeId = getRuntimeSessionId(session);
        if (!runtimeId) {
          wsSend(ws, {
            type: 'system_message',
            message: agent === 'codex'
              ? '当前会话尚未建立 Codex 上下文，暂时无需压缩。'
              : '当前会话尚未建立 Claude 上下文，暂时无需压缩。',
          });
          break;
        }

        wsSend(ws, { type: 'system_message', message: compactStartMessage(agent) });
        pendingSlashCommands.set(session.id, { kind: 'compact' });
        handleMessage(ws, { text: '/compact', sessionId: session.id, mode: session.permissionMode || 'yolo' }, { hideInHistory: true });
        break;
      }

      case '/init': {
        if (!sessionId || !session) {
          wsSend(ws, { type: 'system_message', message: '请先进入一个会话后再执行 /init。' });
          break;
        }
        if (activeProcesses.has(sessionId)) {
          wsSend(ws, { type: 'system_message', message: '当前会话正在处理中，请先等待完成或点击停止。' });
          break;
        }
        if (agent === 'hermes' || agent === 'gemini') {
          wsSend(ws, { type: 'system_message', message: `${agent === 'hermes' ? 'Hermes' : 'Gemini'} 会话暂不支持 cc-web 的 /init。请直接在消息中描述要生成的文件。` });
          break;
        }
        wsSend(ws, { type: 'system_message', message: initStartMessage(agent) });
        pendingSlashCommands.set(session.id, { kind: 'init' });
        handleMessage(ws, {
          text: agent === 'codex' ? buildCodexInitPrompt(session.cwd) : '/init',
          sessionId: session.id,
          mode: session.permissionMode || 'yolo',
        }, { hideInHistory: true });
        break;
      }

      case '/github': {
        if (!sessionId || !session) {
          wsSend(ws, { type: 'system_message', message: '请先进入一个会话后再执行 /github。' });
          break;
        }
        if (activeProcesses.has(sessionId)) {
          wsSend(ws, { type: 'system_message', message: '当前会话正在处理中，请先等待完成或点击停止。' });
          break;
        }
        const ghArgs = parts.slice(1).join(' ').trim() || '列出所有可用仓库';
        const ghPrompt = [
          '[系统指令]',
          '用户请求执行 GitHub 相关操作。请按以下步骤执行：',
          `1. 使用 Read 工具读取 ${DEV_CONFIG_PATH} 获取 GitHub token 和仓库信息`,
          '2. 根据用户的自然语言指令匹配对应的仓库（按 name 或 notes 字段）',
          '3. 使用读取到的 token 进行 git 认证（可设置环境变量 GIT_TOKEN 或直接在 URL 中使用）',
          '4. 严格禁止在回复中打印、回显或引用 token 的完整内容',
          '5. 操作完成后简要报告结果',
          '',
          `用户指令：${ghArgs}`,
        ].join('\n');
        pendingSlashCommands.set(session.id, { kind: 'github' });
        handleMessage(ws, {
          text: ghPrompt,
          sessionId: session.id,
          mode: session.permissionMode || 'yolo',
        }, { hideInHistory: true });
        break;
      }

      case '/ssh': {
        if (!sessionId || !session) {
          wsSend(ws, { type: 'system_message', message: '请先进入一个会话后再执行 /ssh。' });
          break;
        }
        if (activeProcesses.has(sessionId)) {
          wsSend(ws, { type: 'system_message', message: '当前会话正在处理中，请先等待完成或点击停止。' });
          break;
        }
        const sshArgs = parts.slice(1).join(' ').trim() || '列出所有可用主机';
        const sshPrompt = [
          '[系统指令]',
          '用户请求执行 SSH 远程操作。请按以下步骤执行：',
          `1. 使用 Read 工具读取 ${DEV_CONFIG_PATH} 获取 SSH 主机信息`,
          '2. 根据用户的自然语言指令匹配对应的主机（按 name 或 description 字段）',
          '3. 根据主机的 authType 字段选择认证方式：',
          '   - authType 为 "key" 时：使用 ssh -i {identityFile} -p {port} {user}@{host} 连接',
          '   - authType 为 "password" 时：使用 sshpass -p {password} ssh -p {port} {user}@{host} 连接（如系统无 sshpass 可先安装）',
          '4. 严格禁止在回复中打印任何密钥或密码内容',
          '5. 操作完成后简要报告结果',
          '',
          `用户指令：${sshArgs}`,
        ].join('\n');
        pendingSlashCommands.set(session.id, { kind: 'ssh' });
        handleMessage(ws, {
          text: sshPrompt,
          sessionId: session.id,
          mode: session.permissionMode || 'yolo',
        }, { hideInHistory: true });
        break;
      }

      case '/mode':
      case '/permissions': {
        const modeInput = parts[1];
        const MODE_DESC = { default: '默认（CLI 原生审批；cc-web 暂无网页批准/拒绝面板）', plan: 'Plan（只读/计划优先）', yolo: 'YOLO（跳过所有权限检查）' };
        const availableModes = agent === 'gemini' ? ['plan', 'yolo'] : ['default', 'plan', 'yolo'];
        if (!modeInput) {
          const cur = normalizePermissionModeForAgent(agent, session?.permissionMode || 'yolo');
          wsSend(ws, { type: 'system_message', message: `当前模式: ${MODE_DESC[cur] || cur}\n可选: ${availableModes.join(', ')}` });
        } else if (VALID_PERMISSION_MODES.has(modeInput.toLowerCase())) {
          const mode = modeInput.toLowerCase();
          if (!availableModes.includes(mode)) {
            wsSend(ws, { type: 'system_message', message: 'Gemini CLI 的 default 模式需要终端原生确认；cc-web 手机端暂不提供网页批准/拒绝面板。请使用 Plan 或 YOLO。' });
            break;
          }
          if (session) {
            session.permissionMode = normalizePermissionModeForAgent(agent, mode);
            session.updated = new Date().toISOString();
            saveSession(session);
          }
          wsSend(ws, { type: 'system_message', message: `权限模式已切换为: ${MODE_DESC[normalizePermissionModeForAgent(agent, mode)]}` });
          wsSend(ws, { type: 'mode_changed', mode: normalizePermissionModeForAgent(agent, mode) });
        } else {
          wsSend(ws, { type: 'system_message', message: `无效模式: ${modeInput}\n可选: ${availableModes.join(', ')}` });
        }
        break;
      }

      case '/help': {
        const base = '可用指令:\n' +
          '/clear — 清除当前会话（含上下文）\n' +
          '/mode|/permissions [模式] — 查看/切换权限模式（default, plan, yolo）\n' +
          '/status — 查看当前会话、模型、目录和运行状态\n' +
          '/cost|/usage — 查看当前会话累计统计\n' +
          '/resume — 查看当前会话恢复方式\n' +
          '/doctor — 检查本机 Claude/Codex/Gemini CLI 状态\n' +
          '/login /logout /auth /mcp /plugin /agents /extensions /skills /hooks — 保留原生 CLI 管理命令入口（Web 中给出安全说明）\n' +
          '/github [指令] — GitHub 操作（读取开发者配置后执行）\n' +
          '/ssh [指令] — SSH 远程操作（读取开发者配置后执行）\n' +
          '/help — 显示本帮助';
        wsSend(ws, {
          type: 'system_message',
          message: agent === 'codex'
            ? base + '\n/model [名称] — 查看/切换 Codex 模型（自由输入）\n/compact — 执行 Codex /compact 压缩上下文\n/init — 分析项目并生成/更新 AGENTS.md'
            : agent === 'hermes'
              ? base + '\n/model — 查看 Hermes 模型说明（使用 WSL Hermes 默认配置）'
            : agent === 'gemini'
              ? base.replace('（default, plan, yolo）', '（plan, yolo）') + '\n/model [名称] — 查看/切换 Gemini CLI 模型（自由输入）'
            : base + '\n/model [名称] — 查看/切换模型（opus, sonnet, haiku）\n/compact — 执行 Claude 原生上下文压缩（保留压缩计划并可自动续跑）\n/init — 分析项目并生成/更新 CLAUDE.md',
        });
        break;
      }

      default:
        if (NATIVE_CLI_COMMANDS.has(cmd)) {
          wsSend(ws, { type: 'system_message', message: nativeCliCommandMessage(cmd, agent) });
        } else {
          wsSend(ws, { type: 'system_message', message: `未知指令: ${cmd}\n输入 /help 查看可用指令` });
        }
    }
  }

  // ── Update checker ─────────────────────────────────────────────────────────

  function handleCheckUpdateLocal(ws) {
    const localVersion = (() => {
      try {
        const cl = fs.readFileSync(CHANGELOG_PATH, 'utf8');
        const m = cl.match(/##\s*v([\d.]+)/) || cl.match(/\*\*v([\d.]+)\*\*/);
        if (m) return m[1];
      } catch {}
      try { return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')).version || 'unknown'; } catch {}
      return 'unknown';
    })();

    const options = {
      hostname: 'raw.githubusercontent.com',
      path: '/ZgDaniel/cc-web/main/CHANGELOG.md',
      headers: { 'User-Agent': 'cc-web-update-check' },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return wsSend(ws, { type: 'update_info', localVersion, error: `HTTP ${res.statusCode}` });
        }
        const m = body.match(/##\s*v([\d.]+)/) || body.match(/\*\*v([\d.]+)\*\*/);
        const latest = m ? m[1] : null;
        if (!latest) {
          return wsSend(ws, { type: 'update_info', localVersion, error: '无法解析远端版本号' });
        }
        const hasUpdate = latest !== localVersion;
        wsSend(ws, {
          type: 'update_info',
          localVersion,
          latestVersion: latest,
          hasUpdate,
          releaseUrl: 'https://github.com/ZgDaniel/cc-web',
        });
      });
    });
    req.on('error', (e) => {
      wsSend(ws, { type: 'update_info', localVersion, error: '网络请求失败: ' + e.message });
    });
    req.on('timeout', () => {
      req.destroy();
      wsSend(ws, { type: 'update_info', localVersion, error: '请求超时' });
    });
    req.end();
  }

  // ── HTTP request handler ───────────────────────────────────────────────────

  function handleHttpRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/commands') {
      return jsonResponse(res, 200, { commands: COMMANDS_FOR_CLIENT });
    }

    if (req.method === 'POST' && url.pathname === '/api/attachments') {
      const token = extractBearerToken(req);
      if (!isTokenValid(token)) {
        return jsonResponse(res, 401, { ok: false, message: 'Not authenticated' });
      }
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const rawName = decodeURIComponent(String(req.headers['x-filename'] || 'image'));
      const filename = safeFilename(rawName);
      if (!IMAGE_MIME_TYPES.has(mime)) {
        return jsonResponse(res, 400, { ok: false, message: '仅支持 PNG/JPG/WEBP/GIF 图片' });
      }

      const chunks = [];
      let total = 0;
      let aborted = false;
      req.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_ATTACHMENT_SIZE) {
          aborted = true;
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (aborted) {
          return jsonResponse(res, 413, { ok: false, message: '图片大小不能超过 10MB' });
        }
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          return jsonResponse(res, 400, { ok: false, message: '图片内容为空' });
        }
        const id = crypto.randomUUID();
        const ext = extFromMime(mime) || path.extname(filename) || '';
        const dataPath = attachmentDataPath(id, ext);
        const now = new Date();
        const meta = {
          id,
          kind: 'image',
          filename,
          mime,
          size: buffer.length,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + ATTACHMENT_TTL_MS).toISOString(),
          path: dataPath,
        };
        try {
          fs.writeFileSync(dataPath, buffer);
          saveAttachmentMeta(meta);
          return jsonResponse(res, 200, {
            ok: true,
            attachment: {
              id,
              kind: 'image',
              filename,
              mime,
              size: buffer.length,
              createdAt: meta.createdAt,
              expiresAt: meta.expiresAt,
              storageState: 'available',
            },
          });
        } catch (err) {
          try { if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath); } catch {}
          try { if (fs.existsSync(attachmentMetaPath(id))) fs.unlinkSync(attachmentMetaPath(id)); } catch {}
          return jsonResponse(res, 500, { ok: false, message: `保存附件失败: ${err.message}` });
        }
      });
      req.on('error', () => {
        if (!res.headersSent) jsonResponse(res, 500, { ok: false, message: '上传过程中断' });
      });
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/attachments/')) {
      const token = extractBearerToken(req);
      if (!isTokenValid(token)) {
        return jsonResponse(res, 401, { ok: false, message: 'Not authenticated' });
      }
      const id = sanitizeId(url.pathname.split('/').pop() || '');
      if (!id) {
        return jsonResponse(res, 400, { ok: false, message: '缺少附件 ID' });
      }
      removeAttachmentById(id);
      return jsonResponse(res, 200, { ok: true });
    }

    let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    filePath = path.resolve(filePath);

    if (!isPathInside(PUBLIC_DIR, filePath)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not Found');
      }
      const ext = path.extname(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      });
      res.end(data);
    });
  }

  // ── WebSocket connection handler ───────────────────────────────────────────

  function handleWsConnection(ws, req) {
    const forwarded = req.headers['x-forwarded-for'];
    const clientIP = forwarded ? forwarded.split(',')[0].trim()
      : req.socket?.remoteAddress || null;

    // Check if IP is banned
    if (clientIP && isBanned(clientIP)) {
      plog('WARN', 'banned_ip_rejected', { ip: clientIP });
      wsSend(ws, { type: 'auth_result', success: false, banned: true });
      ws.close();
      return;
    }

    let authenticated = false;
    let authToken = null;
    const wsId = crypto.randomBytes(4).toString('hex');
    plog('INFO', 'ws_connect', { wsId });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return wsSend(ws, { type: 'error', message: 'Invalid JSON' });
      }

      if (msg.type === 'auth') {
        ensureAuthLoaded();
        if (clientIP && isBanned(clientIP)) {
          wsSend(ws, { type: 'auth_result', success: false, banned: true });
          ws.close();
          return;
        }
        const tokenValid = isTokenValid(msg.token);
        if (msg.password === getPassword() || tokenValid) {
          authToken = tokenValid ? msg.token : crypto.randomBytes(32).toString('hex');
          activeTokens.set(authToken, Date.now());
          authenticated = true;
          wsSend(ws, { type: 'auth_result', success: true, token: authToken, mustChangePassword: !!getAuthConfig().mustChange });
          sendSessionList(ws);
        } else {
          const justBanned = recordAuthFailure(clientIP);
          wsSend(ws, { type: 'auth_result', success: false, banned: justBanned });
          if (justBanned) ws.close();
        }
        return;
      }

      if (!authenticated) {
        return wsSend(ws, { type: 'error', message: 'Not authenticated' });
      }

      switch (msg.type) {
        case 'message':
          if (msg.text && msg.text.trim().startsWith('/')) {
            handleSlashCommand(ws, msg.text.trim(), msg.sessionId, msg.agent);
          } else {
            handleMessage(ws, msg);
          }
          break;
        case 'abort':
          handleAbort(ws);
          break;
        case 'new_session':
          handleNewSession(ws, msg);
          break;
        case 'load_session':
          handleLoadSession(ws, msg.sessionId);
          break;
        case 'delete_session':
          handleDeleteSession(ws, msg.sessionId);
          break;
        case 'rename_session':
          handleRenameSession(ws, msg.sessionId, msg.title);
          break;
        case 'set_mode':
          handleSetMode(ws, msg.sessionId, msg.mode);
          break;
        case 'list_sessions':
          sendSessionList(ws);
          break;
        case 'detach_view':
          handleDetachView(ws);
          break;
        case 'get_notify_config':
          wsSend(ws, { type: 'notify_config', config: getNotifyConfigMasked() });
          break;
        case 'save_notify_config':
          handleSaveNotifyConfig(ws, msg.config);
          break;
        case 'test_notify':
          handleTestNotify(ws);
          break;
        case 'change_password':
          handleChangePassword(ws, msg, authToken);
          break;
        case 'get_model_config':
          wsSend(ws, { type: 'model_config', config: getModelConfigMasked() });
          break;
        case 'save_model_config':
          handleSaveModelConfig(ws, msg.config);
          break;
        case 'get_codex_config':
          wsSend(ws, { type: 'codex_config', config: getCodexConfigMasked() });
          break;
        case 'save_codex_config':
          handleSaveCodexConfig(ws, msg.config);
          break;
        case 'get_ccswitch_state':
          handleGetCcSwitchState(ws);
          break;
        case 'switch_ccswitch_provider':
          handleSwitchCcSwitchProvider(ws, msg);
          break;
        case 'refresh_ccswitch_desktop':
          handleRefreshCcSwitchDesktop(ws);
          break;
        case 'fetch_models':
          handleFetchModels(ws, msg);
          break;
        case 'check_update':
          handleCheckUpdateLocal(ws);
          break;
        case 'read_claude_local_config':
          handleReadClaudeLocalConfig(ws);
          break;
        case 'read_codex_local_config':
          handleReadCodexLocalConfig(ws);
          break;
        case 'save_local_snapshot':
          handleSaveLocalSnapshot(ws, msg);
          break;
        case 'restore_claude_local_snapshot':
          handleRestoreClaudeLocalSnapshot(ws);
          break;
        case 'get_dev_config':
          wsSend(ws, { type: 'dev_config', config: getDevConfigMasked() });
          break;
        case 'save_dev_config':
          handleSaveDevConfig(ws, msg);
          break;
        case 'list_native_sessions':
          handleListNativeSessions(ws);
          break;
        case 'import_native_session':
          handleImportNativeSession(ws, msg);
          break;
        case 'list_codex_sessions':
          handleListCodexSessions(ws);
          break;
        case 'import_codex_session':
          handleImportCodexSession(ws, msg);
          break;
        case 'list_cwd_suggestions':
          handleListCwdSuggestions(ws);
          break;
        case 'browse_paths':
          handleBrowsePaths(ws, msg);
          break;
        default:
          wsSend(ws, { type: 'error', message: `Unknown type: ${msg.type}` });
      }
    });

    ws.on('close', () => handleDisconnect(ws, wsId));
    ws.on('error', (err) => {
      plog('WARN', 'ws_error', { wsId, error: err.message });
      handleDisconnect(ws, wsId);
    });
  }

  // ── Public interface ───────────────────────────────────────────────────────

  return {
    handleHttpRequest,
    handleWsConnection,
    handleSlashCommand,
  };
}

module.exports = { createRouter };

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { createAgentRuntime } = require('./agent-runtime');
const { activeProcesses, wsSessionMap, pendingSlashCommands, pendingCompactRetries } = require('./shared-state');

// ── Factory ─────────────────────────────────────────────────────────────────

function createAgentManager(deps) {
  const {
    plog,
    wsSend,
    shared,
    sessions: {
      loadSession,
      saveSession,
      getSessionAgent,
      isClaudeSession,
      isCodexSession,
      isHermesSession,
      isGeminiSession,
      normalizeAgent,
      normalizePermissionModeForAgent,
      normalizeSession,
      agentDisplayName,
      getRuntimeSessionId,
      setRuntimeSessionId,
      clearRuntimeSessionId,
      runDir,
      VALID_AGENTS,
      VALID_PERMISSION_MODES,
    },
    config: {
      loadModelConfig,
      prepareCodexCustomRuntime,
      backupClaudeSettings,
      restoreClaudeSettings,
      applyCustomTemplateToSettings,
      resolveDefaultCodexModel,
      loadCodexConfig,
    },
    notifier: {
      sendNotification,
      buildNotifyContent,
      loadNotifyConfig,
    },
    CLAUDE_PATH,
    CODEX_PATH,
    GEMINI_PATH,
    HERMES_API_BASE,
    HERMES_API_KEY,
    SESSIONS_DIR,
    MAX_MESSAGE_ATTACHMENTS,
    resolveMessageAttachments,
    buildProcessLaunch,
    sendSessionList,
    getWss,
    modelShortName,
    sessionModelLabel,
  } = deps;

  const MODEL_MAP = shared.MODEL_MAP;
  const IS_WIN = process.platform === 'win32';

  // ── Agent Runtime (spawn specs + event processors) ────────────────────────

  const agentRuntime = createAgentRuntime({
    processEnv: process.env,
    CLAUDE_PATH,
    CODEX_PATH,
    GEMINI_PATH,
    MODEL_MAP,
    loadModelConfig,
    applyCustomTemplateToSettings,
    backupClaudeSettings,
    loadCodexConfig,
    prepareCodexCustomRuntime,
    wsSend,
    truncateObj,
    sanitizeToolInput,
    loadSession,
    saveSession,
    setRuntimeSessionId,
    getRuntimeSessionId,
  });

  const {
    buildClaudeSpawnSpec,
    buildCodexSpawnSpec,
    buildGeminiSpawnSpec,
    processRuntimeEvent,
  } = agentRuntime;

  // ── Utilities ─────────────────────────────────────────────────────────────

  function truncateObj(obj, maxLen) {
    const s = JSON.stringify(obj);
    if (s.length <= maxLen) return obj;
    return s.slice(0, maxLen) + '...';
  }

  function safeJsonParse(input) {
    if (input === null || input === undefined) return input;
    if (typeof input !== 'string') return input;
    const trimmed = input.trim();
    if (!trimmed) return input;
    if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
      return input;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return input;
    }
  }

  function sanitizeToolInput(toolName, input) {
    if (!input) return input;
    if (typeof input === 'string') return input;
    try {
      return JSON.parse(JSON.stringify(input));
    } catch {
      return String(input);
    }
  }

  // ── Process Lifecycle Helpers ─────────────────────────────────────────────

  function isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function killProcess(pid, force = false) {
    try {
      if (IS_WIN) {
        const args = ['/T', '/PID', String(pid)];
        if (force) args.unshift('/F');
        spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' });
      } else {
        process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
      }
    } catch {}
  }

  function cleanRunDir(sessionId) {
    const dir = runDir(sessionId);
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    } catch {}
  }

  // ── File Tailer ──────────────────────────────────────────────────────────

  class FileTailer {
    constructor(filePath, onLine) {
      this.filePath = filePath;
      this.onLine = onLine;
      this.offset = 0;
      this.buffer = '';
      this.watcher = null;
      this.interval = null;
      this.stopped = false;
    }

    start() {
      this.readNew();
      try {
        this.watcher = fs.watch(this.filePath, () => {
          if (!this.stopped) this.readNew();
        });
        this.watcher.on('error', () => {});
      } catch {}
      // Backup poll every 500ms (fs.watch not always reliable on all systems)
      this.interval = setInterval(() => {
        if (!this.stopped) this.readNew();
      }, 500);
    }

    readNew() {
      try {
        const stat = fs.statSync(this.filePath);
        if (stat.size <= this.offset) return;
        const buf = Buffer.alloc(stat.size - this.offset);
        const fd = fs.openSync(this.filePath, 'r');
        fs.readSync(fd, buf, 0, buf.length, this.offset);
        fs.closeSync(fd);
        this.offset = stat.size;
        this.buffer += buf.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop();
        for (const line of lines) {
          if (line.trim()) this.onLine(line);
        }
      } catch {}
    }

    stop() {
      this.stopped = true;
      if (this.watcher) { this.watcher.close(); this.watcher = null; }
      if (this.interval) { clearInterval(this.interval); this.interval = null; }
    }
  }

  // ── Runtime Error Formatting ─────────────────────────────────────────────

  function firstMeaningfulLine(text) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || '';
  }

  function condenseRuntimeError(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const usageIndex = lines.findIndex((line) => /^Usage:/i.test(line));
    if (usageIndex >= 0) return lines.slice(0, usageIndex).join(' ');
    return lines.slice(0, 3).join(' ');
  }

  function filterRuntimeStderr(agent, text) {
    const lines = String(text || '').split(/\r?\n/);
    return lines
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (agent === 'gemini') {
          if (/^Warning: 256-color support not detected\./i.test(line)) return false;
          if (/^YOLO mode is enabled\. All tool calls will be automatically approved\./i.test(line)) return false;
        }
        return true;
      })
      .join('\n')
      .trim();
  }

  function formatRuntimeError(agent, raw, context = {}) {
    const condensed = condenseRuntimeError(raw);
    const exitInfo = typeof context.exitCode === 'number' ? `（退出码 ${context.exitCode}）` : '';
    if (!condensed) {
      if (agent === 'hermes') {
        return `Hermes 任务异常结束${exitInfo}，但 Gateway 没有返回更多错误信息。`;
      }
      if (agent === 'gemini') {
        return `Gemini 任务异常结束${exitInfo}，但 CLI 没有返回更多错误信息。`;
      }
      return agent === 'codex'
        ? `Codex 任务异常结束${exitInfo}，但 CLI 没有返回更多错误信息。`
        : `Claude 任务异常结束${exitInfo}，但 CLI 没有返回更多错误信息。`;
    }

    if (agent === 'hermes') {
      if (/ECONNREFUSED|fetch failed|ENOTFOUND|network|timed out|timeout/i.test(condensed)) {
        return `Hermes Gateway 连接失败：请确认 WSL 中的 Hermes API Server 正在监听 ${HERMES_API_BASE}。`;
      }
      if (/authentication|unauthorized|forbidden|invalid api key|api key/i.test(condensed)) {
        return 'Hermes Gateway 鉴权失败。请检查 CC_WEB_HERMES_API_KEY 或 Hermes API Server 的 key 配置。';
      }
      if (/context|token|too large|too many/i.test(condensed)) {
        return `Hermes 上下文或输入过大：${firstMeaningfulLine(condensed)}`;
      }
      return `Hermes 任务失败${exitInfo}：${condensed}`;
    }

    if (agent === 'gemini') {
      if (/ENOENT|not found|No such file/i.test(condensed)) {
        return '找不到 Gemini CLI。请检查系统 PATH 中是否可直接运行 `gemini`，或设置 GEMINI_PATH。';
      }
      if (/trusted directory|trust.*workspace|skip-trust/i.test(condensed)) {
        return 'Gemini CLI 拒绝运行未信任工作区。cc-web 已使用 --skip-trust；若仍失败，请检查 Gemini CLI 的 trust 设置。';
      }
      if (/authentication|unauthorized|forbidden|login|api key|credential/i.test(condensed)) {
        return 'Gemini 鉴权失败。请确认本机 Gemini CLI 已完成登录或配置了可用 API Key。';
      }
      if (/approval|confirm|permission|policy/i.test(condensed)) {
        return `Gemini 当前审批策略阻止了这次执行：${firstMeaningfulLine(condensed)}`;
      }
      if (/network|timed out|timeout|ECONNRESET|ENOTFOUND|TLS|certificate|fetch failed/i.test(condensed)) {
        return 'Gemini CLI 网络请求失败。请检查当前网络、代理或证书环境后重试。';
      }
      if (/rate limit|quota|billing|credits/i.test(condensed)) {
        return 'Gemini 请求被额度或速率限制拦截。请检查账号配额、计费状态或稍后重试。';
      }
      return `Gemini 任务失败${exitInfo}：${condensed}`;
    }

    if (agent === 'codex') {
      if (/stream disconnected before completion|stream closed before response\.completed|response\.completed/i.test(condensed)) {
        return 'Codex 上游响应流提前中断：当前自定义 API 的 Responses 流式协议没有完整发送 response.completed。请检查该 API 端点是否完整兼容 OpenAI Responses SSE，或切回确认兼容的 API 模板。';
      }
      if (/ENOENT|not found|No such file/i.test(condensed)) {
        return '找不到 Codex CLI。请检查 Codex 设置里的 CLI 路径，或确认系统 PATH 中可直接运行 `codex`。';
      }
      if (/unexpected argument|unexpected option|Usage:\s*codex/i.test(raw || '')) {
        return `Codex CLI 参数不兼容：${firstMeaningfulLine(condensed)}。建议检查当前 CLI 版本与 cc-web 的参数约定是否匹配。`;
      }
      if (/permission denied|EACCES|EPERM/i.test(condensed)) {
        return 'Codex CLI 启动失败：当前环境没有足够权限执行该命令或访问目标目录。';
      }
      if (/authentication|unauthorized|forbidden|login|api key|credential/i.test(condensed)) {
        return 'Codex 鉴权失败。请确认本机 Codex CLI 已完成登录，且当前凭据仍然有效。';
      }
      if (/rate limit|quota|billing|credits/i.test(condensed)) {
        return 'Codex 请求被额度或速率限制拦截。请检查账号配额、计费状态或稍后重试。';
      }
      if (/network|timed out|timeout|ECONNRESET|ENOTFOUND|TLS|certificate|fetch failed/i.test(condensed)) {
        return 'Codex 运行时网络请求失败。请检查当前网络、代理或证书环境后重试。';
      }
      if (/sandbox|approval|read-only|bypass-approvals/i.test(condensed)) {
        return `Codex 当前的审批或沙箱设置阻止了这次执行：${firstMeaningfulLine(condensed)}`;
      }
      return `Codex 任务失败${exitInfo}：${condensed}`;
    }

    if (/ENOENT|not found|No such file/i.test(condensed)) {
      return '找不到 Claude CLI。请检查当前环境是否能直接运行 `claude`。';
    }
    if (/authentication|unauthorized|forbidden|api key|credential/i.test(condensed)) {
      return 'Claude 鉴权失败。请确认本机 Claude CLI 已完成登录，且凭据仍然有效。';
    }
    return `Claude 任务失败${exitInfo}：${condensed}`;
  }

  // ── Status Messages ──────────────────────────────────────────────────────

  function compactStartMessage(agent) {
    if (agent === 'gemini') return 'Gemini 会话暂不支持通过 cc-web 执行 /compact。';
    return agent === 'codex'
      ? '正在执行 Codex /compact 压缩上下文，请稍候…'
      : '正在执行 Claude 原生 /compact 压缩上下文，请稍候…';
  }

  function compactDoneMessage(agent) {
    if (agent === 'gemini') return 'Gemini 会话暂不支持通过 cc-web 执行 /compact。';
    return agent === 'codex'
      ? '上下文压缩完成。已执行 Codex /compact，下次继续在同一会话发送即可。'
      : '上下文压缩完成。已按 Claude Code 原生策略执行 /compact，下次继续在同一会话发送即可。';
  }

  function initStartMessage(agent) {
    if (agent === 'gemini') return '正在让 Gemini 生成项目说明...';
    return agent === 'codex'
      ? '正在分析项目并生成 AGENTS.md ...'
      : '正在分析项目并生成 CLAUDE.md ...';
  }

  function buildCodexInitPrompt(cwd) {
    const targetPath = path.join(cwd || process.cwd(), 'AGENTS.md');
    return [
      'You are running cc-web\'s /init for a Codex session.',
      'Analyze the current workspace and create or update AGENTS.md at the repository root.',
      `The file path to write is: ${targetPath}`,
      'Requirements:',
      '- Actually write the file; do not stop after summarizing in chat.',
      '- If AGENTS.md already exists, update it in place instead of creating a duplicate.',
      '- Keep the document concise and practical for future coding agents working in this repo.',
      '- Include the project purpose, key entry points, dev/test commands, important workflows, and repo-specific safety constraints.',
      '- Prefer facts from the actual codebase over README claims when they differ.',
      '- After editing the file, reply with a brief summary of what you wrote.',
    ].join('\n');
  }

  function compactAutoStartMessage(agent) {
    return agent === 'codex'
      ? '检测到上下文达到上限，正在按 Codex /compact 自动压缩，然后继续当前任务…'
      : '检测到上下文达到上限，正在按 Claude Code 原版策略自动执行 /compact，然后继续当前任务…';
  }

  function compactAutoResumeMessage(agent) {
    return agent === 'codex'
      ? '检测到上一条请求因上下文过大失败，现已按 Codex 压缩计划继续执行。'
      : '检测到上一条请求因上下文过大失败，现已自动按压缩计划继续执行。';
  }

  function isContextLimitError(agent, raw) {
    const text = String(raw || '');
    if (!text) return false;
    if (agent === 'claude') {
      return /Request too large \(max 20MB\)/i.test(text);
    }
    return /context\s+(window|length)|maximum context length|context limit|token limit|too many tokens|input.*too long|prompt.*too long|request too large|please use\s*\/compact|use\s*\/compact|reduce (the )?(input|prompt|message)|exceed(?:ed|s).*(token|context)/i.test(text);
  }

  // ── Process Completion ────────────────────────────────────────────────────

  function handleProcessComplete(sessionId, exitCode, signal) {
    const entry = activeProcesses.get(sessionId);
    if (!entry) return;

    const completeTime = new Date().toISOString();
    const wsConnected = !!entry.ws;
    const disconnectGap = entry.wsDisconnectTime
      ? ((new Date(completeTime) - new Date(entry.wsDisconnectTime)) / 1000).toFixed(1) + 's'
      : null;

    const pendingRetry = pendingCompactRetries.get(sessionId) || null;
    let contextLimitExceeded = false;

    // Read stderr for error clues
    let stderrSnippet = '';
    try {
      const errPath = path.join(runDir(sessionId), 'error.log');
      if (fs.existsSync(errPath)) {
        const content = filterRuntimeStderr(entry.agent || 'claude', fs.readFileSync(errPath, 'utf8')).trim();
        if (content) stderrSnippet = content.slice(-500);
      }
    } catch {}

    const abnormalExit = (typeof exitCode === 'number' && exitCode !== 0) || (!!signal && signal !== 'SIGTERM');
    const fallbackCompletionError = abnormalExit
      ? (stderrSnippet || `${agentDisplayName(entry.agent || 'claude')} 任务异常结束${typeof exitCode === 'number' ? `（退出码 ${exitCode}）` : ''}${signal ? `（信号 ${signal}）` : ''}。`)
      : null;
    const rawCompletionError = entry.lastError || fallbackCompletionError;
    contextLimitExceeded = isContextLimitError(entry.agent || 'claude', `${entry.fullText || ''}\n${stderrSnippet || ''}\n${rawCompletionError || ''}`);
    const completionError = rawCompletionError ? formatRuntimeError(entry.agent || 'claude', rawCompletionError, { exitCode, signal }) : null;
    if (!entry.lastError && rawCompletionError) entry.lastError = rawCompletionError;

    plog(exitCode === 0 || exitCode === null ? 'INFO' : 'WARN', 'process_complete', {
      sessionId: sessionId.slice(0, 8),
      pid: entry.pid,
      agent: entry.agent || 'claude',
      exitCode,
      signal,
      wsConnected,
      wsDisconnectTime: entry.wsDisconnectTime || null,
      disconnectToDeathGap: disconnectGap,
      responseLen: (entry.fullText || '').length,
      toolCallCount: (entry.toolCalls || []).length,
      cost: entry.lastCost,
      usage: entry.lastUsage || null,
      error: rawCompletionError,
      stderr: stderrSnippet || null,
      requestTooLarge: contextLimitExceeded,
    });

    // Final read
    if (entry.tailer) {
      entry.tailer.readNew();
      entry.tailer.stop();
    }

    const pendingSlash = pendingSlashCommands.get(sessionId) || null;
    if (pendingSlash) pendingSlashCommands.delete(sessionId);

    // Save result to session
    const session = loadSession(sessionId);
    if (session && entry.fullText) {
      const msg = {
        role: 'assistant',
        content: entry.fullText,
        toolCalls: entry.toolCalls || [],
        timestamp: new Date().toISOString(),
      };
      if (entry.fullTextTruncated) msg.truncated = true;
      if (entry.toolCallsTruncated) msg.toolCallsTruncated = true;
      session.messages.push(msg);
      session.updated = new Date().toISOString();
      if (!entry.ws) session.hasUnread = true;
      saveSession(session);
    }

    if (pendingSlash?.kind === 'compact' && session) {
      if (entry.lastCost) {
        session.totalCost = Math.max(0, (session.totalCost || 0) - entry.lastCost);
      }
      session.updated = new Date().toISOString();
      saveSession(session);
    }

    // Codex reconnects during startup can be benign on Windows. Only discard the
    // thread after an abnormal exit; clearing it after a successful turn loses
    // context and forces every next turn into another cold exec session.
    if (session && entry.agent === 'codex' && (entry.reconnectRetryCount || 0) > 0 && abnormalExit) {
      clearRuntimeSessionId(session);
      saveSession(session);
      plog('INFO', 'codex_thread_reset_after_reconnects', {
        sessionId: sessionId.slice(0, 8),
        reconnectCount: entry.reconnectRetryCount,
      });
    } else if (entry.agent === 'codex' && (entry.reconnectRetryCount || 0) > 0) {
      plog('INFO', 'codex_reconnects_observed', {
        sessionId: sessionId.slice(0, 8),
        reconnectCount: entry.reconnectRetryCount,
        keptThread: !!session?.codexThreadId,
      });
    }

    let shouldReturnForFollowup = false;
    let shouldAutoCompact = false;

    activeProcesses.delete(sessionId);
    cleanRunDir(sessionId);
    pendingSlashCommands.delete(sessionId);

    // Restore original Claude settings after session ends (undoes custom template)
    restoreClaudeSettings();

    // Notify client
    if (entry.ws) {
      if (pendingSlash?.kind === 'compact') {
        const retry = pendingCompactRetries.get(sessionId);
        const autoRetryRequested = !!(retry?.text && retry?.reason === 'auto');
        if (autoRetryRequested) {
          if (contextLimitExceeded) {
            pendingCompactRetries.delete(sessionId);
            wsSend(entry.ws, { type: 'system_message', message: '已尝试执行 /compact，但仍未成功解除上下文超限。请手动缩小输入范围后重试。' });
          } else {
            wsSend(entry.ws, { type: 'system_message', message: compactDoneMessage(entry.agent || 'claude') });
            wsSend(entry.ws, { type: 'system_message', message: compactAutoResumeMessage(entry.agent || 'claude') });
            shouldReturnForFollowup = true;
          }
        } else {
          wsSend(entry.ws, { type: 'system_message', message: compactDoneMessage(entry.agent || 'claude') });
        }
      }

      if (contextLimitExceeded && !pendingSlash && session && !isHermesSession(session) && !isGeminiSession(session) && getRuntimeSessionId(session)) {
        pendingCompactRetries.set(sessionId, { text: pendingRetry?.text || '', mode: pendingRetry?.mode || session.permissionMode || 'yolo', reason: 'auto' });
        wsSend(entry.ws, { type: 'system_message', message: compactAutoStartMessage(entry.agent || 'claude') });
        shouldAutoCompact = true;
      }

      if (completionError && !entry.errorSent && !shouldAutoCompact) {
        entry.errorSent = true;
        wsSend(entry.ws, { type: 'error', message: completionError });
      }

      wsSend(entry.ws, { type: 'done', sessionId, costUsd: entry.lastCost || null });
      sendSessionList(entry.ws);
      // Push notification when trigger='always' (user online but still wants notification)
      (() => {
        const notifyCfg = loadNotifyConfig();
        if (!notifyCfg.provider || notifyCfg.provider === 'off') return;
        if ((notifyCfg.summary?.trigger || 'background') !== 'always') return;
        const sess = loadSession(sessionId);
        buildNotifyContent(entry, sess, completionError, contextLimitExceeded).then(({ title: ntitle, content }) => {
          sendNotification(ntitle, content);
        }).catch(err => plog('WARN', 'notify_build_failed', { error: err.message }));
      })();
    } else {
      // Process completed while browser was disconnected — notify all connected clients
      const sess = loadSession(sessionId);
      const title = sess?.title || 'Untitled';
      const wss = getWss();
      if (wss) {
        for (const client of wss.clients) {
          if (client.readyState === 1) {
            wsSend(client, {
              type: 'background_done',
              sessionId,
              title,
              costUsd: entry.lastCost || null,
              responseLen: (entry.fullText || '').length,
            });
          }
        }
      }
      // Push notification (background task)
      buildNotifyContent(entry, sess, completionError, contextLimitExceeded).then(({ title: ntitle, content }) => {
        sendNotification(ntitle, content);
      }).catch(err => plog('WARN', 'notify_build_failed', { error: err.message }));
    }

    if (!shouldReturnForFollowup && !shouldAutoCompact && !contextLimitExceeded && pendingRetry && pendingRetry.text === (entry.fullText || '').trim()) {
      pendingCompactRetries.delete(sessionId);
    }

    if (shouldReturnForFollowup && entry.ws && entry.ws.readyState === 1 && session) {
      if (pendingSlash?.kind === 'compact') {
        const retry = pendingCompactRetries.get(sessionId);
        if (retry?.text) {
          pendingCompactRetries.delete(sessionId);
          handleMessage(entry.ws, { text: retry.text, sessionId, mode: retry.mode || session.permissionMode || 'yolo' });
        }
        return;
      }
    }

    if (shouldAutoCompact && entry.ws && entry.ws.readyState === 1 && session) {
      pendingSlashCommands.set(sessionId, { kind: 'compact' });
      handleMessage(entry.ws, { text: '/compact', sessionId, mode: session.permissionMode || 'yolo' }, { hideInHistory: true });
      return;
    }
  }

  // ── PID Monitor ──────────────────────────────────────────────────────────

  const pidMonitorInterval = setInterval(() => {
    for (const [sessionId, entry] of activeProcesses) {
      if (entry.pid && !isProcessRunning(entry.pid)) {
        const observed = entry.exitObserved || null;
        plog('INFO', 'pid_monitor_detected_exit', {
          sessionId: sessionId.slice(0, 8),
          pid: entry.pid,
          wsConnected: !!entry.ws,
          exitObserved: !!observed,
        });
        handleProcessComplete(
          sessionId,
          observed ? observed.code : null,
          observed ? observed.signal : 'unknown (detected by monitor)'
        );
      }
    }
  }, 2000);

  // ── Process Recovery ─────────────────────────────────────────────────────

  function recoverProcesses() {
    try {
      const entries = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('-run') && fs.statSync(path.join(SESSIONS_DIR, f)).isDirectory());
      if (entries.length === 0) return;
      plog('INFO', 'recovery_start', { runDirs: entries.length });
      for (const dirName of entries) {
        const sessionId = dirName.replace('-run', '');
        const dir = path.join(SESSIONS_DIR, dirName);
        const pidPath = path.join(dir, 'pid');
        const outputPath = path.join(dir, 'output.jsonl');
        const session = loadSession(sessionId);
        const agent = getSessionAgent(session);

        if (!fs.existsSync(pidPath)) {
          try { fs.rmSync(dir, { recursive: true }); } catch {}
          continue;
        }

        const pid = parseInt(fs.readFileSync(pidPath, 'utf8'));

        if (isProcessRunning(pid)) {
          console.log(`[recovery] Re-attaching to session ${sessionId} (PID ${pid})`);
          plog('INFO', 'recovery_alive', { sessionId: sessionId.slice(0, 8), pid, agent });
          const entry = { pid, ws: null, agent, fullText: '', toolCalls: [], lastCost: null, lastUsage: null, lastError: null, errorSent: false, tailer: null };
          activeProcesses.set(sessionId, entry);

          if (fs.existsSync(outputPath)) {
            entry.tailer = new FileTailer(outputPath, (line) => {
              try {
                const event = JSON.parse(line);
                processRuntimeEvent(entry, event, sessionId);
              } catch {}
            });
            entry.tailer.start();
          }
        } else {
          // Process finished while server was down — read all output and save
          console.log(`[recovery] Processing completed output for session ${sessionId}`);
          plog('INFO', 'recovery_dead', { sessionId: sessionId.slice(0, 8), pid, agent });
          if (fs.existsSync(outputPath)) {
            const tempEntry = { pid: 0, ws: null, agent, fullText: '', toolCalls: [], lastCost: null, lastUsage: null, lastError: null, errorSent: false, tailer: null };
            const content = fs.readFileSync(outputPath, 'utf8');
            for (const line of content.split('\n')) {
              if (!line.trim()) continue;
              try {
                const event = JSON.parse(line);
                processRuntimeEvent(tempEntry, event, sessionId);
              } catch {}
            }
            if (session && tempEntry.fullText) {
              session.messages.push({
                role: 'assistant',
                content: tempEntry.fullText,
                toolCalls: tempEntry.toolCalls || [],
                timestamp: new Date().toISOString(),
              });
              session.updated = new Date().toISOString();
              saveSession(session);
            }
          }
          try { fs.rmSync(dir, { recursive: true }); } catch {}
        }
      }
    } catch (err) {
      console.error('[recovery] Error:', err.message);
    }
  }

  // ── Hermes Streaming ─────────────────────────────────────────────────────

  function hermesConversationIdForSession(session) {
    if (!session) return '';
    return session.hermesConversationId || `cc-web:${session.id}`;
  }

  function parseSseChunkBuffer(buffer, onEvent) {
    let cursor = 0;
    while (true) {
      const next = buffer.indexOf('\n\n', cursor);
      if (next === -1) break;
      const rawEvent = buffer.slice(cursor, next);
      cursor = next + 2;
      let eventName = '';
      const dataLines = [];
      for (const rawLine of rawEvent.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length === 0) continue;
      const dataText = dataLines.join('\n');
      if (dataText === '[DONE]') continue;
      let data;
      try { data = JSON.parse(dataText); } catch { data = { message: dataText }; }
      onEvent(eventName || data.type || data.event || 'message', data);
    }
    return buffer.slice(cursor);
  }

  async function startHermesResponseStream(ws, session, textValue) {
    const sessionId = session.id;
    if (activeProcesses.has(sessionId)) {
      wsSend(ws, { type: 'error', message: '正在处理中，请先点击停止按钮。' });
      return false;
    }

    const conversationId = hermesConversationIdForSession(session);
    session.hermesConversationId = conversationId;
    session.updated = new Date().toISOString();
    saveSession(session);

    const controller = new AbortController();
    const entry = {
      pid: 0,
      ws,
      agent: 'hermes',
      cwd: null,
      fullText: '',
      attachments: [],
      toolCalls: [],
      lastCost: null,
      lastUsage: null,
      lastError: null,
      errorSent: false,
      abortController: controller,
      abortRequested: false,
      tailer: null,
    };
    activeProcesses.set(sessionId, entry);
    sendSessionList(ws);

    plog('INFO', 'hermes_stream_start', {
      sessionId: sessionId.slice(0, 8),
      apiBase: HERMES_API_BASE,
      conversationId,
    });

    (async () => {
      let completed = false;
      try {
        const headers = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        };
        if (HERMES_API_KEY) headers.Authorization = `Bearer ${HERMES_API_KEY}`;
        const response = await fetch(`${HERMES_API_BASE}/v1/responses`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: textValue,
            stream: true,
            store: true,
            conversation: conversationId,
          }),
          signal: controller.signal,
        });

        const hermesSessionId = response.headers.get('x-hermes-session-id');
        if (hermesSessionId) {
          const latest = loadSession(sessionId);
          if (latest) {
            latest.hermesSessionId = hermesSessionId;
            latest.hermesConversationId = conversationId;
            saveSession(latest);
          }
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(body || `Hermes Gateway HTTP ${response.status}`);
        }
        if (!response.body) throw new Error('Hermes Gateway 没有返回可读取的 SSE 流。');

        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          buffer = parseSseChunkBuffer(buffer, (eventName, data) => {
            processRuntimeEvent(entry, { event: eventName, data }, sessionId);
          });
        }
        buffer += decoder.decode();
        parseSseChunkBuffer(buffer + '\n\n', (eventName, data) => {
          processRuntimeEvent(entry, { event: eventName, data }, sessionId);
        });
        completed = true;
        plog('INFO', 'hermes_stream_complete', {
          sessionId: sessionId.slice(0, 8),
          responseLen: entry.fullText.length,
          toolCallCount: entry.toolCalls.length,
        });
        handleProcessComplete(sessionId, 0, null);
      } catch (err) {
        if (entry.abortRequested || err?.name === 'AbortError') {
          plog('INFO', 'hermes_stream_aborted', { sessionId: sessionId.slice(0, 8) });
          handleProcessComplete(sessionId, null, 'SIGTERM');
          return;
        }
        entry.lastError = err?.message || String(err);
        plog('ERROR', 'hermes_stream_error', {
          sessionId: sessionId.slice(0, 8),
          error: entry.lastError,
        });
        handleProcessComplete(sessionId, completed ? 0 : 1, null);
      }
    })();

    return true;
  }

  // ── Abort Handler ────────────────────────────────────────────────────────

  function handleAbort(ws) {
    const sessionId = wsSessionMap.get(ws);
    if (!sessionId) return;
    const entry = activeProcesses.get(sessionId);
    if (!entry) return;

    plog('INFO', 'user_abort', { sessionId: sessionId.slice(0, 8), pid: entry.pid });
    if (entry.agent === 'hermes' && entry.abortController) {
      entry.abortRequested = true;
      try { entry.abortController.abort(); } catch {}
      return;
    }
    killProcess(entry.pid);
    setTimeout(() => {
      killProcess(entry.pid, true);
    }, 3000);
    // handleProcessComplete will be triggered by the PID monitor
  }

  // ── Message Handler ──────────────────────────────────────────────────────

  function handleMessage(ws, msg, options = {}) {
    const { text, sessionId, mode } = msg;
    const { hideInHistory = false } = options;
    const textValue = typeof text === 'string' ? text : '';
    const attachments = Array.isArray(msg.attachments) ? msg.attachments.slice(0, MAX_MESSAGE_ATTACHMENTS) : [];
    const normalizedText = textValue.trim();
    const resolvedAttachments = resolveMessageAttachments(attachments);
    if (attachments.length > 0 && resolvedAttachments.length === 0) {
      return wsSend(ws, { type: 'error', message: '图片附件已过期或不可用，请重新上传后再发送。' });
    }
    if (!normalizedText && resolvedAttachments.length === 0) return;

    const savedAttachments = resolvedAttachments.map((attachment) => ({
      id: attachment.id,
      kind: 'image',
      filename: attachment.filename,
      mime: attachment.mime,
      size: attachment.size,
      createdAt: attachment.createdAt,
      expiresAt: attachment.expiresAt,
      storageState: attachment.storageState,
    }));

    if (sessionId && activeProcesses.has(sessionId)) {
      return wsSend(ws, { type: 'error', message: '正在处理中，请先点击停止按钮。' });
    }

    const derivedTitle = normalizedText
      ? textValue.slice(0, 60).replace(/\n/g, ' ')
      : `图片: ${savedAttachments[0]?.filename || 'image'}`;

    let session;
    if (sessionId) session = loadSession(sessionId);
    if (!session) {
      const id = crypto.randomUUID();
      const agent = normalizeAgent(msg.agent);
      const resolvedCwd = (agent === 'claude' || agent === 'gemini') ? (process.env.HOME || process.env.USERPROFILE || process.cwd()) : null;
      session = {
        id,
        title: derivedTitle,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        agent,
        claudeSessionId: null,
        codexThreadId: null,
        hermesResponseId: null,
        hermesConversationId: agent === 'hermes' ? `cc-web:${id}` : '',
        hermesSessionId: null,
        geminiSessionId: null,
        model: agent === 'codex' ? resolveDefaultCodexModel() : (agent === 'hermes' || agent === 'gemini' ? null : MODEL_MAP.opus),
        permissionMode: normalizePermissionModeForAgent(agent, mode || 'yolo'),
        totalCost: 0,
        totalUsage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
        messages: [],
        cwd: resolvedCwd,
      };
    }
    normalizeSession(session);

    if (isHermesSession(session) && resolvedAttachments.length > 0) {
      return wsSend(ws, { type: 'error', message: 'Hermes 会话暂不支持图片附件，请移除附件后重试。' });
    }
    if (isGeminiSession(session) && resolvedAttachments.length > 0) {
      return wsSend(ws, { type: 'error', message: 'Gemini CLI 会话暂不支持图片附件，请移除附件后重试。' });
    }

    if (normalizedText.startsWith('/') && resolvedAttachments.length > 0) {
      return wsSend(ws, { type: 'error', message: '命令消息暂不支持同时附带图片。请先发送图片说明，再单独使用 /model 或 /mode。' });
    }

    if (mode && VALID_PERMISSION_MODES.has(mode)) {
      session.permissionMode = normalizePermissionModeForAgent(getSessionAgent(session), mode);
    }

    if (!hideInHistory && normalizedText !== '/compact' && getRuntimeSessionId(session)) {
      pendingCompactRetries.set(session.id, { text: normalizedText, mode: session.permissionMode || 'yolo', reason: 'normal' });
    }

    if (session.title === 'New Chat' || session.title === 'Untitled') {
      session.title = derivedTitle;
    }

    if (!hideInHistory) {
      session.messages.push({
        role: 'user',
        content: textValue,
        attachments: savedAttachments,
        timestamp: new Date().toISOString(),
      });
    }
    session.updated = new Date().toISOString();
    saveSession(session);

    const currentSessionId = session.id;

    for (const [, entry] of activeProcesses) {
      if (entry.ws === ws) entry.ws = null;
    }
    wsSessionMap.set(ws, currentSessionId);

    if (!sessionId) {
      wsSend(ws, {
        type: 'session_info',
        sessionId: currentSessionId,
        messages: session.messages,
        title: session.title,
        mode: session.permissionMode || 'yolo',
        model: sessionModelLabel(session),
        agent: getSessionAgent(session),
        cwd: session.cwd || null,
        totalCost: session.totalCost || 0,
        totalUsage: session.totalUsage || null,
        updated: session.updated,
        hasUnread: false,
        historyPending: false,
        isRunning: false,
        taskMode: session.taskMode || 'local',
        sshHostId: session.sshHostId || '',
        remoteCwd: session.remoteCwd || '',
      });
    }
    sendSessionList(ws);

    if (isHermesSession(session)) {
      startHermesResponseStream(ws, session, textValue);
      return;
    }

    const spawnSpec = isClaudeSession(session)
      ? buildClaudeSpawnSpec(session, { attachments: resolvedAttachments })
      : isGeminiSession(session)
        ? buildGeminiSpawnSpec(session, { attachments: resolvedAttachments })
        : buildCodexSpawnSpec(session, { attachments: resolvedAttachments });
    if (spawnSpec?.error) {
      return wsSend(ws, { type: 'error', message: spawnSpec.error });
    }
    saveSession(session);

    // === Detached process with file-based I/O ===
    const dir = runDir(currentSessionId);
    fs.mkdirSync(dir, { recursive: true });

    const inputPath = path.join(dir, 'input.txt');
    const outputPath = path.join(dir, 'output.jsonl');
    const errorPath = path.join(dir, 'error.log');

    const useStreamJson = isClaudeSession(session) && resolvedAttachments.length > 0;

    if (useStreamJson) {
      const content = [];
      if (textValue) content.push({ type: 'text', text: textValue });
      for (const attachment of resolvedAttachments) {
        const data = fs.readFileSync(attachment.path).toString('base64');
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mime,
            data,
          },
        });
      }
      fs.writeFileSync(inputPath, `${JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content,
        },
      })}\n`);
    } else {
      fs.writeFileSync(inputPath, textValue);
    }

    const outputFd = fs.openSync(outputPath, 'w');
    const errorFd = fs.openSync(errorPath, 'w');

    let proc;
    try {
      let stdinSource;
      if (useStreamJson) {
        // stream-json requires an open pipe (not a closed file) so Claude doesn't exit on EOF
        stdinSource = 'pipe';
      } else {
        stdinSource = fs.openSync(inputPath, 'r');
      }
      const launch = buildProcessLaunch(spawnSpec.command, spawnSpec.args);
      proc = spawn(launch.command, launch.args, {
        env: spawnSpec.env,
        cwd: spawnSpec.cwd,
        stdio: [stdinSource, outputFd, errorFd],
        detached: !IS_WIN,
        windowsHide: true,
      });
      if (useStreamJson) {
        // Write the stream-json message then close stdin so Claude knows input is done
        proc.stdin.write(fs.readFileSync(inputPath));
        proc.stdin.end();
      } else {
        fs.closeSync(stdinSource);
      }
    } catch (err) {
      fs.closeSync(outputFd);
      fs.closeSync(errorFd);
      cleanRunDir(currentSessionId);
      plog('ERROR', 'process_spawn_fail', {
        sessionId: currentSessionId.slice(0, 8),
        command: spawnSpec.command,
        cwd: spawnSpec.cwd,
        error: err.message,
      });
      const agent = getSessionAgent(session);
      return wsSend(ws, { type: 'error', message: formatRuntimeError(agent, err.message, { exitCode: null, signal: null }) });
    }

    fs.closeSync(outputFd);
    fs.closeSync(errorFd);

    fs.writeFileSync(path.join(dir, 'pid'), String(proc.pid));
    proc.unref(); // Process survives Node.js exit

    plog('INFO', 'process_spawn', {
      sessionId: currentSessionId.slice(0, 8),
      pid: proc.pid,
      agent: getSessionAgent(session),
      mode: spawnSpec.mode,
      model: session.model || 'default',
      resume: spawnSpec.resume,
      codexHomeDir: spawnSpec.codexHomeDir || null,
      codexRuntimeKey: spawnSpec.codexRuntimeKey || null,
      command: spawnSpec.command,
      args: spawnSpec.args.join(' '),
    });

    // Fast exit detection (while Node.js is running)
    proc.on('exit', (code, signal) => {
      const entry = activeProcesses.get(currentSessionId);
      if (entry) entry.exitObserved = { code, signal };
      plog('INFO', 'process_exit_event', {
        sessionId: currentSessionId.slice(0, 8),
        pid: proc.pid,
        exitCode: code,
        signal: signal,
      });
      // Small delay to ensure file is fully flushed
      setTimeout(() => {
        const latest = activeProcesses.get(currentSessionId);
        const observed = latest?.exitObserved || { code, signal };
        handleProcessComplete(currentSessionId, observed.code, observed.signal);
      }, 300);
    });

    proc.on('error', (err) => {
      plog('ERROR', 'process_error_event', {
        sessionId: currentSessionId.slice(0, 8),
        pid: proc.pid,
        error: err.message,
      });
      try {
        fs.appendFileSync(errorPath, err.stack || err.message);
      } catch {}
      // If 'error' is emitted, 'exit' might not be. Call handleProcessComplete manually with an exit code.
      setTimeout(() => handleProcessComplete(currentSessionId, -1, null), 300);
    });

    const entry = {
      pid: proc.pid,
      ws,
      agent: getSessionAgent(session),
      cwd: spawnSpec.cwd,
      fullText: '',
      attachments: resolvedAttachments,
      toolCalls: [],
      lastCost: null,
      lastUsage: null,
      lastError: null,
      errorSent: false,
      codexHomeDir: spawnSpec.codexHomeDir || '',
      codexRuntimeKey: spawnSpec.codexRuntimeKey || '',
      tailer: null,
    };
    activeProcesses.set(currentSessionId, entry);
    sendSessionList(ws);

    // Tail the output file for real-time streaming
    entry.tailer = new FileTailer(outputPath, (line) => {
      try {
        const event = JSON.parse(line);
        processRuntimeEvent(entry, event, currentSessionId);
      } catch {}
    });
    entry.tailer.start();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    handleMessage,
    handleAbort,
    recoverProcesses,
    startHermesResponseStream,
    isProcessRunning,
    killProcess,
    FileTailer,
    // Expose for handleSlashCommand's /compact, /init, etc.
    compactStartMessage,
    compactDoneMessage,
    initStartMessage,
    buildCodexInitPrompt,
    compactAutoStartMessage,
    compactAutoResumeMessage,
    isContextLimitError,
    formatRuntimeError,
    filterRuntimeStderr,
    handleProcessComplete,
    parseSseChunkBuffer,
    hermesConversationIdForSession,
  };
}

module.exports = { createAgentManager };

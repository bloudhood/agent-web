'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_AGENTS = new Set(['claude', 'codex', 'hermes', 'gemini']);
const VALID_PERMISSION_MODES = new Set(['default', 'plan', 'yolo']);

const INITIAL_HISTORY_COUNT = 12;
const HISTORY_CHUNK_SIZE = 24;

function createSessionStore(sessionsDir, deps) {
  const {
    plog,
    wsSend,
    shared,
    config,
    notifier,
    IMAGE_MIME_TYPES,
    MAX_ATTACHMENT_SIZE,
    MAX_MESSAGE_ATTACHMENTS,
    ATTACHMENT_TTL_MS,
    ATTACHMENTS_DIR,
    // utils from lib/utils.js
    sanitizeId: utilSanitizeId,
    resolveMessageAttachments,
    collectSessionAttachmentIds,
    removeAttachmentById,
    saveAttachmentMeta,
    attachmentDataPath,
    extFromMime,
    safeFilename,
    isPathInside,
    // native session import
    CLAUDE_PROJECTS_DIR,
    CODEX_SESSIONS_DIR,
    CODEX_STATE_DB_PATH,
    CODEX_LOG_DB_PATH,
    // codex rollouts
    getCodexRolloutFiles,
    getImportedCodexThreadIds,
    parseCodexRolloutFile,
    parseCodexRolloutLines,
    // agent callbacks (late-bound)
    killProcess: killProcessRef,
    buildProcessLaunch,
    // late-bound refs object (set after all modules created)
    lateBound = {},
  } = deps;

  const activeProcesses = shared.activeProcesses;
  const wsSessionMap = shared.wsSessionMap;

  function sanitizeId(id) {
    return utilSanitizeId ? utilSanitizeId(id) : String(id).replace(/[^a-zA-Z0-9\-]/g, '');
  }

  function sessionPath(id) {
    return path.join(sessionsDir, `${sanitizeId(id)}.json`);
  }

  function runDir(sessionId) {
    return path.join(sessionsDir, `${sanitizeId(sessionId)}-run`);
  }

  // --- Agent / session normalization helpers ---

  function normalizeAgent(agent) {
    return VALID_AGENTS.has(agent) ? agent : 'claude';
  }

  function agentDisplayName(agent) {
    const normalized = normalizeAgent(agent);
    return normalized === 'codex' ? 'Codex'
      : normalized === 'hermes' ? 'Hermes'
        : normalized === 'gemini' ? 'Gemini'
          : 'Claude';
  }

  function normalizePermissionModeForAgent(agent, mode) {
    const normalizedAgent = normalizeAgent(agent);
    const normalizedMode = VALID_PERMISSION_MODES.has(mode) ? mode : 'yolo';
    if (normalizedAgent === 'gemini' && normalizedMode === 'default') return 'plan';
    return normalizedMode;
  }

  function normalizeMessageAttachments(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];
    return attachments;
  }

  function normalizeSession(session) {
    if (!session || typeof session !== 'object') return session;
    session.agent = normalizeAgent(session.agent);
    session.permissionMode = normalizePermissionModeForAgent(session.agent, session.permissionMode);
    if (!Object.prototype.hasOwnProperty.call(session, 'claudeSessionId')) session.claudeSessionId = null;
    if (!Object.prototype.hasOwnProperty.call(session, 'codexThreadId')) session.codexThreadId = null;
    if (!Object.prototype.hasOwnProperty.call(session, 'hermesResponseId')) session.hermesResponseId = null;
    if (!Object.prototype.hasOwnProperty.call(session, 'hermesConversationId')) session.hermesConversationId = '';
    if (!Object.prototype.hasOwnProperty.call(session, 'hermesSessionId')) session.hermesSessionId = null;
    if (!Object.prototype.hasOwnProperty.call(session, 'geminiSessionId')) session.geminiSessionId = null;
    if (!Object.prototype.hasOwnProperty.call(session, 'codexHomeDir')) session.codexHomeDir = '';
    if (!Object.prototype.hasOwnProperty.call(session, 'codexRuntimeKey')) session.codexRuntimeKey = '';
    if (!Object.prototype.hasOwnProperty.call(session, 'totalCost')) session.totalCost = 0;
    if (!Object.prototype.hasOwnProperty.call(session, 'totalUsage') || !session.totalUsage) {
      session.totalUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    }
    if (!Object.prototype.hasOwnProperty.call(session, 'taskMode')) session.taskMode = 'local';
    if (!Object.prototype.hasOwnProperty.call(session, 'sshHostId')) session.sshHostId = '';
    if (!Object.prototype.hasOwnProperty.call(session, 'remoteCwd')) session.remoteCwd = '';
    if (!Object.prototype.hasOwnProperty.call(session, 'messages')) session.messages = [];
    if (Array.isArray(session.messages)) {
      session.messages = session.messages.map((message) => {
        if (!message || typeof message !== 'object') return message;
        if (message.attachments) {
          return { ...message, attachments: normalizeMessageAttachments(message.attachments) };
        }
        return message;
      });
    }
    return session;
  }

  function getSessionAgent(session) {
    return normalizeAgent(session?.agent);
  }

  function isClaudeSession(session) {
    return getSessionAgent(session) === 'claude';
  }

  function isCodexSession(session) {
    return getSessionAgent(session) === 'codex';
  }

  function isHermesSession(session) {
    return getSessionAgent(session) === 'hermes';
  }

  function isGeminiSession(session) {
    return getSessionAgent(session) === 'gemini';
  }

  function getRuntimeSessionId(session) {
    if (!session) return null;
    const agent = getSessionAgent(session);
    if (agent === 'codex') return session.codexThreadId || null;
    if (agent === 'hermes') return session.hermesResponseId || null;
    if (agent === 'gemini') return session.geminiSessionId || null;
    return session.claudeSessionId || null;
  }

  function setRuntimeSessionId(session, runtimeId) {
    if (!session) return;
    const agent = getSessionAgent(session);
    if (agent === 'codex') {
      session.codexThreadId = runtimeId || null;
    } else if (agent === 'hermes') {
      session.hermesResponseId = runtimeId || null;
    } else if (agent === 'gemini') {
      session.geminiSessionId = runtimeId || null;
    } else {
      session.claudeSessionId = runtimeId || null;
    }
  }

  function clearRuntimeSessionId(session) {
    if (!session) return;
    setRuntimeSessionId(session, null);
    if (getSessionAgent(session) === 'hermes') {
      session.hermesConversationId = '';
      session.hermesSessionId = null;
    }
  }

  // --- CRUD ---

  function loadSession(id) {
    try {
      return normalizeSession(JSON.parse(fs.readFileSync(sessionPath(id), 'utf8')));
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    normalizeSession(session);
    const filePath = sessionPath(session.id);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2));
    fs.renameSync(tmpPath, filePath);
  }

  // --- History chunking ---

  function splitHistoryMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (list.length <= INITIAL_HISTORY_COUNT) {
      return { recentMessages: list, olderChunks: [] };
    }
    const recentMessages = list.slice(-INITIAL_HISTORY_COUNT);
    const older = list.slice(0, -INITIAL_HISTORY_COUNT);
    const olderChunks = [];
    for (let end = older.length; end > 0; end -= HISTORY_CHUNK_SIZE) {
      const start = Math.max(0, end - HISTORY_CHUNK_SIZE);
      olderChunks.push(older.slice(start, end));
    }
    return { recentMessages, olderChunks };
  }

  // --- Send session list ---

  function sendSessionList(ws) {
    try {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      const sessions = [];
      for (const f of files) {
        try {
          const s = normalizeSession(JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8')));
          sessions.push({
            id: s.id,
            title: s.title || 'Untitled',
            updated: s.updated,
            hasUnread: !!s.hasUnread,
            agent: getSessionAgent(s),
            isRunning: activeProcesses.has(s.id),
          });
        } catch {}
      }
      sessions.sort((a, b) => new Date(b.updated) - new Date(a.updated));
      wsSend(ws, { type: 'session_list', sessions });
    } catch {
      wsSend(ws, { type: 'session_list', sessions: [] });
    }
  }

  // --- Session management handlers ---

  function handleNewSession(ws, msg) {
    const { MODEL_MAP, resolveDefaultCodexModel, loadDevConfig, handleMessage, CONFIG_DIR } = lateBound;
    const cwd = (msg && msg.cwd) ? String(msg.cwd) : null;
    const agent = normalizeAgent(msg?.agent);
    const requestedMode = normalizePermissionModeForAgent(agent, VALID_PERMISSION_MODES.has(msg?.mode) ? msg.mode : 'yolo');
    const taskMode = msg?.taskMode === 'remote' ? 'remote' : 'local';
    const sshHostId = String(msg?.sshHostId || '').trim();
    const remoteCwd = String(msg?.remoteCwd || '').trim();

    let resolvedCwd = cwd || ((agent === 'claude' || agent === 'gemini') ? (process.env.HOME || process.env.USERPROFILE || process.cwd()) : null);
    let hostInfo = null;

    if (taskMode === 'remote' && sshHostId) {
      const devConfig = loadDevConfig();
      hostInfo = (devConfig.ssh.hosts || []).find(h => h.id === sshHostId) || null;
      if (hostInfo) {
        const hostDir = path.join(CONFIG_DIR, 'host', sshHostId);
        fs.mkdirSync(hostDir, { recursive: true });
        resolvedCwd = hostDir;
      }
    }

    const id = crypto.randomUUID();
    const session = {
      id,
      title: 'New Chat',
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
      permissionMode: normalizePermissionModeForAgent(agent, requestedMode),
      totalCost: 0,
      totalUsage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      messages: [],
      cwd: resolvedCwd,
      taskMode,
      sshHostId: taskMode === 'remote' ? sshHostId : '',
      remoteCwd: taskMode === 'remote' ? remoteCwd : '',
    };
    saveSession(session);
    wsSessionMap.set(ws, id);

    // modelShortName / sessionModelLabel are needed here
    const modelLabel = agent === 'hermes' ? (session.model || 'Hermes')
      : agent === 'gemini' ? (session.model || 'Gemini')
      : agent === 'codex' ? (session.model || null)
      : null;

    wsSend(ws, {
      type: 'session_info',
      sessionId: id,
      messages: [],
      title: session.title,
      mode: session.permissionMode,
      model: modelLabel,
      agent,
      cwd: session.cwd,
      totalCost: 0,
      totalUsage: session.totalUsage,
      updated: session.updated,
      hasUnread: false,
      historyPending: false,
      isRunning: false,
      taskMode: session.taskMode,
      sshHostId: session.sshHostId,
      remoteCwd: session.remoteCwd,
    });
    sendSessionList(ws);

    if (taskMode === 'remote' && hostInfo) {
      const authType = hostInfo.authType || 'key';
      const authInfo = authType === 'password'
        ? '密码认证（密码已配置，使用 sshpass 连接）'
        : `密钥认证：${hostInfo.identityFile || '(未配置)'}`;
      const sshCmd = authType === 'password'
        ? `sshpass -p <password> ssh -p ${hostInfo.port} ${hostInfo.user}@${hostInfo.host}`
        : `ssh -i ${hostInfo.identityFile} -p ${hostInfo.port} ${hostInfo.user}@${hostInfo.host}`;
      const initPrompt = [
        '[系统上下文]',
        '当前为远程任务会话。目标主机信息：',
        `- 主机名：${hostInfo.name}`,
        `- 地址：${hostInfo.user}@${hostInfo.host}:${hostInfo.port}`,
        `- 认证方式：${authInfo}`,
        `- 远端工作目录：${remoteCwd || 'SSH 默认目录'}`,
        `本地工作目录为 ${resolvedCwd}。`,
        `连接命令：${sshCmd}`,
        '严格禁止在回复中打印任何密钥或密码内容。',
      ].join('\n');
      handleMessage(ws, {
        text: initPrompt,
        sessionId: id,
        mode: requestedMode,
      }, { hideInHistory: true });
    }
  }

  function handleLoadSession(ws, sessionId) {
    const { modelShortName, sessionModelLabel } = lateBound;
    const session = loadSession(sessionId);
    if (!session) {
      return wsSend(ws, { type: 'error', message: 'Session not found' });
    }
    if (getSessionAgent(session) === 'claude' && !session.cwd && session.claudeSessionId) {
      const localMeta = resolveClaudeSessionLocalMeta(session.claudeSessionId);
      if (localMeta?.cwd) {
        session.cwd = localMeta.cwd;
        if (!session.importedFrom && localMeta.projectDir) session.importedFrom = localMeta.projectDir;
        saveSession(session);
      }
    }
    const { recentMessages, olderChunks } = splitHistoryMessages(session.messages);
    const effectiveCwd = session.cwd || activeProcesses.get(sessionId)?.cwd || null;

    for (const [, entry] of activeProcesses) {
      if (entry.ws === ws) entry.ws = null;
    }

    wsSessionMap.set(ws, sessionId);

    const hadUnread = !!session.hasUnread;
    if (session.hasUnread) {
      session.hasUnread = false;
      saveSession(session);
    }

    wsSend(ws, {
      type: 'session_info',
      sessionId: session.id,
      messages: recentMessages,
      title: session.title,
      mode: session.permissionMode || 'yolo',
      model: sessionModelLabel(session),
      agent: getSessionAgent(session),
      hasUnread: hadUnread,
      cwd: effectiveCwd,
      totalCost: session.totalCost || 0,
      totalUsage: session.totalUsage || null,
      historyTotal: session.messages.length,
      historyBuffered: recentMessages.length,
      historyPending: olderChunks.length > 0,
      updated: session.updated,
      isRunning: activeProcesses.has(sessionId),
      taskMode: session.taskMode || 'local',
      sshHostId: session.sshHostId || '',
      remoteCwd: session.remoteCwd || '',
    });

    if (olderChunks.length > 0) {
      olderChunks.forEach((chunk, index) => {
        wsSend(ws, {
          type: 'session_history_chunk',
          sessionId: session.id,
          messages: chunk,
          remaining: Math.max(0, olderChunks.length - index - 1),
        });
      });
    }

    if (activeProcesses.has(sessionId)) {
      const entry = activeProcesses.get(sessionId);
      entry.ws = ws;
      entry.wsDisconnectTime = null;
      plog('INFO', 'ws_resume_attach', {
        sessionId: sessionId.slice(0, 8),
        pid: entry.pid,
        responseLen: (entry.fullText || '').length,
      });
      wsSend(ws, {
        type: 'resume_generating',
        sessionId,
        text: entry.fullText || '',
        toolCalls: entry.toolCalls || [],
      });
    }
  }

  // --- Delete helpers ---

  function sqlQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  function deleteClaudeLocalSession(claudeSessionId) {
    if (!claudeSessionId) return;
    const projectsDir = CLAUDE_PROJECTS_DIR;
    try {
      for (const proj of fs.readdirSync(projectsDir)) {
        const target = path.join(projectsDir, proj, `${sanitizeId(claudeSessionId)}.jsonl`);
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
    } catch {}
  }

  function deleteCodexLocalSession(session) {
    const threadId = session?.codexThreadId;
    if (!threadId) return { removedFiles: 0, removedDbRows: false };

    const rolloutPaths = new Set();
    if (session.importedRolloutPath) rolloutPaths.add(path.resolve(session.importedRolloutPath));
    try {
      for (const filePath of getCodexRolloutFiles()) {
        if (filePath.includes(threadId)) rolloutPaths.add(path.resolve(filePath));
      }
    } catch {}

    let removedFiles = 0;
    for (const filePath of rolloutPaths) {
      try {
        if (isPathInside(CODEX_SESSIONS_DIR, filePath) && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          removedFiles++;
        }
      } catch {}
    }

    let removedDbRows = false;
    try {
      const { spawnSync } = require('child_process');
      const sqliteCheck = spawnSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'pipe'] });
      if (sqliteCheck.status !== 0) {
        plog('WARN', 'codex_delete_no_sqlite3', {
          stderr: String((sqliteCheck.stderr || '').toString()).slice(0, 200),
          status: sqliteCheck.status,
          spawnError: sqliteCheck.error ? String(sqliteCheck.error.message || sqliteCheck.error).slice(0, 200) : null,
        });
      } else {
        const quotedThreadId = sqlQuote(threadId);
        const stateSql = [
          'PRAGMA foreign_keys = ON;',
          `DELETE FROM thread_dynamic_tools WHERE thread_id = ${quotedThreadId};`,
          `DELETE FROM stage1_outputs WHERE thread_id = ${quotedThreadId};`,
          `DELETE FROM logs WHERE thread_id = ${quotedThreadId};`,
          `DELETE FROM threads WHERE id = ${quotedThreadId};`,
        ].join(' ');
        const stateResult = spawnSync('sqlite3', [CODEX_STATE_DB_PATH, stateSql], { stdio: ['ignore', 'ignore', 'pipe'] });
        if (stateResult.status === 0) {
          removedDbRows = true;
        } else {
          plog('WARN', 'codex_delete_state_db_failed', {
            db: CODEX_STATE_DB_PATH,
            exists: fs.existsSync(CODEX_STATE_DB_PATH),
            stderr: String((stateResult.stderr || '').toString()).slice(0, 500),
            status: stateResult.status,
            spawnError: stateResult.error ? String(stateResult.error.message || stateResult.error).slice(0, 200) : null,
          });
        }

        if (fs.existsSync(CODEX_LOG_DB_PATH)) {
          const logResult = spawnSync('sqlite3', [CODEX_LOG_DB_PATH, `DELETE FROM logs WHERE thread_id = ${quotedThreadId};`], { stdio: ['ignore', 'ignore', 'pipe'] });
          if (logResult.status !== 0) {
            plog('WARN', 'codex_delete_log_db_failed', {
              db: CODEX_LOG_DB_PATH,
              stderr: String((logResult.stderr || '').toString()).slice(0, 200),
              status: logResult.status,
            });
          }
        }
      }
    } catch {}

    return { removedFiles, removedDbRows };
  }

  function handleDeleteSession(ws, sessionId) {
    const { pendingSlashCommands, pendingCompactRetries } = shared;
    pendingSlashCommands.delete(sessionId);
    pendingCompactRetries.delete(sessionId);
    if (activeProcesses.has(sessionId)) {
      const entry = activeProcesses.get(sessionId);
      if (entry.agent === 'hermes' && entry.abortController) {
        entry.abortRequested = true;
        try { entry.abortController.abort(); } catch {}
      } else {
        try { killProcessRef(entry.pid); } catch {}
      }
      if (entry.tailer) entry.tailer.stop();
      activeProcesses.delete(sessionId);
      if (entry.ws) wsSend(entry.ws, { type: 'done', sessionId });
    }
    const cleanRunDir = lateBound.cleanRunDir || (() => {});
    cleanRunDir(sessionId);
    try {
      const p = sessionPath(sessionId);
      const session = loadSession(sessionId);
      const sessionAgent = getSessionAgent(session);
      for (const attachmentId of collectSessionAttachmentIds(session)) {
        removeAttachmentById(attachmentId);
      }
      if (fs.existsSync(p)) fs.unlinkSync(p);
      if (sessionAgent === 'codex') {
        const result = deleteCodexLocalSession(session);
        plog('INFO', 'codex_local_session_deleted', {
          sessionId: sessionId.slice(0, 8),
          threadId: session?.codexThreadId || null,
          removedFiles: result.removedFiles,
          removedDbRows: result.removedDbRows,
        });
      } else if (sessionAgent === 'claude') {
        deleteClaudeLocalSession(session?.claudeSessionId || null);
      }
      sendSessionList(ws);
    } catch {
      wsSend(ws, { type: 'error', message: 'Failed to delete session' });
    }
  }

  function handleRenameSession(ws, sessionId, title) {
    if (!sessionId || !title) return;
    const session = loadSession(sessionId);
    if (session) {
      session.title = String(title).slice(0, 100);
      session.updated = new Date().toISOString();
      saveSession(session);
      sendSessionList(ws);
      wsSend(ws, { type: 'session_renamed', sessionId, title: session.title });
    }
  }

  function handleSetMode(ws, sessionId, mode) {
    if (!mode || !VALID_PERMISSION_MODES.has(mode)) return;
    if (sessionId) {
      const session = loadSession(sessionId);
      if (session) {
        const agent = getSessionAgent(session);
        if (agent === 'gemini' && mode === 'default') {
          wsSend(ws, { type: 'system_message', message: 'Gemini CLI 的 default 模式需要终端原生确认；agent-web 手机端暂不提供网页批准/拒绝面板，已保持为 Plan。' });
        }
        session.permissionMode = normalizePermissionModeForAgent(agent, mode);
        session.updated = new Date().toISOString();
        saveSession(session);
        wsSend(ws, { type: 'mode_changed', mode: session.permissionMode });
        return;
      }
    }
    wsSend(ws, { type: 'mode_changed', mode: normalizePermissionModeForAgent('claude', mode) });
  }

  function handleDetachView(ws) {
    for (const [, entry] of activeProcesses) {
      if (entry.ws === ws) {
        entry.ws = null;
        entry.wsDisconnectTime = new Date().toISOString();
      }
    }
    wsSessionMap.delete(ws);
  }

  function handleDisconnect(ws, wsId) {
    const affectedSessions = [];
    for (const [sid, entry] of activeProcesses) {
      if (entry.ws === ws) {
        entry.ws = null;
        entry.wsDisconnectTime = new Date().toISOString();
        affectedSessions.push({ sessionId: sid.slice(0, 8), pid: entry.pid });
      }
    }
    wsSessionMap.delete(ws);
    plog('INFO', 'ws_disconnect', { wsId, activeProcessesAffected: affectedSessions });
  }

  // --- Native session import ---

  function resolveClaudeSessionLocalMeta(claudeSessionId) {
    if (!claudeSessionId) return null;
    try {
      const dirs = fs.readdirSync(CLAUDE_PROJECTS_DIR).filter((dir) => {
        try { return fs.statSync(path.join(CLAUDE_PROJECTS_DIR, dir)).isDirectory(); } catch { return false; }
      });
      for (const dir of dirs) {
        const filePath = path.join(CLAUDE_PROJECTS_DIR, dir, `${sanitizeId(claudeSessionId)}.jsonl`);
        if (!fs.existsSync(filePath)) continue;
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n');
          let cwd = null;
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const entry = JSON.parse(trimmed);
              if (entry.type === 'user' && entry.cwd) {
                cwd = entry.cwd;
                break;
              }
            } catch {}
          }
          return { cwd, projectDir: dir, filePath };
        } catch {}
      }
    } catch {}
    return null;
  }

  function parseJsonlToMessages(lines) {
    const messages = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry;
      try { entry = JSON.parse(trimmed); } catch { continue; }
      if (entry.type === 'user') {
        const raw = entry.message?.content;
        let content = '';
        if (typeof raw === 'string') {
          content = raw;
        } else if (Array.isArray(raw)) {
          content = raw
            .filter(b => b.type === 'text')
            .map(b => b.text || '')
            .join('');
        }
        if (content.trim()) {
          messages.push({ role: 'user', content, timestamp: entry.timestamp || null });
        }
      } else if (entry.type === 'assistant') {
        const blocks = entry.message?.content;
        if (!Array.isArray(blocks)) continue;
        let content = '';
        const toolCalls = [];
        for (const b of blocks) {
          if (b.type === 'text' && b.text) {
            content += b.text;
          } else if (b.type === 'tool_use') {
            toolCalls.push({ name: b.name, id: b.id, input: b.input, done: true });
          }
        }
        if (content.trim() || toolCalls.length > 0) {
          messages.push({ role: 'assistant', content, toolCalls, timestamp: entry.timestamp || null });
        }
      }
    }
    return messages;
  }

  function getImportedSessionIds() {
    const imported = new Set();
    try {
      for (const f of fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'))) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
          if (s.claudeSessionId) imported.add(s.claudeSessionId);
        } catch {}
      }
    } catch {}
    return imported;
  }

  function handleListNativeSessions(ws) {
    const groups = [];
    try {
      const imported = getImportedSessionIds();
      const dirs = fs.readdirSync(CLAUDE_PROJECTS_DIR).filter(d => {
        try { return fs.statSync(path.join(CLAUDE_PROJECTS_DIR, d)).isDirectory(); } catch { return false; }
      });
      for (const dir of dirs) {
        const dirPath = path.join(CLAUDE_PROJECTS_DIR, dir);
        const sessionItems = [];
        try {
          const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
          for (const f of files) {
            const sessionId = f.replace('.jsonl', '');
            const filePath = path.join(dirPath, f);
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              const lines = content.split('\n');
              let title = sessionId.slice(0, 20);
              let cwd = null;
              let updatedAt = null;
              let lastTs = null;
              for (const line of lines) {
                const t = line.trim();
                if (!t) continue;
                try {
                  const e = JSON.parse(t);
                  if (e.timestamp) lastTs = e.timestamp;
                  if (e.type === 'user' && !cwd) {
                    cwd = e.cwd || null;
                    const raw = e.message?.content;
                    let text = '';
                    if (typeof raw === 'string') text = raw;
                    else if (Array.isArray(raw)) text = raw.filter(b => b.type === 'text').map(b => b.text || '').join('');
                    if (text.trim()) title = text.trim().slice(0, 80).replace(/\n/g, ' ');
                  }
                } catch {}
              }
              updatedAt = lastTs;
              sessionItems.push({ sessionId, title, cwd, updatedAt, alreadyImported: imported.has(sessionId) });
            } catch {}
          }
        } catch {}
        if (sessionItems.length > 0) {
          sessionItems.sort((a, b) => {
            if (!a.updatedAt) return 1;
            if (!b.updatedAt) return -1;
            return new Date(b.updatedAt) - new Date(a.updatedAt);
          });
          groups.push({ dir, sessions: sessionItems });
        }
      }
    } catch {}
    wsSend(ws, { type: 'native_sessions', groups });
  }

  function handleImportNativeSession(ws, msg) {
    const { sessionId, projectDir } = msg;
    if (!sessionId || !projectDir) {
      return wsSend(ws, { type: 'error', message: '缺少 sessionId 或 projectDir' });
    }
    const filePath = path.join(CLAUDE_PROJECTS_DIR, String(projectDir), `${sanitizeId(sessionId)}.jsonl`);
    if (!isPathInside(CLAUDE_PROJECTS_DIR, filePath)) {
      return wsSend(ws, { type: 'error', message: '非法路径' });
    }
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch {
      return wsSend(ws, { type: 'error', message: '无法读取会话文件' });
    }
    const lines = content.split('\n');
    const messages = parseJsonlToMessages(lines);

    let existingSession = null;
    try {
      for (const f of fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'))) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
          if (s.claudeSessionId === sessionId) { existingSession = s; break; }
        } catch {}
      }
    } catch {}

    let title = sessionId.slice(0, 20);
    let cwd = null;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t);
        if (e.type === 'user') {
          if (!cwd) cwd = e.cwd || null;
          const raw = e.message?.content;
          let text = '';
          if (typeof raw === 'string') text = raw;
          else if (Array.isArray(raw)) text = raw.filter(b => b.type === 'text').map(b => b.text || '').join('');
          if (text.trim()) { title = text.trim().slice(0, 60).replace(/\n/g, ' '); break; }
        }
      } catch {}
    }

    const id = existingSession ? existingSession.id : crypto.randomUUID();
    const session = {
      id,
      title,
      created: existingSession?.created || new Date().toISOString(),
      updated: new Date().toISOString(),
      agent: 'claude',
      claudeSessionId: sessionId,
      codexThreadId: null,
      importedFrom: projectDir,
      model: existingSession?.model || null,
      permissionMode: existingSession?.permissionMode || 'yolo',
      totalCost: existingSession?.totalCost || 0,
      totalUsage: existingSession?.totalUsage || { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      messages,
      cwd: cwd || existingSession?.cwd || null,
    };
    saveSession(session);
    wsSessionMap.set(ws, id);

    const modelLabel = session.agent === 'claude' ? (session.model || null) : null;
    wsSend(ws, {
      type: 'session_info',
      sessionId: id,
      messages: session.messages,
      title: session.title,
      mode: session.permissionMode,
      model: modelLabel,
      agent: getSessionAgent(session),
      cwd: session.cwd,
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
    sendSessionList(ws);
  }

  function handleListCodexSessions(ws) {
    const imported = getImportedCodexThreadIds();
    const items = [];
    const seen = new Set();
    for (const filePath of getCodexRolloutFiles()) {
      const parsed = parseCodexRolloutFile(filePath);
      if (!parsed?.meta?.threadId) continue;
      if (seen.has(parsed.meta.threadId)) continue;
      seen.add(parsed.meta.threadId);
      const title = parsed.meta.title || parsed.meta.threadId.slice(0, 20);
      items.push({
        threadId: parsed.meta.threadId,
        title,
        cwd: parsed.meta.cwd || null,
        updatedAt: parsed.meta.updatedAt || null,
        cliVersion: parsed.meta.cliVersion || '',
        source: parsed.meta.source || '',
        rolloutPath: filePath,
        alreadyImported: imported.has(parsed.meta.threadId),
      });
    }
    wsSend(ws, { type: 'codex_sessions', sessions: items });
  }

  function handleImportCodexSession(ws, msg) {
    const threadId = String(msg?.threadId || '').trim();
    if (!threadId) {
      return wsSend(ws, { type: 'error', message: '缺少 threadId' });
    }

    let parsed = null;
    const requestedPath = msg?.rolloutPath ? path.resolve(String(msg.rolloutPath)) : '';
    if (requestedPath && isPathInside(CODEX_SESSIONS_DIR, requestedPath) && fs.existsSync(requestedPath)) {
      parsed = parseCodexRolloutFile(requestedPath);
    }
    if (!parsed) {
      for (const filePath of getCodexRolloutFiles()) {
        const candidate = parseCodexRolloutFile(filePath);
        if (candidate?.meta?.threadId === threadId) {
          parsed = candidate;
          break;
        }
      }
    }

    if (!parsed || parsed.meta.threadId !== threadId) {
      return wsSend(ws, { type: 'error', message: '未找到对应的 Codex 会话文件' });
    }

    let existingSession = null;
    try {
      for (const f of fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'))) {
        try {
          const s = normalizeSession(JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8')));
          if (s.codexThreadId === threadId) { existingSession = s; break; }
        } catch {}
      }
    } catch {}

    const id = existingSession ? existingSession.id : crypto.randomUUID();
    const session = {
      id,
      title: parsed.meta.title || existingSession?.title || threadId.slice(0, 20),
      created: existingSession?.created || new Date().toISOString(),
      updated: new Date().toISOString(),
      agent: 'codex',
      claudeSessionId: null,
      codexThreadId: threadId,
      importedFrom: 'codex',
      importedRolloutPath: parsed.filePath,
      model: existingSession?.model || null,
      permissionMode: existingSession?.permissionMode || 'yolo',
      totalCost: existingSession?.totalCost || 0,
      totalUsage: parsed.totalUsage || existingSession?.totalUsage || { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      messages: parsed.messages,
      cwd: parsed.meta.cwd || existingSession?.cwd || null,
    };

    saveSession(session);
    wsSessionMap.set(ws, id);

    const modelLabel = session.model || null;
    wsSend(ws, {
      type: 'session_info',
      sessionId: id,
      messages: session.messages,
      title: session.title,
      mode: session.permissionMode,
      model: modelLabel,
      agent: getSessionAgent(session),
      cwd: session.cwd,
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
    sendSessionList(ws);
  }

  function handleListCwdSuggestions(ws) {
    const paths = new Set();
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) paths.add(home);
    wsSend(ws, { type: 'cwd_suggestions', paths: Array.from(paths).sort() });
  }

  function handleBrowsePaths(ws, msg) {
    const requestId = msg?.requestId || null;
    const roots = getDirectoryRoots();
    const rawPath = String(msg?.path || '').trim();
    const fallback = roots[0] || process.cwd();
    let currentPath = fallback;
    if (rawPath) {
      const expanded = rawPath === '~'
        ? (process.env.HOME || process.env.USERPROFILE || fallback)
        : rawPath.replace(/^~(?=\\|\/)/, process.env.HOME || process.env.USERPROFILE || '');
      currentPath = path.resolve(expanded);
    }

    const response = {
      type: 'path_entries',
      requestId,
      path: currentPath,
      parent: null,
      roots,
      entries: [],
      error: '',
    };

    try {
      const stat = fs.statSync(currentPath);
      if (!stat.isDirectory()) {
        currentPath = path.dirname(currentPath);
        response.path = currentPath;
      }
    } catch (err) {
      response.error = `无法访问目录: ${err.message}`;
      return wsSend(ws, response);
    }

    const parsed = path.parse(currentPath);
    const parent = path.dirname(currentPath);
    response.parent = parent && parent !== currentPath ? parent : null;
    if (currentPath === parsed.root) response.parent = null;

    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const fullPath = path.join(currentPath, entry.name);
          let readable = true;
          try { fs.accessSync(fullPath, fs.constants.R_OK); } catch { readable = false; }
          return { name: entry.name, path: fullPath, readable };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
        .slice(0, 300);
      response.entries = entries;
    } catch (err) {
      response.error = `无法读取目录: ${err.message}`;
    }

    wsSend(ws, response);
  }

  // --- Public API ---

  return {
    VALID_AGENTS,
    VALID_PERMISSION_MODES,
    sanitizeId,
    sessionPath,
    runDir,
    normalizeAgent,
    agentDisplayName,
    normalizePermissionModeForAgent,
    normalizeSession,
    getSessionAgent,
    isClaudeSession,
    isCodexSession,
    isHermesSession,
    isGeminiSession,
    getRuntimeSessionId,
    setRuntimeSessionId,
    clearRuntimeSessionId,
    loadSession,
    saveSession,
    splitHistoryMessages,
    sendSessionList,
    resolveClaudeSessionLocalMeta,
    // Session management handlers
    handleNewSession,
    handleLoadSession,
    handleDeleteSession,
    handleRenameSession,
    handleSetMode,
    handleDetachView,
    handleDisconnect,
    // Native session import
    handleListNativeSessions,
    handleImportNativeSession,
    handleListCodexSessions,
    handleImportCodexSession,
    handleListCwdSuggestions,
    handleBrowsePaths,
  };
}

module.exports = { createSessionStore };

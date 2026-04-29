'use strict';

// ════════════════════════════════════════════════════════════════════════════
// cc-web server — thin entry point that wires extracted modules together.
//
// All business logic lives in lib/ modules:
//   shared-state, logger, auth, notify, config-manager, session-store,
//   agent-manager, routes, agent-runtime, codex-rollouts, utils
// ════════════════════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { WebSocketServer } = require('ws');

// ── Windows environment fix & load .env ────────────────────────────────────

const { fixWindowsEnv, killPortOccupant } = require('./lib/utils');
fixWindowsEnv();

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

// ── Constants ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT) || 8002;
const CLAUDE_PATH = process.env.CLAUDE_PATH || 'claude';
const CODEX_PATH = process.env.CODEX_PATH || 'codex';
const GEMINI_PATH = process.env.GEMINI_PATH || 'gemini';
const HERMES_API_BASE = (process.env.CC_WEB_HERMES_API_BASE || 'http://127.0.0.1:8644').replace(/\/+$/, '');
const HERMES_API_KEY = process.env.CC_WEB_HERMES_API_KEY || '';
const CONFIG_DIR = process.env.CC_WEB_CONFIG_DIR || path.join(__dirname, 'config');
const SESSIONS_DIR = process.env.CC_WEB_SESSIONS_DIR || path.join(__dirname, 'sessions');
const PUBLIC_DIR = process.env.CC_WEB_PUBLIC_DIR || path.join(__dirname, 'public');
const LOGS_DIR = process.env.CC_WEB_LOGS_DIR || path.join(__dirname, 'logs');
const ATTACHMENTS_DIR = path.join(SESSIONS_DIR, '_attachments');
const ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_MESSAGE_ATTACHMENTS = 4;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const CHANGELOG_PATH = path.join(__dirname, 'CHANGELOG.md');
const PACKAGE_JSON_PATH = path.join(__dirname, 'package.json');
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const CLAUDE_PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
const CODEX_SESSIONS_DIR = path.join(HOME, '.codex', 'sessions');
const CODEX_STATE_DB_PATH = path.join(HOME, '.codex', 'state_5.sqlite');
const CODEX_LOG_DB_PATH = path.join(HOME, '.codex', 'logs_1.sqlite');

const COMMAND_MANIFEST = require('./shared/commands.json');
const COMMANDS_FOR_CLIENT = COMMAND_MANIFEST.map(({ cmd, desc, kind, agents }) => ({ cmd, desc, kind, agents }));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ── Directory creation & Windows artifact cleanup ──────────────────────────

for (const dir of [SESSIONS_DIR, LOGS_DIR, CONFIG_DIR, ATTACHMENTS_DIR]) fs.mkdirSync(dir, { recursive: true });

if (process.platform === 'win32') {
  const artifact = path.join(__dirname, '%SystemDrive%');
  try {
    if (fs.existsSync(artifact) && !path.relative(path.resolve(__dirname), path.resolve(artifact)).startsWith('..')) {
      let hasFiles = false;
      try { for (const e of fs.readdirSync(artifact, { withFileTypes: true })) { if (e.isFile()) { hasFiles = true; break; } } } catch {}
      if (!hasFiles) fs.rmSync(artifact, { recursive: true, force: true });
    }
  } catch {}
}

// ── Module imports ─────────────────────────────────────────────────────────

const { createLogger } = require('./lib/logger');
const { createAuth } = require('./lib/auth');
const { createNotifier } = require('./lib/notify');
const { createConfigManager } = require('./lib/config-manager');
const { createSessionStore } = require('./lib/session-store');
const { createAgentManager } = require('./lib/agent-manager');
const { createRouter } = require('./lib/routes');
const { createCodexRolloutStore } = require('./lib/codex-rollouts');
const shared = require('./lib/shared-state');
const {
  sanitizeId, isPathInside, safeFilename, extFromMime, extractBearerToken,
  jsonResponse, buildProcessLaunch, createAttachmentHelpers,
} = require('./lib/utils');

// ── wsSend utility ─────────────────────────────────────────────────────────

const WS_BACKLOG_LIMIT = 4 * 1024 * 1024;

function wsSend(ws, data, dropIfBacklogged = false) {
  if (!ws || ws.readyState !== 1) return;
  if (dropIfBacklogged && ws.bufferedAmount > WS_BACKLOG_LIMIT) return;
  ws.send(JSON.stringify(data));
}

// ── Single-use helpers ─────────────────────────────────────────────────────

const { plog } = createLogger(LOGS_DIR);
const attachments = createAttachmentHelpers(ATTACHMENTS_DIR);

function modelShortName(fullModel) {
  if (!fullModel) return null;
  const entry = Object.entries(shared.MODEL_MAP).find(([, v]) => v === fullModel);
  return entry ? entry[0] : null;
}

function sessionModelLabel(session) {
  const agent = sessions.getSessionAgent(session);
  if (agent === 'hermes') return session?.model || 'Hermes';
  if (agent === 'gemini') return session?.model || 'Gemini';
  if (!session?.model) return null;
  const short = modelShortName(session.model);
  return agent === 'claude' ? (short || session.model) : session.model;
}

function cmdVersion(label, command) {
  try {
    const launch = buildProcessLaunch(command, ['--version']);
    const result = spawnSync(launch.command, launch.args, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const text = `${result.stdout || ''}${result.stderr || ''}`.trim().split(/\r?\n/).find(Boolean) || '';
    return result.status === 0 ? `${label}: OK${text ? ` (${text})` : ''}` : `${label}: 异常${text ? ` (${text.slice(0, 160)})` : ''}`;
  } catch (err) { return `${label}: 不可用 (${err.message})`; }
}

// ── Codex rollout store ────────────────────────────────────────────────────

const codexRollouts = createCodexRolloutStore({
  codexSessionsDir: CODEX_SESSIONS_DIR,
  sessionsDir: SESSIONS_DIR,
  normalizeSession: null,
  sanitizeToolInput: (name, input) => {
    if (!input) return input;
    if (typeof input === 'string') return input;
    try { return JSON.parse(JSON.stringify(input)); } catch { return String(input); }
  },
});

// ── Late-bound refs (filled after all modules created) ─────────────────────

const lateBound = {};

// ── Session store ──────────────────────────────────────────────────────────

const sessions = createSessionStore(SESSIONS_DIR, {
  plog, wsSend, shared,
  config: null, notifier: null,
  IMAGE_MIME_TYPES, MAX_ATTACHMENT_SIZE, MAX_MESSAGE_ATTACHMENTS, ATTACHMENT_TTL_MS, ATTACHMENTS_DIR,
  sanitizeId, extFromMime, safeFilename, isPathInside,
  resolveMessageAttachments: attachments.resolveMessageAttachments,
  collectSessionAttachmentIds: attachments.collectSessionAttachmentIds,
  removeAttachmentById: attachments.removeAttachmentById,
  saveAttachmentMeta: attachments.saveAttachmentMeta,
  attachmentDataPath: attachments.attachmentDataPath,
  CLAUDE_PROJECTS_DIR, CODEX_SESSIONS_DIR, CODEX_STATE_DB_PATH, CODEX_LOG_DB_PATH,
  getCodexRolloutFiles: codexRollouts.getCodexRolloutFiles,
  getImportedCodexThreadIds: codexRollouts.getImportedCodexThreadIds,
  parseCodexRolloutFile: codexRollouts.parseCodexRolloutFile,
  parseCodexRolloutLines: codexRollouts.parseCodexRolloutLines,
  killProcess: null, buildProcessLaunch, lateBound,
});

codexRollouts._normalizeSession = sessions.normalizeSession;

// ── Config manager ─────────────────────────────────────────────────────────

const configManager = createConfigManager(CONFIG_DIR, {
  plog, wsSend, shared,
  activeProcesses: shared.activeProcesses,
  sessionsDir: SESSIONS_DIR, logsDir: LOGS_DIR,
  loadSession: sessions.loadSession,
  saveSession: sessions.saveSession,
  getSessionAgent: sessions.getSessionAgent,
  sendSessionList: sessions.sendSessionList,
});

// ── Auth ───────────────────────────────────────────────────────────────────

const auth = createAuth(CONFIG_DIR, { plog, activeTokens: shared.activeTokens, wsSend });

// ── Notifier ───────────────────────────────────────────────────────────────

const notifier = createNotifier(CONFIG_DIR, {
  plog, wsSend,
  loadModelConfig: configManager.loadModelConfig,
  loadCodexConfig: configManager.loadCodexConfig,
  splitCodexModelSpec: configManager.splitCodexModelSpec,
  DEFAULT_CODEX_MODEL: configManager.DEFAULT_CODEX_MODEL,
});

// ── Agent manager ──────────────────────────────────────────────────────────

const agents = createAgentManager({
  plog, wsSend, shared,
  sessions: {
    loadSession: sessions.loadSession, saveSession: sessions.saveSession,
    getSessionAgent: sessions.getSessionAgent, isClaudeSession: sessions.isClaudeSession,
    isCodexSession: sessions.isCodexSession, isHermesSession: sessions.isHermesSession,
    isGeminiSession: sessions.isGeminiSession, normalizeAgent: sessions.normalizeAgent,
    normalizePermissionModeForAgent: sessions.normalizePermissionModeForAgent,
    normalizeSession: sessions.normalizeSession, agentDisplayName: sessions.agentDisplayName,
    getRuntimeSessionId: sessions.getRuntimeSessionId, setRuntimeSessionId: sessions.setRuntimeSessionId,
    clearRuntimeSessionId: sessions.clearRuntimeSessionId, runDir: sessions.runDir,
    VALID_AGENTS: sessions.VALID_AGENTS, VALID_PERMISSION_MODES: sessions.VALID_PERMISSION_MODES,
  },
  config: {
    loadModelConfig: configManager.loadModelConfig,
    prepareCodexCustomRuntime: configManager.prepareCodexCustomRuntime,
    backupClaudeSettings: configManager.backupClaudeSettings,
    restoreClaudeSettings: configManager.restoreClaudeSettings,
    applyCustomTemplateToSettings: configManager.applyCustomTemplateToSettings,
    resolveDefaultCodexModel: configManager.resolveDefaultCodexModel,
    loadCodexConfig: configManager.loadCodexConfig,
  },
  notifier: {
    sendNotification: notifier.sendNotification,
    buildNotifyContent: notifier.buildNotifyContent,
    loadNotifyConfig: notifier.loadNotifyConfig,
  },
  CLAUDE_PATH, CODEX_PATH, GEMINI_PATH, HERMES_API_BASE, HERMES_API_KEY,
  SESSIONS_DIR, MAX_MESSAGE_ATTACHMENTS,
  resolveMessageAttachments: attachments.resolveMessageAttachments,
  buildProcessLaunch, sendSessionList: sessions.sendSessionList,
  getWss: () => shared.wssRef.value,
  modelShortName, sessionModelLabel,
});

// ── Wire late-bound refs ───────────────────────────────────────────────────

Object.assign(lateBound, {
  MODEL_MAP: shared.MODEL_MAP,
  resolveDefaultCodexModel: configManager.resolveDefaultCodexModel,
  loadDevConfig: configManager.loadDevConfig,
  handleMessage: agents.handleMessage,
  CONFIG_DIR,
  modelShortName, sessionModelLabel,
  cleanRunDir: agents.cleanRunDir,
});

sessions._config = configManager;
sessions._notifier = notifier;
configManager.applyModelConfig();

// ── Formatting helpers (used by router) ────────────────────────────────────

function formatSessionStatus(session, agent) {
  const na = sessions.normalizeAgent(agent);
  if (!session) return `当前 Agent: ${sessions.agentDisplayName(na)}\n当前没有载入会话。`;
  const running = shared.activeProcesses.has(session.id);
  const runtimeId = sessions.getRuntimeSessionId(session);
  const usage = session.totalUsage || {};
  const lines = [
    `Agent: ${sessions.agentDisplayName(na)}`,
    `会话: ${session.title || 'Untitled'} (${session.id.slice(0, 8)})`,
    `状态: ${running ? '运行中' : '空闲'}`,
    `模式: ${session.permissionMode || 'yolo'}`,
    `模型: ${sessionModelLabel(session) || '默认'}`,
    `目录: ${session.cwd || '无'}`,
    `原生会话: ${runtimeId ? String(runtimeId) : '尚未建立'}`,
  ];
  if (na === 'claude') lines.push(`费用: $${Number(session.totalCost || 0).toFixed(4)}`);
  else lines.push(`Token: 输入 ${usage.inputTokens || 0}，缓存 ${usage.cachedInputTokens || 0}，输出 ${usage.outputTokens || 0}`);
  return lines.join('\n');
}

function formatUsageMessage(session, agent) {
  const na = sessions.normalizeAgent(agent);
  if (na === 'codex' || na === 'hermes' || na === 'gemini') {
    const usage = session?.totalUsage || { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    return `当前会话累计 Token: 输入 ${usage.inputTokens || 0}，缓存 ${usage.cachedInputTokens || 0}，输出 ${usage.outputTokens || 0}`;
  }
  return `当前会话累计费用: $${(session?.totalCost || 0).toFixed(4)}`;
}

function formatDoctorMessage(agent) {
  const na = sessions.normalizeAgent(agent);
  const lines = ['CLI 检查:', cmdVersion('Claude', CLAUDE_PATH), cmdVersion('Codex', CODEX_PATH), cmdVersion('Gemini', GEMINI_PATH), '', `当前 Agent: ${sessions.agentDisplayName(na)}`];
  if (na === 'hermes') lines.push(`Hermes Gateway: ${HERMES_API_BASE}`);
  return lines.join('\n');
}

function formatResumeMessage(session, agent) {
  const na = sessions.normalizeAgent(agent);
  if (!session) return '当前没有载入会话。请从左侧会话列表选择 cc-web 会话，或使用"导入本地会话"导入 Claude/Codex 原生历史。';
  const runtimeId = sessions.getRuntimeSessionId(session);
  const native = runtimeId ? `当前会话已绑定原生会话 ID：${runtimeId}` : '当前会话尚未建立原生会话 ID。发送第一条消息后会自动建立。';
  if (na === 'claude' || na === 'codex' || na === 'gemini') return `${native}\ncc-web 会在同一会话继续发送时自动 resume；如果要恢复其他原生会话，请从侧边栏导入。`;
  return `${native}\nHermes 使用 Gateway conversation 维持上下文；cc-web 目前只管理本地会话记录。`;
}

// ── Create router ──────────────────────────────────────────────────────────

const router = createRouter({
  fs, path, crypto, https: require('https'),
  PUBLIC_DIR, MIME_TYPES, COMMANDS_FOR_CLIENT, CHANGELOG_PATH, PACKAGE_JSON_PATH,
  ensureAuthLoaded: auth.ensureAuthLoaded,
  isTokenValid: auth.isTokenValid,
  isBanned: auth.isBanned,
  recordAuthFailure: auth.recordAuthFailure,
  activeTokens: shared.activeTokens,
  getPassword: auth.getPassword,
  getAuthConfig: auth.getAuthConfig,
  plog, wsSend, jsonResponse, extractBearerToken, isPathInside, safeFilename, sanitizeId, extFromMime,
  IMAGE_MIME_TYPES, MAX_ATTACHMENT_SIZE, ATTACHMENT_TTL_MS,
  attachmentDataPath: attachments.attachmentDataPath,
  attachmentMetaPath: attachments.attachmentMetaPath,
  saveAttachmentMeta: attachments.saveAttachmentMeta,
  removeAttachmentById: attachments.removeAttachmentById,
  normalizeAgent: sessions.normalizeAgent,
  agentDisplayName: sessions.agentDisplayName,
  normalizePermissionModeForAgent: sessions.normalizePermissionModeForAgent,
  getSessionAgent: sessions.getSessionAgent,
  sessionModelLabel, modelShortName,
  resolveDefaultCodexModel: configManager.resolveDefaultCodexModel,
  getRuntimeSessionId: sessions.getRuntimeSessionId,
  setRuntimeSessionId: sessions.setRuntimeSessionId,
  clearRuntimeSessionId: sessions.clearRuntimeSessionId,
  loadSession: sessions.loadSession,
  saveSession: sessions.saveSession,
  sendSessionList: sessions.sendSessionList,
  formatSessionStatus, formatUsageMessage, formatDoctorMessage, formatResumeMessage,
  commandVersionLine: cmdVersion,
  compactStartMessage: agents.compactStartMessage,
  initStartMessage: agents.initStartMessage,
  buildCodexInitPrompt: agents.buildCodexInitPrompt,
  activeProcesses: shared.activeProcesses,
  pendingSlashCommands: shared.pendingSlashCommands,
  killProcess: agents.killProcess,
  cleanRunDir: agents.cleanRunDir,
  getNotifyConfigMasked: notifier.getNotifyConfigMasked,
  getModelConfigMasked: configManager.getModelConfigMasked,
  getCodexConfigMasked: configManager.getCodexConfigMasked,
  getDevConfigMasked: configManager.getDevConfigMasked,
  handleMessage: agents.handleMessage,
  handleAbort: agents.handleAbort,
  handleNewSession: sessions.handleNewSession,
  handleLoadSession: sessions.handleLoadSession,
  handleDeleteSession: sessions.handleDeleteSession,
  handleRenameSession: sessions.handleRenameSession,
  handleSetMode: sessions.handleSetMode,
  handleDetachView: sessions.handleDetachView,
  handleSaveNotifyConfig: notifier.handleSaveNotifyConfig,
  handleTestNotify: notifier.handleTestNotify,
  handleChangePassword: auth.handleChangePassword,
  handleSaveModelConfig: configManager.handleSaveModelConfig,
  handleSaveCodexConfig: configManager.handleSaveCodexConfig,
  handleGetCcSwitchState: configManager.handleGetCcSwitchState,
  handleSwitchCcSwitchProvider: configManager.handleSwitchCcSwitchProvider,
  handleRefreshCcSwitchDesktop: configManager.handleRefreshCcSwitchDesktop,
  handleFetchModels: configManager.handleFetchModels,
  handleReadClaudeLocalConfig: configManager.handleReadClaudeLocalConfig,
  handleReadCodexLocalConfig: configManager.handleReadCodexLocalConfig,
  handleSaveLocalSnapshot: configManager.handleSaveLocalSnapshot,
  handleRestoreClaudeLocalSnapshot: configManager.handleRestoreClaudeLocalSnapshot,
  handleSaveDevConfig: configManager.handleSaveDevConfig,
  handleListNativeSessions: sessions.handleListNativeSessions,
  handleImportNativeSession: sessions.handleImportNativeSession,
  handleListCodexSessions: sessions.handleListCodexSessions,
  handleImportCodexSession: sessions.handleImportCodexSession,
  handleListCwdSuggestions: sessions.handleListCwdSuggestions,
  handleBrowsePaths: sessions.handleBrowsePaths,
  handleDisconnect: sessions.handleDisconnect,
  handleCheckUpdate: null,
  MODEL_MAP: shared.MODEL_MAP,
  VALID_PERMISSION_MODES: sessions.VALID_PERMISSION_MODES,
  DEV_CONFIG_PATH: configManager.DEV_CONFIG_PATH || path.join(CONFIG_DIR, 'dev.json'),
  COMMAND_MANIFEST, HERMES_API_BASE, CLAUDE_PATH, CODEX_PATH, GEMINI_PATH,
});

// ── Periodic tasks ─────────────────────────────────────────────────────────

attachments.cleanupExpiredAttachments();
setInterval(attachments.cleanupExpiredAttachments, 6 * 60 * 60 * 1000);

// ── HTTP / WebSocket server ────────────────────────────────────────────────

const server = http.createServer(router.handleHttpRequest);
const wss = new WebSocketServer({ server });
shared.wssRef.value = wss;
wss.on('connection', router.handleWsConnection);

// ── Startup ────────────────────────────────────────────────────────────────

agents.recoverProcesses();

setInterval(() => {
  if (shared.activeProcesses.size === 0) return;
  const procs = [];
  for (const [sid, entry] of shared.activeProcesses) {
    const alive = (() => { try { process.kill(entry.pid, 0); return true; } catch { return false; } })();
    procs.push({ sessionId: sid.slice(0, 8), pid: entry.pid, alive, wsConnected: !!entry.ws, wsDisconnectTime: entry.wsDisconnectTime || null, responseLen: (entry.fullText || '').length });
  }
  plog('INFO', 'heartbeat', { activeCount: procs.length, wsClients: wss.clients.size, processes: procs });
}, 60000);

plog('INFO', 'server_start', { port: PORT });

// ── Shutdown ───────────────────────────────────────────────────────────────

let shuttingDown = false;

function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  plog('INFO', 'server_shutdown_start', { reason, activeProcesses: shared.activeProcesses.size });
  try { for (const c of wss.clients) { try { c.close(1001, 'server shutting down'); } catch {} } } catch {}
  try { for (const [, entry] of shared.activeProcesses) { if (entry.tailer) entry.tailer.stop(); } } catch {}
  const forceTimer = setTimeout(() => { plog('WARN', 'server_shutdown_forced', { reason }); process.exit(exitCode); }, 5000);
  forceTimer.unref?.();
  try {
    server.close(() => { clearTimeout(forceTimer); plog('INFO', 'server_shutdown_complete', { reason }); process.exit(exitCode); });
  } catch (err) {
    clearTimeout(forceTimer); plog('ERROR', 'server_shutdown_error', { reason, error: err.message }); process.exit(exitCode);
  }
}

function handleServerListenError(err) {
  if (err && err.code === 'EADDRINUSE') {
    plog('WARN', 'server_port_in_use_retry', { port: PORT, host: '0.0.0.0' });
    if (killPortOccupant(PORT)) { try { server.listen(PORT, '0.0.0.0'); } catch {} return; }
    plog('ERROR', 'server_port_in_use', { port: PORT, error: err.message });
    console.error(`CC-Web server failed: 0.0.0.0:${PORT} is already in use.`);
    process.exit(98); return;
  }
  plog('ERROR', 'server_error', { error: err?.message || String(err) });
  console.error(err); process.exit(1);
}

server.on('error', handleServerListenError);
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('uncaughtException', (err) => {
  if (err && err.code === 'EADDRINUSE') return handleServerListenError(err);
  plog('ERROR', 'uncaught_exception', { error: err?.stack || err?.message || String(err) });
  console.error(err); shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  plog('ERROR', 'unhandled_rejection', { error: reason?.stack || reason?.message || String(reason) });
});

server.listen(PORT, '0.0.0.0', () => {
  auth.ensureAuthLoaded();
  console.log(`CC-Web server listening on 0.0.0.0:${PORT}`);
});

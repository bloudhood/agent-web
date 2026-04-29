'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

// ── Internal helpers (not exported) ─────────────────────────────────────────

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9\-]/g, '');
}

function dedupePaths(paths) {
  const seen = new Set();
  const result = [];
  for (const item of paths) {
    if (!item) continue;
    const resolved = path.resolve(item);
    const key = IS_WIN ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create the config manager subsystem.
 *
 * @param {string} configDir  – absolute path to the cc-web config directory
 * @param {object} deps
 * @param {Function} deps.plog           – (level, event, data?) => void
 * @param {Function} deps.wsSend         – (ws, data) => void
 * @param {object}   deps.shared         – { MODEL_MAP } — mutable shared reference
 * @param {Map}      deps.activeProcesses – shared sessionId → proc map
 * @param {string}   deps.sessionsDir    – absolute path to sessions directory
 * @param {string}   deps.logsDir        – absolute path to logs directory
 * @param {Function} [deps.loadSession]  – (sessionId) => session | null
 * @param {Function} [deps.saveSession]  – (session) => void
 * @param {Function} [deps.getSessionAgent] – (session) => string
 * @param {Function} [deps.sendSessionList] – (ws) => void
 * @returns {object} config-manager public API
 */
function createConfigManager(configDir, deps) {
  const {
    plog,
    wsSend,
    shared,
    activeProcesses,
    sessionsDir,
    logsDir,
    loadSession,
    saveSession,
    getSessionAgent,
    sendSessionList,
  } = deps;

  const MODEL_MAP = shared.MODEL_MAP;

  // ── Constants ───────────────────────────────────────────────────────────

  const MODEL_CONFIG_PATH = path.join(configDir, 'model.json');
  const CODEX_CONFIG_PATH = path.join(configDir, 'codex.json');
  const DEV_CONFIG_PATH   = path.join(configDir, 'dev.json');

  const CLAUDE_SETTINGS_PATH   = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'settings.json');
  const CLAUDE_SETTINGS_BACKUP = CLAUDE_SETTINGS_PATH + '.bak';
  const SETTINGS_API_KEYS = [
    'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_REASONING_MODEL',
  ];

  const CODEX_RUNTIME_HOME    = path.join(configDir, 'codex-runtime-home');
  const CODEX_SESSIONS_DIR    = path.join(process.env.HOME || process.env.USERPROFILE || '', '.codex', 'sessions');

  const DEFAULT_CODEX_MODEL = 'gpt-5.5';

  const DEFAULT_MODEL_CONFIG = {
    mode: 'local',
    templates: [],
    activeTemplate: '',
    localSnapshot: {},
  };

  const DEFAULT_CODEX_CONFIG = {
    mode: 'local',
    activeProfile: '',
    profiles: [],
    // TODO(v1.4): Wire up Codex search capability
    enableSearch: false,
    supportsSearch: false,
    localSnapshot: {},
  };

  const DEFAULT_DEV_CONFIG = { github: { token: '', repos: [] }, ssh: { hosts: [] } };

  const CODEX_COLD_START_SKIP_DIRS = new Set(['plugins', 'marketplace', 'memories', '.tmp']);

  // ── Model Config ────────────────────────────────────────────────────────

  function maskSecret(str) {
    if (!str || str.length <= 8) return str ? '****' : '';
    return str.slice(0, 4) + '****' + str.slice(-4);
  }

  function splitCodexModelSpec(model) {
    const raw = String(model || '').trim();
    if (!raw) return { raw: '', base: '', reasoning: '' };
    const match = raw.match(/^(.*)\((medium|high|xhigh)\)\s*$/i);
    if (!match) return { raw, base: raw, reasoning: '' };
    return {
      raw,
      base: String(match[1] || '').trim(),
      reasoning: String(match[2] || '').trim().toLowerCase(),
    };
  }

  function normalizeCodexModelList(models, defaultModel = '') {
    const seen = new Set();
    const list = [];

    function addModel(value) {
      const model = String(value || '').trim();
      if (!model || seen.has(model)) return;
      seen.add(model);
      list.push(model);
    }

    if (Array.isArray(models)) {
      models.forEach(addModel);
    }
    addModel(defaultModel);
    return list;
  }

  function loadModelConfig() {
    try {
      if (fs.existsSync(MODEL_CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(MODEL_CONFIG_PATH, 'utf8'));
        if (!config.localSnapshot) config.localSnapshot = {};
        return config;
      }
    } catch {}
    return JSON.parse(JSON.stringify(DEFAULT_MODEL_CONFIG));
  }

  function saveModelConfig(config) {
    fs.writeFileSync(MODEL_CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  function getModelConfigMasked() {
    const config = loadModelConfig();
    return {
      mode: config.mode,
      activeTemplate: config.activeTemplate,
      templates: (config.templates || []).map(t => ({
        name: t.name,
        apiKey: maskSecret(t.apiKey),
        apiBase: t.apiBase || '',
        defaultModel: t.defaultModel || '',
        opusModel: t.opusModel || '',
        sonnetModel: t.sonnetModel || '',
        haikuModel: t.haikuModel || '',
      })),
      localSnapshot: config.localSnapshot || {},
    };
  }

  // ── Claude settings helpers ─────────────────────────────────────────────

  function claudeModelMapFromEnv(env) {
    const source = env || {};
    const map = {};
    const withLongContext = (value) => {
      const model = String(value || '').trim();
      if (!model) return '';
      return model.endsWith('[1m]') ? model : `${model}[1m]`;
    };
    if (source.ANTHROPIC_DEFAULT_OPUS_MODEL) map.opus = withLongContext(source.ANTHROPIC_DEFAULT_OPUS_MODEL);
    if (source.ANTHROPIC_DEFAULT_SONNET_MODEL) map.sonnet = withLongContext(source.ANTHROPIC_DEFAULT_SONNET_MODEL);
    if (source.ANTHROPIC_DEFAULT_HAIKU_MODEL) map.haiku = String(source.ANTHROPIC_DEFAULT_HAIKU_MODEL).trim();
    if (!map.opus && source.ANTHROPIC_MODEL) map.opus = withLongContext(source.ANTHROPIC_MODEL);
    return Object.keys(map).length > 0 ? map : null;
  }

  function loadClaudeSettingsModelMap() {
    try {
      if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return null;
      const raw = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
      return claudeModelMapFromEnv(raw?.env || {});
    } catch {
      return null;
    }
  }

  function loadClaudeJsonModelMap() {
    try {
      const p = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude.json');
      if (!fs.existsSync(p)) return null;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return claudeModelMapFromEnv(raw?.env || {});
    } catch {
      return null;
    }
  }

  function applyCustomTemplateToSettings(tpl) {
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8')); } catch {}
    const cleanedEnv = {};
    for (const [k, v] of Object.entries(settings.env || {})) {
      if (!SETTINGS_API_KEYS.includes(k)) cleanedEnv[k] = v;
    }
    if (tpl.apiKey)       { cleanedEnv.ANTHROPIC_AUTH_TOKEN = tpl.apiKey; }
    if (tpl.apiBase)      cleanedEnv.ANTHROPIC_BASE_URL = tpl.apiBase;
    if (tpl.defaultModel) cleanedEnv.ANTHROPIC_MODEL = tpl.defaultModel;
    if (tpl.opusModel)    cleanedEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = tpl.opusModel;
    if (tpl.sonnetModel)  cleanedEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = tpl.sonnetModel;
    if (tpl.haikuModel)   cleanedEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = tpl.haikuModel;
    settings.env = cleanedEnv;
    // Atomic write: temp file + rename
    const tmpPath = CLAUDE_SETTINGS_PATH + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));
      fs.renameSync(tmpPath, CLAUDE_SETTINGS_PATH);
    } catch {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  function backupClaudeSettings() {
    try {
      if (fs.existsSync(CLAUDE_SETTINGS_PATH) && !fs.existsSync(CLAUDE_SETTINGS_BACKUP)) {
        fs.copyFileSync(CLAUDE_SETTINGS_PATH, CLAUDE_SETTINGS_BACKUP);
      }
    } catch (e) {
      plog('error', 'settings_backup_failed', { error: e.message });
    }
  }

  function restoreClaudeSettings() {
    try {
      if (fs.existsSync(CLAUDE_SETTINGS_BACKUP)) {
        const backup = fs.readFileSync(CLAUDE_SETTINGS_BACKUP, 'utf8');
        const current = fs.existsSync(CLAUDE_SETTINGS_PATH)
          ? fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8') : '';
        if (backup !== current) {
          fs.copyFileSync(CLAUDE_SETTINGS_BACKUP, CLAUDE_SETTINGS_PATH);
        }
        fs.unlinkSync(CLAUDE_SETTINGS_BACKUP);
      }
    } catch (e) {
      plog('error', 'settings_restore_failed', { error: e.message });
    }
  }

  function applyModelConfig() {
    const config = loadModelConfig();
    if (config.mode === 'custom' && config.activeTemplate) {
      const tpl = (config.templates || []).find(t => t.name === config.activeTemplate);
      if (tpl) {
        if (tpl.opusModel) MODEL_MAP.opus = tpl.opusModel.endsWith('[1m]') ? tpl.opusModel : tpl.opusModel + '[1m]';
        if (tpl.sonnetModel) MODEL_MAP.sonnet = tpl.sonnetModel.endsWith('[1m]') ? tpl.sonnetModel : tpl.sonnetModel + '[1m]';
        if (tpl.haikuModel) MODEL_MAP.haiku = tpl.haikuModel;
        return;
      }
    }
    // mode === 'local': read provider model names from CC Switch/Claude local config
    const localMap = loadClaudeSettingsModelMap() || loadClaudeJsonModelMap();
    if (localMap) {
      if (localMap.opus) MODEL_MAP.opus = localMap.opus;
      if (localMap.sonnet) MODEL_MAP.sonnet = localMap.sonnet;
      if (localMap.haiku) MODEL_MAP.haiku = localMap.haiku;
    }
  }

  // ── Codex Config ────────────────────────────────────────────────────────

  function readCodexLocalConfigSnapshot() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const config = { apiKey: '', apiBase: '', model: '' };
    let sourceFound = false;
    let hasApiKey = false;

    const codexConfigToml = path.join(homeDir, '.codex', 'config.toml');
    try {
      if (fs.existsSync(codexConfigToml)) {
        sourceFound = true;
        const toml = fs.readFileSync(codexConfigToml, 'utf8');
        const baseMatch = toml.match(/base_url\s*=\s*"([^"]+)"/);
        const modelMatch = toml.match(/^\s*model\s*=\s*"([^"]+)"/m);
        if (baseMatch) config.apiBase = baseMatch[1];
        if (modelMatch) config.model = modelMatch[1];
      }
    } catch {}

    const codexAuthJson = path.join(homeDir, '.codex', 'auth.json');
    try {
      if (fs.existsSync(codexAuthJson)) {
        sourceFound = true;
        const auth = JSON.parse(fs.readFileSync(codexAuthJson, 'utf8'));
        if (auth.OPENAI_API_KEY) {
          config.apiKey = auth.OPENAI_API_KEY;
          hasApiKey = true;
        }
      }
    } catch {}

    return { config, sourceFound, hasApiKey };
  }

  function codexLocalConfigPath() {
    return path.join(process.env.HOME || process.env.USERPROFILE || '', '.codex', 'config.toml');
  }

  function readCodexSafetyConfig() {
    const filePath = codexLocalConfigPath();
    const snapshot = { top: {}, windows: {} };
    try {
      if (!fs.existsSync(filePath)) return snapshot;
      let section = '';
      for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
        if (sectionMatch) {
          section = sectionMatch[1].trim().toLowerCase();
          continue;
        }
        const keyMatch = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!keyMatch) continue;
        const key = keyMatch[1];
        const rawValue = keyMatch[2];
        if (!section && ['approval_policy', 'sandbox_mode'].includes(key)) {
          snapshot.top[key] = rawValue;
        } else if (section === 'windows' && key === 'sandbox') {
          snapshot.windows[key] = rawValue;
        }
      }
    } catch {}
    return snapshot;
  }

  function setTomlRawValue(content, sectionName, key, rawValue) {
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const section = String(sectionName || '').toLowerCase();
    let start = 0;
    let end = lines.length;

    if (section) {
      start = -1;
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^\s*\[([^\]]+)\]\s*$/);
        if (!match) continue;
        if (match[1].trim().toLowerCase() === section) {
          start = i + 1;
          end = lines.length;
          for (let j = start; j < lines.length; j++) {
            if (/^\s*\[[^\]]+\]\s*$/.test(lines[j])) {
              end = j;
              break;
            }
          }
          break;
        }
      }
      if (start === -1) {
        if (lines.length && lines[lines.length - 1].trim()) lines.push('');
        lines.push(`[${sectionName}]`, `${key} = ${rawValue}`);
        return lines.join(eol);
      }
    } else {
      end = lines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
      if (end === -1) end = lines.length;
    }

    const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
    for (let i = start; i < end; i++) {
      if (keyPattern.test(lines[i])) {
        lines[i] = `${key} = ${rawValue}`;
        return lines.join(eol);
      }
    }
    lines.splice(end, 0, `${key} = ${rawValue}`);
    return lines.join(eol);
  }

  function restoreCodexSafetyConfig(snapshot) {
    if (!snapshot) return;
    const filePath = codexLocalConfigPath();
    try {
      if (!fs.existsSync(filePath)) return;
      let content = fs.readFileSync(filePath, 'utf8');
      for (const [key, rawValue] of Object.entries(snapshot.top || {})) {
        content = setTomlRawValue(content, '', key, rawValue);
      }
      for (const [key, rawValue] of Object.entries(snapshot.windows || {})) {
        content = setTomlRawValue(content, 'windows', key, rawValue);
      }
      const tmpPath = `${filePath}.cc-web-tmp`;
      fs.writeFileSync(tmpPath, content);
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      plog('WARN', 'codex_safety_restore_failed', { error: err.message });
    }
  }

  function resolveDefaultCodexModel() {
    const codexConfig = loadCodexConfig();
    if (codexConfig.mode === 'custom' && codexConfig.activeProfile) {
      const activeProfile = (codexConfig.profiles || []).find((profile) => profile.name === codexConfig.activeProfile);
      const profileModel = String(activeProfile?.model || '').trim();
      return profileModel || DEFAULT_CODEX_MODEL;
    }
    const localModel = String(readCodexLocalConfigSnapshot().config.model || '').trim();
    return localModel || DEFAULT_CODEX_MODEL;
  }

  function loadCodexConfig() {
    try {
      if (fs.existsSync(CODEX_CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CODEX_CONFIG_PATH, 'utf8'));
        return {
          mode: raw.mode === 'custom' ? 'custom' : 'local',
          activeProfile: raw.activeProfile || '',
          profiles: Array.isArray(raw.profiles) ? raw.profiles.map((profile) => ({
            name: String(profile?.name || '').trim(),
            apiKey: String(profile?.apiKey || ''),
            apiBase: String(profile?.apiBase || '').trim(),
            model: String(profile?.model || '').trim(),
            models: normalizeCodexModelList(profile?.models, profile?.model),
          })).filter((profile) => profile.name) : [],
          enableSearch: false,
          supportsSearch: false,
          storedEnableSearch: !!raw.enableSearch,
          localSnapshot: raw.localSnapshot || {},
        };
      }
    } catch {}
    return JSON.parse(JSON.stringify(DEFAULT_CODEX_CONFIG));
  }

  function saveCodexConfig(config) {
    fs.writeFileSync(CODEX_CONFIG_PATH, JSON.stringify({
      mode: config.mode === 'custom' ? 'custom' : 'local',
      activeProfile: config.activeProfile || '',
      profiles: Array.isArray(config.profiles) ? config.profiles.map((profile) => ({
        name: String(profile?.name || '').trim(),
        apiKey: String(profile?.apiKey || ''),
        apiBase: String(profile?.apiBase || '').trim(),
        model: String(profile?.model || '').trim(),
        models: normalizeCodexModelList(profile?.models, profile?.model),
      })).filter((profile) => profile.name) : [],
      // TODO(v1.4): Wire up Codex search capability
      enableSearch: false,
    }, null, 2));
  }

  function getCodexConfigMasked() {
    const config = loadCodexConfig();
    return {
      mode: config.mode === 'custom' ? 'custom' : 'local',
      activeProfile: config.activeProfile || '',
      profiles: (config.profiles || []).map((profile) => ({
        name: profile.name,
        apiKey: maskSecret(profile.apiKey),
        apiBase: profile.apiBase || '',
        model: profile.model || '',
        models: normalizeCodexModelList(profile.models, profile.model),
      })),
      enableSearch: false,
      supportsSearch: false,
      storedEnableSearch: !!config.storedEnableSearch,
      localSnapshot: config.localSnapshot || {},
    };
  }

  // ── Codex Runtime ───────────────────────────────────────────────────────

  function tomlString(value) {
    return JSON.stringify(String(value || ''));
  }

  function normalizeCodexRuntimeApiBase(apiBase) {
    const raw = String(apiBase || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (!url.pathname || url.pathname === '/') {
        url.pathname = '/v1';
        return url.toString().replace(/\/+$/, '');
      }
      return url.toString().replace(/\/+$/, '');
    } catch {
      return raw;
    }
  }

  function codexSessionHomeDir(sessionId) {
    return path.join(configDir, 'codex-session-home', sanitizeId(sessionId || 'default'));
  }

  function walkJsonlFiles(dir, files = []) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && CODEX_COLD_START_SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walkJsonlFiles(fullPath, files);
      else if (entry.isFile() && fullPath.endsWith('.jsonl')) files.push(fullPath);
    }
    return files;
  }

  function copyCodexThreadRollouts(threadId, targetHomeDir) {
    if (!threadId || !targetHomeDir) return;
    const targetSessionsDir = path.join(targetHomeDir, 'sessions');
    fs.mkdirSync(targetSessionsDir, { recursive: true });
    const sourceDirs = [CODEX_SESSIONS_DIR, path.join(CODEX_RUNTIME_HOME, 'sessions')];
    for (const sourceDir of sourceDirs) {
      try {
        for (const filePath of walkJsonlFiles(sourceDir)) {
          if (!filePath.includes(threadId)) continue;
          const rel = path.relative(sourceDir, filePath);
          if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
          const target = path.join(targetSessionsDir, rel);
          if (fs.existsSync(target)) continue;
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(filePath, target);
        }
      } catch {}
    }
  }

  function prepareCodexLocalRuntimeHome(homeDir) {
    fs.mkdirSync(homeDir, { recursive: true });
    const sourceHome = path.join(process.env.HOME || process.env.USERPROFILE || '', '.codex');
    try {
      const authSource = path.join(sourceHome, 'auth.json');
      if (fs.existsSync(authSource)) fs.copyFileSync(authSource, path.join(homeDir, 'auth.json'));
    } catch {}

    const sourceConfig = path.join(sourceHome, 'config.toml');
    const sourceText = (() => {
      try { return fs.existsSync(sourceConfig) ? fs.readFileSync(sourceConfig, 'utf8') : ''; } catch { return ''; }
    })();
    const keepTopLevelKeys = new Set([
      'model',
      'model_context_window',
      'model_auto_compact_token_limit',
      'model_reasoning_effort',
      'approval_policy',
      'sandbox_mode',
      'preferred_auth_method',
    ]);
    const lines = [];
    for (const line of sourceText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
      const key = trimmed.split('=')[0]?.trim();
      if (keepTopLevelKeys.has(key)) lines.push(trimmed);
    }
    const cwd = process.cwd().toLowerCase();
    const minimalConfig = [
      ...lines,
      '',
      '[windows]',
      'sandbox = "unelevated"',
      '',
      `[projects.${tomlString(cwd)}]`,
      'trust_level = "trusted"',
      '',
    ].join('\n');
    try {
      fs.writeFileSync(path.join(homeDir, 'config.toml'), minimalConfig);
    } catch {}
  }

  function ensureCodexSessionHome(session) {
    if (!session?.id) return CODEX_RUNTIME_HOME;
    if (!session.codexHomeDir) session.codexHomeDir = codexSessionHomeDir(session.id);
    if (session.codexThreadId) copyCodexThreadRollouts(session.codexThreadId, session.codexHomeDir);
    fs.mkdirSync(session.codexHomeDir, { recursive: true });
    return session.codexHomeDir;
  }

  function prepareCodexCustomRuntime(config, session = null) {
    const homeDir = ensureCodexSessionHome(session);
    if (!config || config.mode !== 'custom') {
      prepareCodexLocalRuntimeHome(homeDir);
      if (session) {
        session.codexHomeDir = homeDir;
        session.codexRuntimeKey = 'local';
      }
      return { mode: 'local', homeDir, runtimeKey: 'local' };
    }
    const profiles = Array.isArray(config.profiles) ? config.profiles : [];
    const activeProfile = profiles.find((profile) => profile.name === config.activeProfile) || null;
    if (!activeProfile) {
      return { error: 'Codex 自定义配置缺少已激活的 profile。请先在设置中创建并激活一个 API 配置。' };
    }
    if (!activeProfile.apiKey || !activeProfile.apiBase) {
      return { error: `Codex profile「${activeProfile.name}」缺少 API Key 或 API Base URL。` };
    }

    fs.mkdirSync(homeDir, { recursive: true });
    const modelSpec = splitCodexModelSpec(activeProfile.model || DEFAULT_CODEX_MODEL);
    const runtimeApiBase = normalizeCodexRuntimeApiBase(activeProfile.apiBase);
    const configToml = [
      'preferred_auth_method = "apikey"',
      'model_provider = "openai_compat"',
      ...(modelSpec.base ? [`model = ${tomlString(modelSpec.base)}`] : []),
      ...(modelSpec.reasoning ? [`model_reasoning_effort = ${tomlString(modelSpec.reasoning)}`] : []),
      '',
      '[model_providers.openai_compat]',
      `name = ${tomlString(activeProfile.name || 'OpenAI Compat')}`,
      `base_url = ${tomlString(runtimeApiBase)}`,
      'env_key = "OPENAI_API_KEY"',
      'wire_api = "responses"',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(homeDir, 'config.toml'), configToml);
    if (session) {
      session.codexHomeDir = homeDir;
      session.codexRuntimeKey = `custom:${activeProfile.name}`;
    }

    return {
      mode: 'custom',
      homeDir,
      apiKey: activeProfile.apiKey,
      apiBase: runtimeApiBase,
      model: activeProfile.model || '',
      runtimeKey: `custom:${activeProfile.name}`,
      profileName: activeProfile.name,
    };
  }

  // ── CC Switch ───────────────────────────────────────────────────────────

  function ccSwitchCandidatePaths() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const exe = IS_WIN ? 'cc-switch.exe' : 'cc-switch';
    return dedupePaths([
      process.env.CC_SWITCH_CLI_PATH,
      homeDir ? path.join(homeDir, 'bin', exe) : '',
      homeDir ? path.join(homeDir, '.local', 'bin', exe) : '',
      homeDir ? path.join(homeDir, 'cc-switch-extract', exe) : '',
      'cc-switch',
    ].filter(Boolean));
  }

  function sanitizeCcSwitchOutput(text) {
    return String(text || '')
      .replace(/sk-ant-[A-Za-z0-9._-]+/g, 'sk-ant-****')
      .replace(/sk-[A-Za-z0-9._-]{12,}/g, 'sk-****')
      .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, 'jwt.****')
      .replace(/(API Key:\s*)[^\r\n]+/gi, '$1****')
      .trim();
  }

  function findCcSwitchCli() {
    const errors = [];
    for (const candidate of ccSwitchCandidatePaths()) {
      if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
      try {
        const result = spawnSync(candidate, ['--version'], {
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true,
        });
        const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
        if (result.status === 0 && /^cc-switch\s+\d+\./i.test(output)) {
          return { ok: true, path: candidate, version: output.split(/\r?\n/)[0] };
        }
        if (output) errors.push(`${candidate}: ${sanitizeCcSwitchOutput(output).split(/\r?\n/)[0]}`);
      } catch (err) {
        errors.push(`${candidate}: ${err.message}`);
      }
    }
    return {
      ok: false,
      error: errors[0] || '未找到可用的 cc-switch CLI。已跳过桌面版 GUI exe，避免误启动窗口。',
      candidates: ccSwitchCandidatePaths(),
    };
  }

  function findCcSwitchDesktopApp() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const candidates = dedupePaths([
      process.env.CC_SWITCH_DESKTOP_PATH,
      homeDir ? path.join(homeDir, 'CC-Switch-Desktop', 'cc-switch.exe') : '',
    ].filter(Boolean));
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return { ok: true, path: candidate };
    }
    return { ok: false, error: '未找到 CC Switch 桌面端 exe', candidates };
  }

  function getCcSwitchDesktopPids(desktopPath) {
    if (!IS_WIN || !desktopPath) return [];
    try {
      const script = [
        '$target = [System.IO.Path]::GetFullPath($env:CC_SWITCH_DESKTOP_PATH)',
        'Get-CimInstance Win32_Process -Filter "name = \'cc-switch.exe\'" |',
        '  Where-Object { $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target) } |',
        '  ForEach-Object { $_.ProcessId }',
      ].join('\n');
      const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
        env: { ...process.env, CC_SWITCH_DESKTOP_PATH: desktopPath },
      });
      if (result.status !== 0) return [];
      return String(result.stdout || '')
        .split(/\r?\n/)
        .map((line) => Number(line.trim()))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function refreshCcSwitchDesktopApp() {
    const desktop = findCcSwitchDesktopApp();
    if (!desktop.ok) return desktop;
    const pids = getCcSwitchDesktopPids(desktop.path);
    for (const pid of pids) {
      try {
        if (IS_WIN) {
          spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else {
          process.kill(pid, 'SIGTERM');
        }
      } catch {}
    }
    if (pids.length) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
    try {
      const proc = spawn(desktop.path, [], {
        cwd: path.dirname(desktop.path),
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
      });
      proc.unref();
      return { ok: true, path: desktop.path, restarted: pids.length > 0, pid: proc.pid };
    } catch (err) {
      return { ok: false, path: desktop.path, error: err.message };
    }
  }

  function runCcSwitch(args, timeout = 15000) {
    const cli = findCcSwitchCli();
    if (!cli.ok) return { ok: false, cli, error: cli.error, stdout: '', stderr: '' };
    try {
      const result = spawnSync(cli.path, args, {
        encoding: 'utf8',
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      const stdout = sanitizeCcSwitchOutput(result.stdout || '');
      const stderr = sanitizeCcSwitchOutput(result.stderr || '');
      return {
        ok: result.status === 0,
        status: result.status,
        signal: result.signal || null,
        cli,
        stdout,
        stderr,
        error: result.error ? result.error.message : '',
      };
    } catch (err) {
      return { ok: false, cli, error: err.message, stdout: '', stderr: '' };
    }
  }

  function cleanCcSwitchCell(value) {
    return String(value || '')
      .replace(/[│┌┐└┘├┤┬┴┼─═╌╞╡╪]/g, '')
      .trim();
  }

  function parseCcSwitchProviderList(output) {
    const providers = [];
    for (const line of String(output || '').split(/\r?\n/)) {
      if (!line.includes('┆')) continue;
      const parts = line.split('┆').map(cleanCcSwitchCell);
      if (parts.length < 4) continue;
      const marker = parts[0] || '';
      const id = parts[1] || '';
      const name = parts[2] || '';
      const apiUrl = parts[3] || '';
      if (!id || /^ID$/i.test(id) || /[╪═─╌]/.test(id)) continue;
      providers.push({
        id,
        name,
        apiUrl: apiUrl === 'N/A' ? '' : apiUrl,
        current: marker.includes('✓'),
      });
    }
    return providers;
  }

  function normalizeCcSwitchApp(app) {
    const value = String(app || '').trim().toLowerCase();
    return value === 'codex' ? 'codex' : value === 'claude' ? 'claude' : '';
  }

  function getCcSwitchAppState(app) {
    const result = runCcSwitch(['--app', app, 'provider', 'list']);
    if (!result.ok) {
      const message = result.error || result.stderr || result.stdout || `cc-switch provider list failed for ${app}`;
      return { ok: false, app, error: message.split(/\r?\n/).slice(0, 3).join('\n'), providers: [] };
    }
    const providers = parseCcSwitchProviderList(result.stdout);
    const current = providers.find((provider) => provider.current) || null;
    return {
      ok: true,
      app,
      providers,
      currentProviderId: current?.id || '',
      currentProviderName: current?.name || '',
    };
  }

  function getCcSwitchState() {
    const cli = findCcSwitchCli();
    if (!cli.ok) return { cli, apps: {} };
    return {
      cli,
      apps: {
        claude: getCcSwitchAppState('claude'),
        codex: getCcSwitchAppState('codex'),
      },
    };
  }

  function resetClaudeModelMap() {
    MODEL_MAP.opus = 'claude-opus-4-6[1m]';
    MODEL_MAP.sonnet = 'claude-sonnet-4-6[1m]';
    MODEL_MAP.haiku = 'claude-haiku-4-5-20251001';
  }

  function refreshRuntimeAfterCcSwitch(app) {
    if (app === 'claude') {
      resetClaudeModelMap();
      applyModelConfig();
      return;
    }
    if (app !== 'codex') return;
    const nextDefaultModel = resolveDefaultCodexModel();
    if (!nextDefaultModel) return;
    try {
      for (const file of fs.readdirSync(sessionsDir)) {
        if (!file.endsWith('.json')) continue;
        const sessionId = file.slice(0, -5);
        try {
          const session = loadSession(sessionId);
          if (!session || getSessionAgent(session) !== 'codex') continue;
          session.model = nextDefaultModel;
          session.updated = new Date().toISOString();
          saveSession(session);
        } catch {}
      }
    } catch {}
  }

  // ── Dev Config ──────────────────────────────────────────────────────────

  function loadDevConfig() {
    try {
      if (fs.existsSync(DEV_CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(DEV_CONFIG_PATH, 'utf8'));
        return {
          github: {
            token: raw.github?.token || '',
            repos: Array.isArray(raw.github?.repos) ? raw.github.repos : [],
          },
          ssh: {
            hosts: Array.isArray(raw.ssh?.hosts) ? raw.ssh.hosts : [],
          },
        };
      }
    } catch {}
    return JSON.parse(JSON.stringify(DEFAULT_DEV_CONFIG));
  }

  function saveDevConfig(config) {
    fs.writeFileSync(DEV_CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  function getDevConfigMasked() {
    const config = loadDevConfig();
    return {
      github: {
        token: maskSecret(config.github.token),
        repos: config.github.repos || [],
      },
      ssh: {
        hosts: (config.ssh.hosts || []).map(h => ({
          id: h.id || '',
          name: h.name || '',
          host: h.host || '',
          port: h.port || 22,
          user: h.user || '',
          authType: h.authType || 'key',
          identityFile: h.identityFile || '',
          password: maskSecret(h.password || ''),
          description: h.description || '',
        })),
      },
    };
  }

  // ── WS Handlers ─────────────────────────────────────────────────────────

  function handleSaveModelConfig(ws, newConfig) {
    if (!newConfig || !['local', 'custom'].includes(newConfig.mode)) {
      return wsSend(ws, { type: 'error', message: '无效的模型配置' });
    }
    const current = loadModelConfig();
    const merged = {
      mode: newConfig.mode,
      activeTemplate: newConfig.activeTemplate || '',
      templates: [],
      localSnapshot: newConfig.localSnapshot || current.localSnapshot || {},
    };

    // Merge templates: keep existing secrets if masked
    const newTemplates = Array.isArray(newConfig.templates) ? newConfig.templates : [];
    const oldTemplates = Array.isArray(current.templates) ? current.templates : [];
    for (const nt of newTemplates) {
      if (!nt.name || !nt.name.trim()) continue;
      const old = oldTemplates.find(t => t.name === nt.name);
      merged.templates.push({
        name: nt.name.trim(),
        apiKey: (nt.apiKey && !nt.apiKey.includes('****')) ? nt.apiKey : (old?.apiKey || ''),
        apiBase: nt.apiBase || '',
        defaultModel: nt.defaultModel || '',
        opusModel: nt.opusModel || '',
        sonnetModel: nt.sonnetModel || '',
        haikuModel: nt.haikuModel || '',
      });
    }

    saveModelConfig(merged);

    // Re-apply at runtime (mutate in-place to preserve agent-runtime closure reference)
    MODEL_MAP.opus = 'claude-opus-4-6';
    MODEL_MAP.sonnet = 'claude-sonnet-4-6';
    MODEL_MAP.haiku = 'claude-haiku-4-5-20251001';
    applyModelConfig();
    // custom mode: write to ~/.claude/settings.json immediately on save
    if (merged.mode === 'custom' && merged.activeTemplate) {
      const tpl = merged.templates.find(t => t.name === merged.activeTemplate);
      if (tpl) { backupClaudeSettings(); applyCustomTemplateToSettings(tpl); }
    } else if (merged.mode === 'local') {
      restoreClaudeSettings();
    }

    // Remap ALL Claude sessions' model to current runtime MODEL_MAP values.
    const modelToTier = new Map();
    const lookupTemplates = [
      ...(Array.isArray(current.templates) ? current.templates : []),
      ...(Array.isArray(merged.templates) ? merged.templates : []),
    ];
    for (const tpl of lookupTemplates) {
      if (tpl.opusModel) {
        modelToTier.set(tpl.opusModel, 'opus');
        if (!tpl.opusModel.endsWith('[1m]')) modelToTier.set(tpl.opusModel + '[1m]', 'opus');
      }
      if (tpl.sonnetModel) {
        modelToTier.set(tpl.sonnetModel, 'sonnet');
        if (!tpl.sonnetModel.endsWith('[1m]')) modelToTier.set(tpl.sonnetModel + '[1m]', 'sonnet');
      }
      if (tpl.haikuModel) modelToTier.set(tpl.haikuModel, 'haiku');
    }
    try {
      for (const file of fs.readdirSync(sessionsDir)) {
        if (!file.endsWith('.json')) continue;
        const sessionId = file.slice(0, -5);
        try {
          const session = loadSession(sessionId);
          if (!session?.model || session.agent === 'codex') continue;
          const tier = modelToTier.get(session.model);
          if (tier && MODEL_MAP[tier] !== session.model) {
            session.model = MODEL_MAP[tier];
            session.updated = new Date().toISOString();
            saveSession(session);
          }
        } catch {}
      }
    } catch {}

    plog('INFO', 'model_config_saved', { mode: merged.mode, activeTemplate: merged.activeTemplate });
    wsSend(ws, { type: 'model_config', config: getModelConfigMasked() });
    wsSend(ws, { type: 'system_message', message: '模型配置已保存' });
  }

  function handleSaveCodexConfig(ws, newConfig) {
    if (!newConfig || typeof newConfig !== 'object') {
      return wsSend(ws, { type: 'error', message: '无效的 Codex 配置' });
    }
    const current = loadCodexConfig();
    const newProfiles = Array.isArray(newConfig.profiles) ? newConfig.profiles : [];
    const oldProfiles = Array.isArray(current.profiles) ? current.profiles : [];
    const mergedProfiles = [];
    for (const profile of newProfiles) {
      const name = String(profile?.name || '').trim();
      if (!name) continue;
      const old = oldProfiles.find((item) => item.name === name);
      const rawApiKey = String(profile?.apiKey || '');
      const rawModel = String(profile?.model || '').trim();
      const mergedModel = rawModel || String(old?.model || '').trim();
      const incomingModels = Array.isArray(profile?.models) ? profile.models : null;
      const mergedModelsSource = incomingModels && incomingModels.length > 0 ? incomingModels : old?.models;
      mergedProfiles.push({
        name,
        apiKey: rawApiKey && !rawApiKey.includes('****') ? rawApiKey : (old?.apiKey || ''),
        apiBase: String(profile?.apiBase || '').trim(),
        model: mergedModel,
        models: normalizeCodexModelList(
          mergedModelsSource,
          mergedModel,
        ),
      });
    }
    const requestedSearch = !!newConfig.enableSearch;
    const merged = {
      mode: newConfig.mode === 'custom' ? 'custom' : 'local',
      activeProfile: String(newConfig.activeProfile || '').trim(),
      profiles: mergedProfiles,
      // TODO(v1.4): Wire up Codex search capability
      enableSearch: false,
      supportsSearch: false,
      storedEnableSearch: requestedSearch,
      localSnapshot: newConfig.localSnapshot || current.localSnapshot || {},
    };
    if (merged.mode === 'custom' && merged.profiles.length > 0 && !merged.profiles.some((profile) => profile.name === merged.activeProfile)) {
      merged.activeProfile = merged.profiles[0].name;
    }
    saveCodexConfig(merged);
    const nextDefaultModel = resolveDefaultCodexModel();
    if (nextDefaultModel) {
      try {
        for (const file of fs.readdirSync(sessionsDir)) {
          if (!file.endsWith('.json')) continue;
          const sessionId = file.slice(0, -5);
          try {
            const session = loadSession(sessionId);
            if (!session || getSessionAgent(session) !== 'codex') continue;
            session.model = nextDefaultModel;
            session.updated = new Date().toISOString();
            saveSession(session);
          } catch {}
        }
      } catch {}
    }
    plog('INFO', 'codex_config_saved', {
      mode: merged.mode,
      activeProfile: merged.activeProfile || null,
      profileCount: merged.profiles.length,
      defaultModel: nextDefaultModel || null,
      enableSearchRequested: requestedSearch,
      enableSearchEffective: false,
    });
    wsSend(ws, { type: 'codex_config', config: getCodexConfigMasked() });
    wsSend(ws, {
      type: 'system_message',
      message: requestedSearch
        ? 'Codex 配置已保存。当前 cc-web 的 Codex exec 路径暂未接入 Web Search，已自动忽略该开关。'
        : 'Codex 配置已保存',
    });
  }

  function handleGetCcSwitchState(ws) {
    wsSend(ws, { type: 'ccswitch_state', state: getCcSwitchState() });
  }

  function handleRefreshCcSwitchDesktop(ws) {
    const result = refreshCcSwitchDesktopApp();
    plog(result.ok ? 'INFO' : 'WARN', 'ccswitch_desktop_refresh', {
      ok: !!result.ok,
      restarted: !!result.restarted,
      pid: result.pid || null,
      error: result.error || null,
    });
    wsSend(ws, {
      type: 'ccswitch_desktop_refresh_result',
      success: !!result.ok,
      message: result.ok
        ? `CC Switch 桌面端已${result.restarted ? '重启' : '启动'}刷新`
        : `刷新 CC Switch 桌面端失败: ${result.error || '未找到桌面端'}`,
    });
  }

  function handleSwitchCcSwitchProvider(ws, msg) {
    const app = normalizeCcSwitchApp(msg?.app);
    const providerId = String(msg?.providerId || '').trim();
    if (!app || !providerId) {
      return wsSend(ws, { type: 'ccswitch_switch_result', success: false, message: '无效的 CC Switch 切换参数' });
    }

    const before = getCcSwitchAppState(app);
    if (!before.ok) {
      return wsSend(ws, {
        type: 'ccswitch_switch_result',
        success: false,
        app,
        message: before.error || '无法读取 CC Switch provider 列表',
      });
    }
    const target = before.providers.find((provider) => provider.id === providerId);
    if (!target) {
      return wsSend(ws, {
        type: 'ccswitch_switch_result',
        success: false,
        app,
        message: `未找到 ${app} provider: ${providerId}`,
      });
    }

    const codexSafetyConfig = app === 'codex' ? readCodexSafetyConfig() : null;
    const result = runCcSwitch(['--app', app, 'provider', 'switch', providerId], 30000);
    if (app === 'codex') restoreCodexSafetyConfig(codexSafetyConfig);
    if (!result.ok) {
      const message = result.error || result.stderr || result.stdout || `cc-switch switch failed with status ${result.status}`;
      return wsSend(ws, {
        type: 'ccswitch_switch_result',
        success: false,
        app,
        providerId,
        message: message.split(/\r?\n/).slice(0, 4).join('\n'),
      });
    }

    refreshRuntimeAfterCcSwitch(app);
    const desktopRefresh = refreshCcSwitchDesktopApp();
    plog('INFO', 'ccswitch_provider_switched', { app, providerId, providerName: target.name || null });
    wsSend(ws, {
      type: 'ccswitch_switch_result',
      success: true,
      app,
      providerId,
      providerName: target.name || providerId,
      message: `${app === 'claude' ? 'Claude' : 'Codex'} 已切换到 ${target.name || providerId}${desktopRefresh.ok ? '，桌面端已刷新' : '，但桌面端刷新失败'}`,
      desktopRefresh,
    });
    wsSend(ws, { type: 'ccswitch_state', state: getCcSwitchState() });
    wsSend(ws, { type: 'system_message', message: `${app === 'claude' ? 'Claude' : 'Codex'} Provider 已切换为 ${target.name || providerId}` });
    if (sendSessionList) sendSessionList(ws);
  }

  function handleSaveDevConfig(ws, msg) {
    if (!msg.config || typeof msg.config !== 'object') {
      return wsSend(ws, { type: 'error', message: '无效的开发者配置' });
    }
    const current = loadDevConfig();
    let token = String(msg.config.github?.token || '');
    // Mask merge: keep existing if masked
    if (token.includes('****')) token = current.github.token;
    const repos = Array.isArray(msg.config.github?.repos) ? msg.config.github.repos.map(r => ({
      id: r.id || ('r_' + crypto.randomBytes(4).toString('hex')),
      name: String(r.name || '').trim(),
      url: String(r.url || '').trim(),
      branch: String(r.branch || 'main').trim(),
      notes: String(r.notes || '').trim(),
    })).filter(r => r.name && r.url) : [];
    const oldHosts = Array.isArray(current.ssh?.hosts) ? current.ssh.hosts : [];
    const hosts = Array.isArray(msg.config.ssh?.hosts) ? msg.config.ssh.hosts.map(h => {
      const old = oldHosts.find(oh => oh.id === h.id || oh.name === h.name);
      const authType = h.authType === 'password' ? 'password' : 'key';
      let password = String(h.password || '');
      if (password.includes('****')) password = old?.password || '';
      return {
        id: h.id || ('h_' + crypto.randomBytes(4).toString('hex')),
        name: String(h.name || '').trim(),
        host: String(h.host || '').trim(),
        port: parseInt(h.port) || 22,
        user: String(h.user || '').trim(),
        authType,
        identityFile: authType === 'key' ? String(h.identityFile || '').trim() : '',
        password: authType === 'password' ? password : '',
        description: String(h.description || '').trim(),
      };
    }).filter(h => h.name && h.host) : [];
    const merged = { github: { token, repos }, ssh: { hosts } };
    saveDevConfig(merged);
    plog('INFO', 'dev_config_saved', { repoCount: repos.length, hostCount: hosts.length });
    wsSend(ws, { type: 'dev_config', config: getDevConfigMasked() });
    wsSend(ws, { type: 'system_message', message: '开发者配置已保存' });
  }

  // ── Local Config Snapshot Handlers ──────────────────────────────────────

  function handleReadClaudeLocalConfig(ws) {
    let settings = {};
    let sourceFound = false;
    try {
      if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
        sourceFound = true;
      }
    } catch {}
    const env = settings.env || {};
    const config = {
      apiKey: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '',
      apiBase: env.ANTHROPIC_BASE_URL || '',
      defaultModel: env.ANTHROPIC_MODEL || '',
      opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
      sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
      haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
    };
    wsSend(ws, { type: 'claude_local_config', config, sourceFound });
  }

  function handleReadCodexLocalConfig(ws) {
    const { config, sourceFound, hasApiKey } = readCodexLocalConfigSnapshot();
    const result = { type: 'codex_local_config', config, sourceFound, hasApiKey };
    if (!hasApiKey) result.warning = '本机使用登录态认证，未检测到 API Key';
    wsSend(ws, result);
  }

  function handleSaveLocalSnapshot(ws, msg) {
    const config = loadModelConfig();
    config.localSnapshot = msg.snapshot || {};
    saveModelConfig(config);
    wsSend(ws, { type: 'model_config', config: getModelConfigMasked() });
    wsSend(ws, { type: 'system_message', message: '本地配置快照已保存' });
  }

  function handleRestoreClaudeLocalSnapshot(ws) {
    const config = loadModelConfig();
    const snapshot = config.localSnapshot;
    if (!snapshot || Object.keys(snapshot).length === 0) {
      return wsSend(ws, { type: 'error', message: '没有已保存的本地配置快照' });
    }
    backupClaudeSettings();
    applyCustomTemplateToSettings(snapshot);
    // Switch to local mode after restore
    config.mode = 'local';
    config.activeTemplate = '';
    saveModelConfig(config);
    // Reset MODEL_MAP to local defaults
    MODEL_MAP.opus = 'claude-opus-4-6';
    MODEL_MAP.sonnet = 'claude-sonnet-4-6';
    MODEL_MAP.haiku = 'claude-haiku-4-5-20251001';
    applyModelConfig();
    wsSend(ws, { type: 'model_config', config: getModelConfigMasked() });
    wsSend(ws, { type: 'system_message', message: '已恢复本地配置快照到 ~/.claude/settings.json' });
  }

  // ── Fetch Upstream Models ───────────────────────────────────────────────

  function handleFetchModels(ws, msg) {
    const { apiBase, apiKey, modelsEndpoint } = msg;
    if (!apiBase || !apiKey) {
      return wsSend(ws, { type: 'fetch_models_result', success: false, message: '需要填写 API Base 和 API Key' });
    }
    let base = apiBase.replace(/\/+$/, '');
    const endpoint = modelsEndpoint || '/v1/models';
    const fullUrl = base + endpoint;

    let parsed;
    try { parsed = new URL(fullUrl); } catch {
      return wsSend(ws, { type: 'fetch_models_result', success: false, message: '无效的 URL: ' + fullUrl });
    }

    // Resolve real apiKey (if masked, look up saved config by template name or apiBase)
    let realKey = apiKey;
    if (apiKey.includes('****')) {
      const modelConfig = loadModelConfig();
      const codexConfig = loadCodexConfig();
      const savedTemplates = modelConfig.templates || [];
      const savedProfiles = codexConfig.profiles || [];
      const tpl = (msg.templateName && savedTemplates.find((t) => t.name === msg.templateName))
        || savedTemplates.find((t) => t.apiBase && t.apiBase.replace(/\/+$/, '') === base)
        || null;
      const profile = (msg.profileName && savedProfiles.find((p) => p.name === msg.profileName))
        || savedProfiles.find((p) => p.apiBase && p.apiBase.replace(/\/+$/, '') === base)
        || null;
      if (tpl?.apiKey && !tpl.apiKey.includes('****')) realKey = tpl.apiKey;
      else if (profile?.apiKey && !profile.apiKey.includes('****')) realKey = profile.apiKey;
      else return wsSend(ws, { type: 'fetch_models_result', success: false, message: 'API Key 已脱敏，请重新输入完整 Key' });
    }

    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOptions = {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${realKey}` },
      timeout: 15000,
    };

    const req = mod.request(parsed, reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return wsSend(ws, { type: 'fetch_models_result', success: false, message: `HTTP ${res.statusCode}: ${body.slice(0, 200)}` });
        }
        try {
          const json = JSON.parse(body);
          const models = (json.data || json.models || []).map(m => typeof m === 'string' ? m : m.id || m.name || '').filter(Boolean).sort();
          wsSend(ws, { type: 'fetch_models_result', success: true, models });
        } catch (e) {
          wsSend(ws, { type: 'fetch_models_result', success: false, message: '解析响应失败: ' + e.message });
        }
      });
    });

    req.on('error', (e) => {
      wsSend(ws, { type: 'fetch_models_result', success: false, message: '请求失败: ' + e.message });
    });
    req.on('timeout', () => {
      req.destroy();
      wsSend(ws, { type: 'fetch_models_result', success: false, message: '请求超时 (15s)' });
    });
    req.end();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  return {
    // Model config
    loadModelConfig,
    saveModelConfig,
    getModelConfigMasked,
    loadCodexConfig,
    saveCodexConfig,
    getCodexConfigMasked,
    applyModelConfig,
    applyCustomTemplateToSettings,
    backupClaudeSettings,
    restoreClaudeSettings,
    splitCodexModelSpec,
    resolveDefaultCodexModel,
    maskSecret,
    normalizeCodexModelList,

    // Model map helpers
    claudeModelMapFromEnv,
    loadClaudeSettingsModelMap,
    loadClaudeJsonModelMap,

    // Codex runtime
    ensureCodexSessionHome,
    prepareCodexCustomRuntime,
    codexSessionHomeDir,

    // CC Switch
    getCcSwitchState,
    handleGetCcSwitchState,
    handleRefreshCcSwitchDesktop,
    handleSwitchCcSwitchProvider,
    refreshRuntimeAfterCcSwitch,
    resetClaudeModelMap,

    // Dev config
    loadDevConfig,
    getDevConfigMasked,
    handleSaveDevConfig,

    // WS handlers
    handleSaveModelConfig,
    handleSaveCodexConfig,
    handleReadClaudeLocalConfig,
    handleReadCodexLocalConfig,
    handleSaveLocalSnapshot,
    handleRestoreClaudeLocalSnapshot,
    handleFetchModels,

    // Constants
    DEFAULT_CODEX_MODEL,
    CLAUDE_SETTINGS_PATH,
    MODEL_MAP,
  };
}

module.exports = { createConfigManager };

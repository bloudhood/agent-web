'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readHermesProviderScript } = require('./hermes-provider-scripts');

function createHermesProviderBridge(opts = {}) {
  const {
    isWindows = process.platform === 'win32',
    env = process.env,
    firstMeaningfulLine = (text) => String(text || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '',
    now = () => Date.now(),
    stateCacheTtlMs,
    discoverConfigLocation: discoverConfigLocationOverride,
    runProviderScript: runProviderScriptOverride,
  } = opts;
  const rawCacheTtlMs = stateCacheTtlMs ?? env.CC_WEB_HERMES_STATE_CACHE_TTL_MS ?? 15_000;
  const cacheTtlMs = Number.isFinite(Number(rawCacheTtlMs)) ? Math.max(0, Number(rawCacheTtlMs)) : 15_000;
  let cachedState = null;
  let cachedStateAt = 0;

  function invalidateStateCache() {
    cachedState = null;
    cachedStateAt = 0;
  }

  function wslArgs(distro, args) {
    return distro ? ['-d', distro, '--', ...args] : ['--', ...args];
  }

  function runWslCommand(distro, args, timeout = 5000) {
    if (!isWindows) return { ok: false, status: -1, stdout: '', stderr: 'WSL is only available on Windows' };
    try {
      const result = spawnSync('wsl.exe', wslArgs(distro, args), {
        encoding: 'utf8',
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env,
      });
      return {
        ok: result.status === 0,
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: result.error ? result.error.message : '',
      };
    } catch (err) {
      return { ok: false, status: -1, stdout: '', stderr: '', error: err.message };
    }
  }

  function distroCandidates() {
    return [...new Set([
      env.CC_WEB_HERMES_WSL_DISTRO,
      env.HERMES_WSL_DISTRO,
      'Ubuntu-24.04',
      'Ubuntu',
      '',
    ].filter((value) => value !== undefined && value !== null).map((value) => String(value)))];
  }

  function discoverConfigLocation() {
    if (typeof discoverConfigLocationOverride === 'function') {
      return discoverConfigLocationOverride();
    }

    const directConfig = String(env.CC_WEB_HERMES_CONFIG_PATH || '').trim();
    if (directConfig && fs.existsSync(directConfig)) {
      return { ok: true, kind: 'file', configPath: directConfig, cliPath: env.CC_WEB_HERMES_CLI || '' };
    }

    const homeDir = env.HOME || env.USERPROFILE || '';
    const localConfig = homeDir ? path.join(homeDir, '.hermes', 'config.yaml') : '';
    if (!isWindows && localConfig && fs.existsSync(localConfig)) {
      return { ok: true, kind: 'file', configPath: localConfig, cliPath: env.CC_WEB_HERMES_CLI || 'hermes' };
    }

    if (!isWindows || env.CC_WEB_HERMES_WSL_DISABLED === '1') {
      return { ok: false, error: '未找到 Hermes config.yaml。可设置 CC_WEB_HERMES_CONFIG_PATH 或 CC_WEB_HERMES_WSL_DISTRO。' };
    }

    const script = readHermesProviderScript('discover');

    const errors = [];
    for (const distro of distroCandidates()) {
      const result = runWslCommand(distro, ['python3', '-c', script], 3500);
      if (result.ok) {
        const lines = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (lines[0]) return { ok: true, kind: 'wsl', distro, configPath: lines[0], cliPath: lines[1] || '' };
      }
      const detail = firstMeaningfulLine(result.stderr || result.stdout || result.error);
      if (detail) errors.push(`${distro || 'default'}: ${detail}`);
    }
    return { ok: false, error: errors[0] || '未在 WSL 中找到 Hermes config.yaml。' };
  }

  function parseJson(text) {
    try { return JSON.parse(text); }
    catch (err) { return { ok: false, error: `Hermes provider 状态解析失败: ${err.message}` }; }
  }

  function runProviderScript(location, action, providerId = '') {
    if (typeof runProviderScriptOverride === 'function') {
      return runProviderScriptOverride(location, action, providerId);
    }

    const code = readHermesProviderScript(action === 'switch' ? 'switch' : 'read');
    const args = action === 'switch'
      ? ['python3', '-c', code, location.configPath, providerId]
      : ['python3', '-c', code, location.configPath, location.cliPath || ''];
    const result = location.kind === 'wsl'
      ? runWslCommand(location.distro, args, 8000)
      : (() => {
          const python = env.PYTHON || env.PYTHON_PATH || 'python';
          try {
            const r = spawnSync(python, args.slice(1), { encoding: 'utf8', timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 });
            return { ok: r.status === 0, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? r.error.message : '' };
          } catch (err) {
            return { ok: false, status: -1, stdout: '', stderr: '', error: err.message };
          }
        })();
    if (!result.ok && !result.stdout) {
      return { ok: false, error: firstMeaningfulLine(result.stderr || result.error) || 'Hermes provider 操作失败' };
    }
    return parseJson(result.stdout || result.stderr || '{}');
  }

  function readStateUncached() {
    const location = discoverConfigLocation();
    if (!location.ok) {
      return {
        ok: false,
        app: 'hermes',
        error: location.error,
        providers: [],
        envStatus: { ok: false, app: 'hermes', summary: location.error, error: location.error },
        toolStatus: { ok: false, label: 'Hermes', status: '未识别到 Hermes WSL 配置', version: '' },
      };
    }
    const state = runProviderScript(location, 'read');
    if (!state.ok) {
      return {
        ok: false,
        app: 'hermes',
        error: state.error || '无法读取 Hermes provider',
        providers: [],
        envStatus: { ok: false, app: 'hermes', summary: state.error || '无法读取 Hermes provider', error: state.error || '' },
        toolStatus: { ok: false, label: 'Hermes', status: 'Hermes 配置读取失败', version: '' },
      };
    }
    return state;
  }

  function getState(options = {}) {
    const currentTime = Number(now());
    if (!options?.forceRefresh && cachedState && cacheTtlMs > 0 && currentTime - cachedStateAt < cacheTtlMs) {
      return cachedState;
    }
    const state = readStateUncached();
    if (cacheTtlMs > 0) {
      cachedState = state;
      cachedStateAt = currentTime;
    }
    return state;
  }

  function switchProvider(providerId) {
    const location = discoverConfigLocation();
    if (!location.ok) return { ok: false, error: location.error };
    const result = runProviderScript(location, 'switch', providerId);
    invalidateStateCache();
    return result;
  }

  function switchProviderWithState(providerId) {
    const before = getState({ forceRefresh: true });
    if (!before.ok) return { ok: false, message: before.error || '无法读取 Hermes provider 列表' };
    const target = before.providers.find((provider) => provider.id === providerId);
    if (!target || target.readonly) return { ok: false, message: `未找到可切换的 Hermes provider: ${providerId}` };
    const result = switchProvider(providerId);
    if (!result.ok) return { ok: false, message: result.error || 'Hermes provider 切换失败' };
    return { ok: true, providerName: result.providerName || target.name || providerId, state: getState({ forceRefresh: true }) };
  }

  function resolveModelLabel() {
    const state = getState();
    if (!state?.ok) return '';
    const current = (state.providers || []).find((provider) => provider.current) || null;
    return String(state.currentProviderName || current?.name || current?.model || '').trim();
  }

  return { getState, switchProvider, switchProviderWithState, discoverConfigLocation, resolveModelLabel, invalidateStateCache };
}

module.exports = { createHermesProviderBridge };

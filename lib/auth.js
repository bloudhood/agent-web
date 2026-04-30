'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Factory that creates a self-contained auth subsystem.
 *
 * @param {string} configDir  – directory for auth.json / banned_ips.json
 * @param {object} deps
 * @param {Function} deps.plog        – process logger (level, event, data?)
 * @param {Map}      deps.activeTokens – shared token→timestamp map
 * @param {Function} [deps.wsSend]    – (ws, data) => void, used by handleChangePassword
 * @returns {object} public auth API
 */
function createAuth(configDir, deps) {
  const { plog, activeTokens, wsSend } = deps;

  const AUTH_CONFIG_PATH  = path.join(configDir, 'auth.json');
  const BANNED_IPS_PATH   = path.join(configDir, 'banned_ips.json');

  // ── Internal state ────────────────────────────────────────────
  let authConfig = null;
  let PASSWORD   = '';

  const TOKEN_TTL        = 24 * 60 * 60 * 1000;   // 24 hours
  const AUTH_FAIL_WINDOW = 5  * 60 * 1000;         // 5 minutes
  const AUTH_FAIL_MAX    = 3;
  const BAN_DURATION     = 7  * 24 * 60 * 60 * 1000; // 7 days

  const authFailures = new Map();                   // ip -> [timestamp, ...]
  let bannedIPs      = new Map();                   // ip -> expireTimestamp

  // ── Whitelist ─────────────────────────────────────────────────
  const EXTRA_WHITELIST_IPS = new Set(
    String(process.env.CC_WEB_IP_WHITELIST || '')
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/^::ffff:/, '')),
  );

  function isWhitelistedIP(ip) {
    if (!ip) return false;
    const cleaned = ip.replace(/^::ffff:/, '');
    return cleaned === '127.0.0.1'
      || cleaned === '::1'
      || cleaned.startsWith('100.')
      || EXTRA_WHITELIST_IPS.has(cleaned);
  }

  // ── Password helpers ──────────────────────────────────────────
  function generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }

  function validatePasswordStrength(pw) {
    if (!pw || pw.length < 8) {
      return { valid: false, message: '密码长度至少 8 位' };
    }
    let types = 0;
    if (/[a-z]/.test(pw)) types++;
    if (/[A-Z]/.test(pw)) types++;
    if (/[0-9]/.test(pw)) types++;
    if (/[^a-zA-Z0-9]/.test(pw)) types++;
    if (types < 2) {
      return { valid: false, message: '密码需包含至少 2 种字符类型（大写/小写/数字/特殊字符）' };
    }
    return { valid: true, message: '' };
  }

  function loadAuthConfig() {
    // Priority 1: config/auth.json exists with password
    try {
      if (fs.existsSync(AUTH_CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(AUTH_CONFIG_PATH, 'utf8'));
        if (config.password) return config;
      }
    } catch {}

    // Priority 2: .env has CC_WEB_PASSWORD → migrate
    const envPw = process.env.CC_WEB_PASSWORD;
    if (envPw && envPw !== 'changeme') {
      const config = { password: envPw, mustChange: false };
      saveAuthConfig(config);
      return config;
    }

    // Priority 3: Generate random password
    const pw = generateRandomPassword(12);
    const config = { password: pw, mustChange: true };
    saveAuthConfig(config);
    console.log('========================================');
    console.log('  自动生成初始密码: ' + pw);
    console.log('  首次登录后将要求修改密码');
    console.log('========================================');
    return config;
  }

  function saveAuthConfig(config) {
    fs.writeFileSync(AUTH_CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  function ensureAuthLoaded() {
    if (!authConfig) {
      authConfig = loadAuthConfig();
      PASSWORD = authConfig.password;
    }
    return authConfig;
  }

  function getPassword() {
    return PASSWORD;
  }

  function getAuthConfig() {
    ensureAuthLoaded();
    return authConfig;
  }

  // ── Token management ──────────────────────────────────────────
  function isTokenValid(token) {
    if (!token || !activeTokens.has(token)) return false;
    const now = Date.now();
    if (now - activeTokens.get(token) > TOKEN_TTL) {
      activeTokens.delete(token);
      return false;
    }
    activeTokens.set(token, now);
    return true;
  }

  // Token cleanup interval (6 hours) — .unref() so it doesn't keep the process alive
  setInterval(() => {
    const now = Date.now();
    for (const [token, ts] of activeTokens) {
      if (now - ts > TOKEN_TTL) activeTokens.delete(token);
    }
  }, 6 * 60 * 60 * 1000).unref();

  // ── Banned IPs persistence ────────────────────────────────────
  function loadBannedIPs() {
    try {
      if (fs.existsSync(BANNED_IPS_PATH)) {
        const data = JSON.parse(fs.readFileSync(BANNED_IPS_PATH, 'utf8'));
        if (Array.isArray(data)) {
          const exp = Date.now() + BAN_DURATION;
          bannedIPs = new Map(data.map(ip => [ip, exp]));
        } else {
          bannedIPs = new Map(Object.entries(data).map(([ip, t]) => [ip, Number(t)]));
        }
      }
    } catch { bannedIPs = new Map(); }
  }

  function saveBannedIPs() {
    const obj = Object.fromEntries(bannedIPs);
    fs.writeFileSync(BANNED_IPS_PATH, JSON.stringify(obj, null, 2));
  }

  // Load banned IPs eagerly (mirrors original module-level call)
  loadBannedIPs();

  function isBanned(ip) {
    if (!ip || !bannedIPs.has(ip)) return false;
    const exp = bannedIPs.get(ip);
    if (exp !== -1 && Date.now() > exp) {
      bannedIPs.delete(ip);
      saveBannedIPs();
      return false;
    }
    return true;
  }

  function recordAuthFailure(ip) {
    if (!ip || isWhitelistedIP(ip)) return false;
    const now = Date.now();
    let list = authFailures.get(ip) || [];
    list.push(now);
    list = list.filter(t => now - t < AUTH_FAIL_WINDOW);
    authFailures.set(ip, list);
    if (list.length >= AUTH_FAIL_MAX) {
      bannedIPs.set(ip, Date.now() + BAN_DURATION);
      saveBannedIPs();
      authFailures.delete(ip);
      plog('WARN', 'ip_banned', { ip, reason: `${AUTH_FAIL_MAX} failed auth in ${AUTH_FAIL_WINDOW / 1000}s` });
      return true;
    }
    return false;
  }

  // ── Login / password-change ───────────────────────────────────
  /**
   * Verify a password-based login attempt.
   * @param {string} password
   * @param {string} ip
   * @returns {{ ok: boolean, token?: string, mustChange?: boolean, error?: string, banned?: boolean }}
   */
  function verifyLogin(password, ip) {
    ensureAuthLoaded();

    if (ip && isBanned(ip)) {
      return { ok: false, banned: true, error: 'IP banned' };
    }

    if (password === PASSWORD) {
      const token = crypto.randomBytes(32).toString('hex');
      activeTokens.set(token, Date.now());
      return { ok: true, token, mustChange: !!authConfig.mustChange };
    }

    const justBanned = recordAuthFailure(ip);
    return { ok: false, banned: justBanned, error: 'Wrong password' };
  }

  function changePassword(newPassword) {
    authConfig = { password: newPassword, mustChange: false };
    saveAuthConfig(authConfig);
    PASSWORD = newPassword;
  }

  function handleChangePassword(ws, msg, currentToken) {
    const { currentPassword, newPassword } = msg;

    // Validate current password
    if (currentPassword !== PASSWORD) {
      return wsSend(ws, { type: 'password_changed', success: false, message: '当前密码错误' });
    }

    // Validate new password strength
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return wsSend(ws, { type: 'password_changed', success: false, message: strength.message });
    }

    // Save new password
    changePassword(newPassword);
    plog('INFO', 'password_changed', {});

    // Clear all tokens (force all sessions to re-login)
    activeTokens.clear();

    // Generate new token for current connection
    const newToken = crypto.randomBytes(32).toString('hex');
    activeTokens.set(newToken, Date.now());

    wsSend(ws, { type: 'password_changed', success: true, token: newToken, message: '密码修改成功' });
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    ensureAuthLoaded,
    isTokenValid,
    isWhitelistedIP,
    isBanned,
    recordAuthFailure,
    verifyLogin,
    changePassword,
    handleChangePassword,
    validatePasswordStrength,
    generateRandomPassword,
    getPassword,
    getAuthConfig,
  };
}

module.exports = { createAuth };

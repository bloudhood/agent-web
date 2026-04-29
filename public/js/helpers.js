// === CC-Web Helpers Module ===
// Pure utility functions with no shared state dependencies.
window.CCWeb = window.CCWeb || {};

(function () {
  'use strict';

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}天前`;
    return new Date(dateStr).toLocaleDateString('zh-CN');
  }

  function formatFileSize(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size}B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
    return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  }

  function normalizeAgent(agent) {
    const AGENT_LABELS = { claude: 'Claude', codex: 'Codex', hermes: 'Hermes', gemini: 'Gemini' };
    return AGENT_LABELS[agent] ? agent : 'claude';
  }

  function getAvailableModes(agent) {
    return normalizeAgent(agent) === 'gemini' ? ['plan', 'yolo'] : ['yolo', 'default', 'plan'];
  }

  function normalizeModeForAgent(agent, mode) {
    const available = getAvailableModes(agent);
    return available.includes(mode) ? mode : (normalizeAgent(agent) === 'gemini' ? 'plan' : 'yolo');
  }

  function buildWelcomeMarkup(agent) {
    const AGENT_LABELS = { claude: 'Claude', codex: 'Codex', hermes: 'Hermes', gemini: 'Gemini' };
    const label = AGENT_LABELS[agent] || AGENT_LABELS.claude;
    return `<div class="welcome-msg"><div class="welcome-icon">✿</div><h3>欢迎使用 CC-Web</h3><p>开始与 ${label} 对话</p></div>`;
  }

  function deepClone(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function cloneMessages(messages) {
    return Array.isArray(messages) ? deepClone(messages) : [];
  }

  function getAgentSessionStorageKey(agent) {
    return `cc-web-session-${normalizeAgent(agent)}`;
  }

  function getAgentModeStorageKey(agent) {
    return `cc-web-mode-${normalizeAgent(agent)}`;
  }

  function getLastSessionForAgent(agent) {
    return localStorage.getItem(getAgentSessionStorageKey(agent));
  }

  function setLastSessionForAgent(agent, sessionId) {
    localStorage.setItem(getAgentSessionStorageKey(agent), sessionId);
    localStorage.setItem('cc-web-session', sessionId);
  }

  function clientValidatePassword(pw) {
    if (!pw || pw.length < 8) {
      return { valid: false, message: '密码长度至少 8 位' };
    }
    let types = 0;
    if (/[a-z]/.test(pw)) types++;
    if (/[A-Z]/.test(pw)) types++;
    if (/[0-9]/.test(pw)) types++;
    if (/[^a-zA-Z0-9]/.test(pw)) types++;
    if (types < 2) {
      return { valid: false, message: '需包含至少 2 种字符类型（大写/小写/数字/特殊字符）' };
    }
    return { valid: true, message: '' };
  }

  // --- Recent CWD memory (localStorage) ---
  const RECENT_CWD_KEY = 'cc-web-recent-cwds';
  const RECENT_CWD_MAX = 5;

  function getRecentCwds() {
    try {
      const raw = localStorage.getItem(RECENT_CWD_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function saveRecentCwd(cwd) {
    if (!cwd) return;
    let list = getRecentCwds().filter(p => p !== cwd);
    list.unshift(cwd);
    if (list.length > RECENT_CWD_MAX) list = list.slice(0, RECENT_CWD_MAX);
    try { localStorage.setItem(RECENT_CWD_KEY, JSON.stringify(list)); } catch {}
  }

  function getPinnedCwds(agent) {
    try {
      const raw = localStorage.getItem('cc-web-pinned-cwds-' + agent);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function savePinnedCwd(agent, cwd) {
    if (!cwd) return;
    let list = getPinnedCwds(agent);
    if (list.includes(cwd)) return;
    list.unshift(cwd);
    if (list.length > 5) list = list.slice(0, 5);
    try { localStorage.setItem('cc-web-pinned-cwds-' + agent, JSON.stringify(list)); } catch {}
  }

  function removePinnedCwd(agent, cwd) {
    let list = getPinnedCwds(agent).filter(p => p !== cwd);
    try { localStorage.setItem('cc-web-pinned-cwds-' + agent, JSON.stringify(list)); } catch {}
  }

  // Register on CCWeb namespace
  CCWeb.helpers = {
    escapeHtml,
    timeAgo,
    formatFileSize,
    normalizeAgent,
    getAvailableModes,
    normalizeModeForAgent,
    buildWelcomeMarkup,
    deepClone,
    cloneMessages,
    getAgentSessionStorageKey,
    getAgentModeStorageKey,
    getLastSessionForAgent,
    setLastSessionForAgent,
    clientValidatePassword,
    getRecentCwds,
    saveRecentCwd,
    getPinnedCwds,
    savePinnedCwd,
    removePinnedCwd,
    get AGENT_LABELS() { return CCWeb.AGENT_LABELS; },
  };
})();

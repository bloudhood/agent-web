// === Agent-Web UI Module ===
// Theme, scrollbar, sidebar, toast, viewport, pickers, slash commands, input events.
window.CCWeb = window.CCWeb || {};

(function () {
  'use strict';

  // --- Constants ---
  const SIDEBAR_SWIPE_TRIGGER = 72;
  const SIDEBAR_SWIPE_MAX_VERTICAL_DRIFT = 42;

  const MODEL_OPTIONS = [
    { value: 'opus', label: 'Opus', desc: '最强大，1M 上下文' },
    { value: 'sonnet', label: 'Sonnet', desc: '平衡性能，1M 上下文' },
    { value: 'haiku', label: 'Haiku', desc: '最快速，适合简单任务' },
  ];

  const MODE_PICKER_OPTIONS = [
    { value: 'yolo', label: 'YOLO', desc: '跳过所有权限检查' },
    { value: 'plan', label: 'Plan', desc: '执行前需确认计划' },
    { value: 'default', label: '默认', desc: 'CLI 原生审批；agent-web 暂不提供网页批准/拒绝面板' },
  ];

  const THEME_OPTIONS = [
    {
      value: 'washi',
      label: 'Washi Light',
      desc: '暖白底、炭黑文字与朱砂橙强调，和风克制美学。',
      swatches: ['#faf9f5', '#141413', '#e8e6dc', '#d97757'],
    },
    {
      value: 'washi-dark',
      label: 'Washi Dark',
      desc: '深炭底色 + 和纸白字，保留朱砂强调色。',
      swatches: ['#1a1410', '#f0e8dc', '#3d3028', '#d4664a'],
    },
  ];

  const DEFAULT_SLASH_COMMANDS = [
    { cmd: '/clear', desc: '清除当前会话' },
    { cmd: '/model', desc: '查看/切换模型' },
    { cmd: '/mode', desc: '查看/切换权限模式' },
    { cmd: '/permissions', desc: '查看/切换权限模式' },
    { cmd: '/status', desc: '查看当前会话状态' },
    { cmd: '/cost', desc: '查看会话费用' },
    { cmd: '/usage', desc: '查看 Token/费用统计' },
    { cmd: '/compact', desc: '压缩上下文' },
    { cmd: '/init', desc: '生成/更新 Agent 指南文件' },
    { cmd: '/resume', desc: '查看恢复会话方式' },
    { cmd: '/doctor', desc: '检查本机 CLI 状态' },
    { cmd: '/login', desc: '原生 CLI 登录说明' },
    { cmd: '/logout', desc: '原生 CLI 登录说明' },
    { cmd: '/auth', desc: 'Claude 原生认证说明' },
    { cmd: '/mcp', desc: '原生 MCP 配置说明' },
    { cmd: '/plugin', desc: '原生插件配置说明' },
    { cmd: '/plugins', desc: '原生插件配置说明' },
    { cmd: '/agents', desc: 'Claude 原生 agents 说明' },
    { cmd: '/extensions', desc: 'Gemini 原生 extensions 说明' },
    { cmd: '/skills', desc: 'Gemini 原生 skills 说明' },
    { cmd: '/hooks', desc: 'Gemini 原生 hooks 说明' },
    { cmd: '/memory', desc: '原生记忆配置说明' },
    { cmd: '/config', desc: '原生配置说明' },
    { cmd: '/update', desc: '原生更新说明' },
    { cmd: '/upgrade', desc: '原生更新说明' },
    { cmd: '/release-notes', desc: '原生版本说明' },
    { cmd: '/review', desc: 'Codex 原生 review 说明' },
    { cmd: '/apply', desc: 'Codex 原生 apply 说明' },
    { cmd: '/fork', desc: 'Codex 原生 fork 说明' },
    { cmd: '/features', desc: 'Codex 原生 features 说明' },
    { cmd: '/ide', desc: 'Claude IDE 集成说明' },
    { cmd: '/terminal-setup', desc: '终端集成说明' },
    { cmd: '/vim', desc: '终端编辑模式说明' },
    { cmd: '/export', desc: '原生导出说明' },
    { cmd: '/bug', desc: '原生反馈说明' },
    { cmd: '/github', desc: 'GitHub 操作（读取开发者配置后执行）' },
    { cmd: '/ssh', desc: 'SSH 远程操作（读取开发者配置后执行）' },
    { cmd: '/help', desc: '显示帮助' },
  ];
  let slashCommands = DEFAULT_SLASH_COMMANDS.slice();

  async function loadCommandManifest() {
    try {
      const response = await fetch('/api/commands', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const commands = Array.isArray(payload?.commands) ? payload.commands : [];
      const normalized = commands
        .map((command) => ({
          cmd: String(command?.cmd || '').trim(),
          desc: String(command?.desc || '').trim(),
          agents: Array.isArray(command?.agents) ? command.agents : [],
        }))
        .filter((command) => command.cmd.startsWith('/') && command.desc);
      if (normalized.length > 0) slashCommands = normalized;
    } catch {}
  }

  // --- Viewport height fix for mobile browsers ---
  function setVH() {
    const height = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${height * 0.01}px`);
  }

  // --- Theme ---
  function normalizeTheme(theme) {
    return THEME_OPTIONS.some((item) => item.value === theme) ? theme : 'washi';
  }

  function getThemeOption(theme) {
    return THEME_OPTIONS.find((item) => item.value === normalizeTheme(theme)) || THEME_OPTIONS[0];
  }

  function refreshThemeSummaries() {
    const state = CCWeb.state;
    const label = getThemeOption(state.currentTheme).label;
    document.querySelectorAll('[data-theme-summary]').forEach((node) => {
      node.textContent = label;
    });
  }

  function applyTheme(theme) {
    const state = CCWeb.state;
    state.currentTheme = normalizeTheme(theme);
    document.documentElement.dataset.theme = state.currentTheme;
    localStorage.setItem('cc-web-theme', state.currentTheme);
    refreshThemeSummaries();
  }

  function buildThemePickerHtml(options = {}) {
    const state = CCWeb.state;
    const { showSectionTitle = true } = options;
    return `
      ${showSectionTitle ? '<div class="settings-section-title">界面主题</div>' : ''}
      <div class="theme-grid">
        ${THEME_OPTIONS.map((theme) => `
          <button class="theme-card${theme.value === state.currentTheme ? ' active' : ''}" type="button" data-theme-value="${theme.value}">
            <div class="theme-card-preview">
              ${theme.swatches.map((color) => `<span class="theme-card-swatch" style="background:${color}"></span>`).join('')}
            </div>
            <div class="theme-card-title">${CCWeb.helpers.escapeHtml(theme.label)}</div>
            <div class="theme-card-desc">${CCWeb.helpers.escapeHtml(theme.desc)}</div>
          </button>
        `).join('')}
      </div>
    `;
  }

  function mountThemePicker(panel) {
    const state = CCWeb.state;
    panel.querySelectorAll('[data-theme-value]').forEach((button) => {
      button.addEventListener('click', () => {
        applyTheme(button.dataset.themeValue);
        panel.querySelectorAll('[data-theme-value]').forEach((item) => {
          item.classList.toggle('active', item.dataset.themeValue === state.currentTheme);
        });
      });
    });
  }

  function buildThemeEntryHtml() {
    const state = CCWeb.state;
    return `
      <div class="settings-section-title">外观</div>
      <button class="settings-nav-card" type="button" data-open-theme-page>
        <span class="settings-nav-card-main">
          <span class="settings-nav-card-title">界面主题</span>
          <span class="settings-nav-card-meta">当前：<span data-theme-summary>${CCWeb.helpers.escapeHtml(getThemeOption(state.currentTheme).label)}</span></span>
        </span>
        <span class="settings-nav-card-arrow" aria-hidden="true">›</span>
      </button>
    `;
  }

  // --- CWD Badge ---
  function shouldOverlayRuntimeBadge() {
    return window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
  }

  function updateCwdBadge() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    if (!dom.chatCwd) return;
    if (state.currentCwd) {
      const normalized = state.currentCwd.replace(/[\\/]+$/, '');
      const parts = normalized.split(/[\\/]+/).filter(Boolean);
      const short = parts.slice(-2).join('/') || state.currentCwd;
      dom.chatCwd.textContent = short;
      dom.chatCwd.title = state.currentCwd;
    } else {
      dom.chatCwd.textContent = '';
      dom.chatCwd.title = '';
    }
    dom.chatCwd.hidden = !state.currentCwd || (state.currentSessionRunning && shouldOverlayRuntimeBadge());
  }

  function setCurrentSessionRunningState(isRunning) {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    const running = !!isRunning;
    state.currentSessionRunning = running;
    if (dom.chatRuntimeState) {
      dom.chatRuntimeState.hidden = !running;
      dom.chatRuntimeState.textContent = running ? '运行中' : '';
    }
    updateCwdBadge();
  }

  function syncModeOptions() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    if (!dom.modeSelect) return;
    const available = new Set(CCWeb.helpers.getAvailableModes(state.currentAgent));
    Array.from(dom.modeSelect.options).forEach((option) => {
      option.hidden = !available.has(option.value);
      option.disabled = !available.has(option.value);
    });
    if (state.currentAgent === 'gemini') {
      dom.modeSelect.title = 'Gemini 仅支持 yolo / plan 模式（default 模式由 tool-use 实现提供，Gemini 不支持）';
    } else {
      dom.modeSelect.title = '权限模式';
    }
    state.currentMode = CCWeb.helpers.normalizeModeForAgent(state.currentAgent, state.currentMode);
    dom.modeSelect.value = state.currentMode;
  }

  function updateAgentScopedUI() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    if (dom.agentSelect) dom.agentSelect.value = state.currentAgent;
    if (dom.importSessionBtn) {
      const importable = state.currentAgent === 'claude' || state.currentAgent === 'codex';
      dom.importSessionBtn.hidden = !importable;
      dom.importSessionBtn.textContent = importable
        ? (state.currentAgent === 'codex' ? '导入 Codex' : '导入')
        : '';
    }
    if (dom.attachBtn) {
      const supportsAttachments = state.currentAgent === 'claude' || state.currentAgent === 'codex';
      dom.attachBtn.disabled = !supportsAttachments;
      dom.attachBtn.title = supportsAttachments ? '添加图片' : `${CCWeb.helpers.AGENT_LABELS?.[state.currentAgent] || state.currentAgent} 会话暂不支持图片附件`;
      if (!supportsAttachments && (state.pendingAttachments.length || state.uploadingAttachments.length)) {
        state.pendingAttachments = [];
        state.uploadingAttachments = [];
        renderPendingAttachments();
      }
    }
    syncModeOptions();
  }

  // --- Custom Scrollbar ---
  let isDragging = false;

  function updateScrollbar() {
    const dom = CCWeb.dom;
    const scrollbarEl = document.getElementById('custom-scrollbar');
    const thumbEl = document.getElementById('custom-scrollbar-thumb');
    if (!scrollbarEl || !thumbEl || !dom.messagesDiv) return;
    const { scrollTop, scrollHeight, clientHeight } = dom.messagesDiv;
    if (scrollHeight <= clientHeight) {
      thumbEl.style.display = 'none';
      return;
    }
    thumbEl.style.display = '';
    const trackH = scrollbarEl.clientHeight;
    const thumbH = Math.max(30, trackH * clientHeight / scrollHeight);
    const thumbTop = (scrollTop / (scrollHeight - clientHeight)) * (trackH - thumbH);
    thumbEl.style.height = thumbH + 'px';
    thumbEl.style.top = thumbTop + 'px';
  }

  function scrollToBottom() {
    const dom = CCWeb.dom;
    requestAnimationFrame(() => {
      dom.messagesDiv.scrollTop = dom.messagesDiv.scrollHeight;
      updateScrollbar();
    });
  }

  // --- Sidebar ---
  function openSidebar() {
    const dom = CCWeb.dom;
    dom.sidebar.classList.add('open');
    dom.sidebarOverlay.hidden = false;
  }

  function closeSidebar() {
    const dom = CCWeb.dom;
    dom.sidebar.classList.remove('open');
    dom.sidebarOverlay.hidden = true;
  }

  function canOpenSidebarBySwipe(target) {
    const dom = CCWeb.dom;
    if (!window.matchMedia('(max-width: 768px), (pointer: coarse)').matches) return false;
    if (dom.sidebar.classList.contains('open')) return false;
    if (dom.sessionLoadingOverlay && !dom.sessionLoadingOverlay.hidden) return false;
    if (!dom.chatMain || !target || !dom.chatMain.contains(target)) return false;
    if (!dom.app.hidden && target && target.closest('input, textarea, select, button, .modal-panel, .settings-panel, .option-picker, .cmd-menu')) {
      return false;
    }
    return true;
  }

  function canCloseSidebarBySwipe(target) {
    const dom = CCWeb.dom;
    if (!window.matchMedia('(max-width: 768px), (pointer: coarse)').matches) return false;
    if (!dom.sidebar.classList.contains('open')) return false;
    if (!target) return false;
    return dom.sidebar.contains(target) || target === dom.sidebarOverlay;
  }

  function handleSidebarSwipeStart(e) {
    const state = CCWeb.state;
    if (!e.touches || e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (canCloseSidebarBySwipe(e.target)) {
      state.sidebarSwipe = {
        startX: touch.clientX,
        startY: touch.clientY,
        active: true,
        mode: 'close',
      };
      return;
    }
    if (!canOpenSidebarBySwipe(e.target)) {
      state.sidebarSwipe = null;
      return;
    }
    state.sidebarSwipe = {
      startX: touch.clientX,
      startY: touch.clientY,
      active: true,
      mode: 'open',
    };
  }

  function handleSidebarSwipeMove(e) {
    const state = CCWeb.state;
    if (!state.sidebarSwipe?.active || !e.touches || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - state.sidebarSwipe.startX;
    const deltaY = touch.clientY - state.sidebarSwipe.startY;
    if (Math.abs(deltaY) > SIDEBAR_SWIPE_MAX_VERTICAL_DRIFT && Math.abs(deltaY) > Math.abs(deltaX)) {
      state.sidebarSwipe = null;
      return;
    }
    const horizontalIntent = state.sidebarSwipe.mode === 'open' ? deltaX > 12 : deltaX < -12;
    if (horizontalIntent && Math.abs(deltaY) < SIDEBAR_SWIPE_MAX_VERTICAL_DRIFT) {
      e.preventDefault();
    }
  }

  function handleSidebarSwipeEnd(e) {
    const state = CCWeb.state;
    if (!state.sidebarSwipe?.active) return;
    const touch = e.changedTouches && e.changedTouches[0];
    const endX = touch ? touch.clientX : state.sidebarSwipe.startX;
    const endY = touch ? touch.clientY : state.sidebarSwipe.startY;
    const deltaX = endX - state.sidebarSwipe.startX;
    const deltaY = endY - state.sidebarSwipe.startY;
    const shouldOpen = state.sidebarSwipe.mode === 'open' &&
      deltaX >= SIDEBAR_SWIPE_TRIGGER &&
      Math.abs(deltaY) <= SIDEBAR_SWIPE_MAX_VERTICAL_DRIFT;
    const shouldClose = state.sidebarSwipe.mode === 'close' &&
      deltaX <= -SIDEBAR_SWIPE_TRIGGER &&
      Math.abs(deltaY) <= SIDEBAR_SWIPE_MAX_VERTICAL_DRIFT;
    state.sidebarSwipe = null;
    if (shouldOpen) {
      openSidebar();
    } else if (shouldClose) {
      closeSidebar();
    }
  }

  // --- Slash Command Menu ---
  function showCmdMenu(filter) {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    const filtered = slashCommands.filter(c =>
      c.cmd.startsWith(filter) || c.desc.includes(filter.slice(1))
    );
    filtered.sort((a, b) => (b.cmd === filter ? 1 : 0) - (a.cmd === filter ? 1 : 0));
    if (filtered.length === 0) {
      hideCmdMenu();
      return;
    }
    state.cmdMenuIndex = 0;
    dom.cmdMenu.innerHTML = filtered.map((c, i) =>
      `<div class="cmd-item${i === 0 ? ' active' : ''}" data-cmd="${CCWeb.helpers.escapeHtml(c.cmd)}">
        <span class="cmd-item-cmd">${CCWeb.helpers.escapeHtml(c.cmd)}</span>
        <span class="cmd-item-desc">${CCWeb.helpers.escapeHtml(c.desc)}</span>
      </div>`
    ).join('');
    dom.cmdMenu.hidden = false;

    dom.cmdMenu.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => {
        const cmd = el.dataset.cmd;
        if (cmd === '/model') {
          hideCmdMenu();
          dom.msgInput.value = '';
          showModelPicker();
          return;
        }
        if (cmd === '/mode' || cmd === '/permissions') {
          hideCmdMenu();
          dom.msgInput.value = '';
          showModePicker();
          return;
        }
        dom.msgInput.value = cmd + ' ';
        hideCmdMenu();
        dom.msgInput.focus();
      });
    });
  }

  function hideCmdMenu() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    dom.cmdMenu.hidden = true;
    state.cmdMenuIndex = -1;
  }

  function navigateCmdMenu(direction) {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    const items = dom.cmdMenu.querySelectorAll('.cmd-item');
    if (items.length === 0) return;
    items[state.cmdMenuIndex]?.classList.remove('active');
    state.cmdMenuIndex = (state.cmdMenuIndex + direction + items.length) % items.length;
    items[state.cmdMenuIndex]?.classList.add('active');
  }

  function selectCmdMenuItem() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    const items = dom.cmdMenu.querySelectorAll('.cmd-item');
    if (state.cmdMenuIndex >= 0 && items[state.cmdMenuIndex]) {
      const cmd = items[state.cmdMenuIndex].dataset.cmd;
      if (cmd === '/model') {
        hideCmdMenu();
        dom.msgInput.value = '';
        showModelPicker();
        return;
      }
      if (cmd === '/mode' || cmd === '/permissions') {
        hideCmdMenu();
        dom.msgInput.value = '';
        showModePicker();
        return;
      }
      dom.msgInput.value = cmd + ' ';
      hideCmdMenu();
      dom.msgInput.focus();
    }
  }

  // --- Option Picker (generic) ---
  function showOptionPicker(title, options, currentValue, onSelect) {
    hideOptionPicker();

    const picker = document.createElement('div');
    picker.className = 'option-picker';
    picker.id = 'option-picker';

    picker.innerHTML = `
      <div class="option-picker-title">${CCWeb.helpers.escapeHtml(title)}</div>
      ${options.map(opt => `
        <div class="option-picker-item${opt.value === currentValue ? ' active' : ''}" data-value="${opt.value}">
          <div class="option-picker-item-info">
            <div class="option-picker-item-label">${CCWeb.helpers.escapeHtml(opt.label)}</div>
            <div class="option-picker-item-desc">${CCWeb.helpers.escapeHtml(opt.desc)}</div>
          </div>
          ${opt.value === currentValue ? '<span class="option-picker-item-check">✓</span>' : ''}
        </div>
      `).join('')}
    `;

    const chatMain = document.querySelector('.chat-main');
    chatMain.appendChild(picker);

    picker.querySelectorAll('.option-picker-item').forEach(el => {
      el.addEventListener('click', () => {
        const v = el.dataset.value;
        hideOptionPicker();
        onSelect(v);
      });
    });

    setTimeout(() => {
      document.addEventListener('click', _pickerOutsideClick);
    }, 0);
    document.addEventListener('keydown', _pickerEscape);
  }

  function hideOptionPicker() {
    const picker = document.getElementById('option-picker');
    if (picker) picker.remove();
    document.removeEventListener('click', _pickerOutsideClick);
    document.removeEventListener('keydown', _pickerEscape);
  }

  function _pickerOutsideClick(e) {
    const picker = document.getElementById('option-picker');
    if (picker && !picker.contains(e.target)) {
      hideOptionPicker();
    }
  }

  function _pickerEscape(e) {
    if (e.key === 'Escape') {
      hideOptionPicker();
    }
  }

  function showModelPicker() {
    const state = CCWeb.state;
    if (state.currentAgent === 'hermes') {
      CCWeb.chat.appendSystemMessage('Hermes 使用 WSL 中 Hermes Gateway 的当前默认模型。agent-web 暂不直接切换 Hermes provider/model。');
      return;
    }
    if (state.currentAgent === 'gemini') {
      CCWeb.chat.appendSystemMessage(`当前 Gemini 模型: ${state.currentModel || 'Gemini CLI 默认'}\n如需切换，请输入 /model <模型名>。`);
      return;
    }
    if (state.currentAgent === 'codex') {
      const current = CCWeb.markdown._splitCodexThinkingModel(state.currentModel || '');
      const baseOptions = CCWeb.markdown.getCodexBaseModelOptions();
      if (baseOptions.length === 0) {
        CCWeb.chat.appendSystemMessage('当前 Codex Profile 未配置 /model 候选列表。请先在设置 -> Codex API 配置中填写模型列表，或直接输入 /model <模型名>。');
        return;
      }
      showOptionPicker('选择 Codex 模型', baseOptions, current.base || '', (baseValue) => {
        const base = String(baseValue || '').trim();
        const thinkingOptions = [
          { value: '', label: '无 (默认)', desc: '不附加 (medium/high/xhigh) 后缀' },
          { value: 'medium', label: 'medium', desc: '中等 thinking' },
          { value: 'high', label: 'high', desc: '更强 thinking' },
          { value: 'xhigh', label: 'xhigh', desc: '最强 thinking' },
        ];
        showOptionPicker('选择 Thinking 强度', thinkingOptions, current.level || '', (lvl) => {
          const level = String(lvl || '').trim().toLowerCase();
          const full = level ? `${base}(${level})` : base;
          CCWeb.send({ type: 'message', text: `/model ${full}`, sessionId: state.currentSessionId, mode: state.currentMode, agent: state.currentAgent });
        });
      });
      return;
    }
    showOptionPicker('选择模型', MODEL_OPTIONS, state.currentModel, (value) => {
      CCWeb.send({ type: 'message', text: `/model ${value}`, sessionId: state.currentSessionId, mode: state.currentMode, agent: state.currentAgent });
    });
  }

  function showModePicker() {
    const state = CCWeb.state;
    showOptionPicker('选择权限模式', MODE_PICKER_OPTIONS, state.currentMode, (value) => {
      state.currentMode = value;
      CCWeb.dom.modeSelect.value = state.currentMode;
      localStorage.setItem(CCWeb.helpers.getAgentModeStorageKey(state.currentAgent), state.currentMode);
      if (state.currentSessionId) {
        CCWeb.send({ type: 'set_mode', sessionId: state.currentSessionId, mode: state.currentMode });
      }
    });
  }

  // --- Send Message ---
  function sendMessage() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    const text = dom.msgInput.value.trim();
    if ((!text && state.pendingAttachments.length === 0) || state.isGenerating || CCWeb.session.isBlockingSessionLoad()) return;
    hideCmdMenu();
    hideOptionPicker();
    if ((state.currentAgent === 'hermes' || state.currentAgent === 'gemini') && state.pendingAttachments.length > 0) {
      CCWeb.chat.appendError(`${state.currentAgent === 'hermes' ? 'Hermes' : 'Gemini'} 会话暂不支持图片附件，请移除附件后再发送。`);
      return;
    }

    // Slash commands: don't show as user bubble
    if (text.startsWith('/')) {
      if (state.pendingAttachments.length > 0) {
        CCWeb.chat.appendError('命令消息暂不支持附带图片，请先移除图片或发送普通消息。');
        return;
      }
      if (text === '/model' || text === '/model ') {
        showModelPicker();
        dom.msgInput.value = '';
        autoResize();
        return;
      }
      if (text === '/mode' || text === '/mode ' || text === '/permissions' || text === '/permissions ') {
        showModePicker();
        dom.msgInput.value = '';
        autoResize();
        return;
      }
      CCWeb.send({ type: 'message', text, sessionId: state.currentSessionId, mode: state.currentMode, agent: state.currentAgent });
      dom.msgInput.value = '';
      autoResize();
      return;
    }

    // Regular message
    const welcome = dom.messagesDiv.querySelector('.welcome-msg');
    if (welcome) welcome.remove();
    const attachments = state.pendingAttachments.map((attachment) => ({ ...attachment }));
    dom.messagesDiv.appendChild(CCWeb.chat.createMsgElement('user', text, attachments));
    scrollToBottom();

    CCWeb.send({ type: 'message', text, attachments, sessionId: state.currentSessionId, mode: state.currentMode, agent: state.currentAgent });
    dom.msgInput.value = '';
    state.pendingAttachments = [];
    renderPendingAttachments();
    autoResize();
    CCWeb.chat.startGenerating();
  }

  function autoResize() {
    const dom = CCWeb.dom;
    dom.msgInput.style.height = 'auto';
    const max = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--input-max-height')) || 200;
    dom.msgInput.style.height = Math.min(dom.msgInput.scrollHeight, max) + 'px';
  }

  function isMobileInputMode() {
    return window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
  }

  // --- Toast Notification ---
  function showQuickToast(text) {
    const el = document.createElement('div');
    el.className = 'cc-toast';
    el.textContent = text;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 220);
    }, 1500);
  }

  function showToast(text, sessionId) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = text;
    if (sessionId) {
      toast.style.cursor = 'pointer';
      toast.addEventListener('click', () => {
        CCWeb.session.openSession(sessionId);
        toast.remove();
      });
    }
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  // --- Browser Notification ---
  function showBrowserNotification(title) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification('Agent-Web', {
          body: `「${title}」任务完成`,
          tag: 'cc-web-task',
          renotify: true,
        });
      }).catch(() => {});
    }
  }

  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // --- Attachment rendering ---
  function renderAttachmentLabels(attachments, options = {}) {
    if (!Array.isArray(attachments) || attachments.length === 0) return '';
    const labels = attachments.map((attachment) => {
      const stateSuffix = attachment.storageState === 'expired' ? '（已过期）' : '';
      const name = CCWeb.helpers.escapeHtml(attachment.filename || 'image');
      return `<span class="msg-attachment-label">图片: ${name}${stateSuffix}</span>`;
    }).join('');
    return `<div class="msg-attachments${options.compact ? ' compact' : ''}">${labels}</div>`;
  }

  function syncAttachmentActions() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    const uploading = state.uploadingAttachments.length > 0;
    if (dom.attachBtn) dom.attachBtn.disabled = uploading;
  }

  function renderPendingAttachments() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    if (!dom.attachmentTray) return;
    if (!state.pendingAttachments.length && !state.uploadingAttachments.length) {
      dom.attachmentTray.hidden = true;
      dom.attachmentTray.innerHTML = '';
      syncAttachmentActions();
      return;
    }
    dom.attachmentTray.hidden = false;
    const uploadingHtml = state.uploadingAttachments.map((attachment) => `
      <div class="attachment-chip uploading">
        <div class="attachment-chip-meta">
          <span class="attachment-chip-name">${CCWeb.helpers.escapeHtml(attachment.filename || 'image')}</span>
          <span class="attachment-chip-note">上传中 · ${CCWeb.helpers.formatFileSize(attachment.size)}</span>
        </div>
      </div>
    `).join('');
    const readyHtml = state.pendingAttachments.map((attachment, index) => `
      <div class="attachment-chip" data-index="${index}">
        <div class="attachment-chip-meta">
          <span class="attachment-chip-name">${CCWeb.helpers.escapeHtml(attachment.filename || 'image')}</span>
          <span class="attachment-chip-note">${CCWeb.helpers.formatFileSize(attachment.size)} · 将随下一条消息发送</span>
        </div>
        <button class="attachment-chip-remove" type="button" data-index="${index}" title="移除">✕</button>
      </div>
    `).join('');
    const noteHtml = [
      state.uploadingAttachments.length > 0
        ? '<div class="attachment-tray-note">图片上传中，此时发送不会包含尚未完成的图片。</div>'
        : '',
    ].join('');
    dom.attachmentTray.innerHTML = `${uploadingHtml}${readyHtml}${noteHtml}`;
    dom.attachmentTray.querySelectorAll('.attachment-chip-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = Number(btn.dataset.index);
        const [removed] = state.pendingAttachments.splice(index, 1);
        renderPendingAttachments();
        deleteUploadedAttachment(removed?.id);
      });
    });
    syncAttachmentActions();
  }

  // --- Image upload helpers ---
  function replaceFileExtension(filename, ext) {
    const base = String(filename || 'image').replace(/\.[^/.]+$/, '');
    return `${base}${ext}`;
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('读取图片失败'));
      };
      img.src = url;
    });
  }

  async function compressImageFile(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/i.test(file.type || '')) return file;
    const img = await loadImageFromFile(file);
    const maxDimension = 2000;
    const maxOriginalBytes = 2 * 1024 * 1024;
    const largestSide = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
    if (file.size <= maxOriginalBytes && largestSide <= maxDimension) {
      return file;
    }

    const scale = Math.min(1, maxDimension / largestSide);
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const targetType = 'image/webp';
    const qualities = [0.9, 0.84, 0.78, 0.72];
    let bestBlob = null;
    for (const quality of qualities) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, targetType, quality));
      if (!blob) continue;
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= Math.max(maxOriginalBytes, file.size * 0.72)) break;
    }
    if (!bestBlob || bestBlob.size >= file.size) return file;
    return new File([bestBlob], replaceFileExtension(file.name || 'image', '.webp'), {
      type: bestBlob.type,
      lastModified: Date.now(),
    });
  }

  function ensureAuthenticatedWs() {
    return new Promise((resolve, reject) => {
      const state = CCWeb.state;
      if (state.ws && state.ws.readyState === 1 && state.authToken) {
        resolve(state.authToken);
        return;
      }
      const savedPassword = localStorage.getItem('cc-web-pw');
      if (!savedPassword) {
        reject(new Error('登录状态已失效，请刷新页面后重新登录再上传图片。'));
        return;
      }
      const timeout = setTimeout(() => {
        reject(new Error('登录状态恢复超时，请刷新页面后重试。'));
      }, 8000);

      const cleanup = () => {
        clearTimeout(timeout);
        document.removeEventListener('cc-web-auth-restored', onRestored);
        document.removeEventListener('cc-web-auth-failed', onFailed);
      };
      const onRestored = () => {
        cleanup();
        resolve(state.authToken);
      };
      const onFailed = () => {
        cleanup();
        reject(new Error('登录状态已失效，请刷新页面后重新登录再上传图片。'));
      };
      document.addEventListener('cc-web-auth-restored', onRestored);
      document.addEventListener('cc-web-auth-failed', onFailed);

      if (!state.ws || state.ws.readyState > 1) {
        CCWeb.connect();
      } else if (state.ws.readyState === 1) {
        CCWeb.send({ type: 'auth', password: savedPassword });
      }
    });
  }

  async function deleteUploadedAttachment(id) {
    const state = CCWeb.state;
    if (!id) return;
    try {
      await ensureAuthenticatedWs();
      await fetch(`/api/attachments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${state.authToken}`,
        },
      });
    } catch {}
  }

  async function uploadImageFile(file) {
    const state = CCWeb.state;
    await ensureAuthenticatedWs();
    const headers = {
      'Authorization': `Bearer ${state.authToken}`,
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name || 'image'),
    };
    const response = await fetch('/api/attachments', {
      method: 'POST',
      headers,
      body: file,
    });
    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = null;
    }
    if (response.status === 401) {
      throw new Error('登录状态已失效，请刷新页面后重新登录再上传图片。');
    }
    if (response.status === 413) {
      throw new Error('图片大小超过当前上传限制，请压缩到 10MB 以内后重试。');
    }
    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || `上传失败 (${response.status})`);
    }
    return data.attachment;
  }

  async function handleSelectedImageFiles(fileList) {
    const state = CCWeb.state;
    const files = Array.from(fileList || []).filter((file) => file && /^image\//.test(file.type || ''));
    if (!files.length) return;
    if (state.pendingAttachments.length + files.length > 4) {
      CCWeb.chat.appendError('单条消息最多附带 4 张图片。');
      return;
    }
    const batch = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      filename: file.name || 'image',
      size: file.size || 0,
    }));
    state.uploadingAttachments.push(...batch);
    renderPendingAttachments();
    try {
      const results = await Promise.allSettled(files.map(async (file) => {
        const optimized = await compressImageFile(file);
        return uploadImageFile(optimized);
      }));
      const errors = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          state.pendingAttachments.push(result.value);
        } else {
          errors.push(result.reason?.message || '图片上传失败');
        }
      }
      if (errors.length > 0) {
        CCWeb.chat.appendError(errors[0]);
      }
    } catch (err) {
      CCWeb.chat.appendError(err.message || '图片上传失败');
    } finally {
      state.uploadingAttachments = state.uploadingAttachments.filter((item) => !batch.some((entry) => entry.id === item.id));
      renderPendingAttachments();
      if (CCWeb.dom.imageUploadInput) CCWeb.dom.imageUploadInput.value = '';
    }
  }

  // --- Init function for UI module ---
  function init() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;

    // Viewport height fix
    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', () => setTimeout(setVH, 100));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setVH);
      window.visualViewport.addEventListener('scroll', setVH);
    }

    // Password visibility toggle
    if (dom.pwToggleBtn && dom.loginPassword) {
      const eyeOpen = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
      const eyeClosed = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
      dom.pwToggleBtn.addEventListener('click', () => {
        const isPassword = dom.loginPassword.type === 'password';
        dom.loginPassword.type = isPassword ? 'text' : 'password';
        dom.pwToggleBtn.innerHTML = isPassword ? eyeClosed : eyeOpen;
      });
    }

    // Custom scrollbar init
    const scrollbarEl = document.getElementById('custom-scrollbar');
    const thumbEl = document.getElementById('custom-scrollbar-thumb');

    dom.messagesDiv.addEventListener('scroll', () => {
      updateScrollbar();
      scrollbarEl.classList.add('scrolling');
      clearTimeout(scrollbarEl._hideTimer);
      scrollbarEl._hideTimer = setTimeout(() => {
        if (!isDragging) scrollbarEl.classList.remove('scrolling');
      }, 1200);
    }, { passive: true });
    new ResizeObserver(updateScrollbar).observe(dom.messagesDiv);

    // Drag logic for scrollbar
    let dragStartY = 0, dragStartScrollTop = 0;

    function onDragStart(e) {
      isDragging = true;
      dragStartY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
      dragStartScrollTop = dom.messagesDiv.scrollTop;
      thumbEl.classList.add('dragging');
      scrollbarEl.classList.add('active');
      e.preventDefault();
    }

    function onDragMove(e) {
      if (!isDragging) return;
      const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
      const dy = clientY - dragStartY;
      const { scrollHeight, clientHeight } = dom.messagesDiv;
      const trackH = scrollbarEl.clientHeight;
      const thumbH = Math.max(30, trackH * clientHeight / scrollHeight);
      const ratio = (scrollHeight - clientHeight) / (trackH - thumbH);
      dom.messagesDiv.scrollTop = dragStartScrollTop + dy * ratio;
      e.preventDefault();
    }

    function onDragEnd() {
      if (!isDragging) return;
      isDragging = false;
      thumbEl.classList.remove('dragging');
      scrollbarEl.classList.remove('active');
    }

    thumbEl.addEventListener('mousedown', onDragStart);
    thumbEl.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchend', onDragEnd);

    updateScrollbar();

    // Sidebar events
    dom.menuBtn.addEventListener('click', () => {
      dom.sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });

    dom.sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('touchstart', handleSidebarSwipeStart, { passive: true });
    document.addEventListener('touchmove', handleSidebarSwipeMove, { passive: false });
    document.addEventListener('touchend', handleSidebarSwipeEnd, { passive: true });
    document.addEventListener('touchcancel', () => { state.sidebarSwipe = null; }, { passive: true });

    // Agent selector
    if (dom.agentSelect) {
      dom.agentSelect.value = state.currentAgent;
      dom.agentSelect.addEventListener('change', () => {
        const targetAgent = CCWeb.helpers.normalizeAgent(dom.agentSelect.value);
        if (targetAgent === state.currentAgent) return;
        CCWeb.session.syncViewForAgent(targetAgent, { preserveCurrent: false, loadLast: true });
      });
    }

    // New-chat and import buttons
    dom.newChatBtn.addEventListener('click', () => CCWeb.session.showNewSessionModal());
    if (dom.importSessionBtn) {
      dom.importSessionBtn.addEventListener('click', () => {
        if (state.currentAgent === 'codex') {
          CCWeb.session.showImportCodexSessionModal();
        } else if (state.currentAgent === 'claude') {
          CCWeb.session.showImportSessionModal();
        }
      });
    }

    // Send and abort buttons
    dom.sendBtn.addEventListener('click', sendMessage);
    dom.abortBtn.addEventListener('click', () => CCWeb.send({ type: 'abort' }));

    // Attach button
    if (dom.attachBtn && dom.imageUploadInput) {
      dom.attachBtn.addEventListener('click', () => dom.imageUploadInput.click());
      dom.imageUploadInput.addEventListener('change', () => {
        handleSelectedImageFiles(dom.imageUploadInput.files);
      });
    }

    // Drag and drop on input
    if (dom.inputWrapper) {
      dom.inputWrapper.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        dom.inputWrapper.classList.add('drag-active');
      });
      dom.inputWrapper.addEventListener('dragleave', (e) => {
        if (e.target === dom.inputWrapper) dom.inputWrapper.classList.remove('drag-active');
      });
      dom.inputWrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.inputWrapper.classList.remove('drag-active');
        handleSelectedImageFiles(e.dataTransfer?.files);
      });
    }

    // Mode selector
    state.currentMode = CCWeb.helpers.normalizeModeForAgent(state.currentAgent, state.currentMode);
    dom.modeSelect.value = state.currentMode;
    syncModeOptions();
    dom.modeSelect.addEventListener('change', () => {
      state.currentMode = CCWeb.helpers.normalizeModeForAgent(state.currentAgent, dom.modeSelect.value);
      dom.modeSelect.value = state.currentMode;
      localStorage.setItem(CCWeb.helpers.getAgentModeStorageKey(state.currentAgent), state.currentMode);
      if (state.currentSessionId) {
        CCWeb.send({ type: 'set_mode', sessionId: state.currentSessionId, mode: state.currentMode });
      }
      if (state.currentMode === 'default') {
        CCWeb.chat.appendSystemMessage('默认模式会交给底层 CLI 自己处理审批；agent-web 当前只负责转发运行结果，尚未提供统一的网页批准/拒绝面板。需要可预期行为时请使用 Plan 或 YOLO。');
      }
    });

    // Input events
    dom.msgInput.addEventListener('input', () => {
      autoResize();
      const val = dom.msgInput.value;
      if (val.startsWith('/') && !val.includes('\n')) {
        showCmdMenu(val);
      } else {
        hideCmdMenu();
      }
    });

    dom.msgInput.addEventListener('keydown', (e) => {
      if (!dom.cmdMenu.hidden) {
        if (e.key === 'ArrowDown') { e.preventDefault(); navigateCmdMenu(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); navigateCmdMenu(-1); return; }
        if (e.key === 'Tab') { e.preventDefault(); selectCmdMenuItem(); return; }
        if (e.key === 'Escape') { hideCmdMenu(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        if (isMobileInputMode()) {
          if (!dom.cmdMenu.hidden) {
            e.preventDefault();
            selectCmdMenuItem();
          }
          return;
        }

        e.preventDefault();
        if (!dom.cmdMenu.hidden) {
          selectCmdMenuItem();
        } else {
          sendMessage();
        }
      }
    });

    dom.msgInput.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const files = items
        .filter((item) => item.kind === 'file' && /^image\//.test(item.type || ''))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (files.length > 0) {
        e.preventDefault();
        handleSelectedImageFiles(files);
      }
    });

    // Close cmd menu on outside click
    document.addEventListener('click', (e) => {
      if (!dom.cmdMenu.contains(e.target) && e.target !== dom.msgInput) {
        hideCmdMenu();
      }
    });

    // Header title editing (contenteditable)
    dom.chatTitle.addEventListener('click', () => {
      if (!state.currentSessionId || dom.chatTitle.contentEditable === 'true') return;
      const originalText = dom.chatTitle.textContent;
      dom.chatTitle.contentEditable = 'true';
      dom.chatTitle.style.background = '#fff';
      dom.chatTitle.style.outline = '1px solid var(--accent)';
      dom.chatTitle.style.borderRadius = '6px';
      dom.chatTitle.style.padding = '2px 8px';
      dom.chatTitle.style.minWidth = '96px';
      dom.chatTitle.style.whiteSpace = 'normal';
      dom.chatTitle.style.overflow = 'visible';
      dom.chatTitle.style.textOverflow = 'clip';
      dom.chatTitle.focus();
      const range = document.createRange();
      range.selectNodeContents(dom.chatTitle);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      function finish(save) {
        dom.chatTitle.contentEditable = 'false';
        dom.chatTitle.style.background = '';
        dom.chatTitle.style.outline = '';
        dom.chatTitle.style.borderRadius = '';
        dom.chatTitle.style.padding = '';
        dom.chatTitle.style.minWidth = '';
        dom.chatTitle.style.whiteSpace = '';
        dom.chatTitle.style.overflow = '';
        dom.chatTitle.style.textOverflow = '';
        const newTitle = dom.chatTitle.textContent.trim() || originalText;
        dom.chatTitle.textContent = newTitle;
        if (save && newTitle !== originalText && state.currentSessionId) {
          CCWeb.send({ type: 'rename_session', sessionId: state.currentSessionId, title: newTitle });
        }
      }

      dom.chatTitle.addEventListener('blur', () => finish(true), { once: true });
      dom.chatTitle.addEventListener('keydown', function handler(e) {
        if (e.key === 'Enter') { e.preventDefault(); dom.chatTitle.removeEventListener('keydown', handler); dom.chatTitle.blur(); }
        if (e.key === 'Escape') { dom.chatTitle.textContent = originalText; dom.chatTitle.removeEventListener('keydown', handler); dom.chatTitle.blur(); }
      });
    });

    // Login form
    dom.loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const pw = dom.loginPassword.value;
      if (!pw) return;
      dom.loginError.hidden = true;
      state.loginPasswordValue = pw;
      if (dom.rememberPw.checked) {
        localStorage.setItem('cc-web-pw', pw);
      } else {
        localStorage.removeItem('cc-web-pw');
      }
      CCWeb.send({ type: 'auth', password: pw });
      requestNotificationPermission();
    });

    // Settings button
    const settingsBtn = $('#settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', CCWeb.settings.showSettingsPanel);
    }

    // Load command manifest
    loadCommandManifest();
  }

  // Register on CCWeb namespace
  CCWeb.ui = {
    setVH,
    normalizeTheme,
    getThemeOption,
    refreshThemeSummaries,
    applyTheme,
    buildThemePickerHtml,
    mountThemePicker,
    buildThemeEntryHtml,
    updateCwdBadge,
    setCurrentSessionRunningState,
    syncModeOptions,
    updateAgentScopedUI,
    updateScrollbar,
    scrollToBottom,
    openSidebar,
    closeSidebar,
    handleSidebarSwipeStart,
    handleSidebarSwipeMove,
    handleSidebarSwipeEnd,
    showCmdMenu,
    hideCmdMenu,
    navigateCmdMenu,
    selectCmdMenuItem,
    showOptionPicker,
    hideOptionPicker,
    showModelPicker,
    showModePicker,
    sendMessage,
    autoResize,
    showQuickToast,
    showToast,
    showBrowserNotification,
    requestNotificationPermission,
    renderAttachmentLabels,
    renderPendingAttachments,
    handleSelectedImageFiles,
    syncAttachmentActions,
    MODEL_OPTIONS,
    MODE_PICKER_OPTIONS,
    THEME_OPTIONS,
    slashCommands,
    loadCommandManifest,
    init,
  };
})();

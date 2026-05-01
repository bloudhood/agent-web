// === Agent-Web Frontend ===
(function () {
  'use strict';

  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  // --- Exported constants ---

  CCWeb.THEME_OPTIONS = [
    { value: 'washi', label: 'Washi Light', desc: '暖白底、炭黑文字与朱砂橙强调，和风克制美学。', swatches: ['#faf9f5', '#141413', '#e8e6dc', '#d97757'] },
    { value: 'washi-dark', label: 'Washi Dark', desc: '深炭底色 + 和纸白字，保留朱砂强调色。', swatches: ['#1a1410', '#f0e8dc', '#3d3028', '#d4664a'] },
  ];

  CCWeb.AGENT_LABELS = { claude: 'Claude', codex: 'Codex', hermes: 'Hermes', gemini: 'Gemini' };
  CCWeb.MODE_LABELS = { default: '默认', plan: 'Plan', yolo: 'YOLO' };
  CCWeb.DEFAULT_AGENT = 'claude';

  CCWeb.MODEL_OPTIONS = [
    { value: 'opus', label: 'Opus', desc: '最强大，1M 上下文' },
    { value: 'sonnet', label: 'Sonnet', desc: '平衡性能，1M 上下文' },
    { value: 'haiku', label: 'Haiku', desc: '最快速，适合简单任务' },
  ];

  CCWeb.MODE_PICKER_OPTIONS = [
    { value: 'yolo', label: 'YOLO', desc: '跳过所有权限检查' },
    { value: 'plan', label: 'Plan', desc: '执行前需确认计划' },
    { value: 'default', label: '默认', desc: 'CLI 原生审批；agent-web 暂不提供网页批准/拒绝面板' },
  ];

  // --- State ---
  const state = {
    currentSessionId: null,
    sessions: [],
    isGenerating: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    pendingText: '',
    renderTimer: null,
    activeToolCalls: new Map(),
    toolGroupCount: 0,
    hasGrouped: false,
    cmdMenuIndex: -1,
    currentMode: 'yolo',
    currentModel: 'opus',
    currentAgent: CCWeb.AGENT_LABELS[localStorage.getItem('cc-web-agent')] ? localStorage.getItem('cc-web-agent') : CCWeb.DEFAULT_AGENT,
    currentTheme: (document.documentElement.dataset.theme || localStorage.getItem('cc-web-theme') || 'washi'),
    codexConfigCache: null,
    loadedHistorySessionId: null,
    activeSessionLoad: null,
    sidebarSwipe: null,
    pendingAttachments: [],
    uploadingAttachments: [],
    loginPasswordValue: '',
    currentCwd: null,
    currentSessionRunning: false,
    skipDeleteConfirm: localStorage.getItem('cc-web-skip-delete-confirm') === '1',
    pendingInitialSessionLoad: false,
    authToken: localStorage.getItem('cc-web-token'),
  };

  CCWeb.state = state;

  // --- DOM ---
  const $ = (sel) => document.querySelector(sel);
  const loginOverlay = $('#login-overlay');
  const loginForm = $('#login-form');
  const loginPassword = $('#login-password');
  const loginError = $('#login-error');
  const rememberPw = $('#remember-pw');
  const app = $('#app');
  const sidebar = $('#sidebar');
  const sidebarOverlay = $('#sidebar-overlay');
  const menuBtn = $('#menu-btn');
  const connBanner = $('#conn-banner');
  const pwToggleBtn = $('#pw-toggle-btn');
  const newChatBtn = $('#new-chat-btn');
  const importSessionBtn = $('#import-session-btn');
  const sessionList = $('#session-list');
  const chatMain = $('.chat-main');
  const chatTitle = $('#chat-title');
  const agentSelect = $('#agent-select');
  const chatRuntimeState = $('#chat-runtime-state');
  const chatCwd = $('#chat-cwd');
  const costDisplay = $('#cost-display');
  const imageUploadInput = $('#image-upload-input');
  const attachBtn = $('#attach-btn');
  const attachmentTray = $('#attachment-tray');
  const messagesDiv = $('#messages');
  const msgInput = $('#msg-input');
  const sendBtn = $('#send-btn');
  const abortBtn = $('#abort-btn');
  const cmdMenu = $('#cmd-menu');
  const modeSelect = $('#mode-select');
  const inputWrapper = $('.input-wrapper');
  const sessionLoadingOverlay = $('#session-loading-overlay');
  const sessionLoadingLabel = $('#session-loading-label');
  const settingsBtn = $('#settings-btn');

  CCWeb.dom = {
    loginOverlay, loginForm, loginPassword, loginError, rememberPw,
    app, sidebar, sidebarOverlay, menuBtn, connBanner, pwToggleBtn,
    newChatBtn, importSessionBtn, sessionList, chatMain,
    chatTitle, agentSelect, chatRuntimeState, chatCwd, costDisplay,
    imageUploadInput, attachBtn, attachmentTray,
    messagesDiv, msgInput, sendBtn, abortBtn, cmdMenu, modeSelect,
    inputWrapper, sessionLoadingOverlay, sessionLoadingLabel, settingsBtn, $,
  };

  // --- WebSocket ---

  function connect() {
    if (state.ws && state.ws.readyState <= 1) return;
    state.ws = new WebSocket(WS_URL);

    state.ws.onopen = () => {
      state.reconnectAttempts = 0;
      if (state.authToken) send({ type: 'auth', token: state.authToken });
    };

    state.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleServerMessage(msg);
    };

    state.ws.onclose = () => {
      CCWeb.session.clearSessionLoading();
      if (connBanner && !app.hidden) connBanner.hidden = false;
      scheduleReconnect();
    };
    state.ws.onerror = () => {};
  }

  function send(data) {
    if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(data));
  }

  CCWeb.send = send;

  function scheduleReconnect() {
    if (state.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
    state.reconnectAttempts++;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, delay);
  }

  // --- Server Message Handler ---

  const SETTINGS_MSG_TYPES = new Set([
    'notify_config', 'notify_test_result', 'model_config',
    'ccswitch_state', 'ccswitch_switch_result', 'ccswitch_desktop_refresh_result',
    'claude_local_config', 'codex_local_config', 'dev_config', 'fetch_models_result',
    'password_changed',
  ]);

  function handleServerMessage(msg) {
    // Delegate settings messages
    if (SETTINGS_MSG_TYPES.has(msg.type)) {
      if (msg.type === 'codex_config') state.codexConfigCache = msg.config || null;
      if (CCWeb.settings && CCWeb.settings.handleMessage) {
        CCWeb.settings.handleMessage(msg);
      }
      return;
    }

    // Special: codex_config updates both cache and settings
    if (msg.type === 'codex_config') {
      state.codexConfigCache = msg.config || null;
      if (CCWeb.settings && CCWeb.settings.handleMessage) {
        CCWeb.settings.handleMessage(msg);
      }
      return;
    }

    switch (msg.type) {
      case 'auth_result':
        if (msg.success) {
          state.authToken = msg.token;
          localStorage.setItem('cc-web-token', msg.token);
          document.dispatchEvent(new CustomEvent('cc-web-auth-restored'));
          loginOverlay.hidden = true;
          app.hidden = false;
          if (connBanner) connBanner.hidden = true;
          send({ type: 'get_codex_config' });
          if (msg.mustChangePassword) {
            CCWeb.settings.showForceChangePassword();
          } else {
            state.pendingInitialSessionLoad = true;
          }
        } else {
          state.authToken = null;
          localStorage.removeItem('cc-web-token');
          document.dispatchEvent(new CustomEvent('cc-web-auth-failed'));
          loginOverlay.hidden = false;
          app.hidden = true;
          if (msg.banned) {
            loginError.textContent = '该 IP 已被永久封禁';
            loginError.hidden = false;
            loginPassword.disabled = true;
            loginForm.querySelector('button[type="submit"]').disabled = true;
          } else {
            loginError.textContent = '密码错误';
            loginError.hidden = false;
          }
        }
        break;

      case 'session_list':
        state.sessions = msg.sessions || [];
        CCWeb.session.reconcileSessionCacheWithSessions();
        CCWeb.session.renderSessionList();
        if (state.currentSessionId) {
          CCWeb.ui.setCurrentSessionRunningState(!!CCWeb.session.getSessionMeta(state.currentSessionId)?.isRunning);
        }
        if (state.pendingInitialSessionLoad) {
          state.pendingInitialSessionLoad = false;
          CCWeb.session.syncViewForAgent(state.currentAgent, { preserveCurrent: false, loadLast: true });
        } else if (state.currentSessionId && !CCWeb.session.getSessionMeta(state.currentSessionId)) {
          CCWeb.session.resetChatView(state.currentAgent);
        }
        break;

      case 'session_info': {
        const snapshot = CCWeb.session.normalizeSessionSnapshot(msg);
        if (state.activeSessionLoad?.sessionId === msg.sessionId) {
          state.activeSessionLoad.snapshot = snapshot;
        }
        CCWeb.session.applySessionSnapshot(snapshot, {
          immediate: CCWeb.session.isBlockingSessionLoad(msg.sessionId),
          suppressUnreadToast: false,
          preserveStreaming: msg.sessionId === state.currentSessionId && msg.isRunning,
        });
        if (!msg.historyPending) {
          if (state.activeSessionLoad?.sessionId === msg.sessionId) {
            CCWeb.session.finalizeLoadedSession(msg.sessionId);
          } else {
            CCWeb.session.cacheSessionSnapshot(snapshot);
            CCWeb.session.finishSessionSwitch(msg.sessionId);
          }
        }
        break;
      }

      case 'session_history_chunk':
        if (msg.sessionId === state.currentSessionId && state.loadedHistorySessionId === msg.sessionId) {
          const blocking = CCWeb.session.isBlockingSessionLoad(msg.sessionId);
          if (state.activeSessionLoad?.sessionId === msg.sessionId && state.activeSessionLoad.snapshot) {
            state.activeSessionLoad.snapshot.messages = CCWeb.helpers.cloneMessages(msg.messages || []).concat(state.activeSessionLoad.snapshot.messages);
          }
          CCWeb.chat.prependHistoryMessages(msg.messages || [], {
            preserveScroll: !blocking,
            skipScrollbar: blocking,
          });
          if (!msg.remaining) {
            CCWeb.session.finalizeLoadedSession(msg.sessionId);
          }
        }
        break;

      case 'session_renamed':
        state.sessions = state.sessions.map((s) => s.id === msg.sessionId ? { ...s, title: msg.title } : s);
        CCWeb.session.updateCachedSession(msg.sessionId, (snapshot) => { snapshot.title = msg.title; });
        if (msg.sessionId === state.currentSessionId) {
          chatTitle.textContent = msg.title;
        }
        CCWeb.session.renderSessionList();
        break;

      case 'text_delta':
        if (msg.sessionId && state.currentSessionId && msg.sessionId !== state.currentSessionId) {
          CCWeb.session.updateCachedSession(msg.sessionId, (snapshot) => { snapshot.isRunning = true; });
          break;
        }
        if (!state.isGenerating) CCWeb.chat.startGenerating();
        state.pendingText += msg.text;
        CCWeb.chat.scheduleRender();
        break;

      case 'tool_start':
        if (msg.sessionId && state.currentSessionId && msg.sessionId !== state.currentSessionId) {
          CCWeb.session.updateCachedSession(msg.sessionId, (snapshot) => { snapshot.isRunning = true; });
          break;
        }
        if (!state.isGenerating) CCWeb.chat.startGenerating();
        state.activeToolCalls.set(msg.toolUseId, { name: msg.name, input: msg.input, kind: msg.kind || null, meta: msg.meta || null, done: false });
        CCWeb.chat.appendToolCall(msg.toolUseId, msg.name, msg.input, false, msg.kind || null, msg.meta || null);
        break;

      case 'tool_end':
        if (msg.sessionId && state.currentSessionId && msg.sessionId !== state.currentSessionId) {
          CCWeb.session.updateCachedSession(msg.sessionId, (snapshot) => { snapshot.isRunning = true; });
          break;
        }
        if (state.activeToolCalls.has(msg.toolUseId)) {
          state.activeToolCalls.get(msg.toolUseId).done = true;
          if (msg.kind) state.activeToolCalls.get(msg.toolUseId).kind = msg.kind;
          if (msg.meta) state.activeToolCalls.get(msg.toolUseId).meta = msg.meta;
          state.activeToolCalls.get(msg.toolUseId).result = msg.result;
        }
        CCWeb.chat.updateToolCall(msg.toolUseId, msg.result);
        break;

      case 'cost':
        if (!msg.sessionId || msg.sessionId === state.currentSessionId) {
          costDisplay.textContent = `$${msg.costUsd.toFixed(4)}`;
        }
        if (msg.sessionId || state.currentSessionId) {
          CCWeb.session.updateCachedSession(msg.sessionId || state.currentSessionId, (snapshot) => { snapshot.totalCost = msg.costUsd; });
        }
        break;

      case 'usage':
        if (msg.totalUsage) {
          const cacheText = msg.totalUsage.cachedInputTokens ? ` · cache ${msg.totalUsage.cachedInputTokens}` : '';
          if (!msg.sessionId || msg.sessionId === state.currentSessionId) {
            costDisplay.textContent = `in ${msg.totalUsage.inputTokens} · out ${msg.totalUsage.outputTokens}${cacheText}`;
          }
          if (msg.sessionId || state.currentSessionId) {
            CCWeb.session.updateCachedSession(msg.sessionId || state.currentSessionId, (snapshot) => { snapshot.totalUsage = CCWeb.helpers.deepClone(msg.totalUsage); });
          }
        }
        break;

      case 'turn_done':
      case 'done':
        if (!msg.sessionId || msg.sessionId === state.currentSessionId) {
          CCWeb.chat.finishGenerating(msg.sessionId);
        } else {
          CCWeb.session.updateCachedSession(msg.sessionId, (snapshot) => { snapshot.isRunning = false; });
          send({ type: 'list_sessions' });
        }
        break;

      case 'system_message':
        CCWeb.chat.appendSystemMessage(msg.message);
        break;

      case 'mode_changed':
        if (msg.mode && CCWeb.MODE_LABELS[msg.mode]) {
          state.currentMode = CCWeb.helpers.normalizeModeForAgent(state.currentAgent, msg.mode);
          modeSelect.value = state.currentMode;
          localStorage.setItem(CCWeb.helpers.getAgentModeStorageKey(state.currentAgent), state.currentMode);
          if (state.currentSessionId) {
            CCWeb.session.updateCachedSession(state.currentSessionId, (snapshot) => { snapshot.mode = state.currentMode; });
          }
        }
        break;

      case 'model_changed':
        if (msg.model) {
          state.currentModel = msg.model;
          if (state.currentSessionId) {
            CCWeb.session.updateCachedSession(state.currentSessionId, (snapshot) => { snapshot.model = msg.model; });
          }
        }
        break;

      case 'resume_generating':
        CCWeb.ui.setCurrentSessionRunningState(true);
        if (!state.isGenerating || !document.getElementById('streaming-msg')) {
          CCWeb.chat.startGenerating();
        } else {
          sendBtn.hidden = true;
          abortBtn.hidden = false;
          state.toolGroupCount = 0;
          state.hasGrouped = false;
          state.activeToolCalls.clear();
          const toolsDiv = document.querySelector('#streaming-msg .msg-tools');
          if (toolsDiv) toolsDiv.innerHTML = '';
        }
        state.pendingText = msg.text || '';
        CCWeb.chat.flushRender();
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            state.activeToolCalls.set(tc.id, {
              name: tc.name, input: tc.input, result: tc.result,
              kind: tc.kind || null, meta: tc.meta || null, done: tc.done,
            });
            CCWeb.chat.appendToolCall(tc.id, tc.name, tc.input, tc.done, tc.kind || null, tc.meta || null);
            if (tc.done && tc.result) {
              CCWeb.chat.updateToolCall(tc.id, tc.result);
            }
          }
        }
        break;

      case 'error':
        CCWeb.chat.appendError(msg.message);
        CCWeb.session.clearSessionLoading();
        if (!state.isGenerating && state.currentSessionId) {
          CCWeb.ui.setCurrentSessionRunningState(!!CCWeb.session.getSessionMeta(state.currentSessionId)?.isRunning);
        }
        if (state.isGenerating) CCWeb.chat.finishGenerating();
        break;

      case 'background_done':
        CCWeb.ui.showToast(`「${msg.title}」任务完成`, msg.sessionId);
        CCWeb.ui.showBrowserNotification(msg.title);
        if (msg.sessionId === state.currentSessionId) {
          CCWeb.session.openSession(msg.sessionId, { forceSync: true, blocking: false });
        } else {
          send({ type: 'list_sessions' });
        }
        break;

      case 'native_sessions':
        if (typeof CCWeb._onNativeSessions === 'function') CCWeb._onNativeSessions(msg.groups || []);
        break;

      case 'codex_sessions':
        if (typeof CCWeb._onCodexSessions === 'function') CCWeb._onCodexSessions(msg.sessions || []);
        break;

      case 'cwd_suggestions':
        if (typeof CCWeb._onCwdSuggestions === 'function') CCWeb._onCwdSuggestions(msg.paths || []);
        break;

      case 'path_entries':
        if (typeof CCWeb._onPathEntries === 'function') CCWeb._onPathEntries(msg);
        break;

      case 'update_info':
        if (typeof window._ccOnUpdateInfo === 'function') window._ccOnUpdateInfo(msg);
        break;
    }
  }

  // --- Password visibility toggle ---
  if (pwToggleBtn && loginPassword) {
    const eyeOpen = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const eyeClosed = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
    pwToggleBtn.addEventListener('click', () => {
      const isPassword = loginPassword.type === 'password';
      loginPassword.type = isPassword ? 'text' : 'password';
      pwToggleBtn.innerHTML = isPassword ? eyeClosed : eyeOpen;
    });
  }

  // --- Event Listeners ---

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pw = loginPassword.value;
    if (!pw) return;
    loginError.hidden = true;
    state.loginPasswordValue = pw;
    if (rememberPw.checked) {
      localStorage.setItem('cc-web-pw', pw);
    } else {
      localStorage.removeItem('cc-web-pw');
    }
    send({ type: 'auth', password: pw });
    CCWeb.ui.requestNotificationPermission();
  });

  menuBtn.addEventListener('click', () => {
    CCWeb.dom.sidebar && CCWeb.dom.sidebar.classList.contains('open') ? CCWeb.ui.closeSidebar() : CCWeb.ui.openSidebar();
  });

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => CCWeb.settings.showSettingsPanel());
  }

  sidebarOverlay.addEventListener('click', () => CCWeb.ui.closeSidebar());

  CCWeb.dom.newChatBtn && CCWeb.dom.newChatBtn.addEventListener('click', () => CCWeb.session.showNewSessionModal());
  CCWeb.dom.importSessionBtn && CCWeb.dom.importSessionBtn.addEventListener('click', () => CCWeb.session.showImportSessionModal());

  agentSelect.addEventListener('change', () => {
    const agent = agentSelect.value;
    if (CCWeb.AGENT_LABELS[agent]) {
      CCWeb.session.setCurrentAgent(agent);
    }
  });

  modeSelect.addEventListener('change', () => {
    state.currentMode = modeSelect.value;
    localStorage.setItem(CCWeb.helpers.getAgentModeStorageKey(state.currentAgent), state.currentMode);
    if (state.currentSessionId) {
      send({ type: 'set_mode', sessionId: state.currentSessionId, mode: state.currentMode });
    }
  });

  CCWeb.ui.bindComposerEvents();

  sendBtn.addEventListener('click', () => CCWeb.ui.sendMessage());
  abortBtn.addEventListener('click', () => {
    send({ type: 'abort', sessionId: state.currentSessionId });
  });

  attachBtn.addEventListener('click', () => {
    if (imageUploadInput) imageUploadInput.click();
  });

  if (imageUploadInput) {
    imageUploadInput.addEventListener('change', () => {
      if (imageUploadInput.files && imageUploadInput.files.length > 0) {
        CCWeb.ui.handleSelectedImageFiles(imageUploadInput.files);
      }
    });
  }

  // --- Init ---
  CCWeb.ui.applyTheme(state.currentTheme);
  CCWeb.session.setCurrentAgent(state.currentAgent);
  CCWeb.session.renderSessionList();
  connect();
  window.addEventListener('resize', () => CCWeb.ui.updateCwdBadge());
  CCWeb.ui.setVH();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const savedPw = localStorage.getItem('cc-web-pw');
  if (savedPw) {
    loginPassword.value = savedPw;
    rememberPw.checked = true;
  }

  // Visibility change handler
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!state.ws || state.ws.readyState > 1) {
      connect();
    } else if (state.ws.readyState === 1 && state.currentSessionId) {
      if (state.isGenerating || state.currentSessionRunning) {
        send({ type: 'load_session', sessionId: state.currentSessionId });
      } else {
        CCWeb.session.beginSessionSwitch(state.currentSessionId, { blocking: false, force: true });
      }
    }
  });

  // Auth overlay
  if (!state.authToken) {
    loginOverlay.hidden = false;
    app.hidden = true;
  } else {
    loginOverlay.hidden = true;
    app.hidden = false;
  }

})();

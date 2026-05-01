// === Agent-Web Session Module ===
// Session list, LRU cache, switch, create, delete, import modals.
window.CCWeb = window.CCWeb || {};

(function () {
  'use strict';

  // --- Constants ---
  const SESSION_CACHE_LIMIT = 4;
  const SESSION_CACHE_MAX_WEIGHT = 1_500_000;

  // --- Local state ---
  let sessionCache = new Map();

  // --- Session cache helpers ---

  function estimateSessionMessageWeight(message) {
    const content = typeof message?.content === 'string' ? message.content.length : JSON.stringify(message?.content || '').length;
    const toolCalls = Array.isArray(message?.toolCalls) ? JSON.stringify(message.toolCalls).length : 0;
    return content + toolCalls + 64;
  }

  function estimateSessionSnapshotWeight(snapshot) {
    const base = JSON.stringify({
      title: snapshot.title || '',
      mode: snapshot.mode || '',
      model: snapshot.model || '',
      agent: snapshot.agent || '',
      cwd: snapshot.cwd || '',
      updated: snapshot.updated || '',
    }).length;
    return base + (snapshot.messages || []).reduce((sum, message) => sum + estimateSessionMessageWeight(message), 0);
  }

  function normalizeSessionSnapshot(payload, options = {}) {
    return {
      sessionId: payload.sessionId,
      messages: CCWeb.helpers.cloneMessages(payload.messages || []),
      title: payload.title || '新会话',
      mode: payload.mode || 'yolo',
      model: payload.model || '',
      agent: CCWeb.helpers.normalizeAgent(payload.agent),
      hasUnread: !!payload.hasUnread,
      cwd: payload.cwd || null,
      totalCost: typeof payload.totalCost === 'number' ? payload.totalCost : 0,
      totalUsage: payload.totalUsage ? CCWeb.helpers.deepClone(payload.totalUsage) : null,
      updated: payload.updated || null,
      isRunning: !!payload.isRunning,
      historyPending: !!payload.historyPending,
      complete: options.complete !== undefined ? !!options.complete : !payload.historyPending,
    };
  }

  function getSessionMeta(sessionId) {
    const state = CCWeb.state;
    return state.sessions.find((s) => s.id === sessionId) || null;
  }

  function touchSessionCache(sessionId) {
    const entry = sessionCache.get(sessionId);
    if (entry) entry.lastUsed = Date.now();
  }

  function invalidateSessionCache(sessionId) {
    if (!sessionId) return;
    sessionCache.delete(sessionId);
  }

  function pruneSessionCache() {
    let totalWeight = 0;
    for (const entry of sessionCache.values()) totalWeight += entry.weight || 0;
    while (sessionCache.size > SESSION_CACHE_LIMIT || totalWeight > SESSION_CACHE_MAX_WEIGHT) {
      let oldestId = null;
      let oldestTs = Infinity;
      for (const [sessionId, entry] of sessionCache) {
        if ((entry.lastUsed || 0) < oldestTs) {
          oldestTs = entry.lastUsed || 0;
          oldestId = sessionId;
        }
      }
      if (!oldestId) break;
      totalWeight -= sessionCache.get(oldestId)?.weight || 0;
      sessionCache.delete(oldestId);
    }
  }

  function cacheSessionSnapshot(snapshot) {
    if (!snapshot?.sessionId || !snapshot.complete) return;
    const cachedSnapshot = CCWeb.helpers.deepClone(snapshot);
    const weight = estimateSessionSnapshotWeight(cachedSnapshot);
    if (weight > SESSION_CACHE_MAX_WEIGHT) {
      invalidateSessionCache(cachedSnapshot.sessionId);
      return;
    }
    const meta = getSessionMeta(cachedSnapshot.sessionId);
    sessionCache.set(cachedSnapshot.sessionId, {
      snapshot: cachedSnapshot,
      version: cachedSnapshot.updated || null,
      meta: meta ? CCWeb.helpers.deepClone(meta) : null,
      weight,
      lastUsed: Date.now(),
    });
    pruneSessionCache();
  }

  function updateCachedSession(sessionId, updater) {
    const entry = sessionCache.get(sessionId);
    if (!entry) return;
    const nextSnapshot = CCWeb.helpers.deepClone(entry.snapshot);
    updater(nextSnapshot);
    entry.snapshot = nextSnapshot;
    entry.weight = estimateSessionSnapshotWeight(nextSnapshot);
    entry.lastUsed = Date.now();
    if (nextSnapshot.updated) entry.version = nextSnapshot.updated;
    pruneSessionCache();
  }

  function reconcileSessionCacheWithSessions() {
    const state = CCWeb.state;
    const knownIds = new Set(state.sessions.map((session) => session.id));
    for (const [sessionId, entry] of sessionCache) {
      if (!knownIds.has(sessionId)) {
        sessionCache.delete(sessionId);
        continue;
      }
      const meta = getSessionMeta(sessionId);
      entry.meta = meta ? CCWeb.helpers.deepClone(meta) : null;
    }
  }

  function getSessionCacheDisposition(sessionId) {
    const entry = sessionCache.get(sessionId);
    const meta = getSessionMeta(sessionId);
    if (!entry?.snapshot?.complete || !meta) return 'miss';
    if (entry.version === (meta.updated || null) && !meta.hasUnread && !meta.isRunning) {
      return 'strong';
    }
    return 'weak';
  }

  function buildCachedSessionSnapshot(sessionId) {
    const entry = sessionCache.get(sessionId);
    if (!entry?.snapshot) return null;
    const snapshot = CCWeb.helpers.deepClone(entry.snapshot);
    const meta = getSessionMeta(sessionId) || entry.meta;
    if (meta) {
      snapshot.title = meta.title || snapshot.title;
      snapshot.agent = CCWeb.helpers.normalizeAgent(meta.agent || snapshot.agent);
      snapshot.hasUnread = !!meta.hasUnread;
      snapshot.updated = meta.updated || snapshot.updated;
      snapshot.isRunning = !!meta.isRunning;
    }
    return snapshot;
  }

  // --- Session view management ---

  function getVisibleSessions() {
    const state = CCWeb.state;
    return state.sessions.slice().sort((a, b) => {
      const bt = new Date(b.updated || 0).getTime() || 0;
      const at = new Date(a.updated || 0).getTime() || 0;
      return bt - at;
    });
  }

  function setCurrentAgent(agent) {
    const state = CCWeb.state;
    state.currentAgent = CCWeb.helpers.normalizeAgent(agent);
    localStorage.setItem('cc-web-agent', state.currentAgent);
    state.currentMode = CCWeb.helpers.normalizeModeForAgent(state.currentAgent, localStorage.getItem(CCWeb.helpers.getAgentModeStorageKey(state.currentAgent)) || 'yolo');
    localStorage.setItem(CCWeb.helpers.getAgentModeStorageKey(state.currentAgent), state.currentMode);
    CCWeb.dom.modeSelect.value = state.currentMode;
    CCWeb.ui.updateAgentScopedUI();
  }

  function resetChatView(agent) {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    setCurrentAgent(agent);
    state.currentSessionId = null;
    state.loadedHistorySessionId = null;
    clearSessionLoading();
    CCWeb.ui.setCurrentSessionRunningState(false);
    state.currentCwd = null;
    state.currentModel = state.currentAgent === 'claude' ? 'opus' : (state.currentAgent === 'hermes' ? 'Hermes' : (state.currentAgent === 'gemini' ? 'Gemini' : ''));
    state.isGenerating = false;
    state.pendingText = '';
    state.pendingAttachments = [];
    state.uploadingAttachments = [];
    state.activeToolCalls.clear();
    dom.sendBtn.hidden = false;
    dom.abortBtn.hidden = true;
    dom.chatTitle.textContent = '新会话';
    CCWeb.ui.updateCwdBadge();
    dom.messagesDiv.innerHTML = CCWeb.helpers.buildWelcomeMarkup(state.currentAgent);
    setStatsDisplay(null);
    CCWeb.ui.renderPendingAttachments();
    highlightActiveSession();
  }

  function applySessionSnapshot(snapshot, options = {}) {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    if (!snapshot) return;
    const preserveStreaming = !!(options.preserveStreaming && state.isGenerating && snapshot.sessionId === state.currentSessionId && snapshot.isRunning);
    if (state.isGenerating && !preserveStreaming) {
      state.isGenerating = false;
      dom.sendBtn.hidden = false;
      dom.abortBtn.hidden = true;
      state.pendingText = '';
      state.activeToolCalls.clear();
    }
    state.currentSessionId = snapshot.sessionId;
    state.loadedHistorySessionId = snapshot.sessionId;
    CCWeb.helpers.setLastSessionForAgent(snapshot.agent, state.currentSessionId);
    dom.chatTitle.textContent = snapshot.title || '新会话';
    setCurrentAgent(snapshot.agent);
    CCWeb.ui.setCurrentSessionRunningState(snapshot.isRunning);
    setStatsDisplay(snapshot);
    state.currentCwd = snapshot.cwd || null;
    CCWeb.ui.updateCwdBadge();
    if (snapshot.mode && CCWeb.MODE_LABELS?.[snapshot.mode]) {
      state.currentMode = CCWeb.helpers.normalizeModeForAgent(state.currentAgent, snapshot.mode);
      dom.modeSelect.value = state.currentMode;
      localStorage.setItem(CCWeb.helpers.getAgentModeStorageKey(state.currentAgent), state.currentMode);
    }
    CCWeb.ui.syncModeOptions();
    state.currentModel = snapshot.model || '';
    if (!preserveStreaming) {
      CCWeb.chat.renderMessages(snapshot.messages || [], { immediate: !!options.immediate });
    }
    highlightActiveSession();
    renderSessionList();
    if (!options.skipCloseSidebar) CCWeb.ui.closeSidebar();
    if (snapshot.hasUnread && !options.suppressUnreadToast) {
      CCWeb.ui.showToast('后台任务已完成', snapshot.sessionId);
    }
  }

  function syncViewForAgent(agent, options = {}) {
    const state = CCWeb.state;
    const targetAgent = CCWeb.helpers.normalizeAgent(agent);
    const { preserveCurrent = true, loadLast = true } = options;
    setCurrentAgent(targetAgent);
    renderSessionList();

    const currentMeta = state.currentSessionId ? getSessionMeta(state.currentSessionId) : null;
    if (preserveCurrent && currentMeta && CCWeb.helpers.normalizeAgent(currentMeta.agent) === targetAgent) {
      highlightActiveSession();
      return;
    }

    resetChatView(targetAgent);

    if (!loadLast) return;
    const lastSessionId = CCWeb.helpers.getLastSessionForAgent(targetAgent);
    const lastMeta = lastSessionId ? getSessionMeta(lastSessionId) : null;
    if (lastMeta && CCWeb.helpers.normalizeAgent(lastMeta.agent) === targetAgent) {
      openSession(lastSessionId);
    }
  }

  // --- Session loading ---

  function getSessionLoadLabel(sessionId) {
    const meta = sessionId ? getSessionMeta(sessionId) : null;
    const title = meta?.title ? `「${meta.title}」` : '所选会话';
    return `正在载入 ${title} 的完整消息记录…`;
  }

  function setSessionLoading(sessionId, options = {}) {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    const loading = !!sessionId;
    const blocking = options.blocking !== false;
    state.activeSessionLoad = loading ? { sessionId, blocking, snapshot: null } : null;
    const showOverlay = !!(loading && blocking);
    document.body.classList.toggle('session-loading-active', showOverlay);
    dom.sessionLoadingOverlay.hidden = !showOverlay;
    dom.sessionLoadingOverlay.setAttribute('aria-hidden', showOverlay ? 'false' : 'true');
    dom.sessionLoadingLabel.textContent = loading ? (options.label || getSessionLoadLabel(sessionId)) : '正在整理消息与上下文…';
    dom.msgInput.disabled = showOverlay;
    dom.modeSelect.disabled = showOverlay;
    dom.sendBtn.disabled = showOverlay;
    dom.abortBtn.disabled = showOverlay;
    if (showOverlay && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function clearSessionLoading(sessionId) {
    const state = CCWeb.state;
    if (sessionId && state.activeSessionLoad && state.activeSessionLoad.sessionId !== sessionId) return;
    setSessionLoading(null, { blocking: false });
  }

  function isBlockingSessionLoad(sessionId) {
    const state = CCWeb.state;
    return !!(state.activeSessionLoad &&
      state.activeSessionLoad.blocking &&
      (!sessionId || state.activeSessionLoad.sessionId === sessionId));
  }

  function finishSessionSwitch(sessionId) {
    if (isBlockingSessionLoad(sessionId)) {
      CCWeb.ui.scrollToBottom();
      requestAnimationFrame(() => clearSessionLoading(sessionId));
      return;
    }
    clearSessionLoading(sessionId);
  }

  function finalizeLoadedSession(sessionId) {
    const state = CCWeb.state;
    if (state.activeSessionLoad?.sessionId === sessionId && state.activeSessionLoad.snapshot) {
      state.activeSessionLoad.snapshot.complete = true;
      cacheSessionSnapshot(state.activeSessionLoad.snapshot);
    }
    finishSessionSwitch(sessionId);
  }

  function beginSessionSwitch(sessionId, options = {}) {
    const state = CCWeb.state;
    if (!sessionId) return;
    const blocking = options.blocking !== false;
    const force = options.force === true;
    if (!force && state.activeSessionLoad?.sessionId === sessionId) return;
    if (!force && sessionId === state.currentSessionId && !state.activeSessionLoad) return;
    CCWeb.chat.incrementRenderEpoch();
    state.loadedHistorySessionId = null;
    setSessionLoading(sessionId, { blocking, label: options.label });
    CCWeb.send({ type: 'load_session', sessionId });
  }

  function showCachedSession(sessionId) {
    const snapshot = buildCachedSessionSnapshot(sessionId);
    if (!snapshot) return false;
    const state = CCWeb.state;
    clearSessionLoading();
    touchSessionCache(sessionId);
    applySessionSnapshot(snapshot, { immediate: true, suppressUnreadToast: true });
    return true;
  }

  function openSession(sessionId, options = {}) {
    const state = CCWeb.state;
    if (!sessionId) return;
    if (options.forceSync) {
      beginSessionSwitch(sessionId, { blocking: options.blocking !== false, force: true, label: options.label });
      return;
    }
    if (!options.force && sessionId === state.currentSessionId && !state.activeSessionLoad) return;

    const disposition = getSessionCacheDisposition(sessionId);
    if (disposition === 'strong') {
      showCachedSession(sessionId);
      return;
    }
    if (disposition === 'weak' && showCachedSession(sessionId)) {
      beginSessionSwitch(sessionId, { blocking: false, force: true, label: options.label });
      return;
    }
    beginSessionSwitch(sessionId, { blocking: options.blocking !== false, force: options.force === true, label: options.label });
  }

  function setStatsDisplay(msg) {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    if ((state.currentAgent === 'codex' || state.currentAgent === 'hermes' || state.currentAgent === 'gemini') && msg && msg.totalUsage) {
      const usage = msg.totalUsage;
      if ((usage.inputTokens || 0) > 0 || (usage.outputTokens || 0) > 0) {
        const cacheText = usage.cachedInputTokens ? ` · cache ${usage.cachedInputTokens}` : '';
        dom.costDisplay.textContent = `in ${usage.inputTokens} · out ${usage.outputTokens}${cacheText}`;
        return;
      }
    }
    if (msg && typeof msg.totalCost === 'number' && msg.totalCost > 0) {
      dom.costDisplay.textContent = `$${msg.totalCost.toFixed(4)}`;
      return;
    }
    dom.costDisplay.textContent = '';
  }

  // --- Session list rendering ---

  function renderSessionList() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    dom.sessionList.innerHTML = '';
    const visibleSessions = getVisibleSessions();
    if (visibleSessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'session-list-empty';
      empty.textContent = '暂无最近会话，点击「新会话」开始。';
      dom.sessionList.appendChild(empty);
      return;
    }

    for (const s of visibleSessions) {
      const sessionAgent = CCWeb.helpers.normalizeAgent(s.agent);
      const agentLabel = CCWeb.helpers.AGENT_LABELS?.[sessionAgent] || sessionAgent;
      const item = document.createElement('div');
      item.className = `session-item${s.id === state.currentSessionId ? ' active' : ''}`;
      item.dataset.id = s.id;
      item.innerHTML = `
        <div class="session-item-main">
          <span class="session-item-title">${CCWeb.helpers.escapeHtml(s.title || 'Untitled')}</span>
          <span class="session-item-meta">
            <span class="session-agent-badge agent-${sessionAgent}">${CCWeb.helpers.escapeHtml(agentLabel)}</span>
            ${s.isRunning ? '<span class="session-item-status">运行中</span>' : ''}
          </span>
        </div>
        ${s.hasUnread ? '<span class="session-unread-dot"></span>' : ''}
        <span class="session-item-time">${CCWeb.helpers.timeAgo(s.updated)}</span>
        <div class="session-item-actions">
          <button class="session-item-btn edit" title="重命名">✎</button>
          <button class="session-item-btn delete" title="删除">×</button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('delete')) {
          e.stopPropagation();
          const doDelete = () => {
            if (CCWeb.helpers.getLastSessionForAgent(sessionAgent) === s.id) {
              localStorage.removeItem(CCWeb.helpers.getAgentSessionStorageKey(sessionAgent));
            }
            invalidateSessionCache(s.id);
            CCWeb.send({ type: 'delete_session', sessionId: s.id });
            if (s.id === state.currentSessionId) {
              resetChatView(state.currentAgent);
            }
          };
          if (state.skipDeleteConfirm) {
            doDelete();
          } else {
            CCWeb.chat.showDeleteConfirm(s.agent, doDelete);
          }
          return;
        }
        if (target.classList.contains('edit')) {
          e.stopPropagation();
          startEditSessionTitle(item, s);
          return;
        }
        openSession(s.id);
      });

      dom.sessionList.appendChild(item);
    }
  }

  function startEditSessionTitle(itemEl, session) {
    const titleEl = itemEl.querySelector('.session-item-title');
    const currentTitle = session.title || '';
    const input = document.createElement('input');
    input.className = 'session-item-edit-input';
    input.value = currentTitle;
    input.maxLength = 100;

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const actions = itemEl.querySelector('.session-item-actions');
    const time = itemEl.querySelector('.session-item-time');
    if (actions) actions.style.display = 'none';
    if (time) time.style.display = 'none';

    function save() {
      const newTitle = input.value.trim() || currentTitle;
      if (newTitle !== currentTitle) {
        CCWeb.send({ type: 'rename_session', sessionId: session.id, title: newTitle });
      }
      const span = document.createElement('span');
      span.className = 'session-item-title';
      span.textContent = newTitle;
      input.replaceWith(span);
      if (actions) actions.style.display = '';
      if (time) time.style.display = '';
    }

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = currentTitle; input.blur(); }
    });
  }

  function highlightActiveSession() {
    const state = CCWeb.state;
    document.querySelectorAll('.session-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === state.currentSessionId);
    });
  }

  // --- New Session Modal ---

  function showNewSessionModal() {
    const state = CCWeb.state;
    const targetAgent = state.currentAgent;
    const targetLabel = CCWeb.helpers.AGENT_LABELS?.[targetAgent] || 'Claude';
    if (targetAgent === 'hermes') {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'new-session-overlay';
      overlay.innerHTML = `
        <div class="modal-panel modal-panel-compact">
          <div class="modal-header">
            <span class="modal-title">新建 Hermes 会话</span>
            <button class="modal-close-btn" id="ns-close-btn">✕</button>
          </div>
          <div class="modal-body">
            ${CCWeb.settings.buildAgentContextCard('hermes', 'WSL Hermes 原生对话', '使用当前 WSL Hermes Gateway 配置，不需要选择工作目录。工具调用会在对话中以结构化卡片显示。')}
          </div>
          <div class="modal-footer">
            <button class="modal-btn-secondary" id="ns-cancel-btn">取消</button>
            <button class="modal-btn-primary" id="ns-create-btn">创建</button>
          </div>
        </div>
      `;
      const close = () => overlay.remove();
      document.body.appendChild(overlay);
      overlay.querySelector('#ns-close-btn').addEventListener('click', close);
      overlay.querySelector('#ns-cancel-btn').addEventListener('click', close);
      overlay.querySelector('#ns-create-btn').addEventListener('click', () => {
        close();
        CCWeb.send({ type: 'new_session', agent: targetAgent, mode: state.currentMode, taskMode: 'local' });
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'new-session-overlay';

    overlay.innerHTML = `
      <div class="modal-panel">
        <div class="modal-header">
          <span class="modal-title">新建 ${CCWeb.helpers.escapeHtml(targetLabel)} 会话</span>
          <button class="modal-close-btn" id="ns-close-btn">✕</button>
        </div>
        <div class="modal-body">
          <div class="agent-context-card" style="margin-bottom:12px">
            <div class="agent-context-kicker" id="ns-task-label">${CCWeb.helpers.escapeHtml(targetLabel)} · 本地任务</div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button class="btn-test ns-task-tab active" id="ns-tab-local" style="flex:1;padding:6px 12px">本地任务</button>
            <button class="btn-test ns-task-tab" id="ns-tab-remote" style="flex:1;padding:6px 12px">远程任务</button>
          </div>
          <div id="ns-local-view"></div>
          <div id="ns-remote-view" style="display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="modal-btn-secondary" id="ns-cancel-btn">取消</button>
          <button class="modal-btn-primary" id="ns-create-btn">创建</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let currentTab = 'local';
    let selectedHostId = '';
    const tabLocal = overlay.querySelector('#ns-tab-local');
    const tabRemote = overlay.querySelector('#ns-tab-remote');
    const localView = overlay.querySelector('#ns-local-view');
    const remoteView = overlay.querySelector('#ns-remote-view');
    const taskLabel = overlay.querySelector('#ns-task-label');

    function switchTab(tab) {
      currentTab = tab;
      tabLocal.classList.toggle('active', tab === 'local');
      tabRemote.classList.toggle('active', tab === 'remote');
      tabLocal.style.opacity = tab === 'local' ? '1' : '0.6';
      tabRemote.style.opacity = tab === 'remote' ? '1' : '0.6';
      localView.style.display = tab === 'local' ? '' : 'none';
      remoteView.style.display = tab === 'remote' ? '' : 'none';
      taskLabel.textContent = targetLabel + (tab === 'local' ? ' · 本地任务' : ' · 远程任务');
    }
    tabLocal.addEventListener('click', () => switchTab('local'));
    tabRemote.addEventListener('click', () => switchTab('remote'));
    switchTab('local');

    // --- Local task view ---
    let selectedLocalIndex = 0;
    let customCwdValue = '';
    let pathBrowserOpen = false;
    let pathBrowserLoading = false;
    let pathBrowserRequestId = 0;
    let pathBrowserState = {
      path: '',
      parent: null,
      roots: [],
      entries: [],
      error: '',
    };

    function currentLocalDirs() {
      const currentPinned = CCWeb.helpers.getPinnedCwds(targetAgent);
      const currentRecent = CCWeb.helpers.getRecentCwds().filter(p => !currentPinned.includes(p));
      return [...currentPinned, ...currentRecent].slice(0, 4);
    }

    function requestPathEntries(dir) {
      pathBrowserOpen = true;
      pathBrowserLoading = true;
      pathBrowserRequestId += 1;
      CCWeb.send({
        type: 'browse_paths',
        path: dir || customCwdValue || currentLocalDirs()[0] || CCWeb.state.currentCwd || '',
        requestId: pathBrowserRequestId,
      });
      renderLocalView();
    }

    CCWeb._onPathEntries = (msg) => {
      if (!pathBrowserOpen) return;
      if (msg.requestId && msg.requestId !== pathBrowserRequestId) return;
      pathBrowserLoading = false;
      pathBrowserState = {
        path: msg.path || '',
        parent: msg.parent || null,
        roots: Array.isArray(msg.roots) ? msg.roots : [],
        entries: Array.isArray(msg.entries) ? msg.entries : [],
        error: msg.error || '',
      };
      renderLocalView();
    };

    function renderLocalView() {
      const currentPinned = CCWeb.helpers.getPinnedCwds(targetAgent);
      const currentRecent = CCWeb.helpers.getRecentCwds().filter(p => !currentPinned.includes(p));
      const filledDirs = [...currentPinned, ...currentRecent].slice(0, 4);
      const maxIndex = filledDirs.length;
      if (selectedLocalIndex > maxIndex) selectedLocalIndex = maxIndex;

      localView.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${filledDirs.map((dir, i) => {
            const isPinned = currentPinned.includes(dir);
            const isSelected = selectedLocalIndex === i;
            return `
              <div class="ns-cwd-row" data-local-row="${i}" style="display:flex;gap:6px;align-items:center;padding:4px 6px;border:1px solid ${isSelected ? 'var(--accent)' : 'transparent'};border-radius:8px;background:${isSelected ? 'var(--accent-dim,rgba(100,150,255,0.08))' : 'transparent'};cursor:pointer">
                <input type="radio" name="ns-local-cwd" class="ns-cwd-radio" data-local-radio="${i}" ${isSelected ? 'checked' : ''}>
                <input type="text" class="modal-text-input ns-cwd-item" value="${CCWeb.helpers.escapeHtml(dir)}" data-idx="${i}" style="flex:1;${isPinned ? '' : 'opacity:0.6'}">
                <button class="btn-test ns-pin-btn" data-idx="${i}" data-cwd="${CCWeb.helpers.escapeHtml(dir)}" style="padding:2px 6px;font-size:0.9em;${isPinned ? 'color:var(--accent)' : ''}" title="${isPinned ? '取消固定' : '固定'}">${isPinned ? '★' : '☆'}</button>
                <button class="btn-test ns-del-dir-btn" data-idx="${i}" data-cwd="${CCWeb.helpers.escapeHtml(dir)}" style="padding:2px 6px;font-size:0.9em" title="移除">✕</button>
              </div>
            `;
          }).join('')}
          <div class="ns-cwd-row" data-local-row="${filledDirs.length}" style="display:flex;gap:6px;align-items:center;padding:4px 6px;border:1px solid ${selectedLocalIndex === filledDirs.length ? 'var(--accent)' : 'transparent'};border-radius:8px;background:${selectedLocalIndex === filledDirs.length ? 'var(--accent-dim,rgba(100,150,255,0.08))' : 'transparent'};cursor:pointer">
            <input type="radio" name="ns-local-cwd" class="ns-cwd-radio" data-local-radio="${filledDirs.length}" ${selectedLocalIndex === filledDirs.length ? 'checked' : ''}>
            <input type="text" id="ns-cwd-custom" class="modal-text-input" placeholder="输入或选择工作目录" value="${CCWeb.helpers.escapeHtml(customCwdValue)}" style="flex:1">
            <button class="btn-test" id="ns-browse-cwd-btn" type="button" style="padding:6px 10px">选择目录</button>
          </div>
          ${pathBrowserOpen ? `
            <div class="path-picker">
              <div class="path-picker-header">
                <div class="path-picker-current" title="${CCWeb.helpers.escapeHtml(pathBrowserState.path || '')}">${CCWeb.helpers.escapeHtml(pathBrowserState.path || '选择目录')}</div>
                <button class="btn-test" id="ns-use-current-path" type="button" ${pathBrowserState.path ? '' : 'disabled'}>选用当前目录</button>
              </div>
              <div class="path-picker-roots">
                ${(pathBrowserState.roots || []).map(root => `<button class="path-root-btn" type="button" data-browse-root="${CCWeb.helpers.escapeHtml(root)}">${CCWeb.helpers.escapeHtml(root)}</button>`).join('')}
              </div>
              <div class="path-picker-list">
                ${pathBrowserLoading ? '<div class="modal-loading path-picker-empty">正在读取目录…</div>' : ''}
                ${!pathBrowserLoading && pathBrowserState.error ? `<div class="modal-empty path-picker-empty">${CCWeb.helpers.escapeHtml(pathBrowserState.error)}</div>` : ''}
                ${!pathBrowserLoading && pathBrowserState.parent ? `
                  <button class="path-entry path-entry-parent" type="button" data-browse-open="${CCWeb.helpers.escapeHtml(pathBrowserState.parent)}">
                    <span>..</span><small>上级目录</small>
                  </button>
                ` : ''}
                ${!pathBrowserLoading && !pathBrowserState.error ? (pathBrowserState.entries || []).map(entry => `
                  <div class="path-entry">
                    <button class="path-entry-open" type="button" data-browse-open="${CCWeb.helpers.escapeHtml(entry.path)}" ${entry.readable ? '' : 'disabled'}>
                      <span>${CCWeb.helpers.escapeHtml(entry.name)}</span>
                      <small>${entry.readable ? '' : '无读取权限'}</small>
                    </button>
                    <button class="path-entry-use" type="button" data-browse-use="${CCWeb.helpers.escapeHtml(entry.path)}" ${entry.readable ? '' : 'disabled'}>选用</button>
                  </div>
                `).join('') : ''}
              </div>
            </div>
          ` : ''}
        </div>
      `;

      localView.querySelectorAll('[data-local-row]').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.ns-pin-btn') || e.target.closest('.ns-del-dir-btn')) return;
          selectedLocalIndex = Number(row.dataset.localRow);
          renderLocalView();
        });
      });

      localView.querySelectorAll('.ns-cwd-item, #ns-cwd-custom').forEach(input => {
        input.addEventListener('focus', () => {
          const row = input.closest('[data-local-row]');
          if (!row) return;
          if (input.id === 'ns-cwd-custom') customCwdValue = input.value.trim();
          selectedLocalIndex = Number(row.dataset.localRow);
          renderLocalView();
          const freshInput = localView.querySelector(row.dataset.localRow === String(filledDirs.length) ? '#ns-cwd-custom' : `.ns-cwd-item[data-idx="${row.dataset.localRow}"]`);
          if (freshInput) {
            const val = freshInput.value;
            freshInput.focus();
            if (typeof freshInput.setSelectionRange === 'function') freshInput.setSelectionRange(val.length, val.length);
          }
        });
        input.addEventListener('input', () => {
          if (input.id === 'ns-cwd-custom') customCwdValue = input.value;
        });
      });

      const browseBtn = localView.querySelector('#ns-browse-cwd-btn');
      if (browseBtn) {
        browseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const input = localView.querySelector('#ns-cwd-custom');
          customCwdValue = input?.value?.trim() || customCwdValue;
          selectedLocalIndex = filledDirs.length;
          requestPathEntries(customCwdValue);
        });
      }

      const useCurrentBtn = localView.querySelector('#ns-use-current-path');
      if (useCurrentBtn) {
        useCurrentBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          customCwdValue = pathBrowserState.path || customCwdValue;
          selectedLocalIndex = filledDirs.length;
          pathBrowserOpen = false;
          renderLocalView();
        });
      }

      localView.querySelectorAll('[data-browse-root], [data-browse-open]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = btn.dataset.browseRoot || btn.dataset.browseOpen;
          if (next) requestPathEntries(next);
        });
      });

      localView.querySelectorAll('[data-browse-use]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          customCwdValue = btn.dataset.browseUse || customCwdValue;
          selectedLocalIndex = filledDirs.length;
          pathBrowserOpen = false;
          renderLocalView();
        });
      });

      localView.querySelectorAll('.ns-pin-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const rowInput = btn.closest('[data-local-row]')?.querySelector('.ns-cwd-item');
          const cwd = rowInput?.value?.trim() || btn.dataset.cwd;
          if (!cwd) return;
          const currentPinned2 = CCWeb.helpers.getPinnedCwds(targetAgent);
          if (currentPinned2.includes(cwd)) {
            CCWeb.helpers.removePinnedCwd(targetAgent, cwd);
          } else {
            CCWeb.helpers.savePinnedCwd(targetAgent, cwd);
          }
          selectedLocalIndex = Number(btn.dataset.idx || 0);
          renderLocalView();
        });
      });

      localView.querySelectorAll('.ns-del-dir-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const rowInput = btn.closest('[data-local-row]')?.querySelector('.ns-cwd-item');
          const cwd = rowInput?.value?.trim() || btn.dataset.cwd;
          if (!cwd) return;
          CCWeb.helpers.removePinnedCwd(targetAgent, cwd);
          let recents = CCWeb.helpers.getRecentCwds().filter(p => p !== cwd);
          try { localStorage.setItem('cc-web-recent-cwds', JSON.stringify(recents)); } catch {}
          if (selectedLocalIndex > 0) selectedLocalIndex -= 1;
          renderLocalView();
        });
      });
    }

    renderLocalView();

    // --- Remote task view ---
    let sshHosts = [];
    const prevOnDevConfig = CCWeb._onDevConfig;
    CCWeb.send({ type: 'get_dev_config' });
    CCWeb._onDevConfig = (config) => {
      sshHosts = config.ssh?.hosts || [];
      renderRemoteView();
    };

    function renderRemoteView() {
      if (sshHosts.length === 0) {
        remoteView.innerHTML = '<div class="settings-inline-note" style="text-align:center">请先在 设置 > 开发者设置 中添加 SSH 主机</div>';
        return;
      }
      remoteView.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${sshHosts.map((host) => `
            <div style="display:flex;gap:8px;align-items:center;padding:8px;border:1px solid var(--border);border-radius:6px;cursor:pointer;${selectedHostId === host.id ? 'border-color:var(--accent);background:var(--accent-dim,rgba(100,150,255,0.08))' : ''}" data-host-select="${host.id}">
              <input type="radio" name="ns-ssh-host" value="${CCWeb.helpers.escapeHtml(host.id)}" ${selectedHostId === host.id ? 'checked' : ''} style="margin:0">
              <div style="flex:1">
                <div style="font-weight:600">${CCWeb.helpers.escapeHtml(host.name || '未命名')}</div>
                <div style="font-size:0.85em;color:var(--text-secondary)">${CCWeb.helpers.escapeHtml(host.user || '')}@${CCWeb.helpers.escapeHtml(host.host || '')}:${host.port || 22}${host.description ? ' · ' + CCWeb.helpers.escapeHtml(host.description) : ''}</div>
              </div>
            </div>
          `).join('')}
          ${selectedHostId ? `
            <div style="margin-top:8px">
              <label class="modal-field-label" style="margin-bottom:4px">远端工作目录（可选）</label>
              <input type="text" id="ns-remote-cwd" class="modal-text-input" placeholder="留空使用 SSH 默认目录">
            </div>
          ` : ''}
        </div>
      `;

      remoteView.querySelectorAll('[data-host-select]').forEach(el => {
        el.addEventListener('click', () => {
          selectedHostId = el.dataset.hostSelect;
          renderRemoteView();
        });
      });
    }
    renderRemoteView();

    function close() {
      overlay.remove();
      CCWeb._onCwdSuggestions = null;
      CCWeb._onPathEntries = null;
      CCWeb._onDevConfig = prevOnDevConfig;
    }

    overlay.querySelector('#ns-close-btn').addEventListener('click', close);
    overlay.querySelector('#ns-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#ns-create-btn').addEventListener('click', () => {
      if (currentTab === 'local') {
        const customInput = localView.querySelector('#ns-cwd-custom');
        const editedItems = Array.from(localView.querySelectorAll('.ns-cwd-item')).map(input => input.value.trim());
        let cwd = null;
        if (selectedLocalIndex === editedItems.length) {
          cwd = customInput?.value?.trim() || customCwdValue || null;
        } else {
          cwd = editedItems[selectedLocalIndex] || null;
        }
        if (!cwd) {
          alert('请选择或输入工作目录');
          return;
        }
        close();
        CCWeb.helpers.saveRecentCwd(cwd);
        CCWeb.send({ type: 'new_session', cwd, agent: targetAgent, mode: state.currentMode, taskMode: 'local' });
      } else {
        if (!selectedHostId) {
          alert('请选择一个 SSH 主机');
          return;
        }
        const remoteCwd = remoteView.querySelector('#ns-remote-cwd')?.value?.trim() || '';
        close();
        CCWeb.send({ type: 'new_session', agent: targetAgent, mode: state.currentMode, taskMode: 'remote', sshHostId: selectedHostId, remoteCwd });
      }
    });
  }

  // --- Import Native Session Modal ---

  function showImportSessionModal() {
    const state = CCWeb.state;
    if (state.currentAgent !== 'claude') return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'import-session-overlay';

    overlay.innerHTML = `
      <div class="modal-panel modal-panel-wide">
        <div class="modal-header">
          <span class="modal-title">导入本地 CLI 会话</span>
          <button class="modal-close-btn" id="is-close-btn">✕</button>
        </div>
        <div class="modal-body" id="is-body">
          ${CCWeb.settings.buildAgentContextCard('claude', '从 Claude 原生历史导入', '读取 ~/.claude/projects/ 下的会话文件，恢复对话文本与工具调用，并保留 Claude 侧续接上下文。')}
          <div class="modal-loading">正在加载…</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      CCWeb._onNativeSessions = null;
    }

    overlay.querySelector('#is-close-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    CCWeb._onNativeSessions = (groups) => {
      const body = overlay.querySelector('#is-body');
      if (!body) return;
      if (!groups || groups.length === 0) {
        body.innerHTML = `${CCWeb.settings.buildAgentContextCard('claude', '从 Claude 原生历史导入', '读取 ~/.claude/projects/ 下的会话文件，恢复对话文本与工具调用，并保留 Claude 侧续接上下文。')}<div class="modal-empty">未找到本地 CLI 会话</div>`;
        return;
      }
      body.innerHTML = CCWeb.settings.buildAgentContextCard('claude', '从 Claude 原生历史导入', '读取 ~/.claude/projects/ 下的会话文件，恢复对话文本与工具调用，并保留 Claude 侧续接上下文。');
      for (const group of groups) {
        const groupEl = document.createElement('div');
        groupEl.className = 'import-group';
        let readablePath = group.dir.replace(/-/g, '/');
        if (!readablePath.startsWith('/')) readablePath = '/' + readablePath;
        readablePath = readablePath.replace(/\/+/g, '/');
        const groupTitle = document.createElement('div');
        groupTitle.className = 'import-group-title';
        groupTitle.textContent = readablePath;
        groupEl.appendChild(groupTitle);
        for (const sess of group.sessions) {
          const item = document.createElement('div');
          item.className = 'import-item';
          const info = document.createElement('div');
          info.className = 'import-item-info';
          const titleEl = document.createElement('div');
          titleEl.className = 'import-item-title';
          titleEl.textContent = sess.title;
          const meta = document.createElement('div');
          meta.className = 'import-item-meta';
          const cwdText = sess.cwd ? sess.cwd : '';
          const timeText = sess.updatedAt ? CCWeb.helpers.timeAgo(sess.updatedAt) : '';
          meta.textContent = [cwdText, timeText].filter(Boolean).join(' · ');
          info.appendChild(titleEl);
          info.appendChild(meta);
          const btn = document.createElement('button');
          btn.className = 'import-item-btn';
          btn.textContent = sess.alreadyImported ? '重新导入' : '导入';
          btn.addEventListener('click', () => {
            if (sess.alreadyImported) {
              if (!confirm('已导入过此会话，重新导入将覆盖已有内容。确认继续？')) return;
            } else {
              if (!confirm('由于 agent-web 与本地 CLI 的逻辑不同，导入会话需要解析后方可展示，导入后将覆盖已有内容。确认继续？')) return;
            }
            close();
            CCWeb.send({ type: 'import_native_session', sessionId: sess.sessionId, projectDir: group.dir });
          });
          item.appendChild(info);
          item.appendChild(btn);
          groupEl.appendChild(item);
        }
        body.appendChild(groupEl);
      }
    };

    CCWeb.send({ type: 'list_native_sessions' });
  }

  function showImportCodexSessionModal() {
    const state = CCWeb.state;
    if (state.currentAgent !== 'codex') return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'import-codex-session-overlay';

    overlay.innerHTML = `
      <div class="modal-panel modal-panel-wide">
        <div class="modal-header">
          <span class="modal-title">导入本地 Codex 会话</span>
          <button class="modal-close-btn" id="ics-close-btn">✕</button>
        </div>
        <div class="modal-body" id="ics-body">
          ${CCWeb.settings.buildAgentContextCard('codex', '从 Codex rollout 历史导入', '读取 ~/.codex/sessions/ 下的 rollout 文件，恢复用户消息、助手输出、函数调用和 token 统计。')}
          <div class="modal-loading">正在加载 Codex 本地历史…</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      CCWeb._onCodexSessions = null;
    }

    overlay.querySelector('#ics-close-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    CCWeb._onCodexSessions = (items) => {
      const body = overlay.querySelector('#ics-body');
      if (!body) return;
      if (!items || items.length === 0) {
        body.innerHTML = `${CCWeb.settings.buildAgentContextCard('codex', '从 Codex rollout 历史导入', '读取 ~/.codex/sessions/ 下的 rollout 文件，恢复用户消息、助手输出、函数调用和 token 统计。')}<div class="modal-empty">未找到本地 Codex 会话</div>`;
        return;
      }

      body.innerHTML = CCWeb.settings.buildAgentContextCard('codex', '从 Codex rollout 历史导入', '读取 ~/.codex/sessions/ 下的 rollout 文件，恢复用户消息、助手输出、函数调用和 token 统计。');
      items.forEach((sess) => {
        const item = document.createElement('div');
        item.className = 'import-item';

        const info = document.createElement('div');
        info.className = 'import-item-info';

        const titleEl = document.createElement('div');
        titleEl.className = 'import-item-title';
        titleEl.textContent = sess.title || sess.threadId;

        const meta = document.createElement('div');
        meta.className = 'import-item-meta';
        meta.textContent = [
          sess.cwd || '',
          sess.source ? `source:${sess.source}` : '',
          sess.updatedAt ? CCWeb.helpers.timeAgo(sess.updatedAt) : '',
        ].filter(Boolean).join(' · ');

        const tags = document.createElement('div');
        tags.className = 'import-item-tags';
        if (sess.cliVersion) {
          const ver = document.createElement('span');
          ver.className = 'import-item-tag';
          ver.textContent = `CLI ${sess.cliVersion}`;
          tags.appendChild(ver);
        }
        if (sess.source) {
          const source = document.createElement('span');
          source.className = 'import-item-tag';
          source.textContent = sess.source;
          tags.appendChild(source);
        }

        info.appendChild(titleEl);
        info.appendChild(meta);
        if (tags.children.length > 0) info.appendChild(tags);

        const btn = document.createElement('button');
        btn.className = 'import-item-btn';
        btn.textContent = sess.alreadyImported ? '重新导入' : '导入';
        btn.addEventListener('click', () => {
          const confirmed = sess.alreadyImported
            ? confirm('已导入过此 Codex 会话，重新导入将覆盖已有内容。确认继续？')
            : confirm('将解析本地 Codex rollout 历史并导入当前 Web 视图。确认继续？');
          if (!confirmed) return;
          close();
          CCWeb.send({ type: 'import_codex_session', threadId: sess.threadId, rolloutPath: sess.rolloutPath });
        });

        item.appendChild(info);
        item.appendChild(btn);
        body.appendChild(item);
      });
    };

    CCWeb.send({ type: 'list_codex_sessions' });
  }

  // Register on CCWeb namespace
  CCWeb.session = {
    normalizeSessionSnapshot,
    getSessionMeta,
    cacheSessionSnapshot,
    updateCachedSession,
    reconcileSessionCacheWithSessions,
    getSessionCacheDisposition,
    buildCachedSessionSnapshot,
    getVisibleSessions,
    setCurrentAgent,
    resetChatView,
    applySessionSnapshot,
    syncViewForAgent,
    setSessionLoading,
    clearSessionLoading,
    isBlockingSessionLoad,
    finishSessionSwitch,
    finalizeLoadedSession,
    beginSessionSwitch,
    showCachedSession,
    openSession,
    setStatsDisplay,
    renderSessionList,
    startEditSessionTitle,
    highlightActiveSession,
    showNewSessionModal,
    showImportSessionModal,
    showImportCodexSessionModal,
    invalidateSessionCache,
  };
})();

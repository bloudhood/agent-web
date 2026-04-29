// === Agent-Web Chat Module ===
// Messages, tool calls, AskUser, generating state, rendering.
window.CCWeb = window.CCWeb || {};

(function () {
  'use strict';

  const RENDER_DEBOUNCE = 100;

  // --- Local state ---
  let renderEpoch = 0;

  function incrementRenderEpoch() {
    renderEpoch++;
  }

  // --- Generating State ---
  function startGenerating() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    state.isGenerating = true;
    CCWeb.ui.setCurrentSessionRunningState(true);
    state.pendingText = '';
    state.activeToolCalls.clear();
    state.toolGroupCount = 0;
    state.hasGrouped = false;
    dom.sendBtn.hidden = true;
    dom.abortBtn.hidden = false;

    const welcome = dom.messagesDiv.querySelector('.welcome-msg');
    if (welcome) welcome.remove();

    const msgEl = createMsgElement('assistant', '');
    msgEl.id = 'streaming-msg';
    const bubble = msgEl.querySelector('.msg-bubble');
    bubble.innerHTML = '';
    const textDiv = document.createElement('div');
    textDiv.className = 'msg-text';
    textDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    const toolsDiv = document.createElement('div');
    toolsDiv.className = 'msg-tools';
    bubble.appendChild(textDiv);
    bubble.appendChild(toolsDiv);
    dom.messagesDiv.appendChild(msgEl);
    CCWeb.ui.scrollToBottom();
  }

  function finishGenerating(sessionId) {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    state.isGenerating = false;
    dom.sendBtn.hidden = false;
    dom.abortBtn.hidden = true;
    CCWeb.ui.setCurrentSessionRunningState(false);
    dom.msgInput.focus();

    if (state.pendingText) flushRender();

    const typing = document.querySelector('.typing-indicator');
    if (typing) typing.remove();

    const streamEl = document.getElementById('streaming-msg');
    if (streamEl) {
      if (state.hasGrouped) {
        const toolsDiv = streamEl.querySelector('.msg-tools');
        if (toolsDiv) {
          const loose = Array.from(toolsDiv.children).filter(c => c.classList.contains('tool-call'));
          if (loose.length > 0) {
            let group = toolsDiv.querySelector(':scope > .tool-group');
            if (!group) {
              group = document.createElement('details');
              group.className = 'tool-group';
              const gs = document.createElement('summary');
              gs.className = 'tool-group-summary';
              group.appendChild(gs);
              const inner = document.createElement('div');
              inner.className = 'tool-group-inner';
              group.appendChild(inner);
              toolsDiv.insertBefore(group, toolsDiv.firstChild);
            }
            const inner = group.querySelector('.tool-group-inner');
            loose.forEach(c => inner.appendChild(c));
            _refreshGroupSummary(group);
          }
        }
      }
      streamEl.removeAttribute('id');
    }

    if (sessionId) state.currentSessionId = sessionId;
    state.pendingText = '';
    state.activeToolCalls.clear();
    state.toolGroupCount = 0;
    state.hasGrouped = false;
  }

  // --- Rendering ---
  function scheduleRender() {
    const state = CCWeb.state;
    if (state.renderTimer) return;
    state.renderTimer = setTimeout(() => {
      CCWeb.state.renderTimer = null;
      flushRender();
    }, RENDER_DEBOUNCE);
  }

  function flushRender() {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    const streamEl = document.getElementById('streaming-msg');
    if (!streamEl) return;
    const bubble = streamEl.querySelector('.msg-bubble');
    if (!bubble) return;
    let textDiv = bubble.querySelector('.msg-text');
    if (!textDiv) { textDiv = bubble; }
    textDiv.innerHTML = CCWeb.markdown.renderMarkdown(state.pendingText);
    CCWeb.ui.scrollToBottom();
  }

  function renderMarkdown(text) {
    return CCWeb.markdown.renderMarkdown(text);
  }

  function createMsgElement(role, content, attachments = []) {
    const state = CCWeb.state;
    const div = document.createElement('div');
    div.className = `msg ${role}${role === 'assistant' ? ' agent-' + state.currentAgent : ''}`;

    if (role === 'system') {
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      bubble.textContent = content;
      div.appendChild(bubble);
      return div;
    }

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    if (role === 'user') {
      avatar.textContent = 'U';
    } else if (state.currentAgent === 'codex') {
      avatar.innerHTML = `<img src="/codex.png" width="24" height="24" style="display:block;" alt="Codex">`;
    } else if (state.currentAgent === 'hermes') {
      avatar.innerHTML = '<span class="hermes-avatar-mark">H</span>';
    } else if (state.currentAgent === 'gemini') {
      avatar.innerHTML = '<span class="gemini-avatar-mark">G</span>';
    } else {
      avatar.innerHTML = `<img src="/claude.png" width="24" height="24" style="display:block;" alt="Claude">`;
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (role === 'user') {
      if (content) {
        const textNode = document.createElement('div');
        textNode.className = 'msg-text';
        textNode.style.whiteSpace = 'pre-wrap';
        textNode.textContent = content;
        bubble.appendChild(textNode);
      }
      if (attachments.length > 0) {
        bubble.insertAdjacentHTML('beforeend', CCWeb.ui.renderAttachmentLabels(attachments));
      }
    } else {
      bubble.innerHTML = content ? CCWeb.markdown.renderMarkdown(content) : '';
      if (attachments.length > 0) {
        bubble.insertAdjacentHTML('beforeend', CCWeb.ui.renderAttachmentLabels(attachments));
      }
    }

    div.appendChild(avatar);
    div.appendChild(bubble);
    return div;
  }

  // --- Tool call helpers ---

  function toolKind(tool) {
    return tool?.kind || tool?.meta?.kind || '';
  }

  function toolTitle(tool) {
    if (tool?.meta?.title) return tool.meta.title;
    return tool?.name || 'Tool';
  }

  function toolSubtitle(tool) {
    if (tool?.meta?.subtitle) return tool.meta.subtitle;
    if (toolKind(tool) === 'command_execution') {
      return tool?.input?.command || '';
    }
    return '';
  }

  function stringifyToolValue(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function toolStateLabel(tool, done) {
    if (!done) return 'Running';
    if (toolKind(tool) === 'command_execution' && typeof tool?.meta?.exitCode === 'number') {
      return `Exit ${tool.meta.exitCode}`;
    }
    return 'Done';
  }

  function toolStateClass(tool, done) {
    if (!done) return 'running';
    if (toolKind(tool) === 'command_execution' && typeof tool?.meta?.exitCode === 'number' && tool.meta.exitCode !== 0) {
      return 'error';
    }
    return 'done';
  }

  function applyToolSummary(summary, tool, done) {
    summary.innerHTML = '';
    const icon = document.createElement('span');
    icon.className = `tool-call-icon ${done ? 'done' : 'running'}`;

    const main = document.createElement('span');
    main.className = 'tool-call-summary-main';
    const label = document.createElement('span');
    label.className = 'tool-call-label';
    label.textContent = toolTitle(tool);
    main.appendChild(label);

    const subtitleText = toolSubtitle(tool);
    if (subtitleText) {
      const subtitle = document.createElement('span');
      subtitle.className = 'tool-call-subtitle';
      subtitle.textContent = subtitleText;
      main.appendChild(subtitle);
    }

    const state = document.createElement('span');
    state.className = `tool-call-state ${toolStateClass(tool, done)}`;
    state.textContent = toolStateLabel(tool, done);

    summary.appendChild(icon);
    summary.appendChild(main);
    summary.appendChild(state);
  }

  function buildStructuredToolSection(labelText, bodyText) {
    const section = document.createElement('div');
    section.className = 'tool-call-section';
    const label = document.createElement('div');
    label.className = 'tool-call-section-label';
    label.textContent = labelText;
    const pre = document.createElement('pre');
    pre.className = 'tool-call-code';
    pre.textContent = bodyText;
    section.appendChild(label);
    section.appendChild(pre);
    return section;
  }

  // --- AskUserQuestion ---

  function normalizeAskUserInput(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) return null;
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    return input;
  }

  function extractAskUserQuestions(input) {
    const parsed = normalizeAskUserInput(input);
    if (!parsed || !Array.isArray(parsed.questions)) return [];
    return parsed.questions;
  }

  function appendAskOptionToInput(question, option) {
    const dom = CCWeb.dom;
    const header = (question?.header || '').trim() || '问题';
    const line = `【${header}】${option?.label || ''}`;
    const current = dom.msgInput.value.trim();
    dom.msgInput.value = current ? `${current}\n${line}` : line;
    CCWeb.ui.autoResize();
    dom.msgInput.focus();
  }

  function createAskUserQuestionView(questions) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ask-user-question';

    questions.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'ask-question-card';

      const header = document.createElement('div');
      header.className = 'ask-question-header';
      header.textContent = `${idx + 1}. ${q.header || '问题'}`;
      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'ask-question-text';
      body.textContent = q.question || '';
      card.appendChild(body);

      if (Array.isArray(q.options) && q.options.length > 0) {
        const hasDesc = q.options.some(o => o.description);

        const layout = document.createElement('div');
        layout.className = 'ask-options-layout' + (hasDesc ? ' has-preview' : '');

        const opts = document.createElement('div');
        opts.className = 'ask-question-options';

        const preview = hasDesc ? document.createElement('div') : null;
        if (preview) {
          preview.className = 'ask-option-preview';
          preview.textContent = q.options[0].description || '';
        }

        let selectedOpt = null;
        let selectedBtn = null;

        q.options.forEach((opt, i) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'ask-option-item';

          const title = document.createElement('div');
          title.className = 'ask-option-label';
          title.textContent = `${i + 1}. ${opt.label || ''}`;
          item.appendChild(title);

          if (preview) {
            item.addEventListener('mouseenter', () => {
              preview.textContent = opt.description || '';
            });
          }

          item.addEventListener('click', (e) => {
            const isTouch = item.dataset.touchActivated === '1';
            item.dataset.touchActivated = '';

            if (isTouch) {
              if (selectedBtn !== item) {
                if (selectedBtn) selectedBtn.classList.remove('ask-option-selected');
                selectedBtn = item;
                selectedOpt = opt;
                item.classList.add('ask-option-selected');
                if (preview) preview.textContent = opt.description || '';
                return;
              }
            }

            appendAskOptionToInput(q, opt);
          });

          item.addEventListener('touchstart', () => {
            item.dataset.touchActivated = '1';
          }, { passive: true });

          opts.appendChild(item);
        });

        layout.appendChild(opts);
        if (preview) {
          layout.appendChild(preview);
          requestAnimationFrame(() => {
            preview.style.minHeight = opts.offsetHeight + 'px';
          });
        }

        if (hasDesc) {
          const confirmBtn = document.createElement('button');
          confirmBtn.type = 'button';
          confirmBtn.className = 'ask-confirm-btn';
          confirmBtn.textContent = '确认选择';
          confirmBtn.addEventListener('click', () => {
            if (selectedOpt) {
              appendAskOptionToInput(q, selectedOpt);
            } else if (q.options.length > 0) {
              appendAskOptionToInput(q, q.options[0]);
            }
          });
          layout.appendChild(confirmBtn);
        }

        card.appendChild(layout);
      }

      wrapper.appendChild(card);
    });

    return wrapper;
  }

  // --- Tool content element ---

  function buildToolContentElement(name, input) {
    const tool = typeof name === 'object' && name !== null ? name : { name, input };
    const effectiveName = tool.name || name;
    const effectiveInput = tool.input !== undefined ? tool.input : input;
    const effectiveResult = tool.result;
    const kind = toolKind(tool);
    if (effectiveName === 'AskUserQuestion') {
      const questions = extractAskUserQuestions(effectiveInput);
      if (questions.length > 0) {
        return createAskUserQuestionView(questions);
      }
    }

    if (kind === 'command_execution') {
      const wrapper = document.createElement('div');
      wrapper.className = 'tool-call-content command';
      const stack = document.createElement('div');
      stack.className = 'tool-call-structured';
      const commandText = effectiveInput?.command || tool?.meta?.subtitle || '';
      if (commandText) stack.appendChild(buildStructuredToolSection('Command', commandText));
      if (effectiveResult) {
        stack.appendChild(buildStructuredToolSection('Output', stringifyToolValue(effectiveResult)));
      } else if (!tool.done) {
        const empty = document.createElement('div');
        empty.className = 'tool-call-empty';
        empty.textContent = '等待命令输出…';
        stack.appendChild(empty);
      }
      wrapper.appendChild(stack);
      return wrapper;
    }

    if (kind === 'reasoning') {
      const content = document.createElement('div');
      content.className = 'tool-call-content reasoning';
      const text = stringifyToolValue(effectiveResult || effectiveInput);
      content.innerHTML = text ? CCWeb.markdown.renderMarkdown(text) : '<div class="tool-call-empty">暂无推理内容</div>';
      return content;
    }

    if (kind === 'file_change' || kind === 'mcp_tool_call') {
      const wrapper = document.createElement('div');
      wrapper.className = `tool-call-content ${kind === 'file_change' ? 'file-change' : ''}`.trim();
      const stack = document.createElement('div');
      stack.className = 'tool-call-structured';
      if (tool?.meta?.subtitle) {
        stack.appendChild(buildStructuredToolSection(kind === 'file_change' ? 'Target' : 'Tool', tool.meta.subtitle));
      }
      const payloadText = stringifyToolValue(effectiveResult || effectiveInput);
      if (payloadText) {
        stack.appendChild(buildStructuredToolSection('Payload', payloadText));
      }
      wrapper.appendChild(stack);
      return wrapper;
    }

    const inputStr = stringifyToolValue(effectiveResult || effectiveInput);
    const content = document.createElement('div');
    content.className = 'tool-call-content';
    content.textContent = inputStr;
    return content;
  }

  function createToolCallElement(toolUseId, tool, done) {
    const state = CCWeb.state;
    const details = document.createElement('details');
    details.className = 'tool-call';
    details.id = `tool-${toolUseId}`;
    details.dataset.toolName = tool.name || '';
    if (toolKind(tool)) {
      details.dataset.toolKind = toolKind(tool);
      details.classList.add(`codex-${toolKind(tool).replace(/_/g, '-')}`);
    }
    const agent = CCWeb.helpers.normalizeAgent(state.currentAgent);
    const kind = toolKind(tool);
    if (tool.name === 'AskUserQuestion') {
      details.open = true;
    } else if (agent !== 'codex' && !done && kind === 'command_execution') {
      details.open = true;
    }

    const summary = document.createElement('summary');
    applyToolSummary(summary, tool, done);
    details.appendChild(summary);
    details.appendChild(buildToolContentElement({ ...tool, done }));
    return details;
  }

  function appendToolCall(toolUseId, name, input, done, kind = null, meta = null) {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    const streamEl = document.getElementById('streaming-msg');
    if (!streamEl) return;
    const bubble = streamEl.querySelector('.msg-bubble');
    if (!bubble) return;
    let toolsDiv = bubble.querySelector('.msg-tools');
    if (!toolsDiv) { toolsDiv = bubble; }

    const tool = { id: toolUseId, name, input, kind, meta, done };

    const details = createToolCallElement(toolUseId, tool, done);

    const FOLD_AT = 3;
    const looseBefore = Array.from(toolsDiv.children).filter(c => c.classList.contains('tool-call'));
    if (looseBefore.length >= FOLD_AT) {
      let group = toolsDiv.querySelector(':scope > .tool-group');
      if (!group) {
        group = document.createElement('details');
        group.className = 'tool-group';
        const gs = document.createElement('summary');
        gs.className = 'tool-group-summary';
        group.appendChild(gs);
        const inner = document.createElement('div');
        inner.className = 'tool-group-inner';
        group.appendChild(inner);
        toolsDiv.insertBefore(group, toolsDiv.firstChild);
        state.hasGrouped = true;
      }
      const inner = group.querySelector('.tool-group-inner');
      looseBefore.forEach(c => inner.appendChild(c));
      _refreshGroupSummary(group);
    }
    toolsDiv.appendChild(details);
    CCWeb.ui.scrollToBottom();
  }

  function _refreshGroupSummary(group) {
    const inner = group.querySelector('.tool-group-inner');
    const count = inner ? inner.childElementCount : 0;
    const summary = group.querySelector('.tool-group-summary');
    if (summary) summary.textContent = `展开 ${count} 个工具调用`;
  }

  function updateToolCall(toolUseId, result) {
    const state = CCWeb.state;
    const el = document.getElementById(`tool-${toolUseId}`);
    if (!el) return;
    const tool = state.activeToolCalls.get(toolUseId) || {
      id: toolUseId,
      name: el.dataset.toolName || '',
      kind: el.dataset.toolKind || null,
      done: true,
    };
    tool.done = true;
    if (result !== undefined) tool.result = result;
    const summary = el.querySelector('summary');
    if (summary) applyToolSummary(summary, tool, true);
    if (tool.name === 'AskUserQuestion') return;
    const nextContent = buildToolContentElement(tool);
    const content = el.querySelector('.tool-call-content');
    if (content) content.replaceWith(nextContent);
  }

  // --- Build message element from saved message ---

  function buildMsgElement(m) {
    const el = createMsgElement(m.role, m.content, m.attachments || []);
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const bubble = el.querySelector('.msg-bubble');
      const FOLD_AT = 3;
      let grouped = false;
      for (const tc of m.toolCalls) {
        const details = createToolCallElement(tc.id || `saved-${Math.random().toString(36).slice(2)}`, tc, true);

        const loose = Array.from(bubble.children).filter(c => c.classList.contains('tool-call'));
        if (loose.length >= FOLD_AT) {
          let group = bubble.querySelector(':scope > .tool-group');
          if (!group) {
            group = document.createElement('details');
            group.className = 'tool-group';
            const gs = document.createElement('summary');
            gs.className = 'tool-group-summary';
            group.appendChild(gs);
            const inner = document.createElement('div');
            inner.className = 'tool-group-inner';
            group.appendChild(inner);
            bubble.insertBefore(group, bubble.firstChild);
            grouped = true;
          }
          const inner = group.querySelector('.tool-group-inner');
          loose.forEach(c => inner.appendChild(c));
          _refreshGroupSummary(group);
        }
        bubble.appendChild(details);
      }
      if (grouped) {
        const loose = Array.from(bubble.children).filter(c => c.classList.contains('tool-call'));
        if (loose.length > 0) {
          const group = bubble.querySelector(':scope > .tool-group');
          if (group) {
            const inner = group.querySelector('.tool-group-inner');
            loose.forEach(c => inner.appendChild(c));
            _refreshGroupSummary(group);
          }
        }
      }
    }
    return el;
  }

  function renderMessages(messages, options = {}) {
    const dom = CCWeb.dom;
    const state = CCWeb.state;
    renderEpoch++;
    const epoch = renderEpoch;
    dom.messagesDiv.innerHTML = '';
    if (messages.length === 0) {
      dom.messagesDiv.innerHTML = CCWeb.helpers.buildWelcomeMarkup(state.currentAgent);
      return;
    }
    if (options.immediate) {
      const frag = document.createDocumentFragment();
      messages.forEach((message) => frag.appendChild(buildMsgElement(message)));
      dom.messagesDiv.appendChild(frag);
      CCWeb.ui.scrollToBottom();
      return;
    }
    // Batch render: last 10 first, then next 20, then the rest
    const batches = [];
    const len = messages.length;
    if (len <= 10) {
      batches.push([0, len]);
    } else if (len <= 30) {
      batches.push([len - 10, len]);
      batches.push([0, len - 10]);
    } else {
      batches.push([len - 10, len]);
      batches.push([len - 30, len - 10]);
      batches.push([0, len - 30]);
    }

    const frag0 = document.createDocumentFragment();
    for (let i = batches[0][0]; i < batches[0][1]; i++) frag0.appendChild(buildMsgElement(messages[i]));
    dom.messagesDiv.appendChild(frag0);
    CCWeb.ui.scrollToBottom();

    let delay = 0;
    for (let b = 1; b < batches.length; b++) {
      const [start, end] = batches[b];
      delay += 16;
      setTimeout(() => {
        if (renderEpoch !== epoch) return;
        const prevHeight = dom.messagesDiv.scrollHeight;
        const prevScrollTop = dom.messagesDiv.scrollTop;
        const frag = document.createDocumentFragment();
        for (let i = start; i < end; i++) frag.appendChild(buildMsgElement(messages[i]));
        dom.messagesDiv.insertBefore(frag, dom.messagesDiv.firstChild);
        dom.messagesDiv.scrollTop = prevScrollTop + (dom.messagesDiv.scrollHeight - prevHeight);
        CCWeb.ui.updateScrollbar();
      }, delay);
    }
  }

  function prependHistoryMessages(messages, options = {}) {
    const dom = CCWeb.dom;
    if (!Array.isArray(messages) || messages.length === 0) return;
    const preserveScroll = options.preserveScroll !== false;
    const skipScrollbar = options.skipScrollbar === true;
    const welcome = dom.messagesDiv.querySelector('.welcome-msg');
    if (welcome) welcome.remove();
    const frag = document.createDocumentFragment();
    messages.forEach((m) => frag.appendChild(buildMsgElement(m)));
    if (!preserveScroll) {
      dom.messagesDiv.insertBefore(frag, dom.messagesDiv.firstChild);
      if (!skipScrollbar) CCWeb.ui.updateScrollbar();
      return;
    }
    const prevHeight = dom.messagesDiv.scrollHeight;
    const prevScrollTop = dom.messagesDiv.scrollTop;
    dom.messagesDiv.insertBefore(frag, dom.messagesDiv.firstChild);
    dom.messagesDiv.scrollTop = prevScrollTop + (dom.messagesDiv.scrollHeight - prevHeight);
    if (!skipScrollbar) CCWeb.ui.updateScrollbar();
  }

  // --- Delete confirm ---

  function getDeleteConfirmMessage(agent) {
    const normalized = CCWeb.helpers.normalizeAgent(agent);
    if (normalized === 'codex') {
      return '删除本会话将同步删去本地 Codex rollout 历史与线程记录，不可恢复。确认删除？';
    }
    if (normalized === 'hermes') {
      return '删除本会话只会移除 agent-web 本地记录，不会删除 WSL 中的 Hermes 原生历史。确认删除？';
    }
    if (normalized === 'gemini') {
      return '删除本会话只会移除 agent-web 本地记录，不会清理 Gemini CLI 原生会话文件。确认删除？';
    }
    return '删除本会话将同步删去本地 Claude 中的会话历史，不可恢复。确认删除？';
  }

  function showDeleteConfirm(agent, onConfirm) {
    const state = CCWeb.state;
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.style.zIndex = '10002';

    const box = document.createElement('div');
    box.className = 'settings-panel';
    box.innerHTML = `
      <div style="font-size:0.9em;color:var(--text-primary);margin-bottom:20px;line-height:1.7">${CCWeb.helpers.escapeHtml(getDeleteConfirmMessage(agent))}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button id="del-confirm-ok" style="width:100%;padding:10px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:0.95em;font-weight:600;cursor:pointer;font-family:inherit">确认删除</button>
        <button id="del-confirm-skip" style="width:100%;padding:9px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-tertiary);color:var(--text-secondary);font-size:0.85em;cursor:pointer;font-family:inherit">确认且不再提示</button>
        <button id="del-confirm-cancel" style="width:100%;padding:9px;border:none;border-radius:10px;background:transparent;color:var(--text-muted);font-size:0.85em;cursor:pointer;font-family:inherit">取消</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = () => document.body.removeChild(overlay);
    box.querySelector('#del-confirm-ok').addEventListener('click', () => { close(); onConfirm(); });
    box.querySelector('#del-confirm-skip').addEventListener('click', () => {
      state.skipDeleteConfirm = true;
      localStorage.setItem('cc-web-skip-delete-confirm', '1');
      close();
      onConfirm();
    });
    box.querySelector('#del-confirm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  // --- System/error messages ---

  function appendSystemMessage(message) {
    const dom = CCWeb.dom;
    const welcome = dom.messagesDiv.querySelector('.welcome-msg');
    if (welcome) welcome.remove();
    dom.messagesDiv.appendChild(createMsgElement('system', message));
    CCWeb.ui.scrollToBottom();
  }

  function appendError(message) {
    const dom = CCWeb.dom;
    const div = document.createElement('div');
    div.className = 'msg system';
    div.innerHTML = `<div class="msg-bubble" style="border-color:var(--danger);color:var(--danger)">⚠ ${CCWeb.helpers.escapeHtml(message)}</div>`;
    dom.messagesDiv.appendChild(div);
    CCWeb.ui.scrollToBottom();
  }

  // Register on CCWeb namespace
  CCWeb.chat = {
    incrementRenderEpoch,
    startGenerating,
    finishGenerating,
    scheduleRender,
    flushRender,
    renderMarkdown,
    createMsgElement,
    buildMsgElement,
    renderMessages,
    prependHistoryMessages,
    appendToolCall,
    updateToolCall,
    appendSystemMessage,
    appendError,
    showDeleteConfirm,
    scrollToBottom: function () { CCWeb.ui.scrollToBottom(); },
  };
})();

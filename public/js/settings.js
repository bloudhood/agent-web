// === CC-Web Settings Module ===
// Settings panel, sub-pages (theme, notify, CC Switch, dev, password), Claude/Codex config UI.
window.CCWeb = window.CCWeb || {};

(function () {
  'use strict';

  const escapeHtml = (s) => CCWeb.helpers.escapeHtml(s);

  const PROVIDER_OPTIONS = [
    { value: 'off', label: '关闭' },
    { value: 'pushplus', label: 'PushPlus' },
    { value: 'telegram', label: 'Telegram' },
    { value: 'serverchan', label: 'Server酱' },
    { value: 'feishu', label: '飞书机器人' },
    { value: 'qqbot', label: 'QQ（Qmsg）' },
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

  const MODEL_OPTIONS = [
    { value: 'opus', label: 'Opus', desc: '最强大，1M 上下文' },
    { value: 'sonnet', label: 'Sonnet', desc: '平衡性能，1M 上下文' },
    { value: 'haiku', label: 'Haiku', desc: '最快速，适合简单任务' },
  ];

  const MODE_PICKER_OPTIONS = [
    { value: 'yolo', label: 'YOLO', desc: '跳过所有权限检查' },
    { value: 'plan', label: 'Plan', desc: '执行前需确认计划' },
    { value: 'default', label: '默认', desc: 'CLI 原生审批；cc-web 暂不提供网页批准/拒绝面板' },
  ];

  // --- Local state ---
  let _onNotifyConfig = null;
  let _onNotifyTestResult = null;
  let _onModelConfig = null;
  let _onCodexConfig = null;
  let _onCcSwitchState = null;
  let _onCcSwitchSwitchResult = null;
  let _onCcSwitchDesktopRefreshResult = null;
  let _onFetchModelsResult = null;
  let _onClaudeLocalConfig = null;
  let _onCodexLocalConfig = null;
  let _onDevConfig = null;
  let _onPasswordChanged = null;

  // --- Password helpers ---

  function openPasswordModal() {
    const pwOverlay = document.createElement('div');
    pwOverlay.className = 'settings-overlay';
    pwOverlay.style.zIndex = '10001';
    const pwModal = document.createElement('div');
    pwModal.className = 'settings-panel';
    pwModal.style.maxWidth = '400px';
    pwModal.innerHTML = `
      <div class="settings-header">
        <h3>修改密码</h3>
        <button class="settings-close" id="pw-modal-close">&times;</button>
      </div>
      <div class="settings-field">
        <label>当前密码</label>
        <input type="password" id="pw-modal-current" placeholder="当前密码" autocomplete="current-password">
      </div>
      <div class="settings-field">
        <label>新密码</label>
        <input type="password" id="pw-modal-new" placeholder="新密码" autocomplete="new-password">
        <div class="password-hint" id="pw-modal-hint">至少 8 位，包含大写/小写/数字/特殊字符中的 2 种</div>
      </div>
      <div class="settings-field">
        <label>确认新密码</label>
        <input type="password" id="pw-modal-confirm" placeholder="确认新密码" autocomplete="new-password">
      </div>
      <div class="settings-actions">
        <button class="btn-save" id="pw-modal-submit" disabled>修改密码</button>
      </div>
      <div class="settings-status" id="pw-modal-status"></div>
    `;
    pwOverlay.appendChild(pwModal);
    document.body.appendChild(pwOverlay);

    const currentPwIn = pwModal.querySelector('#pw-modal-current');
    const newPwIn = pwModal.querySelector('#pw-modal-new');
    const confirmPwIn = pwModal.querySelector('#pw-modal-confirm');
    const hintEl = pwModal.querySelector('#pw-modal-hint');
    const submitBtn = pwModal.querySelector('#pw-modal-submit');
    const statusEl = pwModal.querySelector('#pw-modal-status');

    function checkPw() {
      const currentPw = currentPwIn.value;
      const newPw = newPwIn.value;
      const confirmPw = confirmPwIn.value;
      if (!currentPw || !newPw || !confirmPw) {
        submitBtn.disabled = true;
        return;
      }
      const result = CCWeb.helpers.clientValidatePassword(newPw);
      if (!result.valid) {
        hintEl.textContent = result.message;
        hintEl.className = 'password-hint error';
        submitBtn.disabled = true;
        return;
      }
      hintEl.textContent = '密码强度符合要求';
      hintEl.className = 'password-hint success';
      submitBtn.disabled = confirmPw !== newPw;
    }

    currentPwIn.addEventListener('input', checkPw);
    newPwIn.addEventListener('input', checkPw);
    confirmPwIn.addEventListener('input', checkPw);

    const closeModal = () => {
      _onPasswordChanged = null;
      if (pwOverlay.parentNode) pwOverlay.parentNode.removeChild(pwOverlay);
    };
    pwModal.querySelector('#pw-modal-close').addEventListener('click', closeModal);
    pwOverlay.addEventListener('click', (e) => { if (e.target === pwOverlay) closeModal(); });

    submitBtn.addEventListener('click', () => {
      const currentPw = currentPwIn.value;
      const newPw = newPwIn.value;
      const confirmPw = confirmPwIn.value;
      if (newPw !== confirmPw) {
        statusEl.textContent = '两次密码不一致';
        statusEl.className = 'settings-status error';
        return;
      }
      submitBtn.disabled = true;
      statusEl.textContent = '正在修改...';
      statusEl.className = 'settings-status';
      _onPasswordChanged = (result) => {
        if (result.success) {
          statusEl.textContent = result.message || '密码修改成功';
          statusEl.className = 'settings-status success';
          setTimeout(closeModal, 1200);
        } else {
          statusEl.textContent = result.message || '修改失败';
          statusEl.className = 'settings-status error';
          submitBtn.disabled = false;
        }
      };
      CCWeb.send({ type: 'change_password', currentPassword: currentPw, newPassword: newPw });
    });

    currentPwIn.focus();
  }

  // --- Force Change Password ---

  function showForceChangePassword() {
    const overlay = document.createElement('div');
    overlay.className = 'force-change-overlay';
    overlay.id = 'force-change-overlay';

    const panel = document.createElement('div');
    panel.className = 'force-change-panel';

    panel.innerHTML = `
      <div class="login-logo">CC</div>
      <h2>修改初始密码</h2>
      <p>首次登录需要设置新密码</p>
      <div class="force-change-form">
        <input type="password" id="fc-new-pw" placeholder="新密码" autocomplete="new-password">
        <div class="password-hint" id="fc-hint">至少 8 位，包含大写/小写/数字/特殊字符中的 2 种</div>
        <input type="password" id="fc-confirm-pw" placeholder="确认新密码" autocomplete="new-password">
        <button id="fc-submit-btn" class="fc-submit-btn" disabled>确认修改</button>
        <div class="fc-status" id="fc-status"></div>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const newPwInput = panel.querySelector('#fc-new-pw');
    const confirmPwInput = panel.querySelector('#fc-confirm-pw');
    const hintEl = panel.querySelector('#fc-hint');
    const submitBtn = panel.querySelector('#fc-submit-btn');
    const statusEl = panel.querySelector('#fc-status');

    function checkStrength() {
      const pw = newPwInput.value;
      const confirm = confirmPwInput.value;
      if (!pw) {
        hintEl.textContent = '至少 8 位，包含大写/小写/数字/特殊字符中的 2 种';
        hintEl.className = 'password-hint';
        submitBtn.disabled = true;
        return;
      }
      const result = CCWeb.helpers.clientValidatePassword(pw);
      if (!result.valid) {
        hintEl.textContent = result.message;
        hintEl.className = 'password-hint error';
        submitBtn.disabled = true;
        return;
      }
      hintEl.textContent = '密码强度符合要求';
      hintEl.className = 'password-hint success';
      submitBtn.disabled = !confirm || confirm !== pw;
    }

    newPwInput.addEventListener('input', checkStrength);
    confirmPwInput.addEventListener('input', checkStrength);

    submitBtn.addEventListener('click', () => {
      const newPw = newPwInput.value;
      const confirmPw = confirmPwInput.value;
      if (newPw !== confirmPw) {
        statusEl.textContent = '两次密码不一致';
        statusEl.className = 'fc-status error';
        return;
      }
      submitBtn.disabled = true;
      statusEl.textContent = '正在修改...';
      statusEl.className = 'fc-status';
      CCWeb.send({ type: 'change_password', currentPassword: CCWeb.state.loginPasswordValue || localStorage.getItem('cc-web-pw') || '', newPassword: newPw });
    });

    newPwInput.focus();
  }

  function hideForceChangePassword() {
    const overlay = document.getElementById('force-change-overlay');
    if (overlay) overlay.remove();
  }

  // --- Password Changed Handler ---

  function handlePasswordChanged(msg) {
    if (msg.success) {
      CCWeb.state.authToken = msg.token;
      localStorage.setItem('cc-web-token', msg.token);
      if (localStorage.getItem('cc-web-pw')) {
        localStorage.removeItem('cc-web-pw');
      }
      const fcOverlay = document.getElementById('force-change-overlay');
      if (fcOverlay) {
        hideForceChangePassword();
        CCWeb.session.syncViewForAgent(CCWeb.state.currentAgent, { preserveCurrent: false, loadLast: true });
        CCWeb.ui.showToast('密码修改成功');
      }
      if (_onPasswordChanged) {
        _onPasswordChanged({ success: true, message: msg.message });
        _onPasswordChanged = null;
      }
    } else {
      const fcStatus = document.querySelector('#fc-status');
      if (fcStatus) {
        fcStatus.textContent = msg.message || '修改失败';
        fcStatus.className = 'fc-status error';
        const btn = document.querySelector('#fc-submit-btn');
        if (btn) btn.disabled = false;
      }
      if (_onPasswordChanged) {
        _onPasswordChanged({ success: false, message: msg.message });
        _onPasswordChanged = null;
      }
    }
  }

  // --- Theme entry / subpage ---

  function buildThemeEntryHtml() {
    return `
      <div class="settings-section-title">外观</div>
      <button class="settings-nav-card" type="button" data-open-theme-page>
        <span class="settings-nav-card-main">
          <span class="settings-nav-card-title">界面主题</span>
          <span class="settings-nav-card-meta" data-theme-summary>${escapeHtml(CCWeb.ui.getThemeOption(CCWeb.state.currentTheme).label)}</span>
        </span>
        <span class="settings-nav-card-arrow" aria-hidden="true">›</span>
      </button>
    `;
  }

  function openThemeSubpage() {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay settings-subpage-overlay';
    overlay.style.zIndex = '10001';

    const panel = document.createElement('div');
    panel.className = 'settings-panel settings-subpage-panel';
    panel.innerHTML = `
      <div class="settings-header settings-subpage-header">
        <button class="settings-back" type="button" aria-label="返回">‹</button>
        <div class="settings-subpage-copy">
          <div class="settings-subpage-kicker">Appearance</div>
          <h3>界面主题</h3>
        </div>
        <button class="settings-close" type="button" title="关闭">&times;</button>
      </div>
      ${CCWeb.ui.buildThemePickerHtml({ showSectionTitle: false })}
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    CCWeb.ui.mountThemePicker(panel);
    CCWeb.ui.refreshThemeSummaries();

    const closeSubpage = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };

    panel.querySelector('.settings-back').addEventListener('click', closeSubpage);
    panel.querySelector('.settings-close').addEventListener('click', closeSubpage);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeSubpage();
    });
  }

  // --- Notify entry / subpage ---

  function buildNotifyEntryHtml(config) {
    const provider = config?.provider || 'off';
    const providerLabel = PROVIDER_OPTIONS.find(o => o.value === provider)?.label || '关闭';
    const summaryOn = config?.summary?.enabled ? '摘要已启用' : '摘要关闭';
    const meta = provider === 'off' ? '未启用' : `${providerLabel} · ${summaryOn}`;
    return `
      <div class="settings-section-title">通知</div>
      <button class="settings-nav-card" type="button" data-open-notify-page>
        <span class="settings-nav-card-main">
          <span class="settings-nav-card-title">通知设置</span>
          <span class="settings-nav-card-meta" data-notify-summary>${escapeHtml(meta)}</span>
        </span>
        <span class="settings-nav-card-arrow" aria-hidden="true">›</span>
      </button>
    `;
  }

  function buildNotifyFieldsHtml(config, provider) {
    if (provider === 'pushplus') {
      return `
        <div class="settings-field">
          <label>Token</label>
          <input type="text" id="notify-pushplus-token" placeholder="PushPlus Token" value="${escapeHtml(config?.pushplus?.token || '')}">
        </div>
      `;
    }
    if (provider === 'telegram') {
      return `
        <div class="settings-field">
          <label>Bot Token</label>
          <input type="text" id="notify-tg-bottoken" placeholder="123456:ABC-DEF..." value="${escapeHtml(config?.telegram?.botToken || '')}">
        </div>
        <div class="settings-field">
          <label>Chat ID</label>
          <input type="text" id="notify-tg-chatid" placeholder="Chat ID" value="${escapeHtml(config?.telegram?.chatId || '')}">
        </div>
      `;
    }
    if (provider === 'serverchan') {
      return `
        <div class="settings-field">
          <label>SendKey</label>
          <input type="text" id="notify-sc-sendkey" placeholder="Server酱 SendKey" value="${escapeHtml(config?.serverchan?.sendKey || '')}">
        </div>
      `;
    }
    if (provider === 'feishu') {
      return `
        <div class="settings-field">
          <label>Webhook 地址</label>
          <input type="text" id="notify-feishu-webhook" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx" value="${escapeHtml(config?.feishu?.webhook || '')}">
        </div>
      `;
    }
    if (provider === 'qqbot') {
      return `
        <div class="settings-field">
          <label>Qmsg Key</label>
          <input type="text" id="notify-qmsg-key" placeholder="Qmsg 推送 Key" value="${escapeHtml(config?.qqbot?.qmsgKey || '')}">
        </div>
      `;
    }
    return '';
  }

  function renderNotifyFields(fieldsDiv, config, provider) {
    fieldsDiv.innerHTML = buildNotifyFieldsHtml(config, provider);
  }

  function collectNotifyConfigFromPanel(panel, currentConfig, provider) {
    const pp = panel.querySelector('#notify-pushplus-token');
    const tgBot = panel.querySelector('#notify-tg-bottoken');
    const tgChat = panel.querySelector('#notify-tg-chatid');
    const sc = panel.querySelector('#notify-sc-sendkey');
    const feishuWh = panel.querySelector('#notify-feishu-webhook');
    const qmsgKey = panel.querySelector('#notify-qmsg-key');
    const summaryEnabled = panel.querySelector('#notify-summary-enabled');
    const summaryTrigger = panel.querySelector('#notify-summary-trigger');
    const summarySource = panel.querySelector('#notify-summary-source');
    const summaryApiBase = panel.querySelector('#notify-summary-apibase');
    const summaryApiKey = panel.querySelector('#notify-summary-apikey');
    const summaryModel = panel.querySelector('#notify-summary-model');
    const cs = currentConfig?.summary || {};
    return {
      provider,
      pushplus: { token: pp ? pp.value.trim() : (currentConfig?.pushplus?.token || '') },
      telegram: {
        botToken: tgBot ? tgBot.value.trim() : (currentConfig?.telegram?.botToken || ''),
        chatId: tgChat ? tgChat.value.trim() : (currentConfig?.telegram?.chatId || ''),
      },
      serverchan: { sendKey: sc ? sc.value.trim() : (currentConfig?.serverchan?.sendKey || '') },
      feishu: { webhook: feishuWh ? feishuWh.value.trim() : (currentConfig?.feishu?.webhook || '') },
      qqbot: { qmsgKey: qmsgKey ? qmsgKey.value.trim() : (currentConfig?.qqbot?.qmsgKey || '') },
      summary: {
        enabled: summaryEnabled ? summaryEnabled.checked : !!cs.enabled,
        trigger: summaryTrigger ? summaryTrigger.value : (cs.trigger || 'background'),
        apiSource: summarySource ? summarySource.value : (cs.apiSource || 'claude'),
        apiBase: summaryApiBase ? summaryApiBase.value.trim() : (cs.apiBase || ''),
        apiKey: summaryApiKey ? summaryApiKey.value.trim() : (cs.apiKey || ''),
        model: summaryModel ? summaryModel.value.trim() : (cs.model || ''),
      },
    };
  }

  function buildSummarySettingsHtml(config) {
    const s = config?.summary || {};
    const enabled = !!s.enabled;
    const trigger = s.trigger || 'background';
    const src = s.apiSource || 'claude';
    const customVisible = src === 'custom' ? '' : 'display:none';
    return `
      <div class="settings-divider"></div>
      <div class="settings-section-title">通知摘要</div>
      <div class="settings-field" style="flex-direction:row;align-items:center;gap:10px">
        <label style="margin:0;flex:1">启用 AI 摘要</label>
        <input type="checkbox" id="notify-summary-enabled" ${enabled ? 'checked' : ''} style="width:auto;margin:0">
      </div>
      <div id="notify-summary-options" style="${enabled ? '' : 'display:none'}">
        <div class="settings-field">
          <label>推送时机</label>
          <select class="settings-select" id="notify-summary-trigger">
            <option value="background" ${trigger === 'background' ? 'selected' : ''}>仅后台任务</option>
            <option value="always" ${trigger === 'always' ? 'selected' : ''}>所有任务</option>
          </select>
        </div>
        <div class="settings-field">
          <label>摘要 API 来源</label>
          <select class="settings-select" id="notify-summary-source">
            <option value="claude" ${src === 'claude' ? 'selected' : ''}>Claude 活跃模板</option>
            <option value="codex" ${src === 'codex' ? 'selected' : ''}>Codex 活跃 Profile</option>
            <option value="custom" ${src === 'custom' ? 'selected' : ''}>独立配置</option>
          </select>
        </div>
        <div id="notify-summary-custom" style="${customVisible}">
          <div class="settings-field">
            <label>API Base URL</label>
            <input type="text" id="notify-summary-apibase" placeholder="https://api.example.com" value="${escapeHtml(s.apiBase || '')}">
          </div>
          <div class="settings-field">
            <label>API Key</label>
            <input type="text" id="notify-summary-apikey" placeholder="sk-..." value="${escapeHtml(s.apiKey || '')}">
          </div>
          <div class="settings-field">
            <label>模型</label>
            <input type="text" id="notify-summary-model" placeholder="claude-opus-4-6" value="${escapeHtml(s.model || '')}">
          </div>
        </div>
      </div>
    `;
  }

  function bindSummarySettingsEvents(panel) {
    const enabledCb = panel.querySelector('#notify-summary-enabled');
    const optionsDiv = panel.querySelector('#notify-summary-options');
    const sourceSelect = panel.querySelector('#notify-summary-source');
    const customDiv = panel.querySelector('#notify-summary-custom');
    if (!enabledCb || !optionsDiv || !sourceSelect || !customDiv) return;
    enabledCb.addEventListener('change', () => {
      optionsDiv.style.display = enabledCb.checked ? '' : 'none';
    });
    sourceSelect.addEventListener('change', () => {
      customDiv.style.display = sourceSelect.value === 'custom' ? '' : 'none';
    });
  }

  function openNotifySubpage() {
    CCWeb.send({ type: 'get_notify_config' });

    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay settings-subpage-overlay';
    overlay.style.zIndex = '10001';

    const panel = document.createElement('div');
    panel.className = 'settings-panel settings-subpage-panel';
    panel.innerHTML = `
      <div class="settings-header settings-subpage-header">
        <button class="settings-back" type="button" aria-label="返回">‹</button>
        <div class="settings-subpage-copy">
          <div class="settings-subpage-kicker">Notification</div>
          <h3>通知设置</h3>
        </div>
      </div>
      <div class="settings-field">
        <label>通知方式</label>
        <select class="settings-select" id="notify-provider">
          ${PROVIDER_OPTIONS.map(o => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </div>
      <div id="notify-fields"></div>
      <div id="notify-summary-area"></div>
      <div class="settings-actions">
        <button class="btn-test" id="notify-test-btn">测试</button>
        <button class="btn-save" id="notify-save-btn">保存</button>
      </div>
      <div class="settings-status" id="notify-status"></div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const providerSelect = panel.querySelector('#notify-provider');
    const fieldsDiv = panel.querySelector('#notify-fields');
    const summaryArea = panel.querySelector('#notify-summary-area');
    const statusDiv = panel.querySelector('#notify-status');
    const testBtn = panel.querySelector('#notify-test-btn');
    const saveBtn = panel.querySelector('#notify-save-btn');

    let currentNotifyConfig = null;

    function renderFields(provider) {
      renderNotifyFields(fieldsDiv, currentNotifyConfig, provider);
      if (summaryArea) {
        summaryArea.innerHTML = buildSummarySettingsHtml(currentNotifyConfig);
        bindSummarySettingsEvents(panel);
      }
    }

    function collectConfig() {
      return collectNotifyConfigFromPanel(panel, currentNotifyConfig, providerSelect.value);
    }

    function showStatus(msg, type) {
      statusDiv.textContent = msg;
      statusDiv.className = 'settings-status ' + (type || '');
    }

    function refreshParentSummary(config) {
      const provider = config?.provider || 'off';
      const providerLabel = PROVIDER_OPTIONS.find(o => o.value === provider)?.label || '关闭';
      const summaryOn = config?.summary?.enabled ? '摘要已启用' : '摘要关闭';
      const meta = provider === 'off' ? '未启用' : `${providerLabel} · ${summaryOn}`;
      document.querySelectorAll('[data-notify-summary]').forEach(el => { el.textContent = meta; });
    }

    const savedOnNotifyConfig = _onNotifyConfig;
    _onNotifyConfig = (config) => {
      currentNotifyConfig = config;
      providerSelect.value = config.provider || 'off';
      renderFields(config.provider || 'off');
      if (savedOnNotifyConfig) savedOnNotifyConfig(config);
    };

    const savedOnNotifyTestResult = _onNotifyTestResult;
    _onNotifyTestResult = (msg) => {
      showStatus(msg.message, msg.success ? 'success' : 'error');
      if (savedOnNotifyTestResult) savedOnNotifyTestResult(msg);
    };

    providerSelect.addEventListener('change', () => renderFields(providerSelect.value));

    testBtn.addEventListener('click', () => {
      const config = collectConfig();
      CCWeb.send({ type: 'save_notify_config', config });
      showStatus('正在发送测试消息...', '');
      CCWeb.send({ type: 'test_notify' });
    });

    saveBtn.addEventListener('click', () => {
      const config = collectConfig();
      CCWeb.send({ type: 'save_notify_config', config });
      refreshParentSummary(config);
      showStatus('已保存', 'success');
    });

    const closeSubpage = () => {
      _onNotifyConfig = savedOnNotifyConfig;
      _onNotifyTestResult = savedOnNotifyTestResult;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };

    panel.querySelector('.settings-back').addEventListener('click', closeSubpage);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSubpage(); });
  }

  // --- CC Switch entry / subpage ---

  function summarizeCcSwitchState(state) {
    if (!state) return '正在检测...';
    if (!state.cli?.ok) return '未找到 CLI';
    const claude = state.apps?.claude?.currentProviderName || state.apps?.claude?.currentProviderId || '未选择';
    const codex = state.apps?.codex?.currentProviderName || state.apps?.codex?.currentProviderId || '未选择';
    return `Claude: ${claude} · Codex: ${codex}`;
  }

  function updateCcSwitchSummary(state) {
    const meta = summarizeCcSwitchState(state);
    document.querySelectorAll('[data-ccswitch-summary]').forEach((node) => {
      node.textContent = meta;
    });
  }

  function buildCcSwitchEntryHtml(state) {
    return `
      <div class="settings-section-title">CC Switch</div>
      <button class="settings-nav-card" type="button" data-open-ccswitch-page>
        <span class="settings-nav-card-main">
          <span class="settings-nav-card-title">Provider 切换</span>
          <span class="settings-nav-card-meta" data-ccswitch-summary>${escapeHtml(summarizeCcSwitchState(state))}</span>
        </span>
        <span class="settings-nav-card-arrow" aria-hidden="true">›</span>
      </button>
    `;
  }

  function renderCcSwitchProviderBlock(app, appState) {
    const title = app === 'claude' ? 'Claude' : 'Codex';
    if (!appState?.ok) {
      return `
        <div class="ccswitch-app-block" data-ccswitch-app="${app}">
          <div class="ccswitch-app-title">${title}</div>
          <div class="settings-inline-note warning">${escapeHtml(appState?.error || '无法读取 provider 列表')}</div>
        </div>
      `;
    }
    const providers = Array.isArray(appState.providers) ? appState.providers : [];
    const currentId = appState.currentProviderId || providers.find((provider) => provider.current)?.id || '';
    const options = providers.map((provider) => {
      const label = `${provider.name || provider.id}${provider.apiUrl ? ` · ${provider.apiUrl}` : ''}`;
      return `<option value="${escapeHtml(provider.id)}"${provider.id === currentId ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    return `
      <div class="ccswitch-app-block" data-ccswitch-app="${app}">
        <div class="ccswitch-app-title">${title}</div>
        <div class="settings-field">
          <label>当前 Provider</label>
          <select class="settings-select" data-ccswitch-select="${app}">
            ${options || '<option value="">无可用 Provider</option>'}
          </select>
        </div>
        <div class="ccswitch-current-line">
          当前：<code>${escapeHtml(appState.currentProviderName || appState.currentProviderId || '未选择')}</code>
        </div>
        <div class="settings-actions ccswitch-actions">
          <button class="btn-save" type="button" data-ccswitch-apply="${app}"${providers.length ? '' : ' disabled'}>切换 ${title}</button>
        </div>
      </div>
    `;
  }

  function openCcSwitchSubpage() {
    CCWeb.send({ type: 'get_ccswitch_state' });

    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay settings-subpage-overlay';
    overlay.style.zIndex = '10001';

    const panel = document.createElement('div');
    panel.className = 'settings-panel settings-subpage-panel';
    panel.innerHTML = `
      <div class="settings-header settings-subpage-header">
        <button class="settings-back" type="button" aria-label="返回">‹</button>
        <div class="settings-subpage-copy">
          <div class="settings-subpage-kicker">CC Switch</div>
          <h3>Provider 切换</h3>
        </div>
      </div>
      <div id="ccswitch-body">
        <div class="settings-inline-note">正在读取 CC Switch CLI...</div>
      </div>
      <div class="settings-status" id="ccswitch-status"></div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const body = panel.querySelector('#ccswitch-body');
    const status = panel.querySelector('#ccswitch-status');

    function showStatus(message, type) {
      status.textContent = message || '';
      status.className = 'settings-status ' + (type || '');
    }

    function wireProviderActions() {
      panel.querySelectorAll('[data-ccswitch-apply]').forEach((button) => {
        button.addEventListener('click', () => {
          const appTarget = button.dataset.ccswitchApply;
          const select = panel.querySelector(`[data-ccswitch-select="${appTarget}"]`);
          const providerId = select?.value || '';
          if (!providerId) {
            showStatus('请选择 Provider', 'error');
            return;
          }
          button.disabled = true;
          showStatus('正在切换...', '');
          CCWeb.send({ type: 'switch_ccswitch_provider', app: appTarget, providerId });
        });
      });
    }

    function render(state) {
      updateCcSwitchSummary(state);
      if (!state?.cli?.ok) {
        body.innerHTML = `
          <div class="settings-inline-note warning">
            ${escapeHtml(state?.cli?.error || '未找到 cc-switch CLI')}
          </div>
        `;
        return;
      }
      body.innerHTML = `
        <div class="settings-inline-note">
          CLI：<code>${escapeHtml(state.cli.version || 'cc-switch')}</code>
        </div>
        <div class="settings-inline-note warning">
          切换会调用 CC Switch 写入本机 Claude/Codex 配置；Codex 的 sandbox/approval 本机安全字段会保留当前值。
        </div>
        <div class="settings-actions ccswitch-actions">
          <button class="btn-test" type="button" id="ccswitch-refresh-desktop-btn">刷新桌面端显示</button>
        </div>
        ${renderCcSwitchProviderBlock('claude', state.apps?.claude)}
        <div class="settings-divider"></div>
        ${renderCcSwitchProviderBlock('codex', state.apps?.codex)}
      `;
      const refreshBtn = panel.querySelector('#ccswitch-refresh-desktop-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
          refreshBtn.disabled = true;
          showStatus('正在刷新桌面端...', '');
          CCWeb.send({ type: 'refresh_ccswitch_desktop' });
        });
      }
      wireProviderActions();
    }

    const closeSubpage = () => {
      if (overlay.parentNode) document.body.removeChild(overlay);
      _onCcSwitchState = null;
      _onCcSwitchSwitchResult = null;
      _onCcSwitchDesktopRefreshResult = null;
    };

    _onCcSwitchState = render;
    _onCcSwitchSwitchResult = (result) => {
      showStatus(result.message || (result.success ? '切换完成' : '切换失败'), result.success ? 'success' : 'error');
      panel.querySelectorAll('[data-ccswitch-apply]').forEach((button) => { button.disabled = false; });
    };
    _onCcSwitchDesktopRefreshResult = (result) => {
      showStatus(result.message || (result.success ? '桌面端已刷新' : '桌面端刷新失败'), result.success ? 'success' : 'error');
      const refreshBtn = panel.querySelector('#ccswitch-refresh-desktop-btn');
      if (refreshBtn) refreshBtn.disabled = false;
    };

    panel.querySelector('.settings-back').addEventListener('click', closeSubpage);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSubpage(); });
  }

  // --- Dev settings subpage ---

  function openDevSettingsSubpage() {
    CCWeb.send({ type: 'get_dev_config' });
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay settings-subpage-overlay';
    overlay.id = 'dev-settings-subpage';
    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.innerHTML = `
      <div class="settings-header">
        <h3>开发者设置</h3>
        <button class="settings-close" id="dev-close">&times;</button>
      </div>
      <div class="settings-section-title">GitHub</div>
      <div class="settings-field">
        <label>Token</label>
        <input type="text" id="dev-github-token" placeholder="ghp_..." value="">
      </div>
      <div id="dev-github-repos"></div>
      <div class="settings-actions" style="margin-top:0;gap:8px">
        <button class="btn-test" id="dev-repo-add" style="padding:4px 12px">+ 添加仓库</button>
      </div>
      <div class="settings-divider"></div>
      <div class="settings-section-title">SSH 主机</div>
      <div id="dev-ssh-hosts"></div>
      <div class="settings-actions" style="margin-top:0;gap:8px">
        <button class="btn-test" id="dev-host-add" style="padding:4px 12px">+ 添加主机</button>
      </div>
      <div class="settings-divider"></div>
      <div class="settings-actions">
        <button class="btn-save" id="dev-save-btn">保存开发者配置</button>
      </div>
      <div class="settings-status" id="dev-status"></div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const closeBtn = panel.querySelector('#dev-close');
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    let editingRepos = [];
    let editingHosts = [];

    function renderRepos() {
      const container = panel.querySelector('#dev-github-repos');
      if (editingRepos.length === 0) {
        container.innerHTML = '<div class="settings-inline-note">暂无仓库</div>';
        return;
      }
      container.innerHTML = editingRepos.map((repo, i) => `
        <div class="settings-field" style="padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>${escapeHtml(repo.name || '未命名')}</strong>
            <div style="display:flex;gap:4px">
              <button class="btn-test" data-repo-edit="${i}" style="padding:2px 8px">编辑</button>
              <button class="btn-test" data-repo-del="${i}" style="padding:2px 8px">删除</button>
            </div>
          </div>
          <div style="font-size:0.85em;color:var(--text-secondary);margin-top:4px">${escapeHtml(repo.url || '')} · ${escapeHtml(repo.branch || 'main')}${repo.notes ? ' · ' + escapeHtml(repo.notes) : ''}</div>
        </div>
      `).join('');
      container.querySelectorAll('[data-repo-edit]').forEach(btn => {
        btn.addEventListener('click', () => openRepoEditModal(parseInt(btn.dataset.repoEdit)));
      });
      container.querySelectorAll('[data-repo-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.repoDel);
          editingRepos.splice(idx, 1);
          renderRepos();
        });
      });
    }

    function openRepoEditModal(index = -1) {
      const existing = index >= 0 ? editingRepos[index] : null;
      const draft = existing || { id: '', name: '', url: '', branch: 'main', notes: '' };
      const modalOverlay = document.createElement('div');
      modalOverlay.className = 'settings-overlay';
      modalOverlay.style.zIndex = '10002';
      const modal = document.createElement('div');
      modal.className = 'settings-panel';
      modal.style.maxWidth = '440px';
      modal.innerHTML = `
        <div class="settings-header">
          <h3>${existing ? '编辑仓库' : '添加仓库'}</h3>
          <button class="settings-close" id="repo-modal-close">&times;</button>
        </div>
        <div class="settings-field"><label>名称</label><input type="text" id="repo-name" placeholder="cc-web" value="${escapeHtml(draft.name)}"></div>
        <div class="settings-field"><label>URL</label><input type="text" id="repo-url" placeholder="https://github.com/user/repo" value="${escapeHtml(draft.url)}"></div>
        <div class="settings-field"><label>分支</label><input type="text" id="repo-branch" placeholder="main" value="${escapeHtml(draft.branch || 'main')}"></div>
        <div class="settings-field"><label>备注</label><input type="text" id="repo-notes" placeholder="说明" value="${escapeHtml(draft.notes || '')}"></div>
        <div class="settings-actions"><button class="btn-save" id="repo-modal-ok">确定</button></div>
      `;
      modalOverlay.appendChild(modal);
      document.body.appendChild(modalOverlay);
      const closeModal = () => document.body.removeChild(modalOverlay);
      modal.querySelector('#repo-modal-close').addEventListener('click', closeModal);
      modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
      modal.querySelector('#repo-modal-ok').addEventListener('click', () => {
        const name = modal.querySelector('#repo-name').value.trim();
        const url = modal.querySelector('#repo-url').value.trim();
        if (!name || !url) { alert('请填写名称和 URL'); return; }
        const data = {
          id: draft.id || '',
          name,
          url,
          branch: modal.querySelector('#repo-branch').value.trim() || 'main',
          notes: modal.querySelector('#repo-notes').value.trim(),
        };
        if (existing) {
          editingRepos[index] = data;
        } else {
          editingRepos.push(data);
        }
        closeModal();
        renderRepos();
      });
    }

    function renderHosts() {
      const container = panel.querySelector('#dev-ssh-hosts');
      if (editingHosts.length === 0) {
        container.innerHTML = '<div class="settings-inline-note">暂无 SSH 主机</div>';
        return;
      }
      container.innerHTML = editingHosts.map((host, i) => `
        <div class="settings-field" style="padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>${escapeHtml(host.name || '未命名')}</strong>
            <div style="display:flex;gap:4px">
              <button class="btn-test" data-host-edit="${i}" style="padding:2px 8px">编辑</button>
              <button class="btn-test" data-host-del="${i}" style="padding:2px 8px">删除</button>
            </div>
          </div>
          <div style="font-size:0.85em;color:var(--text-secondary);margin-top:4px">${escapeHtml(host.user || '')}@${escapeHtml(host.host || '')}:${host.port || 22} · ${(host.authType || 'key') === 'password' ? '密码认证' : '密钥认证'}${host.description ? ' · ' + escapeHtml(host.description) : ''}</div>
        </div>
      `).join('');
      container.querySelectorAll('[data-host-edit]').forEach(btn => {
        btn.addEventListener('click', () => openHostEditModal(parseInt(btn.dataset.hostEdit)));
      });
      container.querySelectorAll('[data-host-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.hostDel);
          editingHosts.splice(idx, 1);
          renderHosts();
        });
      });
    }

    function openHostEditModal(index = -1) {
      const existing = index >= 0 ? editingHosts[index] : null;
      const draft = existing || { id: '', name: '', host: '', port: 22, user: '', authType: 'key', identityFile: '', password: '', description: '' };
      const isKey = (draft.authType || 'key') === 'key';
      const modalOverlay = document.createElement('div');
      modalOverlay.className = 'settings-overlay';
      modalOverlay.style.zIndex = '10002';
      const modal = document.createElement('div');
      modal.className = 'settings-panel';
      modal.style.maxWidth = '440px';
      modal.innerHTML = `
        <div class="settings-header">
          <h3>${existing ? '编辑主机' : '添加主机'}</h3>
          <button class="settings-close" id="host-modal-close">&times;</button>
        </div>
        <div class="settings-field"><label>名称</label><input type="text" id="host-name" placeholder="主机01" value="${escapeHtml(draft.name)}"></div>
        <div class="settings-field"><label>地址</label><input type="text" id="host-host" placeholder="192.168.1.100" value="${escapeHtml(draft.host)}"></div>
        <div class="settings-field"><label>端口</label><input type="number" id="host-port" placeholder="22" value="${draft.port || 22}"></div>
        <div class="settings-field"><label>用户</label><input type="text" id="host-user" placeholder="root" value="${escapeHtml(draft.user)}"></div>
        <div class="settings-field">
          <label>认证方式</label>
          <div style="display:flex;gap:12px">
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="radio" name="host-auth-type" value="key" ${isKey ? 'checked' : ''}> 密钥</label>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="radio" name="host-auth-type" value="password" ${!isKey ? 'checked' : ''}> 密码</label>
          </div>
        </div>
        <div id="host-auth-key-field" class="settings-field" style="${isKey ? '' : 'display:none'}">
          <label>密钥路径</label><input type="text" id="host-identity" placeholder="~/.ssh/id_ed25519" value="${escapeHtml(draft.identityFile)}">
        </div>
        <div id="host-auth-pw-field" class="settings-field" style="${!isKey ? '' : 'display:none'}">
          <label>密码</label><input type="password" id="host-password" placeholder="SSH 登录密码" value="${escapeHtml(draft.password || '')}">
        </div>
        <div class="settings-field"><label>说明</label><input type="text" id="host-desc" placeholder="测试服务器" value="${escapeHtml(draft.description || '')}"></div>
        <div class="settings-actions"><button class="btn-save" id="host-modal-ok">确定</button></div>
      `;
      modalOverlay.appendChild(modal);
      document.body.appendChild(modalOverlay);

      const keyField = modal.querySelector('#host-auth-key-field');
      const pwField = modal.querySelector('#host-auth-pw-field');
      modal.querySelectorAll('input[name="host-auth-type"]').forEach(radio => {
        radio.addEventListener('change', () => {
          const isKeyMode = radio.value === 'key' && radio.checked;
          keyField.style.display = isKeyMode ? '' : 'none';
          pwField.style.display = isKeyMode ? 'none' : '';
        });
      });

      const closeModal = () => document.body.removeChild(modalOverlay);
      modal.querySelector('#host-modal-close').addEventListener('click', closeModal);
      modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
      modal.querySelector('#host-modal-ok').addEventListener('click', () => {
        const name = modal.querySelector('#host-name').value.trim();
        const host = modal.querySelector('#host-host').value.trim();
        if (!name || !host) { alert('请填写名称和地址'); return; }
        const authType = modal.querySelector('input[name="host-auth-type"]:checked')?.value || 'key';
        const data = {
          id: draft.id || '',
          name,
          host,
          port: parseInt(modal.querySelector('#host-port').value) || 22,
          user: modal.querySelector('#host-user').value.trim(),
          authType,
          identityFile: authType === 'key' ? modal.querySelector('#host-identity').value.trim() : '',
          password: authType === 'password' ? modal.querySelector('#host-password').value : '',
          description: modal.querySelector('#host-desc').value.trim(),
        };
        if (existing) {
          editingHosts[index] = data;
        } else {
          editingHosts.push(data);
        }
        closeModal();
        renderHosts();
      });
    }

    panel.querySelector('#dev-repo-add').addEventListener('click', () => openRepoEditModal());
    panel.querySelector('#dev-host-add').addEventListener('click', () => openHostEditModal());

    panel.querySelector('#dev-save-btn').addEventListener('click', () => {
      const token = panel.querySelector('#dev-github-token').value.trim();
      CCWeb.send({
        type: 'save_dev_config',
        config: {
          github: { token, repos: editingRepos },
          ssh: { hosts: editingHosts },
        },
      });
      panel.querySelector('#dev-status').textContent = '已保存';
      panel.querySelector('#dev-status').className = 'settings-status success';
    });

    _onDevConfig = (config) => {
      panel.querySelector('#dev-github-token').value = config.github?.token || '';
      editingRepos = (config.github?.repos || []).map(r => ({ ...r }));
      editingHosts = (config.ssh?.hosts || []).map(h => ({ ...h }));
      renderRepos();
      renderHosts();
    };
  }

  // --- Agent context card ---

  function buildAgentContextCard(agent, title, copy) {
    const label = CCWeb.AGENT_LABELS[CCWeb.helpers.normalizeAgent(agent)] || CCWeb.AGENT_LABELS.claude;
    return `
      <div class="agent-context-card">
        <div class="agent-context-kicker">${escapeHtml(label)}</div>
        ${title ? `<div class="agent-context-title">${escapeHtml(title)}</div>` : ''}
        ${copy ? `<div class="agent-context-copy">${escapeHtml(copy)}</div>` : ''}
      </div>
    `;
  }

  // --- Claude local info modal ---

  function showClaudeLocalInfoModal() {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'settings-overlay';
    modalOverlay.style.zIndex = '10001';
    const modal = document.createElement('div');
    modal.className = 'settings-panel';
    modal.style.maxWidth = '460px';
    modal.innerHTML = `
      <div class="settings-header">
        <h3>本地配置说明</h3>
        <button class="settings-close" id="claude-info-close">&times;</button>
      </div>
      <div class="settings-inline-note">
        选中"本地配置"时，Agent 直接使用本机原生配置文件中的 API 信息，不会覆盖或修改本机配置。
        <br><br>
        <strong>• Claude：</strong>切换到自定义模板时，本机 ~/.claude/settings.json 中的 API 配置会被替换为模板值。再次切回"本地配置"时，可一键恢复之前保存的快照到 settings.json。
        <br><br>
        <strong>• Codex：</strong>自定义模板不会修改本机 ~/.codex/，切回"本地配置"时自动恢复本机直通，无需恢复操作。
      </div>
      <div class="settings-actions">
        <button class="btn-save" id="claude-info-ok">确定</button>
      </div>
    `;
    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);
    const closeModal = () => document.body.removeChild(modalOverlay);
    modal.querySelector('#claude-info-close').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
    modal.querySelector('#claude-info-ok').addEventListener('click', closeModal);
  }

  // --- Settings escape ---

  function _settingsEscape(e) {
    if (e.key === 'Escape') hideSettingsPanel();
  }

  // --- Main Settings Panel ---

  function showSettingsPanel() {
    CCWeb.send({ type: 'get_model_config' });
    CCWeb.send({ type: 'get_codex_config' });
    CCWeb.send({ type: 'get_notify_config' });
    CCWeb.send({ type: 'get_ccswitch_state' });

    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.id = 'settings-overlay';

    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    panel.innerHTML = `
      <h3>
        设置
        <button class="settings-close" title="关闭">&times;</button>
      </h3>

      <div class="settings-section-title">Claude API 配置</div>
      <div id="claude-config-area"></div>
      <div class="settings-actions">
        <button class="btn-save" id="model-save-btn">保存 Claude 配置</button>
      </div>
      <div class="settings-status" id="model-status"></div>

      <div class="settings-divider"></div>

      <div class="settings-section-title">Codex API 配置</div>
      <div id="codex-config-area"></div>
      <div class="settings-actions">
        <button class="btn-save" id="codex-save-btn">保存 Codex 配置</button>
      </div>
      <div class="settings-status" id="codex-status"></div>

      <div class="settings-divider"></div>

      ${buildThemeEntryHtml()}

      <div class="settings-divider"></div>

      ${buildNotifyEntryHtml(null)}

      <div class="settings-divider"></div>

      ${buildCcSwitchEntryHtml(null)}

      <div class="settings-divider"></div>

      <div class="settings-section-title">开发者</div>
      <button class="settings-nav-card" type="button" data-open-dev-page>
        <span class="settings-nav-card-main">
          <span class="settings-nav-card-title">开发者设置</span>
          <span class="settings-nav-card-meta">GitHub / SSH 配置</span>
        </span>
        <span class="settings-nav-card-arrow" aria-hidden="true">›</span>
      </button>

      <div class="settings-divider"></div>

      <div class="settings-section-title">系统</div>
      <div class="settings-actions" style="margin-top:0;flex-wrap:wrap;gap:10px">
        <button class="btn-test" id="pw-open-modal-btn" style="padding:6px 16px">修改密码</button>
        <button class="btn-test" id="check-update-btn" style="padding:6px 16px">检查更新</button>
      </div>
      <div class="settings-status" id="update-status" style="margin-top:8px"></div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const themePageBtn = panel.querySelector('[data-open-theme-page]');
    if (themePageBtn) themePageBtn.addEventListener('click', openThemeSubpage);
    const notifyPageBtn2 = panel.querySelector('[data-open-notify-page]');
    if (notifyPageBtn2) notifyPageBtn2.addEventListener('click', openNotifySubpage);
    const ccSwitchPageBtn = panel.querySelector('[data-open-ccswitch-page]');
    if (ccSwitchPageBtn) ccSwitchPageBtn.addEventListener('click', openCcSwitchSubpage);
    const devPageBtn = panel.querySelector('[data-open-dev-page]');
    if (devPageBtn) devPageBtn.addEventListener('click', openDevSettingsSubpage);

    // === Claude Config UI ===
    const claudeConfigArea = panel.querySelector('#claude-config-area');
    const modelStatusDiv = panel.querySelector('#model-status');
    const modelSaveBtn = panel.querySelector('#model-save-btn');

    let modelCurrentConfig = null;
    let modelEditingTemplates = [];
    let modelActiveTemplate = '';

    function showModelStatus(msg, type) {
      modelStatusDiv.textContent = msg;
      modelStatusDiv.className = 'settings-status ' + (type || '');
    }

    function renderClaudeConfigArea() {
      const isLocal = modelActiveTemplate === '';
      const tplOptions = modelEditingTemplates.map(t =>
        `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`
      ).join('');

      if (isLocal) {
        const hasSnapshot = modelCurrentConfig?.localSnapshot && Object.keys(modelCurrentConfig.localSnapshot).length > 0
          && (modelCurrentConfig.localSnapshot.apiKey || modelCurrentConfig.localSnapshot.apiBase);
        claudeConfigArea.innerHTML = `
          <div class="settings-field">
            <label>激活模板</label>
            <div style="display:flex;gap:6px;align-items:center">
              <select class="settings-select" id="claude-tpl-select" style="flex:1">
                <option value="__local__" selected>本地配置</option>
                ${tplOptions}
                <option value="__new__">+ 新建模板</option>
              </select>
              <button class="btn-test" id="claude-info-btn" style="padding:4px 10px">说明</button>
              <button class="btn-test" id="claude-read-local-btn" style="padding:4px 10px">读取当前配置</button>
              ${hasSnapshot ? '<button class="btn-test" id="claude-restore-btn" style="padding:4px 10px">恢复快照</button>' : ''}
            </div>
          </div>
          <div class="settings-inline-note">
            Agent 直接使用本机 <code>~/.claude/settings.json</code> 中的 API 信息，不会覆盖或修改本机配置。
          </div>
        `;
        panel.querySelector('#claude-tpl-select').addEventListener('change', (e) => {
          if (e.target.value === '__new__') {
            const newName = prompt('输入新模板名称:');
            if (!newName || !newName.trim()) { e.target.value = '__local__'; return; }
            const n = newName.trim();
            if (modelEditingTemplates.find(t => t.name === n)) { alert('模板名称已存在'); e.target.value = '__local__'; return; }
            modelEditingTemplates.push({ name: n, apiKey: '', apiBase: '', defaultModel: '', opusModel: '', sonnetModel: '', haikuModel: '' });
            modelActiveTemplate = n;
            renderClaudeConfigArea();
            openTplEditModal();
          } else {
            modelActiveTemplate = e.target.value;
            renderClaudeConfigArea();
          }
        });
        panel.querySelector('#claude-info-btn').addEventListener('click', showClaudeLocalInfoModal);
        panel.querySelector('#claude-read-local-btn').addEventListener('click', () => CCWeb.send({ type: 'read_claude_local_config' }));
        const restoreBtn = panel.querySelector('#claude-restore-btn');
        if (restoreBtn) restoreBtn.addEventListener('click', () => CCWeb.send({ type: 'restore_claude_local_snapshot' }));
        return;
      }

      // Custom template selected
      const tpl = modelEditingTemplates.find(t => t.name === modelActiveTemplate);
      const summary = tpl ? `API Key: <code>${tpl.apiKey ? '已设置' : '未设置'}</code> · Base: <code>${escapeHtml(tpl.apiBase || '默认')}</code>` : '';
      claudeConfigArea.innerHTML = `
        <div class="settings-field">
          <label>激活模板</label>
          <div style="display:flex;gap:6px;align-items:center">
            <select class="settings-select" id="claude-tpl-select" style="flex:1">
              <option value="__local__">本地配置</option>
              ${tplOptions}
              <option value="__new__">+ 新建模板</option>
            </select>
            <button class="btn-test" id="model-tpl-edit" style="padding:4px 10px">编辑</button>
            <button class="btn-test" id="model-tpl-del" title="删除" style="padding:4px 8px">删除</button>
          </div>
        </div>
        <div class="settings-inline-note">${summary}</div>
      `;

      panel.querySelector('#claude-tpl-select').addEventListener('change', (e) => {
        if (e.target.value === '__new__') {
          const newName = prompt('输入新模板名称:');
          if (!newName || !newName.trim()) { e.target.value = escapeHtml(modelActiveTemplate); return; }
          const n = newName.trim();
          if (modelEditingTemplates.find(t => t.name === n)) { alert('模板名称已存在'); e.target.value = escapeHtml(modelActiveTemplate); return; }
          modelEditingTemplates.push({ name: n, apiKey: '', apiBase: '', defaultModel: '', opusModel: '', sonnetModel: '', haikuModel: '' });
          modelActiveTemplate = n;
          renderClaudeConfigArea();
          openTplEditModal();
        } else if (e.target.value === '__local__') {
          modelActiveTemplate = '';
          renderClaudeConfigArea();
        } else {
          modelActiveTemplate = e.target.value;
          renderClaudeConfigArea();
        }
      });
      panel.querySelector('#model-tpl-edit').addEventListener('click', () => openTplEditModal());
      const delBtn = panel.querySelector('#model-tpl-del');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          if (!modelActiveTemplate) return;
          if (!confirm(`确认删除模板「${modelActiveTemplate}」?`)) return;
          modelEditingTemplates = modelEditingTemplates.filter(t => t.name !== modelActiveTemplate);
          modelActiveTemplate = modelEditingTemplates[0]?.name || '';
          renderClaudeConfigArea();
        });
      }
    }

    function openTplEditModal() {
      const tpl = modelEditingTemplates.find(t => t.name === modelActiveTemplate);
      if (!tpl) return;
      const modalOverlay = document.createElement('div');
      modalOverlay.className = 'settings-overlay';
      modalOverlay.style.zIndex = '10001';
      const modal = document.createElement('div');
      modal.className = 'settings-panel';
      modal.style.maxWidth = '460px';
      modal.innerHTML = `
        <div class="settings-header">
          <h3>编辑模板: ${escapeHtml(tpl.name)}</h3>
          <button class="settings-close" id="tpl-modal-close">&times;</button>
        </div>
        <div class="settings-field">
          <label>模板名称</label>
          <input type="text" id="tpl-ed-name" value="${escapeHtml(tpl.name)}">
        </div>
        <div class="settings-field">
          <label>API Key</label>
          <input type="text" id="tpl-ed-apikey" placeholder="sk-ant-..." value="${escapeHtml(tpl.apiKey || '')}">
        </div>
        <div class="settings-field">
          <label>API Base URL</label>
          <input type="text" id="tpl-ed-apibase" placeholder="https://api.anthropic.com" value="${escapeHtml(tpl.apiBase || '')}">
        </div>
        <div class="settings-divider" style="margin:12px 0"></div>
        <div class="settings-field">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600">获取上游模型列表</label>
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
            <label style="font-size:0.85em;display:flex;align-items:center;gap:4px;cursor:pointer">
              <input type="checkbox" id="tpl-ed-custom-endpoint"> 端点
            </label>
            <input type="text" id="tpl-ed-models-endpoint" placeholder="/v1/models" style="flex:1;display:none" value="">
          </div>
          <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
            <button class="btn-test" id="tpl-ed-fetch-models" style="padding:4px 12px;white-space:nowrap">获取模型</button>
            <span id="tpl-ed-fetch-status" style="font-size:0.85em;color:var(--text-secondary)"></span>
          </div>
        </div>
        <div class="settings-divider" style="margin:12px 0"></div>
        <div class="settings-field">
          <label>默认模型 (ANTHROPIC_MODEL)</label>
          <input type="text" id="tpl-ed-default" list="tpl-dl-models" placeholder="claude-opus-4-6" value="${escapeHtml(tpl.defaultModel || '')}" autocomplete="off">
        </div>
        <div class="settings-field">
          <label>Opus 模型名</label>
          <input type="text" id="tpl-ed-opus" list="tpl-dl-models" placeholder="claude-opus-4-6" value="${escapeHtml(tpl.opusModel || '')}" autocomplete="off">
        </div>
        <div class="settings-field">
          <label>Sonnet 模型名</label>
          <input type="text" id="tpl-ed-sonnet" list="tpl-dl-models" placeholder="claude-sonnet-4-6" value="${escapeHtml(tpl.sonnetModel || '')}" autocomplete="off">
        </div>
        <div class="settings-field">
          <label>Haiku 模型名</label>
          <input type="text" id="tpl-ed-haiku" list="tpl-dl-models" placeholder="claude-haiku-4-5-20251001" value="${escapeHtml(tpl.haikuModel || '')}" autocomplete="off">
        </div>
        <datalist id="tpl-dl-models"></datalist>
        <div class="settings-actions">
          <button class="btn-save" id="tpl-ed-ok">确定</button>
        </div>
      `;
      modalOverlay.appendChild(modal);
      document.body.appendChild(modalOverlay);
      const customEndpointCb = modal.querySelector('#tpl-ed-custom-endpoint');
      const endpointInput = modal.querySelector('#tpl-ed-models-endpoint');
      customEndpointCb.addEventListener('change', () => {
        endpointInput.style.display = customEndpointCb.checked ? '' : 'none';
      });
      const fetchBtn = modal.querySelector('#tpl-ed-fetch-models');
      const fetchStatus = modal.querySelector('#tpl-ed-fetch-status');
      const datalist = modal.querySelector('#tpl-dl-models');
      fetchBtn.addEventListener('click', () => {
        const apiBase = modal.querySelector('#tpl-ed-apibase').value.trim();
        const apiKey = modal.querySelector('#tpl-ed-apikey').value.trim();
        if (!apiBase || !apiKey) {
          fetchStatus.textContent = '请先填写 API Base 和 API Key';
          fetchStatus.style.color = 'var(--text-error, #e85d5d)';
          return;
        }
        const modelsEndpoint = customEndpointCb.checked ? endpointInput.value.trim() : '';
        fetchBtn.disabled = true;
        fetchStatus.textContent = '正在获取...';
        fetchStatus.style.color = 'var(--text-secondary)';
        _onFetchModelsResult = (result) => {
          _onFetchModelsResult = null;
          fetchBtn.disabled = false;
          if (result.success) {
            datalist.innerHTML = result.models.map(m => `<option value="${escapeHtml(m)}">`).join('');
            fetchStatus.textContent = `获取到 ${result.models.length} 个模型`;
            fetchStatus.style.color = 'var(--text-success, #5dbe5d)';
          } else {
            fetchStatus.textContent = result.message || '获取失败';
            fetchStatus.style.color = 'var(--text-error, #e85d5d)';
          }
        };
        CCWeb.send({ type: 'fetch_models', apiBase, apiKey, modelsEndpoint: modelsEndpoint || undefined, templateName: tpl.name });
      });
      const closeModal = () => {
        _onFetchModelsResult = null;
        document.body.removeChild(modalOverlay);
      };
      modal.querySelector('#tpl-modal-close').addEventListener('click', closeModal);
      modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
      modal.querySelector('#tpl-ed-ok').addEventListener('click', () => {
        const newName = modal.querySelector('#tpl-ed-name').value.trim();
        if (newName && newName !== tpl.name) {
          if (modelEditingTemplates.find(t => t.name === newName && t !== tpl)) { alert('模板名称已存在'); return; }
          tpl.name = newName;
          modelActiveTemplate = newName;
        }
        tpl.apiKey = modal.querySelector('#tpl-ed-apikey').value.trim();
        tpl.apiBase = modal.querySelector('#tpl-ed-apibase').value.trim();
        tpl.defaultModel = modal.querySelector('#tpl-ed-default').value.trim();
        tpl.opusModel = modal.querySelector('#tpl-ed-opus').value.trim();
        tpl.sonnetModel = modal.querySelector('#tpl-ed-sonnet').value.trim();
        tpl.haikuModel = modal.querySelector('#tpl-ed-haiku').value.trim();
        closeModal();
        renderClaudeConfigArea();
      });
    }

    function _handleClaudeLocalConfigShow(msg) {
      const config = msg.config || {};
      const hasData = config.apiKey || config.apiBase;
      const modalOverlay = document.createElement('div');
      modalOverlay.className = 'settings-overlay';
      modalOverlay.style.zIndex = '10001';
      const modal = document.createElement('div');
      modal.className = 'settings-panel';
      modal.style.maxWidth = '460px';
      const fields = [
        ['API Key', config.apiKey || '(空)'],
        ['API Base URL', config.apiBase || '(空)'],
        ['默认模型', config.defaultModel || '(空)'],
        ['Opus 模型', config.opusModel || '(空)'],
        ['Sonnet 模型', config.sonnetModel || '(空)'],
        ['Haiku 模型', config.haikuModel || '(空)'],
      ];
      modal.innerHTML = `
        <div class="settings-header">
          <h3>当前 Claude 本地配置</h3>
          <button class="settings-close" id="read-local-close">&times;</button>
        </div>
        ${msg.sourceFound ? '' : '<div class="settings-inline-note" style="color:var(--text-warning, #e8a838)">未找到 ~/.claude/settings.json，以下为空值。</div>'}
        ${fields.map(([label, val]) => `
          <div class="settings-field">
            <label>${label}</label>
            <div style="font-size:0.9em;word-break:break-all;color:var(--text-secondary)">${escapeHtml(val)}</div>
          </div>
        `).join('')}
        ${hasData ? '<div class="settings-actions"><button class="btn-save" id="save-snapshot-btn">保存为快照</button></div>' : ''}
        <div class="settings-actions"><button class="btn-save" id="read-local-ok">关闭</button></div>
      `;
      modalOverlay.appendChild(modal);
      document.body.appendChild(modalOverlay);
      const closeModal = () => document.body.removeChild(modalOverlay);
      modal.querySelector('#read-local-close').addEventListener('click', closeModal);
      modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
      modal.querySelector('#read-local-ok').addEventListener('click', closeModal);
      const saveBtn = modal.querySelector('#save-snapshot-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          CCWeb.send({ type: 'save_local_snapshot', snapshot: config });
          closeModal();
        });
      }
    }

    modelSaveBtn.addEventListener('click', () => {
      const isLocal = modelActiveTemplate === '';
      const config = {
        mode: isLocal ? 'local' : 'custom',
        activeTemplate: isLocal ? '' : modelActiveTemplate,
        templates: modelEditingTemplates,
        localSnapshot: modelCurrentConfig?.localSnapshot || {},
      };
      CCWeb.send({ type: 'save_model_config', config });
      showModelStatus('已保存', 'success');
    });

    _onModelConfig = (config) => {
      modelCurrentConfig = config;
      modelEditingTemplates = (config.templates || []).map(t => Object.assign({}, t));
      if (config.mode === 'local') {
        modelActiveTemplate = '';
      } else {
        modelActiveTemplate = config.activeTemplate || (modelEditingTemplates[0]?.name || '');
      }
      renderClaudeConfigArea();
    };

    _onClaudeLocalConfig = (msg) => {
      _handleClaudeLocalConfigShow(msg);
    };

    // === Codex Config UI ===
    const codexConfigArea = panel.querySelector('#codex-config-area');
    const codexStatus = panel.querySelector('#codex-status');
    const codexSaveBtn = panel.querySelector('#codex-save-btn');

    let currentCodexConfig = null;
    let codexEditingProfiles = [];
    let codexActiveProfile = '';

    function _splitCodexThinkingModel(model) {
      if (typeof model !== 'string' || !model) return { base: model };
      const m = model.match(/^(.*)\s+thinking$/);
      return m ? { base: m[1], thinking: true } : { base: model };
    }

    function _parseCodexModelListText(text) {
      return String(text || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    }

    function normalizeCodexProfile(profile) {
      if (!profile || typeof profile !== 'object') return { name: '', apiKey: '', apiBase: '', model: '', models: [] };
      const models = Array.isArray(profile.models) ? profile.models : [];
      const model = profile.model || (models[0] || '');
      return {
        name: profile.name || '',
        apiKey: profile.apiKey || '',
        apiBase: profile.apiBase || '',
        model,
        models,
      };
    }

    function showCodexStatus(msg, type) {
      codexStatus.textContent = msg;
      codexStatus.className = 'settings-status ' + (type || '');
    }

    function renderCodexConfigArea() {
      const isLocal = codexActiveProfile === '';
      const profileOptions = codexEditingProfiles.map((profile) =>
        `<option value="${escapeHtml(profile.name)}"${profile.name === codexActiveProfile ? ' selected' : ''}>${escapeHtml(profile.name)}</option>`
      ).join('');

      if (isLocal) {
        codexConfigArea.innerHTML = `
          <div class="settings-field">
            <label>激活 Profile</label>
            <div style="display:flex;gap:6px;align-items:center">
              <select class="settings-select" id="codex-profile-select" style="flex:1">
                <option value="__local__" selected>本地配置</option>
                ${profileOptions}
                <option value="__new__">+ 新建 Profile</option>
              </select>
              <button class="btn-test" id="codex-info-btn" style="padding:4px 10px">说明</button>
              <button class="btn-test" id="codex-read-local-btn" style="padding:4px 10px">读取当前配置</button>
            </div>
          </div>
          <div class="settings-inline-note">
            直接复用本机 <code>codex</code> 的登录态与 <code>~/.codex/config.toml</code>。
          </div>
        `;
        panel.querySelector('#codex-profile-select').addEventListener('change', (e) => {
          if (e.target.value === '__new__') {
            openCodexProfileModal();
          } else if (e.target.value === '__local__') {
            codexActiveProfile = '';
            renderCodexConfigArea();
          } else {
            codexActiveProfile = e.target.value;
            renderCodexConfigArea();
          }
        });
        panel.querySelector('#codex-info-btn').addEventListener('click', showClaudeLocalInfoModal);
        panel.querySelector('#codex-read-local-btn').addEventListener('click', () => CCWeb.send({ type: 'read_codex_local_config' }));
        return;
      }

      // Custom profile selected
      const currentProfileRaw = codexEditingProfiles.find((profile) => profile.name === codexActiveProfile);
      const currentProfile = currentProfileRaw ? normalizeCodexProfile(currentProfileRaw) : null;
      const summaryBase = currentProfile?.apiBase ? escapeHtml(currentProfile.apiBase) : '默认';
      const summaryModel = currentProfile?.model ? escapeHtml(currentProfile.model) : '未设置';
      const summaryModelsCount = Array.isArray(currentProfile?.models) ? currentProfile.models.length : 0;

      codexConfigArea.innerHTML = `
        <div class="settings-field">
          <label>激活 Profile</label>
          <div style="display:flex;gap:6px;align-items:center">
            <select class="settings-select" id="codex-profile-select" style="flex:1">
              <option value="__local__">本地配置</option>
              ${profileOptions}
              <option value="__new__">+ 新建 Profile</option>
            </select>
            <button class="btn-test" id="codex-profile-edit" style="padding:4px 10px">编辑</button>
            <button class="btn-test" id="codex-profile-del" title="删除" style="padding:4px 8px">删除</button>
          </div>
        </div>
        <div class="settings-inline-note">
          当前 Profile：<strong>${escapeHtml(currentProfile?.name || '未选择')}</strong> · API Base：<code>${summaryBase}</code> · 默认模型：<code>${summaryModel}</code> · /model 候选：<code>${summaryModelsCount}</code> 项
        </div>
      `;

      panel.querySelector('#codex-profile-select').addEventListener('change', (e) => {
        if (e.target.value === '__new__') {
          openCodexProfileModal();
        } else if (e.target.value === '__local__') {
          codexActiveProfile = '';
          renderCodexConfigArea();
        } else {
          codexActiveProfile = e.target.value;
          renderCodexConfigArea();
        }
      });
      panel.querySelector('#codex-profile-edit').addEventListener('click', () => {
        openCodexProfileModal(codexActiveProfile);
      });
      panel.querySelector('#codex-profile-del').addEventListener('click', () => {
        if (!codexActiveProfile) return;
        if (!confirm(`确认删除 Codex Profile「${codexActiveProfile}」?`)) return;
        codexEditingProfiles = codexEditingProfiles.filter((profile) => profile.name !== codexActiveProfile);
        codexActiveProfile = codexEditingProfiles[0]?.name || '';
        renderCodexConfigArea();
      });
    }

    function openCodexProfileModal(profileName = '') {
      const current = profileName
        ? codexEditingProfiles.find((profile) => profile.name === profileName)
        : null;
      const draft = current ? normalizeCodexProfile(current) : { name: '', apiKey: '', apiBase: '', model: '', models: [] };
      const initialModelListText = Array.isArray(draft.models) ? draft.models.join('\n') : '';
      const modalOverlay = document.createElement('div');
      modalOverlay.className = 'settings-overlay';
      modalOverlay.style.zIndex = '10001';
      const modal = document.createElement('div');
      modal.className = 'settings-panel';
      modal.style.maxWidth = '460px';
      modal.innerHTML = `
        <div class="settings-header">
          <h3>${current ? `编辑 Profile: ${escapeHtml(current.name)}` : '新建 Codex Profile'}</h3>
          <button class="settings-close" id="codex-profile-modal-close">&times;</button>
        </div>
        <div class="settings-field">
          <label>Profile 名称</label>
          <input type="text" id="codex-profile-name" placeholder="例如 OpenRouter Work" value="${escapeHtml(draft.name || '')}">
        </div>
        <div class="settings-field">
          <label>API Key</label>
          <input type="text" id="codex-profile-apikey" placeholder="sk-..." value="${escapeHtml(draft.apiKey || '')}">
        </div>
        <div class="settings-field">
          <label>API Base URL</label>
          <input type="text" id="codex-profile-apibase" placeholder="https://api.openai.com/v1" value="${escapeHtml(draft.apiBase || '')}">
        </div>
        <div class="settings-divider" style="margin:12px 0"></div>
        <div class="settings-field">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600">获取上游模型列表</label>
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
            <label style="font-size:0.85em;display:flex;align-items:center;gap:4px;cursor:pointer">
              <input type="checkbox" id="codex-profile-custom-endpoint"> 端点
            </label>
            <input type="text" id="codex-profile-models-endpoint" placeholder="/v1/models" style="flex:1;display:none" value="">
          </div>
          <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
            <button class="btn-test" id="codex-profile-fetch-models" style="padding:4px 12px;white-space:nowrap">获取模型</button>
            <span id="codex-profile-fetch-status" style="font-size:0.85em;color:var(--text-secondary)"></span>
          </div>
        </div>
        <div class="settings-divider" style="margin:12px 0"></div>
        <div class="settings-field">
          <label>默认模型</label>
          <input type="text" id="codex-profile-model" list="codex-profile-dl-models" placeholder="gpt-5.5" value="${escapeHtml(draft.model || '')}" autocomplete="off">
        </div>
        <datalist id="codex-profile-dl-models"></datalist>
        <div class="settings-field">
          <label>/model 候选列表</label>
          <textarea id="codex-profile-model-list" rows="7" placeholder="每行一个模型，例如&#10;gpt-5.5&#10;gpt-5.4&#10;gpt-5.3-codex" style="resize:vertical">${escapeHtml(initialModelListText)}</textarea>
        </div>
        <div class="settings-inline-note">
          默认模型会用于新会话；<code>/model</code> 弹出的候选项只来自这里配置的列表。
        </div>
        <div class="settings-actions">
          <button class="btn-save" id="codex-profile-ok">确定</button>
        </div>
      `;
      modalOverlay.appendChild(modal);
      document.body.appendChild(modalOverlay);
      const customEndpointCb = modal.querySelector('#codex-profile-custom-endpoint');
      const endpointInput = modal.querySelector('#codex-profile-models-endpoint');
      const fetchBtn = modal.querySelector('#codex-profile-fetch-models');
      const fetchStatus = modal.querySelector('#codex-profile-fetch-status');
      const datalist = modal.querySelector('#codex-profile-dl-models');
      const defaultModelInput = modal.querySelector('#codex-profile-model');
      const modelListTextarea = modal.querySelector('#codex-profile-model-list');
      customEndpointCb.addEventListener('change', () => {
        endpointInput.style.display = customEndpointCb.checked ? '' : 'none';
      });
      fetchBtn.addEventListener('click', () => {
        const apiBase = modal.querySelector('#codex-profile-apibase').value.trim();
        const apiKey = modal.querySelector('#codex-profile-apikey').value.trim();
        if (!apiBase || !apiKey) {
          fetchStatus.textContent = '请先填写 API Base 和 API Key';
          fetchStatus.style.color = 'var(--text-error, #e85d5d)';
          return;
        }
        const modelsEndpoint = customEndpointCb.checked ? endpointInput.value.trim() : '';
        fetchBtn.disabled = true;
        fetchStatus.textContent = '正在获取...';
        fetchStatus.style.color = 'var(--text-secondary)';
        _onFetchModelsResult = (result) => {
          _onFetchModelsResult = null;
          fetchBtn.disabled = false;
          if (result.success) {
            datalist.innerHTML = result.models.map((m) => `<option value="${escapeHtml(m)}">`).join('');
            const fetchedText = result.models.join('\n');
            const currentText = modelListTextarea.value.trim();
            if (!currentText) {
              modelListTextarea.value = fetchedText;
            } else if (currentText !== fetchedText && confirm('是否使用拉取结果覆盖当前 /model 候选列表？')) {
              modelListTextarea.value = fetchedText;
            }
            if (!defaultModelInput.value.trim() && result.models[0]) {
              defaultModelInput.value = result.models[0];
            }
            fetchStatus.textContent = `获取到 ${result.models.length} 个模型`;
            fetchStatus.style.color = 'var(--text-success, #5dbe5d)';
          } else {
            fetchStatus.textContent = result.message || '获取失败';
            fetchStatus.style.color = 'var(--text-error, #e85d5d)';
          }
        };
        CCWeb.send({
          type: 'fetch_models',
          apiBase,
          apiKey,
          modelsEndpoint: modelsEndpoint || undefined,
          profileName: current?.name || modal.querySelector('#codex-profile-name').value.trim(),
        });
      });
      const closeModal = () => {
        _onFetchModelsResult = null;
        document.body.removeChild(modalOverlay);
      };
      modal.querySelector('#codex-profile-modal-close').addEventListener('click', closeModal);
      modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
      modal.querySelector('#codex-profile-ok').addEventListener('click', () => {
        const name = modal.querySelector('#codex-profile-name').value.trim();
        const apiKey = modal.querySelector('#codex-profile-apikey').value.trim();
        const apiBase = modal.querySelector('#codex-profile-apibase').value.trim();
        const model = defaultModelInput.value.trim();
        const models = _parseCodexModelListText(modelListTextarea.value);
        if (!name) { alert('请填写 Profile 名称'); return; }
        if (!apiKey) { alert('请填写 API Key'); return; }
        if (!apiBase) { alert('请填写 API Base URL'); return; }
        if (!model) { alert('请填写模型'); return; }
        if (!models.length) { alert('请至少填写一个 /model 候选模型'); return; }
        if (!models.includes(model)) models.unshift(model);
        const existing = codexEditingProfiles.find((profile) => profile.name === name);
        if (existing && existing !== current) { alert('Profile 名称已存在'); return; }
        if (current) {
          current.name = name;
          current.apiKey = apiKey;
          current.apiBase = apiBase;
          current.model = model;
          current.models = models;
        } else {
          codexEditingProfiles.push({ name, apiKey, apiBase, model, models });
        }
        codexActiveProfile = name;
        closeModal();
        renderCodexConfigArea();
      });
    }

    _onCodexConfig = (config) => {
      currentCodexConfig = config || {};
      codexEditingProfiles = (currentCodexConfig.profiles || []).map((profile) => normalizeCodexProfile(profile));
      if (currentCodexConfig.mode === 'local') {
        codexActiveProfile = '';
      } else {
        codexActiveProfile = currentCodexConfig.activeProfile || (codexEditingProfiles[0]?.name || '');
      }
      renderCodexConfigArea();
    };

    codexSaveBtn.addEventListener('click', () => {
      const isLocal = codexActiveProfile === '';
      if (!isLocal && codexEditingProfiles.length === 0) {
        showCodexStatus('自定义模式至少需要一个 Codex Profile', 'error');
        return;
      }
      const config = {
        mode: isLocal ? 'local' : 'custom',
        activeProfile: isLocal ? '' : codexActiveProfile,
        profiles: codexEditingProfiles,
        // TODO(v1.4): Wire up Codex search capability
        enableSearch: false,
        localSnapshot: currentCodexConfig?.localSnapshot || {},
      };
      CCWeb.send({ type: 'save_codex_config', config });
      showCodexStatus('已保存', 'success');
    });

    _onCodexLocalConfig = (msg) => {
      const config = msg.config || {};
      const modalOverlay = document.createElement('div');
      modalOverlay.className = 'settings-overlay';
      modalOverlay.style.zIndex = '10001';
      const modal = document.createElement('div');
      modal.className = 'settings-panel';
      modal.style.maxWidth = '460px';
      const fields = [
        ['API Key', config.apiKey || '(空)'],
        ['API Base URL', config.apiBase || '(空)'],
        ['模型', config.model || '(空)'],
      ];
      modal.innerHTML = `
        <div class="settings-header">
          <h3>当前 Codex 本地配置</h3>
          <button class="settings-close" id="read-codex-local-close">&times;</button>
        </div>
        ${msg.warning ? `<div class="settings-inline-note" style="color:var(--text-warning, #e8a838)">${escapeHtml(msg.warning)}</div>` : ''}
        ${!msg.sourceFound ? '<div class="settings-inline-note" style="color:var(--text-warning, #e8a838)">未找到 ~/.codex/ 配置文件。</div>' : ''}
        ${fields.map(([label, val]) => `
          <div class="settings-field">
            <label>${label}</label>
            <div style="font-size:0.9em;word-break:break-all;color:var(--text-secondary)">${escapeHtml(val)}</div>
          </div>
        `).join('')}
        <div class="settings-actions"><button class="btn-save" id="read-codex-local-ok">关闭</button></div>
      `;
      modalOverlay.appendChild(modal);
      document.body.appendChild(modalOverlay);
      const closeModal = () => document.body.removeChild(modalOverlay);
      modal.querySelector('#read-codex-local-close').addEventListener('click', closeModal);
      modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
      modal.querySelector('#read-codex-local-ok').addEventListener('click', closeModal);
    };

    // === System UI ===
    const closeBtn = panel.querySelector('.settings-close');
    const pwOpenModalBtn = panel.querySelector('#pw-open-modal-btn');
    pwOpenModalBtn.addEventListener('click', openPasswordModal);

    // Check update button
    const checkUpdateBtn = panel.querySelector('#check-update-btn');
    const updateStatusEl = panel.querySelector('#update-status');
    let _onUpdateInfo = null;
    checkUpdateBtn.addEventListener('click', () => {
      updateStatusEl.textContent = '正在检查...';
      updateStatusEl.className = 'settings-status';
      _onUpdateInfo = (info) => {
        _onUpdateInfo = null;
        if (info.error) {
          updateStatusEl.textContent = '检查失败: ' + info.error;
          updateStatusEl.className = 'settings-status error';
          return;
        }
        if (info.hasUpdate) {
          updateStatusEl.innerHTML = `有新版本 <strong>v${escapeHtml(info.latestVersion)}</strong>（当前 v${escapeHtml(info.localVersion)}）&nbsp;<a href="${escapeHtml(info.releaseUrl)}" target="_blank" style="color:var(--accent)">查看更新</a>`;
          updateStatusEl.className = 'settings-status success';
        } else {
          updateStatusEl.textContent = `已是最新版本 v${info.localVersion}`;
          updateStatusEl.className = 'settings-status success';
        }
      };
      CCWeb.send({ type: 'check_update' });
    });

    // Wire _onUpdateInfo into WS handler via closure
    const _origOnUpdateInfo = window._ccOnUpdateInfo;
    window._ccOnUpdateInfo = (info) => { if (_onUpdateInfo) _onUpdateInfo(info); };

    closeBtn.addEventListener('click', hideSettingsPanel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hideSettingsPanel(); });

    document.addEventListener('keydown', _settingsEscape);
  }

  function hideSettingsPanel() {
    const overlay = document.getElementById('settings-overlay');
    if (overlay) overlay.remove();
    document.querySelectorAll('.settings-subpage-overlay').forEach((node) => node.remove());
    _onNotifyConfig = null;
    _onNotifyTestResult = null;
    _onModelConfig = null;
    _onCodexConfig = null;
    _onCcSwitchState = null;
    _onCcSwitchSwitchResult = null;
    _onCcSwitchDesktopRefreshResult = null;
    _onFetchModelsResult = null;
    _onClaudeLocalConfig = null;
    _onCodexLocalConfig = null;
    _onDevConfig = null;
    _onPasswordChanged = null;
    window._ccOnUpdateInfo = null;
    document.removeEventListener('keydown', _settingsEscape);
  }

  // --- Message Handler ---

  function handleMessage(msg) {
    switch (msg.type) {
      case 'notify_config':
        if (typeof _onNotifyConfig === 'function') _onNotifyConfig(msg.config);
        if (msg.config) {
          const provider = msg.config.provider || 'off';
          const providerLabel = PROVIDER_OPTIONS.find(o => o.value === provider)?.label || '关闭';
          const summaryOn = msg.config.summary?.enabled ? '摘要已启用' : '摘要关闭';
          const meta = provider === 'off' ? '未启用' : `${providerLabel} · ${summaryOn}`;
          document.querySelectorAll('[data-notify-summary]').forEach(el => { el.textContent = meta; });
        }
        break;
      case 'notify_test_result':
        if (typeof _onNotifyTestResult === 'function') _onNotifyTestResult(msg);
        break;
      case 'model_config':
        if (typeof _onModelConfig === 'function') _onModelConfig(msg.config);
        break;
      case 'codex_config':
        CCWeb.state.codexConfigCache = msg.config || null;
        if (typeof _onCodexConfig === 'function') _onCodexConfig(msg.config);
        break;
      case 'ccswitch_state':
        updateCcSwitchSummary(msg.state);
        if (typeof _onCcSwitchState === 'function') _onCcSwitchState(msg.state);
        break;
      case 'ccswitch_switch_result':
        if (typeof _onCcSwitchSwitchResult === 'function') _onCcSwitchSwitchResult(msg);
        break;
      case 'ccswitch_desktop_refresh_result':
        if (typeof _onCcSwitchDesktopRefreshResult === 'function') _onCcSwitchDesktopRefreshResult(msg);
        break;
      case 'claude_local_config':
        if (typeof _onClaudeLocalConfig === 'function') _onClaudeLocalConfig(msg);
        break;
      case 'codex_local_config':
        if (typeof _onCodexLocalConfig === 'function') _onCodexLocalConfig(msg);
        break;
      case 'dev_config':
        if (typeof _onDevConfig === 'function') _onDevConfig(msg.config);
        break;
      case 'fetch_models_result':
        if (typeof _onFetchModelsResult === 'function') _onFetchModelsResult(msg);
        break;
      case 'password_changed':
        handlePasswordChanged(msg);
        break;
    }
  }

  // --- Public API ---

  CCWeb.settings = {
    // Entry builders
    buildThemeEntryHtml,
    buildNotifyEntryHtml,
    buildCcSwitchEntryHtml,
    buildAgentContextCard,
    // State helpers
    summarizeCcSwitchState,
    updateCcSwitchSummary,
    // Panel lifecycle
    showSettingsPanel,
    hideSettingsPanel,
    // Password
    openPasswordModal,
    showForceChangePassword,
    hideForceChangePassword,
    // Message handler
    handleMessage,
  };

})();

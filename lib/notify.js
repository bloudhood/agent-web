'use strict';

const fs = require('fs');
const path = require('path');

// Per-channel content length limits (chars)
const NOTIFY_CONTENT_LIMITS = {
  telegram: 3800,
  qqbot: 3800,
  serverchan: 30000,
  pushplus: 18000,
  feishu: 18000,
};

const DEFAULT_SUMMARY_CONFIG = {
  enabled: false,
  trigger: 'background', // 'background' | 'always'
  apiSource: 'claude',   // 'claude' | 'codex' | 'custom'
  apiBase: '',
  apiKey: '',
  model: '',
};

/**
 * Create a notifier that encapsulates notification config & sending logic.
 *
 * @param {string} configDir  Absolute path to the config directory (contains notify.json).
 * @param {object} deps       Injected dependencies.
 * @param {Function} deps.plog                 Logger (level, event, data).
 * @param {Function} deps.loadModelConfig      Load Claude model config.
 * @param {Function} deps.loadCodexConfig      Load Codex config.
 * @param {Function} deps.splitCodexModelSpec  Parse Codex model spec.
 * @param {string}   deps.DEFAULT_CODEX_MODEL  Default Codex model name.
 * @param {Function} deps.wsSend               WebSocket send helper (ws, data).
 */
function createNotifier(configDir, deps) {
  const {
    plog,
    loadModelConfig,
    loadCodexConfig,
    splitCodexModelSpec,
    DEFAULT_CODEX_MODEL,
    wsSend,
  } = deps;

  const NOTIFY_CONFIG_PATH = path.join(configDir, 'notify.json');

  // --- Config persistence ---

  function loadNotifyConfig() {
    try {
      if (fs.existsSync(NOTIFY_CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(NOTIFY_CONFIG_PATH, 'utf8'));
        // Ensure summary field exists for older configs
        if (!raw.summary) raw.summary = { ...DEFAULT_SUMMARY_CONFIG };
        return raw;
      }
    } catch {}
    // First run: migrate from .env PUSHPLUS_TOKEN
    const token = process.env.PUSHPLUS_TOKEN || '';
    const config = {
      provider: token ? 'pushplus' : 'off',
      pushplus: { token },
      telegram: { botToken: '', chatId: '' },
      serverchan: { sendKey: '' },
      feishu: { webhook: '' },
      qqbot: { qmsgKey: '' },
      summary: { ...DEFAULT_SUMMARY_CONFIG },
    };
    saveNotifyConfig(config);
    return config;
  }

  function saveNotifyConfig(config) {
    fs.writeFileSync(NOTIFY_CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  // --- Display helpers ---

  function maskToken(str) {
    if (!str || str.length <= 8) return str ? '****' : '';
    return str.slice(0, 4) + '****' + str.slice(-4);
  }

  function getNotifyConfigMasked() {
    const config = loadNotifyConfig();
    const s = config.summary || {};
    return {
      provider: config.provider,
      pushplus: { token: maskToken(config.pushplus?.token) },
      telegram: { botToken: maskToken(config.telegram?.botToken), chatId: config.telegram?.chatId || '' },
      serverchan: { sendKey: maskToken(config.serverchan?.sendKey) },
      feishu: { webhook: maskToken(config.feishu?.webhook) },
      qqbot: { qmsgKey: maskToken(config.qqbot?.qmsgKey) },
      summary: {
        enabled: !!s.enabled,
        trigger: s.trigger || 'background',
        apiSource: s.apiSource || 'claude',
        apiBase: s.apiBase || '',
        apiKey: maskToken(s.apiKey),
        model: s.model || '',
      },
    };
  }

  // --- Content helpers ---

  function truncateForChannel(text, provider) {
    const limit = NOTIFY_CONTENT_LIMITS[provider] || 18000;
    if (text.length <= limit) return text;
    return text.slice(0, limit - 20) + '\n\n[内容已截断]';
  }

  // --- AI summary ---

  function getSummaryApiCredentials(summaryConfig) {
    const src = summaryConfig.apiSource || 'claude';
    if (src === 'claude') {
      const modelCfg = loadModelConfig();
      if (modelCfg.mode === 'custom' && modelCfg.activeTemplate) {
        const tpl = (modelCfg.templates || []).find(t => t.name === modelCfg.activeTemplate);
        if (tpl && tpl.apiKey && tpl.apiBase) {
          return { apiBase: tpl.apiBase, apiKey: tpl.apiKey, model: tpl.defaultModel || tpl.opusModel || '' };
        }
      }
      return null; // local mode — no API credentials available
    }
    if (src === 'codex') {
      const codexCfg = loadCodexConfig();
      if (codexCfg.mode === 'custom' && codexCfg.activeProfile) {
        const profile = (codexCfg.profiles || []).find(p => p.name === codexCfg.activeProfile);
        if (profile && profile.apiKey && profile.apiBase) {
          const resolvedModel = splitCodexModelSpec(summaryConfig.model || profile.model || DEFAULT_CODEX_MODEL).base || DEFAULT_CODEX_MODEL;
          return { apiBase: profile.apiBase, apiKey: profile.apiKey, model: resolvedModel };
        }
      }
      return null;
    }
    if (src === 'custom') {
      if (summaryConfig.apiBase && summaryConfig.apiKey) {
        return { apiBase: summaryConfig.apiBase, apiKey: summaryConfig.apiKey, model: summaryConfig.model || '' };
      }
      return null;
    }
    return null;
  }

  function callSummaryApi(creds, prompt) {
    return new Promise((resolve) => {
      try {
        const base = creds.apiBase.replace(/\/+$/, '');
        const url = new URL(base + '/v1/chat/completions');
        const mod = url.protocol === 'https:' ? require('https') : require('http');
        const model = creds.model || 'claude-opus-4-6';
        const body = JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        });
        const req = mod.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${creds.apiKey}`,
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 20000,
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const text = json.choices?.[0]?.message?.content || json.content?.[0]?.text || '';
              resolve({ ok: !!text, text: text.trim() });
            } catch {
              resolve({ ok: false, text: '' });
            }
          });
        });
        req.on('error', () => resolve({ ok: false, text: '' }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, text: '' }); });
        req.write(body);
        req.end();
      } catch {
        resolve({ ok: false, text: '' });
      }
    });
  }

  function buildSummaryPrompt(sessionTitle, lastUserMsg, fullText, isError, errorDesc) {
    const userSnip = (lastUserMsg || '').slice(0, 300);
    const outputSnip = (fullText || '').slice(0, 15000);
    const base = `会话：${sessionTitle}\n用户请求：${userSnip}\n\n以下是助手的输出内容：\n${outputSnip}`;
    if (isError) {
      return base + `\n\n错误信息：${(errorDesc || '').slice(0, 300)}\n\n` +
        `请用纯文本简要说明本次任务做了什么、遇到了什么问题。` +
        `要求：1. 不超过 200 字  2. 可以有序号和适当分段  3. 不要罗列具体代码、函数名、文件路径等细节  4. 不使用 markdown 格式（无星号、井号、横线等符号）`;
    }
    return base + `\n\n请用纯文本简要说明本次任务做了什么、结论是否成功。` +
      `要求：1. 不超过 200 字  2. 可以有序号和适当分段  3. 不要罗列具体代码、函数名、文件路径等细节  4. 不使用 markdown 格式（无星号、井号、横线等符号）`;
  }

  async function buildNotifyContent(entry, session, completionError, contextLimitExceeded) {
    const title = session?.title || 'Untitled';
    const agent = entry.agent || 'claude';
    const agentLabel = agent === 'codex' ? 'Codex' : 'Claude';
    const hasTools = (entry.toolCalls || []).length > 0;

    // Determine notify title
    let notifyTitle;
    if (contextLimitExceeded) {
      notifyTitle = `⚠ ${title} 上下文已压缩`;
    } else if (completionError) {
      notifyTitle = `✗ ${title} 任务异常`;
    } else if (hasTools) {
      notifyTitle = `✓ ${title} 任务完成`;
    } else {
      notifyTitle = `✓ ${title} 回复就绪`;
    }

    // Context limit: fixed message, no AI
    if (contextLimitExceeded) {
      return { title: notifyTitle, content: `${agentLabel} 会话上下文已达上限，已自动触发压缩。\n会话: ${title}` };
    }

    // Check if summary is enabled and applicable
    const notifyCfg = loadNotifyConfig();
    const summaryCfg = notifyCfg.summary || {};
    const summaryEnabled = !!summaryCfg.enabled;

    if (!summaryEnabled) {
      // Fallback: simple content
      const lines = [`会话: ${title}`];
      if (completionError) lines.push(`错误: ${completionError.slice(0, 200)}`);
      return { title: notifyTitle, content: lines.join('\n') };
    }

    const creds = getSummaryApiCredentials(summaryCfg);
    if (!creds) {
      // No credentials — fallback
      const lines = [`会话: ${title}`];
      if (completionError) lines.push(`错误: ${completionError.slice(0, 200)}`);
      return { title: notifyTitle, content: lines.join('\n') };
    }

    // Get last user message from session
    const messages = session?.messages || [];
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const lastUserMsg = typeof lastUser?.content === 'string' ? lastUser.content : '';

    const prompt = buildSummaryPrompt(title, lastUserMsg, entry.fullText || '', !!completionError, completionError || '');
    const result = await callSummaryApi(creds, prompt);

    let bodyText;
    if (result.ok && result.text) {
      bodyText = result.text;
    } else {
      // Fallback on API failure
      const lines = [`会话: ${title}`];
      if (completionError) lines.push(`错误: ${completionError.slice(0, 200)}`);
      if (!result.ok) lines.push('（摘要生成失败，以上为原始信息）');
      bodyText = lines.join('\n');
    }

    return { title: notifyTitle, content: bodyText };
  }

  // --- Send to provider ---

  function sendNotification(title, content) {
    const config = loadNotifyConfig();
    if (!config.provider || config.provider === 'off') return Promise.resolve({ ok: true, skipped: true });
    const https = require('https');
    const truncated = truncateForChannel(content, config.provider);

    return new Promise((resolve) => {
      let url, data;
      let isFormData = false;
      switch (config.provider) {
        case 'pushplus': {
          if (!config.pushplus?.token) return resolve({ ok: false, error: 'PushPlus token 未配置' });
          url = 'https://www.pushplus.plus/send';
          data = JSON.stringify({ token: config.pushplus.token, title, content: truncated, template: 'txt' });
          break;
        }
        case 'telegram': {
          if (!config.telegram?.botToken || !config.telegram?.chatId) return resolve({ ok: false, error: 'Telegram botToken 或 chatId 未配置' });
          url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
          data = JSON.stringify({ chat_id: config.telegram.chatId, text: `${title}\n\n${truncated}` });
          break;
        }
        case 'serverchan': {
          if (!config.serverchan?.sendKey) return resolve({ ok: false, error: 'Server酱 sendKey 未配置' });
          url = `https://sctapi.ftqq.com/${config.serverchan.sendKey}.send`;
          data = JSON.stringify({ title, desp: truncated });
          break;
        }
        case 'feishu': {
          if (!config.feishu?.webhook) return resolve({ ok: false, error: '飞书 Webhook 未配置' });
          url = config.feishu.webhook;
          data = JSON.stringify({ msg_type: 'text', content: { text: `${title}\n\n${truncated}` } });
          break;
        }
        case 'qqbot': {
          if (!config.qqbot?.qmsgKey) return resolve({ ok: false, error: 'Qmsg Key 未配置' });
          url = `https://qmsg.zendee.cn/send/${config.qqbot.qmsgKey}`;
          data = `msg=${encodeURIComponent(`${title}\n\n${truncated}`)}`;
          isFormData = true;
          break;
        }
        default:
          return resolve({ ok: false, error: `未知通知方式: ${config.provider}` });
      }

      const parsed = new URL(url);
      const contentType = isFormData ? 'application/x-www-form-urlencoded' : 'application/json';
      const reqOptions = {
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(data) },
      };
      const req = https.request(parsed, reqOptions, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          plog('INFO', 'notify_response', { provider: config.provider, status: res.statusCode, body: body.slice(0, 200) });
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: body.slice(0, 200) });
        });
      });
      req.on('error', (e) => {
        plog('WARN', 'notify_error', { provider: config.provider, error: e.message });
        resolve({ ok: false, error: e.message });
      });
      req.write(data);
      req.end();
    });
  }

  // --- WebSocket handlers ---

  function handleSaveNotifyConfig(ws, newConfig) {
    if (!newConfig || !newConfig.provider) {
      return wsSend(ws, { type: 'error', message: '无效的通知配置' });
    }
    const current = loadNotifyConfig();
    // Merge: only update fields that are not masked (contain ****)
    const merged = { provider: newConfig.provider };
    // pushplus
    merged.pushplus = { token: (newConfig.pushplus?.token && !newConfig.pushplus.token.includes('****')) ? newConfig.pushplus.token : current.pushplus?.token || '' };
    // telegram
    merged.telegram = {
      botToken: (newConfig.telegram?.botToken && !newConfig.telegram.botToken.includes('****')) ? newConfig.telegram.botToken : current.telegram?.botToken || '',
      chatId: newConfig.telegram?.chatId !== undefined ? newConfig.telegram.chatId : current.telegram?.chatId || '',
    };
    // serverchan
    merged.serverchan = { sendKey: (newConfig.serverchan?.sendKey && !newConfig.serverchan.sendKey.includes('****')) ? newConfig.serverchan.sendKey : current.serverchan?.sendKey || '' };
    // feishu
    merged.feishu = { webhook: (newConfig.feishu?.webhook && !newConfig.feishu.webhook.includes('****')) ? newConfig.feishu.webhook : current.feishu?.webhook || '' };
    // qqbot
    merged.qqbot = { qmsgKey: (newConfig.qqbot?.qmsgKey && !newConfig.qqbot.qmsgKey.includes('****')) ? newConfig.qqbot.qmsgKey : current.qqbot?.qmsgKey || '' };
    // summary
    const ns = newConfig.summary || {};
    const cs = current.summary || {};
    merged.summary = {
      enabled: !!ns.enabled,
      trigger: ['background', 'always'].includes(ns.trigger) ? ns.trigger : (cs.trigger || 'background'),
      apiSource: ['claude', 'codex', 'custom'].includes(ns.apiSource) ? ns.apiSource : (cs.apiSource || 'claude'),
      apiBase: ns.apiBase !== undefined ? ns.apiBase : (cs.apiBase || ''),
      apiKey: (ns.apiKey && !ns.apiKey.includes('****')) ? ns.apiKey : (cs.apiKey || ''),
      model: ns.model !== undefined ? ns.model : (cs.model || ''),
    };

    saveNotifyConfig(merged);
    plog('INFO', 'notify_config_saved', { provider: merged.provider });
    wsSend(ws, { type: 'notify_config', config: getNotifyConfigMasked() });
    wsSend(ws, { type: 'system_message', message: '通知配置已保存' });
  }

  function handleTestNotify(ws) {
    const config = loadNotifyConfig();
    if (!config.provider || config.provider === 'off') {
      return wsSend(ws, { type: 'notify_test_result', success: false, message: '通知已关闭，无法测试' });
    }
    sendNotification('CC-Web 测试通知', '这是一条测试消息，如果你收到了说明通知配置正确！').then((result) => {
      wsSend(ws, { type: 'notify_test_result', success: result.ok, message: result.ok ? '测试消息已发送，请检查是否收到' : `发送失败: ${result.error || result.body || '未知错误'}` });
    });
  }

  // --- Initialization ---

  // Load config on startup (ensures migration)
  loadNotifyConfig();

  // --- Public API ---

  return {
    loadNotifyConfig,
    saveNotifyConfig,
    getNotifyConfigMasked,
    sendNotification,
    buildNotifyContent,
    handleSaveNotifyConfig,
    handleTestNotify,
  };
}

module.exports = { createNotifier };

#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const WebSocket = require('ws');

const REPO_DIR = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(REPO_DIR, 'server.js');
const MOCK_CLAUDE = path.join(REPO_DIR, 'scripts', 'mock-claude.js');
const MOCK_CODEX = path.join(REPO_DIR, 'scripts', 'mock-codex.js');
const MOCK_GEMINI = path.join(REPO_DIR, 'scripts', 'mock-gemini.js');
const COMMAND_MANIFEST = require('../shared/commands.json');
const HAS_SQLITE3 = (() => {
  try {
    return spawnSync('sqlite3', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch { return false; }
})();

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      server.close(() => resolve(port));
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sql(dbPath, statement) {
  if (!HAS_SQLITE3) throw new Error('sqlite3 is not available');
  const result = spawnSync('sqlite3', [dbPath, statement], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `sqlite3 failed: ${statement}`);
  return result.stdout.trim();
}

async function waitForPort(port, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(250, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for port ${port}`);
}

async function waitForFile(filePath, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
}

async function withServer(env, fn) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: REPO_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForPort(env.PORT, 10000);
    await fn({ child, stdout: () => stdout, stderr: () => stderr });
  } finally {
    child.kill('SIGTERM');
    await sleep(300);
    if (!child.killed) child.kill('SIGKILL');
  }
}

async function startMockHermesServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', platform: 'hermes-agent' }));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/responses') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    req.resume();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Hermes-Session-Id': 'hermes-session-regression',
    });
    const writeEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const responseId = 'resp_regression_hermes';
    writeEvent('response.created', { type: 'response.created', response: { id: responseId } });
    writeEvent('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        id: 'fc_regression',
        type: 'function_call',
        status: 'in_progress',
        name: 'terminal',
        call_id: 'call_regression',
        arguments: JSON.stringify({ command: 'echo hermes' }),
      },
    });
    writeEvent('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        id: 'fc_regression',
        type: 'function_call',
        status: 'completed',
        name: 'terminal',
        call_id: 'call_regression',
        arguments: JSON.stringify({ command: 'echo hermes' }),
      },
    });
    writeEvent('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: 1,
      item: {
        id: 'fco_regression',
        type: 'function_call_output',
        call_id: 'call_regression',
        output: [{ type: 'input_text', text: 'hermes tool output' }],
        status: 'completed',
      },
    });
    writeEvent('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: 1,
      item: {
        id: 'fco_regression',
        type: 'function_call_output',
        call_id: 'call_regression',
        output: [{ type: 'input_text', text: 'hermes tool output' }],
        status: 'completed',
      },
    });
    writeEvent('response.output_text.delta', {
      type: 'response.output_text.delta',
      delta: 'Hermes answer',
    });
    writeEvent('response.completed', {
      type: 'response.completed',
      response: {
        id: responseId,
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hermes answer' }],
          },
        ],
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      },
    });
    res.end();
  });
  const port = await getFreePort();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function connectWs(port, password) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages = [];

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', password }));
    });
    ws.on('message', (buf) => {
      const msg = JSON.parse(String(buf));
      messages.push(msg);
      if (msg.type === 'auth_result' && msg.success) {
        messages.pop();
        resolve({ ws, messages, token: msg.token });
      }
      if (msg.type === 'auth_result' && !msg.success) reject(new Error('Auth failed'));
    });
    ws.on('error', reject);
  });
}

function attemptWsAuth(port, authPayload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('Timed out waiting for auth_result'));
    }, timeoutMs);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', ...authPayload }));
    });
    ws.on('message', (buf) => {
      const msg = JSON.parse(String(buf));
      if (msg.type !== 'auth_result') return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(msg);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function uploadAttachment(port, token, { filename, mime, data }) {
  const response = await fetch(`http://127.0.0.1:${port}/api/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mime,
      'X-Filename': encodeURIComponent(filename),
    },
    body: data,
  });
  const payload = await response.json();
  assert(response.ok && payload.ok, `Attachment upload failed: ${payload.message || response.status}`);
  return payload.attachment;
}

function nextMessage(messages, ws, predicate, timeoutMs = 15000) {
  const callSite = (() => {
    const stack = String(new Error().stack || '').split('\n');
    return (stack[3] || stack[2] || '').trim();
  })();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const idx = messages.findIndex(predicate);
      if (idx !== -1) {
        clearInterval(timer);
        const found = messages.splice(idx, 1)[0];
        resolve(found);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        const recentTypes = messages.slice(-12).map((m) => m?.type).join(', ');
        const pendingTypes = messages.slice(0, 12).map((m) => m?.type).join(', ');
        reject(new Error(`Timed out waiting for expected WebSocket message (wsState=${ws.readyState}, callSite=${callSite}, pendingTypes=[${pendingTypes}], recentTypes=[${recentTypes}])`));
      }
    }, 50);
  });
}

function discardMessages(messages, predicate) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (predicate(messages[i])) messages.splice(i, 1);
  }
}

function createFakeClaudeHistory(homeDir) {
  const projectDir = path.join(homeDir, '.claude', 'projects', 'tmp-project');
  mkdirp(projectDir);
  const sessionId = 'claude-import-test';
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: 'user',
      cwd: '/tmp/project-a',
      timestamp: '2026-03-12T00:00:00.000Z',
      message: { content: 'Claude import prompt' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-12T00:00:02.000Z',
      message: { content: [{ type: 'text', text: 'Claude import answer' }] },
    }),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
  return { sessionId, projectDir: 'tmp-project', filePath };
}

function createFakeCodexHistory(homeDir) {
  const codexHome = path.join(homeDir, '.codex');
  const sessionsDir = path.join(codexHome, 'sessions', '2026', '03', '12');
  mkdirp(sessionsDir);

  // Create heavy directories that should be skipped during cold-start copy.
  for (const skipDir of ['plugins', 'marketplace', 'memories', '.tmp']) {
    const dir = path.join(codexHome, skipDir);
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, 'dummy.jsonl'), JSON.stringify({ skip: true }) + '\n');
  }
  const threadId = 'codex-import-thread';
  const rolloutPath = path.join(sessionsDir, 'rollout-2026-03-12T00-00-00-codex-import-thread.jsonl');
  const rolloutLines = [
    JSON.stringify({
      timestamp: '2026-03-12T00:00:00.000Z',
      type: 'session_meta',
      payload: { id: threadId, cwd: '/tmp/project-b', cli_version: '0.114.0', source: 'exec' },
    }),
    JSON.stringify({
      timestamp: '2026-03-12T00:00:00.100Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '# AGENTS.md wrapper should be ignored' }],
      },
    }),
    JSON.stringify({
      timestamp: '2026-03-12T00:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Codex import prompt' },
    }),
    JSON.stringify({
      timestamp: '2026-03-12T00:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Codex import answer' }],
      },
    }),
    JSON.stringify({
      timestamp: '2026-03-12T00:00:03.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 8 } },
      },
    }),
  ];
  fs.writeFileSync(rolloutPath, `${rolloutLines.join('\n')}\n`);

  const stateDb = path.join(homeDir, '.codex', 'state_5.sqlite');
  mkdirp(path.dirname(stateDb));
  if (HAS_SQLITE3) {
    sql(stateDb, `
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        sandbox_policy TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        has_user_event INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        git_sha TEXT,
        git_branch TEXT,
        git_origin_url TEXT,
        cli_version TEXT NOT NULL DEFAULT '',
        first_user_message TEXT NOT NULL DEFAULT '',
        agent_nickname TEXT,
        agent_role TEXT,
        memory_mode TEXT NOT NULL DEFAULT 'enabled'
      );
      CREATE TABLE IF NOT EXISTS stage1_outputs (
        thread_id TEXT PRIMARY KEY,
        source_updated_at INTEGER NOT NULL,
        raw_memory TEXT NOT NULL,
        rollout_summary TEXT NOT NULL,
        generated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thread_dynamic_tools (
        thread_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        input_schema TEXT NOT NULL,
        PRIMARY KEY(thread_id, position)
      );
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        ts_nanos INTEGER NOT NULL,
        level TEXT NOT NULL,
        target TEXT NOT NULL,
        message TEXT,
        module_path TEXT,
        file TEXT,
        line INTEGER,
        thread_id TEXT,
        process_uuid TEXT,
        estimated_bytes INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, cli_version)
      VALUES ('${threadId}', '${rolloutPath.replace(/'/g, "''")}', 1, 2, 'exec', 'OpenAI', '/tmp/project-b', 'Codex import prompt', '{}', 'never', '0.114.0');
      INSERT INTO logs (ts, ts_nanos, level, target, thread_id) VALUES (1, 0, 'INFO', 'test', '${threadId}');
    `);
  }

  const logsDb = path.join(homeDir, '.codex', 'logs_1.sqlite');
  if (HAS_SQLITE3) {
    sql(logsDb, `
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        ts_nanos INTEGER NOT NULL,
        level TEXT NOT NULL,
        target TEXT NOT NULL,
        message TEXT,
        module_path TEXT,
        file TEXT,
        line INTEGER,
        thread_id TEXT,
        process_uuid TEXT,
        estimated_bytes INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO logs (ts, ts_nanos, level, target, thread_id) VALUES (1, 0, 'INFO', 'test', '${threadId}');
    `);
  }

  return { threadId, rolloutPath, stateDb, logsDb };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-web-regression-'));
  const configDir = path.join(tempRoot, 'config');
  const sessionsDir = path.join(tempRoot, 'sessions');
  const logsDir = path.join(tempRoot, 'logs');
  const homeDir = path.join(tempRoot, 'home');
  mkdirp(configDir);
  mkdirp(sessionsDir);
  mkdirp(logsDir);
  mkdirp(homeDir);

  fs.writeFileSync(path.join(configDir, 'notify.json'), JSON.stringify({
    provider: 'off',
    pushplus: { token: '' },
    telegram: { botToken: '', chatId: '' },
    serverchan: { sendKey: '' },
    feishu: { webhook: '' },
    qqbot: { qmsgKey: '' },
  }, null, 2));

  createFakeClaudeHistory(homeDir);
  const codexFixture = createFakeCodexHistory(homeDir);

  const port = await getFreePort();
  const password = 'Regression!234';
  const hermesMock = await startMockHermesServer();

  try {
    await withServer({
      PORT: String(port),
      CC_WEB_PASSWORD: password,
      CC_WEB_CONFIG_DIR: configDir,
      CC_WEB_SESSIONS_DIR: sessionsDir,
      CC_WEB_LOGS_DIR: logsDir,
      CC_WEB_HERMES_API_BASE: hermesMock.baseUrl,
      HOME: homeDir,
      CLAUDE_PATH: MOCK_CLAUDE,
      CODEX_PATH: MOCK_CODEX,
      GEMINI_PATH: MOCK_GEMINI,
    }, async ({ stderr }) => {
    const commandResponse = await fetch(`http://127.0.0.1:${port}/api/commands`);
    assert(commandResponse.ok, '/api/commands should be reachable');
    const commandPayload = await commandResponse.json();
    const commandNames = new Set((commandPayload.commands || []).map((command) => command.cmd));
    for (const command of ['/status', '/usage', '/permissions', '/mcp', '/login', '/ssh']) {
      assert(commandNames.has(command), `command manifest should expose ${command}`);
    }
    assert(commandPayload.commands.length === COMMAND_MANIFEST.length, 'server command payload should match shared command manifest length');
    const appSource = fs.readFileSync(path.join(REPO_DIR, 'public', 'app.js'), 'utf8');
    const indexSource = fs.readFileSync(path.join(REPO_DIR, 'public', 'index.html'), 'utf8');
    const settingsSource = fs.readFileSync(path.join(REPO_DIR, 'public', 'js', 'settings.js'), 'utf8');
    const styleSource = fs.readFileSync(path.join(REPO_DIR, 'public', 'style.css'), 'utf8');
    const markdownSource = fs.readFileSync(path.join(REPO_DIR, 'public', 'js', 'markdown.js'), 'utf8');
    assert(/renderer\.html\s*=/.test(appSource + markdownSource) && /safeMarkdownUrl/.test(appSource + markdownSource), 'frontend markdown renderer should block raw HTML and unsafe URLs');
    assert(!/\.login-box\s+button\s*\{[^}]*width:\s*100%/s.test(styleSource), 'login box must not apply full-width button styles to every nested button');
    assert(/class="[^"]*\blogin-submit-btn\b[^"]*"/.test(indexSource), 'login submit button should have an explicit component class');
    assert(!/<div class="login-logo">CC<\/div>/.test(indexSource + settingsSource), 'login logo should use Agent-Web branding');
    assert(/\.login-pw-wrapper\s+\.pw-toggle-btn\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/s.test(styleSource), 'password toggle should have a fixed tap target and not cover the password input');
    for (const domName of ['sidebar', 'newChatBtn', 'importSessionBtn', 'chatMain', 'sessionLoadingOverlay', 'sessionLoadingLabel', 'attachmentTray', 'inputWrapper']) {
      assert(new RegExp(`const\\s+${domName}\\s*=\\s*\\$\\(`).test(appSource), `frontend should bind ${domName} for modular UI code`);
      assert(new RegExp(`\\b${domName}\\b[\\s,]`).test(appSource.slice(appSource.indexOf('CCWeb.dom = {'))), `CCWeb.dom should expose ${domName}`);
    }

    const badAuth = await attemptWsAuth(port, { password: 'wrong-password' });
    assert(badAuth.success === false && badAuth.banned === false, 'wrong password should return auth_result without crashing the server');
    const healthAfterBadAuth = await fetch(`http://127.0.0.1:${port}/api/commands`);
    assert(healthAfterBadAuth.ok, 'server should stay alive after failed WebSocket auth');

    const { ws, messages, token } = await connectWs(port, password);

    await nextMessage(messages, ws, (msg) => msg.type === 'session_list');

    ws.send(JSON.stringify({ type: 'new_session', agent: 'hermes', mode: 'yolo' }));
    const hermesSession = await nextMessage(messages, ws, (msg) => msg.type === 'session_info' && msg.agent === 'hermes');
    assert(hermesSession.cwd === null, 'Hermes new_session should not require a workspace cwd');
    assert(hermesSession.model === 'Hermes', 'Hermes new_session should expose a Hermes model label');

    ws.send(JSON.stringify({ type: 'message', text: 'trigger hermes tool', sessionId: hermesSession.sessionId, mode: 'yolo', agent: 'hermes' }));
    const hermesToolStart = await nextMessage(messages, ws, (msg) => msg.type === 'tool_start' && msg.toolUseId === 'call_regression');
    assert(hermesToolStart.name === 'terminal', 'Hermes tool_start should expose function name');
    const hermesToolEnd = await nextMessage(messages, ws, (msg) => msg.type === 'tool_end' && msg.toolUseId === 'call_regression');
    assert(/hermes tool output/.test(hermesToolEnd.result || ''), 'Hermes tool_end should expose function output');
    const hermesText = await nextMessage(messages, ws, (msg) => msg.type === 'text_delta' && /Hermes answer/.test(msg.text || ''));
    assert(/Hermes answer/.test(hermesText.text || ''), 'Hermes text delta should stream assistant output');
    await nextMessage(messages, ws, (msg) => msg.type === 'usage' && msg.totalUsage?.inputTokens === 11);
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === hermesSession.sessionId);
    const storedHermes = JSON.parse(fs.readFileSync(path.join(sessionsDir, `${hermesSession.sessionId}.json`), 'utf8'));
    assert(storedHermes.hermesResponseId === 'resp_regression_hermes', 'Hermes response id should be persisted');
    assert(storedHermes.hermesConversationId === `cc-web:${hermesSession.sessionId}`, 'Hermes conversation id should be stable per cc-web session');
    assert(storedHermes.hermesSessionId === 'hermes-session-regression', 'Hermes native session id should be captured from response headers');
    assert(storedHermes.messages.some((m) => m.role === 'assistant' && /Hermes answer/.test(m.content || '') && m.toolCalls?.length === 1), 'Hermes assistant message should persist tool calls');

    const hermesAttachment = await uploadAttachment(port, token, {
      filename: 'hermes-test.png',
      mime: 'image/png',
      data: Buffer.from('hermes-image'),
    });
    ws.send(JSON.stringify({ type: 'message', text: 'image to hermes', attachments: [hermesAttachment], sessionId: hermesSession.sessionId, mode: 'yolo', agent: 'hermes' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'error' && /Hermes 会话暂不支持图片附件/.test(msg.message || ''));

    const geminiCwd = path.join(tempRoot, 'gemini-space');
    mkdirp(geminiCwd);
    ws.send(JSON.stringify({ type: 'new_session', agent: 'gemini', cwd: geminiCwd, mode: 'default' }));
    const geminiSession = await nextMessage(messages, ws, (msg) => msg.type === 'session_info' && msg.agent === 'gemini');
    assert(geminiSession.mode === 'plan', 'Gemini new_session should coerce default mode to plan for web/mobile approval safety');

    ws.send(JSON.stringify({ type: 'message', text: 'gemini tool prompt', sessionId: geminiSession.sessionId, mode: 'yolo', agent: 'gemini' }));
    const geminiToolStart = await nextMessage(messages, ws, (msg) => msg.type === 'tool_start' && msg.toolUseId === 'gemini_tool_regression');
    assert(geminiToolStart.kind === 'command_execution', 'Gemini shell tool should map to command_execution');
    const geminiToolEnd = await nextMessage(messages, ws, (msg) => msg.type === 'tool_end' && msg.toolUseId === 'gemini_tool_regression');
    assert(/gemini tool output/.test(geminiToolEnd.result || ''), 'Gemini tool result should be surfaced');
    await nextMessage(messages, ws, (msg) => msg.type === 'text_delta' && /Gemini mock handled/.test(msg.text || ''));
    await nextMessage(messages, ws, (msg) => msg.type === 'usage' && msg.totalUsage?.inputTokens === 12);
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === geminiSession.sessionId);
    const storedGemini = JSON.parse(fs.readFileSync(path.join(sessionsDir, `${geminiSession.sessionId}.json`), 'utf8'));
    assert(storedGemini.geminiSessionId, 'Gemini native session id should be captured from init event');

    ws.send(JSON.stringify({ type: 'message', text: 'gemini fail filtered stderr', sessionId: geminiSession.sessionId, mode: 'yolo', agent: 'gemini' }));
    const geminiFailure = await nextMessage(messages, ws, (msg) => msg.type === 'error' && /Gemini 任务/.test(msg.message || ''));
    assert(!/256-color|YOLO mode is enabled/.test(geminiFailure.message || ''), 'Gemini benign stderr warnings should not become user-facing errors');
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === geminiSession.sessionId);

    ws.send(JSON.stringify({
      type: 'save_codex_config',
      config: {
        mode: 'custom',
        activeProfile: 'Regression Profile',
        profiles: [{
          name: 'Regression Profile',
          apiKey: 'sk-regression',
          apiBase: 'https://example.com/v1',
          model: 'gpt-5.5',
          models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex'],
        }],
        enableSearch: true,
      },
    }));
    const codexConfigMsg = await nextMessage(messages, ws, (msg) => msg.type === 'codex_config');
    assert(codexConfigMsg.config.mode === 'custom', 'Codex config mode save/load failed');
    assert(codexConfigMsg.config.activeProfile === 'Regression Profile', 'Codex active profile save/load failed');
    assert(Array.isArray(codexConfigMsg.config.profiles) && codexConfigMsg.config.profiles[0]?.apiKey.includes('****'), 'Codex profile API key should be masked');
    assert(codexConfigMsg.config.profiles[0]?.model === 'gpt-5.5', 'Codex profile model save/load failed');
    assert(Array.isArray(codexConfigMsg.config.profiles[0]?.models) && codexConfigMsg.config.profiles[0].models.length === 3, 'Codex profile model list save/load failed');
    assert(codexConfigMsg.config.supportsSearch === false, 'Codex config should expose unsupported search capability');
    assert(codexConfigMsg.config.enableSearch === false, 'Codex config should ignore unsupported search toggle');

    const codexInitCwd = path.join(tempRoot, 'codex-space');
    mkdirp(codexInitCwd);
    ws.send(JSON.stringify({ type: 'new_session', agent: 'codex', cwd: codexInitCwd, mode: 'plan' }));
    const codexSession = await nextMessage(messages, ws, (msg) => msg.type === 'session_info' && msg.agent === 'codex' && msg.cwd === codexInitCwd);
    assert(codexSession.mode === 'plan', 'Codex new_session should follow requested mode');
    assert(codexSession.model === 'gpt-5.5', 'Codex new_session should inject configured profile model');

    ws.send(JSON.stringify({ type: 'message', text: '/init', sessionId: codexSession.sessionId, mode: 'plan', agent: 'codex' }));
    const codexInitStart = await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /AGENTS\.md/.test(msg.message || ''));
    assert(/AGENTS\.md/.test(codexInitStart.message || ''), 'Codex /init should announce AGENTS.md generation');
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === codexSession.sessionId);
    assert(fs.existsSync(path.join(codexInitCwd, 'AGENTS.md')), 'Codex /init should generate AGENTS.md in the workspace');

    ws.send(JSON.stringify({ type: 'message', text: '/model gpt-5.3-codex', sessionId: codexSession.sessionId, mode: 'plan', agent: 'codex' }));
    const codexModelChanged = await nextMessage(messages, ws, (msg) => msg.type === 'model_changed' && msg.model === 'gpt-5.3-codex');
    assert(codexModelChanged.model === 'gpt-5.3-codex', 'Codex /model should accept arbitrary Codex model names');

    ws.send(JSON.stringify({ type: 'message', text: '/status', sessionId: codexSession.sessionId, mode: 'plan', agent: 'codex' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /Agent: Codex/.test(msg.message || '') && /状态: 空闲/.test(msg.message || ''));

    ws.send(JSON.stringify({ type: 'message', text: '/usage', sessionId: codexSession.sessionId, mode: 'plan', agent: 'codex' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /当前会话累计 Token/.test(msg.message || ''));

    ws.send(JSON.stringify({ type: 'message', text: '/permissions yolo', sessionId: codexSession.sessionId, mode: 'plan', agent: 'codex' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'mode_changed' && msg.mode === 'yolo');

    ws.send(JSON.stringify({ type: 'message', text: '/resume', sessionId: codexSession.sessionId, mode: 'yolo', agent: 'codex' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /自动 resume|尚未建立原生会话/.test(msg.message || ''));

    ws.send(JSON.stringify({ type: 'message', text: '/mcp', sessionId: codexSession.sessionId, mode: 'yolo', agent: 'codex' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /codex mcp/.test(msg.message || '') && !/未知指令/.test(msg.message || ''));

    ws.send(JSON.stringify({ type: 'message', text: '/login', sessionId: codexSession.sessionId, mode: 'yolo', agent: 'codex' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /codex login/.test(msg.message || '') && !/未知指令/.test(msg.message || ''));

    const codexAttachment = await uploadAttachment(port, token, {
      filename: 'codex-test.png',
      mime: 'image/png',
      data: Buffer.from('codex-image'),
    });
    ws.send(JSON.stringify({ type: 'message', text: 'first codex prompt', attachments: [codexAttachment], mode: 'yolo', agent: 'codex' }));
    const firstMessageSession = await nextMessage(messages, ws, (msg) => msg.type === 'session_info' && msg.agent === 'codex' && msg.title === 'first codex prompt');
    assert(firstMessageSession.agent === 'codex', 'First-message path created wrong agent');
    const runningSessionList = await nextMessage(messages, ws, (msg) => msg.type === 'session_list' && msg.sessions.some((s) => s.id === firstMessageSession.sessionId && s.isRunning));
    assert(runningSessionList.sessions.some((s) => s.id === firstMessageSession.sessionId && s.isRunning), 'Running Codex session should be marked as isRunning');
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === firstMessageSession.sessionId);
    const codexRuntimeConfig = fs.readFileSync(path.join(configDir, 'codex-session-home', firstMessageSession.sessionId, 'config.toml'), 'utf8');
    assert(!/\[plugins\.|\[marketplaces\.|memories\s*=/.test(codexRuntimeConfig), 'Codex local runtime config should not copy plugin or memory bootstrap settings');

    // Cold-start optimization: heavy global directories must NOT be copied into session home.
    const sessionHomeDir = path.join(configDir, 'codex-session-home', firstMessageSession.sessionId);
    for (const skipDir of ['plugins', 'marketplace', 'memories', '.tmp']) {
      assert(!fs.existsSync(path.join(sessionHomeDir, skipDir)), `Codex session home should not contain "${skipDir}" directory (cold-start regression)`);
    }

    // Switching permission mode must not clear Codex thread id (otherwise resume loses context).
    const codexSessionPath = path.join(sessionsDir, `${firstMessageSession.sessionId}.json`);
    await waitForFile(codexSessionPath, 15000);
    const storedAfterFirst = JSON.parse(fs.readFileSync(codexSessionPath, 'utf8'));
    const threadIdBeforeMode = storedAfterFirst.codexThreadId;
    assert(threadIdBeforeMode, 'Codex thread id should be persisted after first run');

    ws.send(JSON.stringify({ type: 'set_mode', sessionId: firstMessageSession.sessionId, mode: 'plan' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'mode_changed' && msg.mode === 'plan');
    await waitForFile(codexSessionPath, 15000);
    const storedAfterMode = JSON.parse(fs.readFileSync(codexSessionPath, 'utf8'));
    assert(storedAfterMode.codexThreadId === threadIdBeforeMode, 'Codex thread id should survive mode switch');

    ws.send(JSON.stringify({ type: 'message', text: 'second codex prompt', sessionId: firstMessageSession.sessionId, mode: 'plan', agent: 'codex' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === firstMessageSession.sessionId);

    const processLog = fs.readFileSync(path.join(logsDir, 'process.log'), 'utf8');
    const spawnLine = processLog
      .trim()
      .split('\n')
      .find((line) => line.includes(`"event":"process_spawn"`) && line.includes(firstMessageSession.sessionId.slice(0, 8)));
    assert(spawnLine && !spawnLine.includes('--search') && spawnLine.includes('--image'), 'Codex exec should attach images and not append unsupported --search flag');

	    const allSpawnsForSession = processLog
	      .trim()
	      .split('\n')
	      .filter((line) => line.includes(`"event":"process_spawn"`) && line.includes(firstMessageSession.sessionId.slice(0, 8)));
	    const lastSpawn = allSpawnsForSession[allSpawnsForSession.length - 1] || '';
	    assert(lastSpawn.includes('resume') && lastSpawn.includes(threadIdBeforeMode), 'Codex mode switch should keep resume thread id');
	    assert(lastSpawn.includes('-s read-only'), 'Codex plan mode should set sandbox read-only');
	    assert(lastSpawn.includes('-s read-only resume'), 'Codex resume in plan mode must place -s before resume subcommand');

    ws.send(JSON.stringify({
      type: 'save_codex_config',
      config: {
        mode: 'custom',
        activeProfile: 'Regression Profile 2',
        profiles: [{
          name: 'Regression Profile 2',
          apiKey: 'sk-regression-2',
          apiBase: 'https://example.org/v1',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
        }],
      },
    }));
    await nextMessage(messages, ws, (msg) => msg.type === 'codex_config' && msg.config.activeProfile === 'Regression Profile 2');
    const storedAfterProfileSwitch = JSON.parse(fs.readFileSync(codexSessionPath, 'utf8'));
    assert(storedAfterProfileSwitch.codexThreadId === threadIdBeforeMode, 'Codex profile switch should not clear thread id');
    assert(storedAfterProfileSwitch.model === 'gpt-5.4', 'Codex profile switch should update existing session model');

    ws.send(JSON.stringify({ type: 'message', text: 'third codex prompt', sessionId: firstMessageSession.sessionId, mode: 'plan', agent: 'codex' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === firstMessageSession.sessionId);
    const processLogAfterProfileSwitch = fs.readFileSync(path.join(logsDir, 'process.log'), 'utf8');
    const profileSwitchSpawn = processLogAfterProfileSwitch
      .trim()
      .split('\n')
      .filter((line) => line.includes(`"event":"process_spawn"`) && line.includes(firstMessageSession.sessionId.slice(0, 8)))
      .pop() || '';
    assert(profileSwitchSpawn.includes('resume') && profileSwitchSpawn.includes(threadIdBeforeMode), 'Codex profile switch should keep resume context');
    assert(profileSwitchSpawn.includes('--model gpt-5.4'), 'Codex profile switch should run with new profile model');

    const runtimeToml = fs.readFileSync(path.join(configDir, 'codex-session-home', firstMessageSession.sessionId, 'config.toml'), 'utf8');
    assert(runtimeToml.includes('preferred_auth_method = "apikey"'), 'Codex custom profile should write isolated runtime auth mode');
    assert(runtimeToml.includes('base_url = "https://example.org/v1"'), 'Codex custom profile should write isolated runtime base_url');
    assert(runtimeToml.includes('model = "gpt-5.4"'), 'Codex custom profile should write isolated runtime model');

    ws.send(JSON.stringify({ type: 'message', text: '/compact', sessionId: firstMessageSession.sessionId, mode: 'yolo', agent: 'codex' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /正在执行/.test(msg.message || '') && /Codex \/compact/.test(msg.message || ''));
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === firstMessageSession.sessionId);
    const compactDoneMsg = await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /已执行 Codex \/compact/.test(msg.message || ''));
    assert(/已执行 Codex \/compact/.test(compactDoneMsg.message || ''), 'Codex /compact should complete with Codex-specific status message');

    const autoCompactCwd = path.join(tempRoot, 'codex-auto-compact');
    mkdirp(autoCompactCwd);
    ws.send(JSON.stringify({ type: 'new_session', agent: 'codex', cwd: autoCompactCwd, mode: 'yolo' }));
    const autoCompactSession = await nextMessage(messages, ws, (msg) => msg.type === 'session_info' && msg.agent === 'codex' && msg.cwd === autoCompactCwd);
    ws.send(JSON.stringify({ type: 'message', text: 'warm up auto compact', sessionId: autoCompactSession.sessionId, mode: 'yolo', agent: 'codex' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === autoCompactSession.sessionId);
    ws.send(JSON.stringify({ type: 'message', text: 'trigger codex context limit', sessionId: autoCompactSession.sessionId, mode: 'yolo', agent: 'codex' }));
    const autoCompactStart = await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /正在按 Codex \/compact 自动压缩/.test(msg.message || ''));
    assert(/Codex \/compact/.test(autoCompactStart.message || ''), 'Codex auto /compact should announce auto compact start');
    const autoCompactDone = await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /已执行 Codex \/compact/.test(msg.message || ''));
    assert(/已执行 Codex \/compact/.test(autoCompactDone.message || ''), 'Codex auto /compact should finish compact step');
	    const autoCompactResume = await nextMessage(messages, ws, (msg) => msg.type === 'system_message' && /按 Codex 压缩计划继续执行/.test(msg.message || ''));
	    assert(/继续执行/.test(autoCompactResume.message || ''), 'Codex auto /compact should announce retry');
	    // Some Codex builds won't echo the original prompt text as a text delta on retry; accept either.
	    const autoCompactRetry = await nextMessage(messages, ws, (msg) => (
	      (msg.type === 'text_delta' && /trigger codex context limit/.test(msg.text || '')) ||
	      (msg.type === 'done' && msg.sessionId === autoCompactSession.sessionId)
	    ), 20000);
	    if (autoCompactRetry.type === 'text_delta') {
	      assert(/trigger codex context limit/.test(autoCompactRetry.text || ''), 'Codex auto /compact should replay the failed prompt after compact');
	    }

    const claudeAttachment = await uploadAttachment(port, token, {
      filename: 'claude-test.png',
      mime: 'image/png',
      data: Buffer.from('claude-image'),
    });
    ws.send(JSON.stringify({ type: 'message', text: 'describe attachment', attachments: [claudeAttachment], mode: 'yolo', agent: 'claude' }));
    const claudeImageSession = await nextMessage(messages, ws, (msg) => msg.type === 'session_info' && msg.agent === 'claude' && msg.title === 'describe attachment');
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === claudeImageSession.sessionId);
    const claudeSpawnLine = fs.readFileSync(path.join(logsDir, 'process.log'), 'utf8')
      .trim()
      .split('\n')
      .find((line) => line.includes(`"event":"process_spawn"`) && line.includes(claudeImageSession.sessionId.slice(0, 8)));
    assert(claudeSpawnLine && claudeSpawnLine.includes('--input-format stream-json'), 'Claude image message should switch stdin to stream-json');
    const storedClaudeSession = JSON.parse(fs.readFileSync(path.join(sessionsDir, `${claudeImageSession.sessionId}.json`), 'utf8'));
    assert(Array.isArray(storedClaudeSession.messages?.[0]?.attachments) && storedClaudeSession.messages[0].attachments.length === 1, 'Claude message should persist attachment metadata');
    assert(storedClaudeSession.claudeSessionId, 'Claude session id should be persisted after first run');
    const claudeSessionIdBeforeMode = storedClaudeSession.claudeSessionId;

    // Mode switching must not clear Claude runtime session id (resume should keep context).
    ws.send(JSON.stringify({ type: 'set_mode', sessionId: claudeImageSession.sessionId, mode: 'plan' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'mode_changed' && msg.mode === 'plan');
    const storedClaudeAfterMode = JSON.parse(fs.readFileSync(path.join(sessionsDir, `${claudeImageSession.sessionId}.json`), 'utf8'));
    assert(storedClaudeAfterMode.claudeSessionId === claudeSessionIdBeforeMode, 'Claude session id should survive mode switch');

    ws.send(JSON.stringify({ type: 'message', text: 'second claude prompt', sessionId: claudeImageSession.sessionId, mode: 'plan', agent: 'claude' }));
    await nextMessage(messages, ws, (msg) => msg.type === 'done' && msg.sessionId === claudeImageSession.sessionId);
    const claudeSpawns = fs.readFileSync(path.join(logsDir, 'process.log'), 'utf8')
      .trim()
      .split('\n')
      .filter((line) => line.includes(`"event":"process_spawn"`) && line.includes(claudeImageSession.sessionId.slice(0, 8)));
    const lastClaudeSpawn = claudeSpawns[claudeSpawns.length - 1] || '';
    assert(lastClaudeSpawn.includes(`--resume ${claudeSessionIdBeforeMode}`), 'Claude mode switch should keep --resume session id');
    assert(lastClaudeSpawn.includes('--permission-mode plan'), 'Claude plan mode should set --permission-mode plan');

    ws.send(JSON.stringify({ type: 'list_native_sessions' }));
    const nativeSessions = await nextMessage(messages, ws, (msg) => msg.type === 'native_sessions');
    assert(nativeSessions.groups?.length > 0, 'Claude native session listing failed');
    const firstClaude = nativeSessions.groups[0].sessions[0];
    ws.send(JSON.stringify({ type: 'import_native_session', sessionId: firstClaude.sessionId, projectDir: nativeSessions.groups[0].dir }));
    const importedClaude = await nextMessage(messages, ws, (msg) => msg.type === 'session_info' && msg.agent === 'claude' && msg.title === 'Claude import prompt');
    assert(importedClaude.messages?.[0]?.content === 'Claude import prompt', 'Claude import parsed wrong first message');

    ws.send(JSON.stringify({ type: 'list_codex_sessions' }));
    const codexSessions = await nextMessage(messages, ws, (msg) => msg.type === 'codex_sessions');
    const importedCodexItem = codexSessions.sessions.find((item) => item.threadId === codexFixture.threadId);
    assert(importedCodexItem, 'Codex session listing failed');

    ws.send(JSON.stringify({ type: 'import_codex_session', threadId: importedCodexItem.threadId, rolloutPath: importedCodexItem.rolloutPath }));
    const importedCodex = await nextMessage(messages, ws, (msg) => msg.type === 'session_info' && msg.agent === 'codex' && msg.title === 'Codex import prompt');
    assert(importedCodex.messages?.[0]?.content === 'Codex import prompt', 'Codex import kept wrapper instructions');
    assert(importedCodex.totalUsage?.inputTokens === 20, 'Codex import usage parse failed');

    const importedSessionId = importedCodex.sessionId;
    discardMessages(messages, (msg) => msg.type === 'session_list');
    ws.send(JSON.stringify({ type: 'delete_session', sessionId: importedSessionId }));
    await nextMessage(messages, ws, (msg) => msg.type === 'session_list' && !msg.sessions.some((s) => s.id === importedSessionId));

    assert(!fs.existsSync(path.join(sessionsDir, `${importedSessionId}.json`)), 'Deleting Codex session did not remove session JSON');
    assert(!fs.existsSync(codexFixture.rolloutPath), 'Deleting Codex session did not remove rollout file');
    if (HAS_SQLITE3) {
      try {
        assert(sql(codexFixture.stateDb, `select count(*) from threads where id='${codexFixture.threadId}'`) === '0', 'Deleting Codex session did not remove thread row');
      } catch (dbAssertErr) {
        console.error('  Server stderr:');
        console.error(stderr().split('\n').filter((l) => /codex-delete|sqlite|thread/i.test(l)).join('\n') || '  (no codex-delete lines in server stderr)');
        const serverLogPath = path.join(logsDir, 'process.log');
        if (fs.existsSync(serverLogPath)) {
          const logLines = fs.readFileSync(serverLogPath, 'utf8').trim().split('\n');
          const relevantLines = logLines.filter((line) => /codex_delete|sqlite3|thread/i.test(line));
          if (relevantLines.length > 0) {
            console.error('  Server process.log (codex-delete entries):');
            for (const line of relevantLines) console.error(`    ${line}`);
          } else {
            console.error('  Server process.log exists but has no codex-delete entries.');
          }
        } else {
          console.error(`  Server process.log not found at: ${serverLogPath}`);
        }
        throw dbAssertErr;
      }
    } else {
      console.log('  SKIP: sqlite3 not available (Codex DB delete assertion)');
    }

    // --- Config backup/restore test ---
    // Write a known settings.json to the test home dir
    const claudeDir = path.join(homeDir, '.claude');
    mkdirp(claudeDir);
    const settingsPath = path.join(claudeDir, 'settings.json');
    const settingsBackupPath = settingsPath + '.bak';
    const originalSettings = JSON.stringify({ env: { ORIGINAL_MARKER: 'true' } });
    fs.writeFileSync(settingsPath, originalSettings);

    // Save custom model config → should backup settings and apply template
    ws.send(JSON.stringify({
      type: 'save_model_config',
      config: {
        mode: 'custom',
        activeTemplate: 'Regression Template',
        templates: [{
          name: 'Regression Template',
          apiKey: 'sk-backup-test-key',
          apiBase: 'https://backup-test.example.com/v1',
          defaultModel: 'test-model',
          opusModel: 'test-opus',
          sonnetModel: 'test-sonnet',
          haikuModel: 'test-haiku',
        }],
      },
    }));
    await nextMessage(messages, ws, (msg) => msg.type === 'model_config');

    // Verify backup was created with original content
    assert(fs.existsSync(settingsBackupPath), 'settings.json.bak should exist after custom mode save');
    const backupContent = fs.readFileSync(settingsBackupPath, 'utf8');
    assert(JSON.parse(backupContent).env?.ORIGINAL_MARKER === 'true', 'Backup should contain original settings');

    // Verify settings.json was modified with template values
    const modifiedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert(modifiedSettings.env?.ANTHROPIC_AUTH_TOKEN === 'sk-backup-test-key', 'settings.json should have template API key');
    assert(modifiedSettings.env?.ORIGINAL_MARKER === 'true', 'settings.json should preserve non-API env vars');

    // Switch to local mode → should restore settings from backup
    ws.send(JSON.stringify({
      type: 'save_model_config',
      config: { mode: 'local' },
    }));
    await nextMessage(messages, ws, (msg) => msg.type === 'model_config');

    // Verify settings were restored
    assert(!fs.existsSync(settingsBackupPath), 'settings.json.bak should be removed after restore');
    const restoredSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert(restoredSettings.env?.ORIGINAL_MARKER === 'true', 'settings.json should be restored to original content');
    assert(!('ANTHROPIC_AUTH_TOKEN' in (restoredSettings.env || {})), 'settings.json should not have template API key after restore');

    ws.close();
    console.log('Regression checks passed.');
    });
  } finally {
    await hermesMock.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

# CC-Web Project Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modularize server.js (5099 lines) and app.js (5448 lines), consolidate CSS design system, fix config isolation and test reliability, improving overall maintainability and stability.

**Architecture:** Extract monolithic files into focused modules connected through explicit interfaces. Backend uses dependency injection via factory functions. Frontend uses a `CCWeb` global namespace. CSS consolidates 3 design passes into a single clean token system with 2 themes (Light + Dark).

**Tech Stack:** Node.js 18+, ws, vanilla JS frontend, CSS custom properties, marked.js, highlight.js

---

## File Structure

### Backend Modules (extracted from server.js)

| File | Responsibility | Source Lines |
|------|---------------|-------------|
| `server.js` | Entry point, HTTP/WS setup, env loading, startup/shutdown | Lines 0-65, 1258-1307, 4948-5099 (~300 lines) |
| `lib/logger.js` | Process logger with rotation | Lines 66-104 (~40 lines) |
| `lib/notify.js` | 5 notification providers, AI summary | Lines 131-436 + 2723-2769 (~340 lines) |
| `lib/auth.js` | Password, token, IP ban, brute force | Lines 438-601 + 2771-2799 (~190 lines) |
| `lib/config-manager.js` | Model config, Codex config, CC Switch, dev config | Lines 632-1256 + 1628-1855 + 2801-3097 (~1200 lines) |
| `lib/session-store.js` | Session CRUD, attachments, import | Lines 1308-1506 + 1316-1432 + 4529-4880 (~700 lines) |
| `lib/agent-manager.js` | Agent spawn/kill/recovery, event formatting | Lines 1857-2424 + 3985-4124 + 4127-4418 + 4449-4475 (~1200 lines) |
| `lib/routes.js` | HTTP routes + WS message router + slash commands | Lines 2427-2713 + 3246-3628 + 4477-4527 (~700 lines) |
| `lib/shared-state.js` | Mutable singletons shared across modules | Lines 603-621 + 496-509 (~50 lines) |
| `lib/agent-runtime.js` | Event parsing (existing, unchanged) | — |
| `lib/codex-rollouts.js` | Codex rollout store (existing, unchanged) | — |

### Frontend Modules (extracted from app.js)

| File | Responsibility | Source Lines |
|------|---------------|-------------|
| `public/app.js` | Entry, init, WS connect, global state | Lines 0-183, 1723-1761, 3365-3508, 5405-5448 (~400 lines) |
| `public/js/helpers.js` | Pure utilities: escapeHtml, normalizeAgent, etc. | Lines 198-225, 1038-1043, 5386-5403 (~60 lines) |
| `public/js/markdown.js` | marked config, safe URL, XSS filter, code preview | Lines 1545-1721 (~180 lines) |
| `public/js/ui.js` | Theme, scrollbar, sidebar, toast, viewport, pickers | Lines 185-247, 1287-1314, 2789-2864, 2973-3290, 3344-3560 (~700 lines) |
| `public/js/session.js` | Session list, LRU cache, switch, create, delete | Lines 875-1527, 2867-2971 (~800 lines) |
| `public/js/chat.js` | Message rendering, tool calls, AskUser, generating state | Lines 2059-2788 (~730 lines) |
| `public/js/settings.js` | Settings panel, all subpages | Lines 249-838, 840-873, 3562-4778 (~1900 lines) |
| `public/style.css` | Single design system, 2 themes | Consolidated from 4086 lines |

### Unchanged Files

| File | Note |
|------|------|
| `shared/commands.json` | Command manifest |
| `scripts/regression.js` | Test suite (updated per phase) |
| `public/index.html` | Updated to load new JS modules |

---

## P0 — Commit Current Work

### Task 0: Commit all uncommitted changes

**Files:** All 14 modified/new files

- [ ] **Step 1: Verify current state**

```bash
cd C:\Users\1\Desktop\Project\cc-web
git status
npm test
```

Expected: Tests pass (or known failures only from sqlite3 on Windows).

- [ ] **Step 2: Stage all files**

```bash
git add .env.example .gitignore CHANGELOG.md README.en.md README.md \
  lib/agent-runtime.js package-lock.json package.json public/app.js \
  public/index.html public/style.css scripts/regression.js server.js start.bat \
  .editorconfig .gitattributes .github/ CONTRIBUTING.md LICENSE SECURITY.md \
  scripts/mock-gemini.js shared/
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: open-source convergence, security hardening, command manifest

- Add MIT LICENSE, CONTRIBUTING.md, SECURITY.md, CI workflow
- Add shared/commands.json as single source of truth for slash commands
- Frontend markdown XSS prevention (block raw HTML, dangerous URLs)
- Path traversal hardening with path.relative boundary checks
- Regression tests for command manifest and markdown safety
- Windows start.bat with env var fallbacks and UTF-8 support
- Update README/README.en with full multi-agent documentation"
```

---

## P1 — Config Isolation + Test Fixes

### Task 1a: Create shared-state module

**Files:**
- Create: `lib/shared-state.js`

- [ ] **Step 1: Create shared-state.js**

```js
// lib/shared-state.js
'use strict';

// Mutable singletons shared across modules
const MODEL_MAP = { opus: null, sonnet: null, haiku: null };
const activeProcesses = new Map();  // sessionId → { proc, agent, pid, ... }
const wsSessionMap = new Map();     // ws → sessionId
const pendingSlashCommands = new Map();
const pendingCompactRetries = new Map();
const activeTokens = new Map();     // token → lastActive
const wssRef = { value: null };     // WebSocketServer reference

module.exports = {
  MODEL_MAP,
  activeProcesses,
  wsSessionMap,
  pendingSlashCommands,
  pendingCompactRetries,
  activeTokens,
  wssRef,
};
```

- [ ] **Step 2: Verify module loads**

```bash
node -e "const s = require('./lib/shared-state'); console.log(Object.keys(s));"
```

Expected: `MODEL_MAP activeProcesses wsSessionMap pendingSlashCommands pendingCompactRetries activeTokens wssRef`

- [ ] **Step 3: Commit**

```bash
git add lib/shared-state.js
git commit -m "refactor: extract shared-state module for cross-module singletons"
```

### Task 1b: Create logger module

**Files:**
- Create: `lib/logger.js`

- [ ] **Step 1: Create logger.js**

```js
// lib/logger.js
'use strict';

const fs = require('fs');
const path = require('path');

const LOG_MAX_SIZE = 2 * 1024 * 1024; // 2MB per file

function createLogger(logDir) {
  const LOG_FILE = path.join(logDir, 'process.log');
  fs.mkdirSync(logDir, { recursive: true });

  function plog(level, event, data = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...data,
    };
    const line = JSON.stringify(entry) + '\n';
    try {
      if (fs.existsSync(LOG_FILE)) {
        const stat = fs.statSync(LOG_FILE);
        if (stat.size > LOG_MAX_SIZE) {
          const oldFile = LOG_FILE + '.old';
          try { fs.unlinkSync(oldFile); } catch (_) {}
          fs.renameSync(LOG_FILE, oldFile);
        }
      }
      fs.appendFileSync(LOG_FILE, line);
    } catch (_) {}
  }

  return { plog };
}

module.exports = { createLogger };
```

- [ ] **Step 2: Test it**

```bash
node -e "const { createLogger } = require('./lib/logger'); const l = createLogger('./logs'); l.plog('info', 'test', { a: 1 }); console.log('ok');"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add lib/logger.js
git commit -m "refactor: extract logger module (plog with rotation)"
```

### Task 1c: Create auth module

**Files:**
- Create: `lib/auth.js`
- Source: server.js lines 438-601, 2771-2799

- [ ] **Step 1: Create auth.js**

Extract from server.js: `generateRandomPassword`, `loadAuthConfig`, `saveAuthConfig`, `validatePasswordStrength`, `ensureAuthLoaded`, `isTokenValid`, `isWhitelistedIP`, `loadBannedIPs`, `saveBannedIPs`, `isBanned`, `recordAuthFailure`, `handleChangePassword`.

The module exports a factory function `createAuth(configDir, deps)` that returns all auth functions. `deps` provides `{ plog, activeTokens }`.

```js
// lib/auth.js
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_FAIL_WINDOW = 5 * 60 * 1000;
const AUTH_FAIL_MAX = 3;
const BAN_DURATION = 7 * 24 * 60 * 60 * 1000;
const TOKEN_TTL = 24 * 60 * 60 * 1000;

function createAuth(configDir, deps) {
  const { plog, activeTokens } = deps;
  const AUTH_CONFIG_PATH = path.join(configDir, 'auth.json');
  const BANNED_IPS_PATH = path.join(configDir, 'banned_ips.json');

  let authConfig = null;
  let PASSWORD = null;
  const authFailures = new Map();
  const bannedIPs = new Map();

  // Load banned IPs on startup
  loadBannedIPs();

  // Token cleanup every 6 hours
  setInterval(() => {
    const now = Date.now();
    for (const [token, lastActive] of activeTokens) {
      if (now - lastActive > TOKEN_TTL) activeTokens.delete(token);
    }
  }, 6 * 60 * 60 * 1000).unref();

  function generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let result = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) result += chars[bytes[i] % chars.length];
    return result;
  }

  function loadAuthConfig() {
    try {
      if (fs.existsSync(AUTH_CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(AUTH_CONFIG_PATH, 'utf8'));
        if (raw && raw.password) return raw;
      }
    } catch (_) {}
    const pw = generateRandomPassword();
    const cfg = { password: pw, mustChange: true };
    saveAuthConfig(cfg);
    return cfg;
  }

  function saveAuthConfig(config) {
    try {
      const tmp = AUTH_CONFIG_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
      fs.renameSync(tmp, AUTH_CONFIG_PATH);
    } catch (e) {
      plog('error', 'auth_config_save_failed', { error: e.message });
    }
  }

  function validatePasswordStrength(pw) {
    if (!pw || pw.length < 6) return { valid: false, message: 'Password must be at least 6 characters' };
    return { valid: true, message: '' };
  }

  function ensureAuthLoaded() {
    if (!authConfig) {
      authConfig = loadAuthConfig();
      PASSWORD = authConfig.password;
    }
    return authConfig;
  }

  function isTokenValid(token) {
    if (!token) return false;
    const lastActive = activeTokens.get(token);
    if (!lastActive) return false;
    if (Date.now() - lastActive > TOKEN_TTL) {
      activeTokens.delete(token);
      return false;
    }
    activeTokens.set(token, Date.now());
    return true;
  }

  function isWhitelistedIP(ip) {
    if (!ip) return false;
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    if (ip.startsWith('100.')) return true;
    const extra = process.env.CC_WEB_IP_WHITELIST;
    if (extra) {
      for (const entry of extra.split(',')) {
        if (ip === entry.trim()) return true;
      }
    }
    return false;
  }

  function loadBannedIPs() {
    try {
      if (fs.existsSync(BANNED_IPS_PATH)) {
        const raw = JSON.parse(fs.readFileSync(BANNED_IPS_PATH, 'utf8'));
        const now = Date.now();
        for (const [ip, expire] of Object.entries(raw)) {
          if (expire > now) bannedIPs.set(ip, expire);
        }
      }
    } catch (_) {}
  }

  function saveBannedIPs() {
    try {
      const obj = {};
      for (const [ip, expire] of bannedIPs) obj[ip] = expire;
      const tmp = BANNED_IPS_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, BANNED_IPS_PATH);
    } catch (_) {}
  }

  function isBanned(ip) {
    const expire = bannedIPs.get(ip);
    if (!expire) return false;
    if (Date.now() > expire) {
      bannedIPs.delete(ip);
      return false;
    }
    return true;
  }

  function recordAuthFailure(ip) {
    if (isWhitelistedIP(ip)) return false;
    let failures = authFailures.get(ip) || [];
    const now = Date.now();
    failures = failures.filter(t => now - t < AUTH_FAIL_WINDOW);
    failures.push(now);
    authFailures.set(ip, failures);
    if (failures.length >= AUTH_FAIL_MAX) {
      bannedIPs.set(ip, now + BAN_DURATION);
      authFailures.delete(ip);
      saveBannedIPs();
      plog('warn', 'ip_banned', { ip, duration: BAN_DURATION });
      return true;
    }
    return false;
  }

  function checkPassword(candidate) {
    ensureAuthLoaded();
    return candidate === PASSWORD;
  }

  function changePassword(newPassword) {
    ensureAuthLoaded();
    PASSWORD = newPassword;
    authConfig = { password: newPassword, mustChange: false };
    saveAuthConfig(authConfig);
  }

  function verifyLogin(password, ip) {
    ensureAuthLoaded();
    if (isBanned(ip)) return { ok: false, error: 'IP banned' };
    if (!checkPassword(password)) {
      recordAuthFailure(ip);
      return { ok: false, error: 'Invalid password' };
    }
    const token = crypto.randomUUID();
    activeTokens.set(token, Date.now());
    return { ok: true, token, mustChange: authConfig.mustChange };
  }

  return {
    ensureAuthLoaded,
    isTokenValid,
    isWhitelistedIP,
    isBanned,
    verifyLogin,
    changePassword,
    validatePasswordStrength,
    generateRandomPassword,
    PASSWORD: () => PASSWORD,
  };
}

module.exports = { createAuth };
```

- [ ] **Step 2: Test basic auth flow**

```bash
node -e "
const { createAuth } = require('./lib/auth');
const { createLogger } = require('./lib/logger');
const tokens = new Map();
const { plog } = createLogger('./logs');
const auth = createAuth('./config', { plog, activeTokens: tokens });
auth.ensureAuthLoaded();
console.log('Password:', auth.PASSWORD());
const r = auth.verifyLogin('wrong', '1.2.3.4');
console.log('Bad login:', r);
const r2 = auth.verifyLogin(auth.PASSWORD(), '1.2.3.4');
console.log('Good login:', r2.ok, !!r2.token);
console.log('Token valid:', auth.isTokenValid(r2.token));
"
```

Expected: Password is 12 chars, bad login fails, good login succeeds, token is valid.

- [ ] **Step 3: Commit**

```bash
git add lib/auth.js
git commit -m "refactor: extract auth module (password, token, IP ban)"
```

### Task 1d: Codex cold start optimization

**Files:**
- Modify: `lib/config-manager.js` (to be created in P2) — for now modify server.js directly
- The fix: in `prepareCodexLocalRuntimeHome`, skip copying `plugins/`, `marketplace/`, `memories/` directories

- [ ] **Step 1: Locate the function**

Find `prepareCodexLocalRuntimeHome` in server.js and identify the directory copy logic.

- [ ] **Step 2: Add exclusion filter**

In the `walkJsonlFiles` or copy loop, add a skip list:

```js
const SKIP_DIRS = new Set(['plugins', 'marketplace', 'memories', '.tmp']);
```

Skip any directory whose name is in `SKIP_DIRS` during the recursive copy.

- [ ] **Step 3: Add regression test**

In `scripts/regression.js`, add a test that verifies `prepareCodexLocalRuntimeHome` does NOT copy plugin directories:

```js
// In the Codex test section:
const { prepareCodexLocalRuntimeHome } = require('../server'); // or wherever it's exposed
// Create a fake codex home with plugins dir
// Verify plugins dir is NOT in the session home
```

- [ ] **Step 4: Commit**

```bash
git commit -m "perf: skip copying global plugins/marketplace for Codex session cold start"
```

### Task 1e: Fix regression tests for Windows

**Files:**
- Modify: `scripts/regression.js`

- [ ] **Step 1: Identify sqlite3-dependent tests**

Find all tests that use `sqlite3` CLI in regression.js. Mark them with `skipIfUnavailable`:

```js
const hasSqlite3 = (() => {
  try {
    require('child_process').execSync('sqlite3 --version', { stdio: 'ignore' });
    return true;
  } catch { return false; }
})();
```

- [ ] **Step 2: Guard sqlite3 tests**

Wrap sqlite3-dependent test blocks:

```js
if (hasSqlite3) {
  // existing sqlite3 tests
} else {
  console.log('  SKIP: sqlite3 not available');
}
```

- [ ] **Step 3: Run tests on Windows**

```bash
npm test
```

Expected: All tests pass (sqlite3 tests skipped gracefully).

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: graceful sqlite3 test skip on Windows"
```

### Task 1f: Add config backup/restore tests

**Files:**
- Modify: `scripts/regression.js`

- [ ] **Step 1: Write test for settings.json backup/restore**

Add a test that:
1. Creates a fake `~/.claude/settings.json`
2. Starts a Claude session (which should backup settings)
3. Verifies backup exists
4. Ends session
5. Verifies settings restored to original

```js
// Test: Claude config isolation
{
  const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const original = { env: { ANTHROPIC_API_KEY: 'test-key' } };
  fs.writeFileSync(settingsPath, JSON.stringify(original));

  // Start session → verify backup created
  // End session → verify settings restored
  const restored = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepStrictEqual(restored, original, 'Settings should be restored after session');
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git commit -m "test: add config backup/restore verification"
```

### Task 1g: Implement config backup/restore in server.js

**Files:**
- Modify: server.js (around `applyCustomTemplateToSettings` and session lifecycle)

- [ ] **Step 1: Add backup function**

```js
const CLAUDE_SETTINGS_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'settings.json');
const CLAUDE_SETTINGS_BACKUP = CLAUDE_SETTINGS_PATH + '.bak';

function backupClaudeSettings() {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      fs.copyFileSync(CLAUDE_SETTINGS_PATH, CLAUDE_SETTINGS_BACKUP);
    }
  } catch (e) {
    plog('error', 'settings_backup_failed', { error: e.message });
  }
}

function restoreClaudeSettings() {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_BACKUP)) {
      const backup = fs.readFileSync(CLAUDE_SETTINGS_BACKUP, 'utf8');
      const current = fs.existsSync(CLAUDE_SETTINGS_PATH) ? fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8') : '';
      if (backup !== current) {
        fs.copyFileSync(CLAUDE_SETTINGS_BACKUP, CLAUDE_SETTINGS_PATH);
      }
      fs.unlinkSync(CLAUDE_SETTINGS_BACKUP);
    }
  } catch (e) {
    plog('error', 'settings_restore_failed', { error: e.message });
  }
}
```

- [ ] **Step 2: Wire into session lifecycle**

Call `backupClaudeSettings()` before `applyCustomTemplateToSettings()` and `restoreClaudeSettings()` when session ends or agent switches.

- [ ] **Step 3: Run tests**

```bash
npm test
```

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: backup/restore Claude settings.json to prevent config pollution"
```

---

## P2a — CSS Design System Consolidation

### Task 2a.1: Remove CoolVibe theme

**Files:**
- Modify: `public/style.css`
- Modify: `public/app.js` (THEME_OPTIONS constant)

- [ ] **Step 1: Remove CoolVibe CSS rules**

In `style.css`, delete all `html[data-theme='coolvibe']` blocks and any CoolVibe-specific rules.

- [ ] **Step 2: Remove CoolVibe from THEME_OPTIONS**

In `app.js`, change `THEME_OPTIONS` from 3 themes to 2:

```js
const THEME_OPTIONS = [
  { value: 'washi', label: 'Washi Light', desc: 'Warm, elegant' },
  { value: 'washi-dark', label: 'Washi Dark', desc: 'Deep, focused' },
];
```

- [ ] **Step 3: Update theme picker and index.html**

Remove CoolVibe references from `buildThemePickerHtml` and any `<option>` in HTML.

- [ ] **Step 4: Visual verification**

```bash
node server.js
```

Open browser, verify both themes work correctly.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: remove CoolVibe theme, keep Light + Dark"
```

### Task 2a.2: Consolidate CSS variables

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Extract current effective `:root` values**

Read the LAST `:root` block (around line 2961) — this is the one that actually takes effect. Extract all `--` variables.

- [ ] **Step 2: Replace all prior `:root` blocks**

Delete all earlier `:root` variable definitions. Keep only the final consolidated block at the top of the file.

- [ ] **Step 3: Consolidate duplicate `@media` queries**

Merge all `@media (max-width: 768px)` blocks into one.

- [ ] **Step 4: Verify both themes**

```bash
node server.js
```

Check Light and Dark themes visually.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: consolidate CSS variables, remove redundant overrides"
```

### Task 2a.3: Polish design tokens

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Refine shadow tokens**

```css
:root {
  --shadow-1: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-2: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-3: 0 12px 32px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.06);
}
```

- [ ] **Step 2: Verify transition consistency**

Ensure all interactive elements use `--dur-base` and `--ease-out`:

```css
button, input, select, textarea, a {
  transition: all var(--dur-base) var(--ease-out);
}
```

- [ ] **Step 3: Visual verification + commit**

```bash
git commit -m "style: polish design tokens — shadows, transitions, spacing"
```

---

## P2b — server.js Modularization (parallel with P2a)

### Task 2b.1: Extract routes module

**Files:**
- Create: `lib/routes.js`
- Source: server.js lines 2427-2544 (HTTP), 2546-2713 (WS router), 3246-3628 (slash commands), 4477-4527 (update checker)

- [ ] **Step 1: Create routes.js skeleton**

```js
// lib/routes.js
'use strict';

const fs = require('fs');
const path = require('path');

function createRouter(deps) {
  const {
    auth, sessions, agents, config, notifier, shared,
    plog, wsSend, COMMANDS_FOR_CLIENT, PUBLIC_DIR, MIME_TYPES,
  } = deps;

  // HTTP request handler
  function handleHttpRequest(req, res) {
    // ... extracted from server.js
  }

  // WebSocket message dispatcher
  function handleWsMessage(ws, msg, currentToken) {
    // ... extracted from server.js switch statement
  }

  // Slash command handler
  function handleSlashCommand(ws, text, sessionId, fallbackAgent) {
    // ... extracted from server.js
  }

  return { handleHttpRequest, handleWsMessage, handleSlashCommand };
}

module.exports = { createRouter };
```

- [ ] **Step 2: Move HTTP route logic**

Extract lines 2427-2544 into `handleHttpRequest`.

- [ ] **Step 3: Move WS message dispatch**

Extract lines 2546-2713 into `handleWsMessage`. Each `case` calls into the appropriate module (sessions, agents, config, notifier).

- [ ] **Step 4: Move slash command handler**

Extract lines 3246-3628 into `handleSlashCommand`.

- [ ] **Step 5: Run tests**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add lib/routes.js
git commit -m "refactor: extract routes module (HTTP + WS + slash commands)"
```

### Task 2b.2: Extract notify module

**Files:**
- Create: `lib/notify.js`
- Source: server.js lines 131-436 + 2723-2769

- [ ] **Step 1: Create notify.js**

Extract `loadNotifyConfig`, `saveNotifyConfig`, `maskToken`, `getNotifyConfigMasked`, `truncateForChannel`, `getSummaryApiCredentials`, `callSummaryApi`, `buildSummaryPrompt`, `buildNotifyContent`, `sendNotification` into a factory function `createNotifier(configDir, deps)`.

- [ ] **Step 2: Test**

```bash
node -e "const { createNotifier } = require('./lib/notify'); console.log('ok');"
```

- [ ] **Step 3: Commit**

```bash
git add lib/notify.js
git commit -m "refactor: extract notification module (5 providers + AI summary)"
```

### Task 2b.3: Extract config-manager module

**Files:**
- Create: `lib/config-manager.js`
- Source: server.js lines 632-1256 + 1628-1855

- [ ] **Step 1: Create config-manager.js**

This is the largest extraction. Contains: model config, Codex config, Codex runtime preparation, CC Switch integration, dev config.

Factory: `createConfigManager(configDir, deps)` returns all config functions.

- [ ] **Step 2: Move model config functions**

Extract: `loadModelConfig`, `saveModelConfig`, `loadCodexConfig`, `saveCodexConfig`, `getCodexConfigMasked`, `getModelConfigMasked`, `maskSecret`, `applyCustomTemplateToSettings`, `applyModelConfig`, `claudeModelMapFromEnv`, `loadClaudeSettingsModelMap`, `loadClaudeJsonModelMap`.

- [ ] **Step 3: Move Codex runtime functions**

Extract: `tomlString`, `normalizeCodexRuntimeApiBase`, `codexSessionHomeDir`, `walkJsonlFiles`, `copyCodexThreadRollouts`, `prepareCodexLocalRuntimeHome`, `ensureCodexSessionHome`, `prepareCodexCustomRuntime`.

- [ ] **Step 4: Move CC Switch functions**

Extract: `ccSwitchCandidatePaths`, `findCcSwitchCli`, `findCcSwitchDesktopApp`, `runCcSwitch`, `getCcSwitchState`, etc.

- [ ] **Step 5: Move dev config**

Extract: `loadDevConfig`, `saveDevConfig`, `getDevConfigMasked`.

- [ ] **Step 6: Run tests**

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add lib/config-manager.js
git commit -m "refactor: extract config-manager module (model, codex, ccswitch, dev)"
```

### Task 2b.4: Extract session-store module

**Files:**
- Create: `lib/session-store.js`
- Source: server.js lines 1308-1506, 1316-1432, 4529-4880, 3630-3964

- [ ] **Step 1: Create session-store.js**

Factory: `createSessionStore(sessionsDir, deps)`.

Extract: session CRUD, attachment storage, native import, session handlers.

- [ ] **Step 2: Move session CRUD**

Extract: `sessionPath`, `runDir`, `normalizeSession`, `getSessionAgent`, `isClaudeSession`, `loadSession`, `saveSession`, `splitHistoryMessages`, etc.

- [ ] **Step 3: Move attachment functions**

Extract: `attachmentDataPath`, `loadAttachmentMeta`, `saveAttachmentMeta`, `cleanupExpiredAttachments`, etc.

- [ ] **Step 4: Move import functions**

Extract: `resolveClaudeSessionLocalMeta`, `parseJsonlToMessages`, `handleListNativeSessions`, `handleImportNativeSession`, etc.

- [ ] **Step 5: Move WS handlers**

Extract: `handleNewSession`, `handleLoadSession`, `handleDeleteSession`, `handleRenameSession`, `handleSetMode`, etc.

- [ ] **Step 6: Run tests**

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add lib/session-store.js
git commit -m "refactor: extract session-store module (CRUD, attachments, import)"
```

### Task 2b.5: Extract agent-manager module

**Files:**
- Create: `lib/agent-manager.js`
- Source: server.js lines 1857-2424, 3985-4124, 4127-4418, 4449-4475

- [ ] **Step 1: Create agent-manager.js**

Factory: `createAgentManager(deps)`.

This is the heaviest module — depends on session-store, config-manager, notify, shared-state.

- [ ] **Step 2: Move process lifecycle**

Extract: `isProcessRunning`, `killProcess`, `cleanRunDir`, `FileTailer`.

- [ ] **Step 3: Move error formatting**

Extract: `firstMeaningfulLine`, `condenseRuntimeError`, `filterRuntimeStderr`, `formatRuntimeError`, `isContextLimitError`, message builders.

- [ ] **Step 4: Move process completion**

Extract: `handleProcessComplete`, PID monitor, attachment cleanup.

- [ ] **Step 5: Move Hermes streaming**

Extract: `hermesConversationIdForSession`, `parseSseChunkBuffer`, `startHermesResponseStream`.

- [ ] **Step 6: Move message handler**

Extract: `handleMessage` (the core message processing function).

- [ ] **Step 7: Move process recovery**

Extract: `recoverProcesses`.

- [ ] **Step 8: Run tests**

```bash
npm test
```

- [ ] **Step 9: Commit**

```bash
git add lib/agent-manager.js
git commit -m "refactor: extract agent-manager module (spawn, recovery, events)"
```

### Task 2b.6: Slim down server.js to entry point

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Replace extracted code with module imports**

```js
// server.js (new structure)
'use strict';

// Windows env fix (keep inline, runs before any imports)
// ... existing env fix code ...

const { createLogger } = require('./lib/logger');
const { createAuth } = require('./lib/auth');
const { createNotifier } = require('./lib/notify');
const { createConfigManager } = require('./lib/config-manager');
const { createSessionStore } = require('./lib/session-store');
const { createAgentManager } = require('./lib/agent-manager');
const { createRouter } = require('./lib/routes');
const shared = require('./lib/shared-state');

// ... env loading, constants ...

const { plog } = createLogger(LOGS_DIR);
const auth = createAuth(CONFIG_DIR, { plog, activeTokens: shared.activeTokens });
const notifier = createNotifier(CONFIG_DIR, { plog, ... });
const config = createConfigManager(CONFIG_DIR, { plog, ... });
const sessions = createSessionStore(SESSIONS_DIR, { plog, ... });
const agents = createAgentManager({ plog, sessions, config, notifier, shared, ... });
const router = createRouter({ auth, sessions, agents, config, notifier, shared, plog, ... });

// HTTP server setup
const server = http.createServer(router.handleHttpRequest);
// WS server setup
const wss = new WebSocketServer({ server });
shared.wssRef.value = wss;

// ... startup, shutdown ...
```

- [ ] **Step 2: Verify server starts**

```bash
node server.js
```

- [ ] **Step 3: Run full tests**

```bash
npm test
```

- [ ] **Step 4: Verify server.js is under 400 lines**

```bash
wc -l server.js
```

Expected: < 400 lines.

- [ ] **Step 5: Commit**

```bash
git add server.js lib/
git commit -m "refactor: server.js slimmed to entry point, all logic in modules"
```

---

## P3a — Frontend Modularization

### Task 3a.1: Create helpers.js

**Files:**
- Create: `public/js/helpers.js`
- Source: app.js lines 198-225, 1038-1043, 5386-5403

- [ ] **Step 1: Create helpers.js**

```js
// public/js/helpers.js
'use strict';

window.CCWeb = window.CCWeb || {};

CCWeb.helpers = {
  buildWelcomeMarkup(agent) {
    const name = CCWeb.helpers.normalizeAgent(agent) === 'codex' ? 'Codex'
      : CCWeb.helpers.normalizeAgent(agent) === 'hermes' ? 'Hermes'
      : CCWeb.helpers.normalizeAgent(agent) === 'gemini' ? 'Gemini'
      : 'Claude';
    return `<div class="welcome-msg"><h2>Welcome to ${name}</h2><p>Start a conversation below.</p></div>`;
  },

  normalizeAgent(agent) {
    if (!agent) return 'claude';
    const a = String(agent).toLowerCase().trim();
    if (a === 'codex' || a === 'hermes' || a === 'gemini') return a;
    return 'claude';
  },

  getAvailableModes(agent) {
    const a = CCWeb.helpers.normalizeAgent(agent);
    if (a === 'gemini') return ['plan', 'yolo'];
    return ['default', 'plan', 'yolo'];
  },

  normalizeModeForAgent(agent, mode) {
    const modes = CCWeb.helpers.getAvailableModes(agent);
    if (modes.includes(mode)) return mode;
    return modes[0];
  },

  syncModeOptions() {
    const select = document.getElementById('modeSelect');
    if (!select) return;
    const modes = CCWeb.helpers.getAvailableModes(CCWeb.state?.currentAgent);
    select.innerHTML = modes.map(m => `<option value="${m}">${m}</option>`).join('');
  },

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  timeAgo(dateStr) {
    if (!dateStr) return '';
    const now = Date.now();
    const d = new Date(dateStr).getTime();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  },
};
```

- [ ] **Step 2: Add script tag to index.html**

Add before app.js:
```html
<script src="/js/helpers.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add public/js/helpers.js public/index.html
git commit -m "refactor: extract frontend helpers module (escapeHtml, normalizeAgent, etc.)"
```

### Task 3a.2: Create markdown.js

**Files:**
- Create: `public/js/markdown.js`
- Source: app.js lines 1545-1721

- [ ] **Step 1: Create markdown.js**

Extract: `_splitCodexThinkingModel`, `_parseCodexModelListText`, `normalizeCodexProfile`, `getActiveCodexProfileConfig`, `getCodexBaseModelOptions`, marked renderer config, `safeMarkdownUrl`, `ccCopyCode`, `ccTogglePreview`.

- [ ] **Step 2: Add script tag**

```html
<script src="/js/markdown.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: extract markdown module (renderer, XSS filter, code preview)"
```

### Task 3a.3: Create ui.js

**Files:**
- Create: `public/js/ui.js`
- Source: app.js lines 185-247, 1287-1314, 2789-2864, 2973-3290, 3344-3560

- [ ] **Step 1: Create ui.js**

Extract: `setVH`, theme functions, CWD badge, scrollbar, sidebar, slash command menu, option picker, model/mode pickers, input/send events, toast/notifications.

- [ ] **Step 2: Add script tag**

```html
<script src="/js/ui.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: extract UI module (theme, scrollbar, sidebar, pickers, toast)"
```

### Task 3a.4: Create session.js

**Files:**
- Create: `public/js/session.js`
- Source: app.js lines 875-1527, 2867-2971

- [ ] **Step 1: Create session.js**

Extract: all session cache functions, session management, session list rendering.

- [ ] **Step 2: Add script tag**

```html
<script src="/js/session.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: extract session module (cache, CRUD, list rendering)"
```

### Task 3a.5: Create chat.js

**Files:**
- Create: `public/js/chat.js`
- Source: app.js lines 2059-2788

- [ ] **Step 1: Create chat.js**

Extract: generating state, message rendering, tool calls, AskUserQuestion, delete confirm, system/error messages.

- [ ] **Step 2: Add script tag**

```html
<script src="/js/chat.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: extract chat module (messages, tool calls, generating state)"
```

### Task 3a.6: Create settings.js

**Files:**
- Create: `public/js/settings.js`
- Source: app.js lines 249-838, 840-873, 3562-4778

- [ ] **Step 1: Create settings.js**

Extract: theme picker, notification UI, CC Switch UI, developer config, main settings panel, password/auth.

- [ ] **Step 2: Add script tag**

```html
<script src="/js/settings.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: extract settings module (all settings subpages)"
```

### Task 3a.7: Slim app.js to entry point

**Files:**
- Modify: `public/app.js`, `public/index.html`

- [ ] **Step 1: Remove extracted code from app.js**

Keep only: state variables, DOM references, `connect()`, `send()`, `scheduleReconnect()`, `handleServerMessage()`, init code.

- [ ] **Step 2: Update index.html script loading order**

```html
<script src="/js/helpers.js"></script>
<script src="/js/markdown.js"></script>
<script src="/js/ui.js"></script>
<script src="/js/session.js"></script>
<script src="/js/chat.js"></script>
<script src="/js/settings.js"></script>
<script src="/app.js"></script>
```

- [ ] **Step 3: Verify app.js is under 500 lines**

```bash
wc -l public/app.js
```

- [ ] **Step 4: Full functional test**

```bash
node server.js
```

Test: login, create session, send message, tool calls, settings, theme switch, session switch.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/js/ public/index.html
git commit -m "refactor: app.js slimmed to entry point, frontend modules extracted"
```

---

## P3b — CSS Refinement

### Task 3b.1: Visual polish pass

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Review and fix any visual issues from CSS consolidation**

Check: buttons, inputs, cards, modals, sidebar, chat bubbles in both themes.

- [ ] **Step 2: Verify mobile layout**

Test at 375px and 768px widths.

- [ ] **Step 3: Verify dark mode readability**

Check all text has sufficient contrast in dark theme.

- [ ] **Step 4: Commit**

```bash
git commit -m "style: CSS polish pass — visual consistency across themes"
```

---

## P4 — Feature Cleanup + Docs Sync

### Task 4a: Clean up dead code

**Files:**
- Modify: server.js or lib/ modules

- [ ] **Step 1: Mark Codex search as TODO**

Find `enableSearch`/`supportsSearch` references. Add comment:
```js
// TODO(v1.4): Wire up Codex search capability
```

- [ ] **Step 2: Add Gemini default mode explanation**

In the UI where Gemini mode is shown, ensure the disabled `default` option has a tooltip explaining why.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: mark Codex search as TODO, clarify Gemini mode limitation"
```

### Task 4b: Sync docs

**Files:**
- Modify: `README.md`, `README.en.md`, `CHANGELOG.md`

- [ ] **Step 1: Update CHANGELOG**

Add the convergence work as a new version entry.

- [ ] **Step 2: Verify README accuracy**

Ensure all documented features match actual implementation.

- [ ] **Step 3: Verify commands.json matches actual commands**

```bash
node -e "
const manifest = require('./shared/commands.json');
console.log('Commands:', manifest.length);
// Verify each command has required fields
for (const cmd of manifest) {
  if (!cmd.cmd || !cmd.kind || !cmd.agents) {
    console.error('INVALID:', cmd);
  }
}
console.log('All valid');
"
```

- [ ] **Step 4: Final full test**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "docs: sync README, CHANGELOG, verify command manifest"
```

---

## Verification Checklist

After all phases complete, verify:

- [ ] `npm test` passes on Windows
- [ ] No file exceeds 1000 lines (except CSS which may be ~1500)
- [ ] `server.js` is under 400 lines
- [ ] `public/app.js` is under 500 lines
- [ ] CSS `:root` variables defined once, no redundancy
- [ ] Both themes (Light + Dark) work correctly
- [ ] All 4 agents functional (Claude, Codex, Hermes, Gemini)
- [ ] Settings panel works (all subpages)
- [ ] Mobile layout correct at 375px and 768px
- [ ] Config backup/restore prevents pollution
- [ ] Codex cold start significantly faster

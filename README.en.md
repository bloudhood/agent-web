# Agent-Web

> Community fork maintained independently from [ZgDaniel/cc-web](https://github.com/ZgDaniel/cc-web).

A local-first web console for controlling Claude Code, Codex, Gemini CLI, and WSL Hermes sessions from a mobile-friendly browser UI.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

[中文 README](./README.md) | [Architecture](./docs/ARCHITECTURE.md) | [Changelog](./CHANGELOG.md) | [Security](./SECURITY.md)

## Features

- **Multi-agent sessions**: Claude, Codex, Gemini CLI, and Hermes in a unified recent-session sidebar with an agent badge per session.
- **Mobile control surface**: iOS/Chrome-oriented chat, sidebar, input area, and native-feeling pickers.
- **Native workflow alignment**: Web commands such as `/model`, `/mode`, `/permissions`, `/status`, `/usage`, `/resume`, and `/doctor`; slash completion parses the current local CLI help for commands, subcommands, and options, and safe read-only native commands stream live output.
- **Local history import**: Claude `~/.claude/projects/` and Codex `~/.codex/sessions/`.
- **Process recovery**: Claude/Codex/Gemini run through local CLI subprocesses. Tasks can continue after the browser disconnects and can be reattached after server recovery where possible.
- **Hermes Gateway**: connects to a WSL or local Hermes API Server and renders tool calls.
- **Developer config**: optional GitHub repository and SSH host config for `/github` and `/ssh` workflows.
- **Notifications**: PushPlus, Telegram, ServerChan, Feishu bot, and Qmsg.

## Requirements

- Node.js >= 18
- At least one local agent installed:

```bash
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
# Install and authenticate Gemini CLI / Hermes through their own setup flows.
```

Hermes requires a reachable Gateway, defaulting to `http://127.0.0.1:8644`.

## Quick Start

```bash
git clone https://github.com/bloudhood/agent-web.git
cd agent-web
npm install
cp .env.example .env   # optional; if omitted, a first-login password is generated
npm start
```

On Windows, run `start.bat` or:

```cmd
node server.js
```

Open `http://localhost:8002`. If no password is configured, the server prints a temporary password and requires a password change after login.

## Configuration

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `CC_WEB_PASSWORD` | No | generated | Web login password, migrated into `config/auth.json` on first start |
| `HOST` / `CC_WEB_HOST` | No | `0.0.0.0` | Bind address. Use `127.0.0.1` for local-only use |
| `PORT` | No | `8002` | Service port |
| `CLAUDE_PATH` | No | `claude` | Claude Code CLI path |
| `CODEX_PATH` | No | `codex` | Codex CLI path |
| `GEMINI_PATH` | No | `gemini` | Gemini CLI path |
| `CC_WEB_HERMES_API_BASE` | No | `http://127.0.0.1:8644` | Hermes Gateway base URL |
| `CC_WEB_HERMES_API_KEY` | No | empty | Hermes Gateway API key |
| `CC_WEB_CONFIG_DIR` | No | `./config` | Config directory override |
| `CC_WEB_SESSIONS_DIR` | No | `./sessions` | Session directory override |
| `CC_WEB_LOGS_DIR` | No | `./logs` | Log directory override |
| `PUSHPLUS_TOKEN` | No | empty | PushPlus token, optionally migrated into notification config |

Sensitive config is written to `config/`, sessions to `sessions/`, and logs to `logs/`. Do not commit runtime data.

## Commands

Web-handled commands:

- `/clear`
- `/model`
- `/mode` / `/permissions`
- `/status`
- `/cost` / `/usage`
- `/compact`
- `/init`
- `/resume`
- `/doctor`
- `/github`
- `/ssh`
- `/help`

Native CLI management commands are recognized. Commands that require an interactive TTY or mutate global CLI authentication/configuration are mapped to terminal instructions; safe read commands are executed through the local CLI and streamed back live. The `/` menu gets top-level commands, subcommands, and options from the current CLI `--help` output, while Web commands are backed by `shared/commands.json`.

## Runtime Diagnostics

- `GET /api/health`: version, PID, Node version, actual bind host/port, active task count, command count, and feature flags.
- `GET /api/commands`: Web/native command manifest.
- `GET /api/slash-completions?agent=claude&input=/mcp%20`: native slash candidates for the current agent.

## Project Structure

```text
agent-web/
├── server.js                  # Entry point: assembles modules, starts HTTP/WS server
├── lib/
│   ├── agent-manager.js        # Agent process lifecycle (spawn/kill/recover)
│   ├── agent-runtime.js         # Claude/Codex/Gemini/Hermes event parsing and spawn specs
│   ├── auth.js                  # Authentication and password management
│   ├── codex-rollouts.js        # Codex rollout history parser
│   ├── config-manager.js        # Model, Codex, CCSwitch, and developer config management
│   ├── logger.js                # Log rotation and writing
│   ├── notify.js                # PushPlus / Telegram / ServerChan / Feishu / Qmsg
│   ├── routes.js                # HTTP + WebSocket routing and slash command handling
│   ├── session-store.js         # Session persistence, atomic writes, caching
│   ├── shared-state.js          # Cross-agent shared state (CCSwitch desktop sync)
│   └── utils.js                 # General utility functions
├── public/                     # Frontend, styles, icons
│   ├── app.js                  # Entry: constants, state, DOM, WS, message routing, event binding
│   └── js/
│       ├── helpers.js           # Utilities (escapeHtml, timeAgo, formatFileSize, etc.)
│       ├── markdown.js          # Markdown rendering and XSS filtering
│       ├── ui.js                # Theme, sidebar, scrollbar, toast, pickers, input
│       ├── session.js           # Session list, cache, switch, create, delete, import
│       ├── chat.js              # Message stream, tool calls, AskUser, generating state
│       └── settings.js          # Settings panel (model/notify/Codex/CCSwitch/dev/password)
├── shared/commands.json         # Single slash-command manifest
├── scripts/                    # Regression script and mock CLIs
├── .github/workflows/ci.yml     # CI
├── .env.example
├── SECURITY.md
├── CONTRIBUTING.md
└── LICENSE
```

## Architecture

```text
Browser <-WebSocket-> Node.js <-local process/API-> Claude / Codex / Gemini / Hermes
```

- **Backend**: `server.js` assembles 11 modules under `lib/`, each with a single responsibility (routing, session storage, agent lifecycle, config management, notifications, etc.).
- **Frontend**: `app.js` is the entry point; 6 JS modules (helpers/markdown/ui/session/chat/settings) communicate via the `CCWeb` namespace, all IIFE pattern with zero build-tool dependencies.
- Claude, Codex, and Gemini run through local CLI subprocesses.
- Hermes is connected through Gateway SSE/API streams.
- Sessions are stored as JSON; important writes use temp-file plus rename atomic writes.
- Attachments are image-only, max 4 per message, max 10MB each, and expire after 7 days by default.
- Process logs are written to `logs/process.log` and rotate at 2MB.

## Security Boundary

Agent-Web is a local developer tool, not a public SaaS application. For remote access, use Tailscale, Cloudflare Tunnel, or a reverse proxy with HTTPS and access control.

Never commit:

- `.env`
- `config/*.json`
- `sessions/`
- `logs/`
- `attachments/`
- `.claude/`
- `.codex/`

See [SECURITY.md](./SECURITY.md).

## Development

```bash
npm run check
npm run regression
npm test
```

`npm test` runs syntax checks and the isolated regression suite. CI runs the same checks on Windows and Ubuntu with Node 18 and 22.
## Production Deployment

### systemd Service

Create `/etc/systemd/system/agent-web.service`:

```ini
[Unit]
Description=Agent-Web - Multi-Agent Web Chat UI
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/agent-web
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
# Important: only stop Node.js process, not Claude child processes
KillMode=process

[Install]
WantedBy=multi-user.target
```

`KillMode=process` is important. It ensures systemd restart only stops Node.js, while Claude subprocesses continue and are reattached after recovery.

```bash
sudo systemctl enable agent-web
sudo systemctl start agent-web
```

### Nginx Reverse Proxy

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8002;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Long-running tasks may take time
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### Windows Deployment

Use this mode when running Agent-Web on a personal PC and controlling Claude / Codex from mobile.

Start with `start.bat`, or run manually:

```cmd
cd agent-web
npm install
node server.js
```

**LAN access** (same Wi-Fi):
- Agent-Web defaults to `0.0.0.0:8002` so phones on the LAN can open `http://<your-lan-ip>:8002`.
- For local-only use, set `HOST=127.0.0.1`. For remote access, prefer a reverse proxy such as Nginx, Tailscale, or Cloudflare Tunnel, with firewall rules limiting who can connect.

**Remote access**:
- Recommended: [Tailscale](https://tailscale.com/) for secure private networking.
- Alternative: [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (requires domain setup).

## Release Notes

- **v1.3.0**
  - **Developer settings**: SSH host management (key/password auth) with `/ssh` command; GitHub token & repo management with `/github` command
  - **Unified settings panel**: Claude and Codex API configs now in one panel
  - **Local config templates**: read/snapshot/restore local API config with "本地配置" template
  - **New session redesign**: local/remote task selection, pinned directories, SSH remote host connection

- **v1.2.10**
  - Implemented `/init` behavior aligned with native Claude Code and Codex CLI

- **v1.2.8**
  - **Dual-agent (Codex)**: create Claude or Codex sessions on the same backend; agent-isolated sidebar, settings, and import
  - **Image upload**: drag, paste, or attach images in both Claude and Codex sessions; client-side WebP compression, 7-day server cache, up to 4 images per message
  - **Session loading**: loading overlay, hot session cache (4 slots, strong/weak hit), fix for streaming content disappearing on tab switch
  - **Theme system**: full theme engine with CoolVibe Light, washi, and editorial variants; theme picker moved to sub-page
  - **Mobile UX**: swipe-to-open/close sidebar, running-state badge replaces cwd label, button sizing fixes
  - **Backend refactor**: spawn spec + event parsing extracted to `lib/agent-runtime.js`; isolated regression script `npm run regression`

- **v1.2.2**
  - Aligned context compression with Claude Code native behavior: `/compact` is now actually sent to CLI instead of doing a local pseudo-reset.
  - Added automatic overflow recovery: when `Request too large (max 20MB)` occurs, Agent-Web runs `/compact` and replays the failed prompt automatically.
  - Added retry guard: if context is still too large after compacting, Agent-Web stops auto-retry and asks for a narrower prompt range.
- **v1.2.1**
  - Fixed missing `AskUserQuestion` options in Web UI by preserving structured tool input in backend and rendering question/option cards on frontend.
  - Added option-to-input shortcut: click an option to append it into the input box for quick confirmation.
- **v1.2**
  - Fixed layout overflow caused by long code blocks in messages. The page no longer stretches horizontally; code blocks scroll within the block.
  - Improved mobile input behavior: Enter inserts newline by default, and sending is done via the send button.
- **v1.1**
  - Added compatibility improvements for Claude Code CLI on Windows.

## Notes

- Claude support is still the more mature path, while Codex now supports isolated sessions, resume, import, background execution, and local cleanup.

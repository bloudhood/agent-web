# Agent-Web

> 4-Agent unified local console for **Claude Code**, **Codex CLI**, **Gemini CLI**, and **Hermes** — capability-driven UI, zero vendor lock-in, runs entirely on your machine.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

[中文 README](./README.md) · [Architecture](./docs/ARCHITECTURE.md) · [Capability Matrix](./docs/CAPABILITIES.md) · [Adding an Agent](./docs/ADDING_AN_AGENT.md) · [Changelog](./CHANGELOG.md)

## Why Agent-Web

| | Agent-Web | OpenWebUI / LobeChat | Single-agent CLI web |
|---|---|---|---|
| **Local first** | One-click `start.bat`, no cloud deps | Cloud models / vector DB heavy | Mostly local |
| **Multi-agent unified** | Claude / Codex / Gemini / Hermes share one UI | LLM-chat oriented | Single agent |
| **Extensible** | `AgentAdapter` + capabilities, ~30 min to add a new agent | Core changes required | Not extensible |
| **CLI-native alignment** | Thinking, tool calls, resume, permissions all map to native CLI semantics | LLM endpoint only | Depends |

## Features

- **Multi-agent sessions** — Claude, Codex, Gemini CLI, Hermes; sidebar tags each entry with the source agent.
- **Capability-driven UI** — thinking blocks, tool calls, permission prompts, slash menu, `/usage` `/cost` `/resume` automatically adapt to each agent's `capabilities`.
- **Native workflow alignment** — `/model`, `/mode`, `/permissions`, `/status`, `/usage`, `/resume`, `/doctor` web commands; `/` autocomplete parses the running CLI help.
- **Local history import** — from `~/.claude/projects/` and `~/.codex/sessions/`.
- **Process recovery** — sessions keep running after browser disconnects; idempotent reattach after server restart.
- **Hermes Gateway deepening** — conversations list, concurrent cancel, Last-Event-ID reconnect, localized errors.
- **Modern frontend** — Vite + Svelte 5 + Tailwind + bits-ui, ~50 KB gzip, mobile-friendly.
- **Two themes** — Washi Light / Washi Dark (warm Japanese aesthetic).

## Quick Start

```bash
git clone https://github.com/bloudhood/agent-web.git
cd agent-web
npm install
cp .env.example .env       # optional; a random password is generated on first launch
npm start
```

Windows users can double-click `start.bat`, or run `node server.js`. Open `http://localhost:8002`. The console prints a temporary password if none is configured; the UI requires you to change it after first login.

**LAN access** (phone + computer on the same Wi-Fi): the server binds `0.0.0.0:8002` by default. Set `HOST=127.0.0.1` for local-only. For remote access prefer Tailscale, Cloudflare Tunnel, or an HTTPS reverse proxy with auth.

## Prerequisites

- Node.js >= 18
- At least one local agent installed:

```bash
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
# Gemini CLI / Hermes: follow vendor docs.
```

Hermes needs a reachable Gateway; default is `http://127.0.0.1:8644`.

## Configuration

| Variable | Required | Default | Notes |
|---|:---:|---|---|
| `CC_WEB_PASSWORD` | no | auto-generated | Web login password; persisted to `config/auth.json` on first launch |
| `HOST` / `CC_WEB_HOST` | no | `0.0.0.0` | Bind address |
| `PORT` | no | `8002` | Bind port |
| `CLAUDE_PATH` | no | `claude` | Claude Code CLI binary |
| `CODEX_PATH` | no | `codex` | Codex CLI binary |
| `GEMINI_PATH` | no | `gemini` | Gemini CLI binary |
| `CC_WEB_HERMES_API_BASE` | no | `http://127.0.0.1:8644` | Hermes Gateway base URL |
| `CC_WEB_HERMES_API_KEY` | no | empty | Hermes Gateway bearer token |
| `CC_WEB_CONFIG_DIR` | no | `./config` | Override config directory |
| `CC_WEB_SESSIONS_DIR` | no | `./sessions` | Override session directory |
| `CC_WEB_LOGS_DIR` | no | `./logs` | Override log directory |

Sensitive files live under `config/`, sessions under `sessions/`, logs under `logs/`, attachments under `sessions/_attachments/`. All gitignored.

## Architecture

```text
Browser (Svelte 5)
  ↕ WebSocket (zod-validated)
Node.js
  ├─ AgentRegistry (one Adapter per agent)
  │   ├─ ClaudeAdapter ──► spawn `claude`
  │   ├─ CodexAdapter ──► spawn `codex`
  │   ├─ GeminiAdapter ──► spawn `gemini`
  │   └─ HermesAdapter ──► HTTP/SSE Gateway
  ├─ ChatOrchestrator / SlashOrchestrator / SettingsOrchestrator
  └─ SessionRepository / ConfigStore / AttachmentRepository
```

Full design in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). Adding a fifth agent in 30 minutes: [docs/ADDING_AN_AGENT.md](./docs/ADDING_AN_AGENT.md).

## Slash Commands

Web-handled: `/clear` `/model` `/mode` `/permissions` `/status` `/cost` `/usage` `/compact` `/init` `/resume` `/doctor` `/github` `/ssh` `/help`.

Native CLI management commands are recognized. Anything that requires a TTY or mutates global auth/config returns a terminal-only hint. Safe read commands stream live output through a child process.

## Diagnostics

- `GET /api/health` — version, PID, Node version, bind address, running task count, capability switches.
- `GET /api/commands` — slash command manifest.
- `GET /api/slash-completions?agent=claude&input=/mcp%20` — slash candidates for the current agent.

## Development

```bash
# Backend
npm run check         # node --check + tsc --noEmit
npm run unit          # vitest (130+ specs)
npm run regression    # mock CLI integration suite
npm test              # all of the above

# Frontend
npm run dev:web       # Vite HMR (proxies WS/HTTP to :8002)
npm run build:web     # Vite production build → public/
npx svelte-check --workspace web

# E2E
npm run e2e
```

CI runs on Windows + Ubuntu × Node 18/22, plus type-check and unit jobs. Build artifacts (`public/index.html` + `public/assets/`) are committed alongside source and CI verifies they stay in sync.

## Emergency Rollback

If the new frontend regresses, append `?legacy=1` to the URL to fall back to the previous IIFE frontend (kept under `public/legacy/`).

## Security Boundaries

Agent-Web is a local developer tool, not a public SaaS. For remote access use Tailscale, Cloudflare Tunnel, or an HTTPS reverse proxy with auth.

Do not commit publicly: `.env`, `config/*.json`, `sessions/`, `logs/`, `attachments/`, `.claude/`, `.codex/`. See [SECURITY.md](./SECURITY.md).

## Acknowledgements

Community fork maintained independently from [ZgDaniel/cc-web](https://github.com/ZgDaniel/cc-web).

## License

MIT

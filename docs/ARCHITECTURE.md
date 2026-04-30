# Agent-Web Architecture

This document is the maintainer-facing map for the project. Keep it aligned with code whenever runtime contracts change.

## Goals

- Local-first control surface for Claude Code, Codex CLI, Gemini CLI, and Hermes.
- Browser UI that can survive long-running local CLI work, tab switches, and reconnects.
- Explicit runtime contracts so new commands, agents, settings, and recovery behavior can be added without guessing.

## Runtime Shape

```text
Browser
  | HTTP: static assets, diagnostics, uploads
  | WebSocket: auth, session events, streaming deltas
Node server.js
  | local child processes: Claude / Codex / Gemini
  | HTTP/SSE: Hermes Gateway
  | JSON files: config, sessions, attachments
```

`server.js` is the composition root. It loads `.env`, builds shared state, wires `lib/*` modules, and starts HTTP/WebSocket listeners. Business logic should live under `lib/` or `public/js/`, not in new top-level scripts.

## Backend Modules

| Module | Responsibility |
|---|---|
| `lib/auth.js` | Password migration, token TTL, ban window, password change flow |
| `lib/session-store.js` | Session JSON persistence, session metadata, import/browse handlers |
| `lib/agent-manager.js` | Process lifecycle, running-state recovery, foreground/background event routing |
| `lib/agent-runtime.js` | Agent-specific spawn specs and stream/event parsing |
| `lib/routes.js` | HTTP and WebSocket dispatch plus slash-command routing |
| `lib/config-manager.js` | Model, Codex, CC Switch, local CLI config, developer config |
| `lib/notify.js` | Notification provider config and delivery |
| `lib/codex-rollouts.js` | Codex rollout/history parsing |
| `lib/utils.js` | Safe path checks, process launch normalization, JSON/static helpers |

When a module grows a second responsibility, prefer extracting the new responsibility behind a small factory that receives explicit dependencies. Avoid adding hidden globals.

## Frontend Modules

| Module | Responsibility |
|---|---|
| `public/app.js` | Shared state, DOM registry, WebSocket message dispatch, app boot |
| `public/js/ui.js` | Theme, sidebar, scroll, picker, slash completion, composer events |
| `public/js/session.js` | Unified recent session list, create/load/delete/import flows |
| `public/js/chat.js` | Message rendering, streaming deltas, tool call UI, generation state |
| `public/js/settings.js` | Full-screen runtime/settings center |
| `public/js/markdown.js` | Markdown rendering and XSS filtering |
| `public/js/helpers.js` | Pure browser utilities |

The frontend intentionally has no build step. Shared state is exposed through `window.CCWeb`; new code should keep DOM writes in the smallest relevant module and avoid re-binding input events in multiple places.

## Runtime Contracts

### HTTP

- `GET /api/health`: public diagnostic snapshot. It must not include secrets.
- `GET /api/commands`: slash command manifest from `shared/commands.json`.
- `GET /api/slash-completions`: native CLI help-backed slash completion.
- `POST /api/attachments`: authenticated image upload only.
- Static files are served from `public/` through path-boundary checks.

### WebSocket

Every streaming event that belongs to a session must include `sessionId`. The browser may keep multiple sessions running while viewing one foreground session. Background session events must update state without corrupting the foreground transcript.

Important event types:

- `session_info`, `session_list`
- `text_delta`, `tool_start`, `tool_end`, `usage`, `cost`
- `turn_done`, `done`, `error`
- settings/config results such as `ccswitch_state`

### Slash Commands

There are two command sources:

- Web commands: `shared/commands.json`, handled by Agent-Web.
- Native commands: parsed from the current local CLI `--help`; safe read commands may be executed through `spawn` and streamed, while TTY/global mutation commands must return terminal instructions.

Do not add a new slash command only in the frontend. Update the manifest or native CLI mapping, then add regression coverage.

### Process and Session State

- A session can be running while not foregrounded.
- Logical completion (`turn_done`) may arrive before the child process exits; the UI should accept follow-up input after logical completion.
- Do not detach existing active processes just because the user switches sessions.
- Session writes should remain atomic where existing helpers provide that behavior.

## Configuration

Common runtime variables:

- `HOST` / `CC_WEB_HOST`: bind address, default `0.0.0.0`.
- `PORT`: bind port, default `8002`.
- `CLAUDE_PATH`, `CODEX_PATH`, `GEMINI_PATH`: local CLI executables.
- `CC_WEB_CONFIG_DIR`, `CC_WEB_SESSIONS_DIR`, `CC_WEB_LOGS_DIR`: runtime directory overrides.
- `CC_WEB_HERMES_API_BASE`, `CC_WEB_HERMES_API_KEY`: Hermes Gateway.

Runtime-local directories (`config/`, `sessions/`, `logs/`, `attachments/`, `.claude/`, `.codex/`) must stay out of git.

## Regression Expectations

`npm test` is the minimum gate. It runs syntax checks and `scripts/regression.js`, which covers:

- auth failure isolation
- command manifest and slash completion contracts
- multi-agent sessions and background event scoping
- native command streaming
- CC Switch integration state
- mobile/layout invariants that previously regressed

When adding behavior, prefer extending `scripts/regression.js` with a mock CLI path before changing production code.

## Maintainer Checklist

- Is there one source of truth for the changed behavior?
- Can a user inspect the actual runtime state through `/api/health` or logs?
- Are secrets excluded from diagnostics and logs?
- Does the change preserve background running sessions?
- Did `npm test` pass on a clean runtime directory?

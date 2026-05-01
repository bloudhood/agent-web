# E2E Test Suite

These tests cover the seven critical user paths the new Svelte UI must support:

1. **Login** — temp password + remember-me + ban behavior.
2. **New session** — pick agent, create, foreground.
3. **Send message + stream** — receive `text_delta`, `tool_start`, `tool_end`, `turn_done`.
4. **Switch agent / model** — verify capability-driven UI.
5. **Import history** — Claude `~/.claude/projects/` and Codex rollouts.
6. **Change password** — typed via Settings panel.
7. **Theme toggle** — washi <-> washi-dark, persists via localStorage.

## Running

```bash
npm run build:web      # produce the Vite dist
npm start              # in another shell
npm run e2e            # this directory
```

Phase 3.4 will replace `npm start` with a Playwright `webServer` config that
boots `server.js` against mock CLIs (in `scripts/mock-*.js`) so e2e is self-
contained and CI-friendly.

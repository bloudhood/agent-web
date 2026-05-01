# Adding a New Agent

Adding a fifth agent (e.g. [Aider](https://aider.chat/), [Cline](https://github.com/cline/cline), or a private internal agent) is a **30-minute job** because the architecture pivots on `AgentAdapter`.

## Checklist

1. Add the agent id to `AgentId` in [src/core/session/session.ts](../src/core/session/session.ts).
2. Create `src/adapters/<id>/index.ts` exporting `create<Name>Adapter(runtime): AgentAdapter`.
3. Declare its `AgentCapabilities` (see the capability matrix in [CAPABILITIES.md](./CAPABILITIES.md)).
4. Implement either `buildSpawnSpec` (CLI-backed) or `buildGatewayCall` (HTTP-backed).
5. Implement `parseEvent` — receives the agent's raw event/output and emits normalized WS events.
6. Register the adapter in [src/adapters/index.ts](../src/adapters/index.ts).
7. Append entries to [shared/commands.json](../shared/commands.json) for any agent-specific slash commands.
8. Update [docs/CAPABILITIES.md](./CAPABILITIES.md) and [tests/unit/adapters/capabilities.test.ts](../tests/unit/adapters/capabilities.test.ts).
9. Add a contract test in `tests/contract/` that constructs the registry with a stub runtime and verifies the adapter is registered with the right capabilities.
10. Add a mock CLI in `scripts/mock-<id>.js` so the regression suite can exercise the adapter end-to-end.

## Worked Example — `aider` (sketch)

### 1. Extend AgentId

```ts
// src/core/session/session.ts
export type AgentId = 'claude' | 'codex' | 'hermes' | 'gemini' | 'aider';
export const VALID_AGENTS = ['claude', 'codex', 'hermes', 'gemini', 'aider'] as const;
```

### 2. Adapter

```ts
// src/adapters/aider/index.ts
import type { AgentAdapter, AgentCapabilities, AgentEntry, EmitFn } from '@core/agent/agent';
import type { Session } from '@core/session/session';

const CAP: AgentCapabilities = {
  attachments: false,
  thinkingBlocks: false,
  mcpTools: false,
  permissionModes: ['default'],
  resume: 'web-only',
  modelList: 'cli',
  usage: 'tokens',
};

export function createAiderAdapter(): AgentAdapter {
  return {
    id: 'aider' as any, // until the union widens
    displayName: 'Aider',
    capabilities: CAP,
    buildSpawnSpec(session: Session) {
      return {
        command: process.env.AIDER_PATH ?? 'aider',
        args: ['--no-show-diffs', '--stream'],
        env: { ...process.env },
        cwd: session.cwd ?? process.cwd(),
        parser: 'aider' as any,
        mode: 'default',
        resume: false,
      };
    },
    parseEvent(entry: AgentEntry, raw: unknown, sessionId: string, _emit: EmitFn) {
      // Convert aider's stream into text_delta / tool_start / tool_end events.
    },
  };
}
```

### 3. Register

```ts
// src/adapters/index.ts
import { createAiderAdapter } from './aider';

export function createBuiltInRegistry(runtime: BuiltInRuntimeFns): AgentRegistry {
  const registry = createAgentRegistry();
  registry.register(createClaudeAdapter(runtime));
  registry.register(createCodexAdapter(runtime));
  registry.register(createGeminiAdapter(runtime));
  registry.register(createHermesAdapter(runtime));
  registry.register(createAiderAdapter());
  return registry;
}
```

### 4. Slash commands

```json
// shared/commands.json (append)
{ "cmd": "/diff", "desc": "查看 aider 当前 diff", "kind": "web", "agents": ["aider"] }
```

### 5. Capability test

```ts
// tests/unit/adapters/capabilities.test.ts (extend)
it('Aider does not advertise attachments', () => {
  expect(cap('aider' as any).attachments).toBe(false);
});
```

### 6. Mock CLI for regression

```js
// scripts/mock-aider.js — emit a single fake response then exit
process.stdout.write('Hello from aider\n');
setTimeout(() => process.exit(0), 50);
```

## What you do **not** need to touch

- `lib/routes.js` — the slash command dispatch and orchestration is capability-driven.
- `web/src/features/chat/*` — the message stream, tool cards, thinking blocks, and permission prompts read capabilities, not agent ids.
- WS schema (`src/shared/ws-messages.ts`) — agnostic to agent identity.

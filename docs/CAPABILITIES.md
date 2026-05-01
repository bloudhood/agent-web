# Agent Capability Matrix

Locked by [tests/unit/adapters/capabilities.test.ts](../tests/unit/adapters/capabilities.test.ts). Every change here requires the corresponding adapter declaration in `src/adapters/<id>/index.ts` and a test update.

| Capability | Claude Code | Codex CLI | Gemini CLI | Hermes |
|---|:---:|:---:|:---:|:---:|
| **Connection** | spawn `claude` | spawn `codex` | spawn `gemini` | HTTP/SSE Gateway |
| **Image attachments** | yes | yes | no | no |
| **Thinking blocks** | yes | yes | yes | no |
| **MCP tools** | yes | yes | yes | yes |
| **Permission modes** | default · plan · yolo | default · plan · yolo | plan · yolo | yolo |
| **Resume strategy** | native (CLI) | native (CLI) | native (CLI) | web-only |
| **Model list source** | CLI help | CLI help | CLI help | Gateway endpoint |
| **Conversations API** | — | — | — | yes (Gateway) |
| **Inline permission prompt** | not yet (phase 3.1+) | no | no | no |
| **Usage display** | USD cost | tokens | tokens | tokens |
| **Slash menu source** | manifest + CLI help | manifest + CLI help | manifest + CLI help | manifest only |

## Roadmap Gaps

- **Claude inline permission prompts** — adapter capability flag is wired (`inlinePermissionPrompts: false` today). The frontend already renders `PermissionPrompt.svelte` when it receives a `permission_prompt` WS event, so we only need to add the spawn-side glue in [src/adapters/claude/index.ts](../src/adapters/claude/index.ts) that listens for the CLI's permission stream and forwards it. Estimated 2 days.
- **Gemini image attachments** — Gemini CLI does not currently accept `--image`. When it does, flip `attachments: true` in [src/adapters/gemini/index.ts](../src/adapters/gemini/index.ts) and add a contract test.
- **Hermes conversations panel** — server-side support for `GET /v1/conversations` is in [src/adapters/hermes/gateway-client.ts](../src/adapters/hermes/gateway-client.ts); frontend integration (sidebar tab + restore flow) is the remaining work.
- **Codex/OpenAI Responses API direct path** — phase 3 stretch; see plan under "Optional SDK paths".

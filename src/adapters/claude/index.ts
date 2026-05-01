/**
 * Claude adapter — wraps the existing JS runtime in lib/agent-runtime.js.
 *
 * Phase 1 keeps spawn-spec/event-parsing logic in the JS module to avoid
 * a risky big-bang rewrite. This module exposes the AgentAdapter contract
 * so application/orchestrator code can stop hard-coding `if (agent === 'claude')`.
 */

import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEntry,
  EmitFn,
  GatewayCall,
  SpawnError,
  SpawnOptions,
  SpawnSpec,
} from '@core/agent/agent';
import type { Session } from '@core/session/session';

export interface ClaudeRuntimeFns {
  buildClaudeSpawnSpec: (session: Session, opts?: SpawnOptions) => SpawnSpec | SpawnError;
  processClaudeEvent: (entry: AgentEntry, event: unknown, sessionId: string) => void;
}

const CLAUDE_CAPABILITIES: AgentCapabilities = {
  attachments: true,
  thinkingBlocks: true,
  mcpTools: true,
  permissionModes: ['default', 'plan', 'yolo'],
  resume: 'native',
  modelList: 'cli',
  inlinePermissionPrompts: false,
  usage: 'usd',
};

export function createClaudeAdapter(runtime: ClaudeRuntimeFns): AgentAdapter {
  return {
    id: 'claude',
    displayName: 'Claude',
    capabilities: CLAUDE_CAPABILITIES,

    buildSpawnSpec(session, opts) {
      return runtime.buildClaudeSpawnSpec(session, opts);
    },

    parseEvent(entry, raw, sessionId, _emit: EmitFn) {
      runtime.processClaudeEvent(entry, raw, sessionId);
    },

    listSlashCommands() {
      return [];
    },
  };
}

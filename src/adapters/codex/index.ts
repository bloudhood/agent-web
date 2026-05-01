import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEntry,
  EmitFn,
  SpawnError,
  SpawnOptions,
  SpawnSpec,
} from '@core/agent/agent';
import type { Session } from '@core/session/session';

export interface CodexRuntimeFns {
  buildCodexSpawnSpec: (session: Session, opts?: SpawnOptions) => SpawnSpec | SpawnError;
  processCodexEvent: (entry: AgentEntry, event: unknown, sessionId: string) => void;
}

const CODEX_CAPABILITIES: AgentCapabilities = {
  attachments: true,
  thinkingBlocks: true,
  mcpTools: true,
  permissionModes: ['default', 'plan', 'yolo'],
  resume: 'native',
  modelList: 'cli',
  inlinePermissionPrompts: false,
  usage: 'tokens',
};

export function createCodexAdapter(runtime: CodexRuntimeFns): AgentAdapter {
  return {
    id: 'codex',
    displayName: 'Codex',
    capabilities: CODEX_CAPABILITIES,

    buildSpawnSpec(session, opts) {
      return runtime.buildCodexSpawnSpec(session, opts);
    },

    parseEvent(entry, raw, sessionId, _emit: EmitFn) {
      runtime.processCodexEvent(entry, raw, sessionId);
    },

    listSlashCommands() {
      return [];
    },
  };
}

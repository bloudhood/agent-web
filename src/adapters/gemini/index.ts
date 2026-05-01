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

export interface GeminiRuntimeFns {
  buildGeminiSpawnSpec: (session: Session, opts?: SpawnOptions) => SpawnSpec | SpawnError;
  processGeminiEvent: (entry: AgentEntry, event: unknown, sessionId: string) => void;
}

const GEMINI_CAPABILITIES: AgentCapabilities = {
  attachments: false,
  thinkingBlocks: true,
  mcpTools: true,
  permissionModes: ['plan', 'yolo'],
  resume: 'native',
  modelList: 'cli',
  inlinePermissionPrompts: false,
  usage: 'tokens',
};

export function createGeminiAdapter(runtime: GeminiRuntimeFns): AgentAdapter {
  return {
    id: 'gemini',
    displayName: 'Gemini',
    capabilities: GEMINI_CAPABILITIES,

    buildSpawnSpec(session, opts) {
      return runtime.buildGeminiSpawnSpec(session, opts);
    },

    parseEvent(entry, raw, sessionId, _emit: EmitFn) {
      runtime.processGeminiEvent(entry, raw, sessionId);
    },

    listSlashCommands() {
      return [];
    },
  };
}

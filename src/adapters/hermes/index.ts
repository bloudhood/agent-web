import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEntry,
  EmitFn,
  GatewayCall,
  SpawnError,
  SpawnOptions,
} from '@core/agent/agent';
import type { Session } from '@core/session/session';

export interface HermesRuntimeFns {
  /**
   * Build the Gateway call descriptor for a given session.
   * Phase 1: not implemented (the manager wires SSE directly); reserved for Phase 3.2.
   */
  buildHermesGatewayCall?: (session: Session, opts?: SpawnOptions) => GatewayCall | SpawnError;
  processHermesEvent: (entry: AgentEntry, event: unknown, sessionId: string) => void;
}

const HERMES_CAPABILITIES: AgentCapabilities = {
  attachments: true,
  thinkingBlocks: false,
  mcpTools: true,
  permissionModes: ['yolo'],
  resume: 'web-only',
  modelList: 'gateway',
  conversations: 'gateway',
  inlinePermissionPrompts: false,
  usage: 'tokens',
};

export function createHermesAdapter(runtime: HermesRuntimeFns): AgentAdapter {
  return {
    id: 'hermes',
    displayName: 'Hermes',
    capabilities: HERMES_CAPABILITIES,

    buildGatewayCall(session, opts) {
      if (runtime.buildHermesGatewayCall) {
        return runtime.buildHermesGatewayCall(session, opts);
      }
      return { error: 'HermesAdapter.buildGatewayCall not yet wired (phase 3.2)' };
    },

    parseEvent(entry, raw, sessionId, _emit: EmitFn) {
      runtime.processHermesEvent(entry, raw, sessionId);
    },

    listSlashCommands() {
      return [];
    },
  };
}

/**
 * Shared application-layer types used by orchestrators.
 *
 * Orchestrators sit between transport (HTTP/WS) and infra/core. They take
 * already-validated WS payloads and turn them into domain operations.
 */

import type { AgentRegistry } from '@core/agent/registry';
import type { Session } from '@core/session/session';
import type { CommandManifestEntry } from '@shared/commands';

export interface WsClient {
  readyState: number;
  bufferedAmount?: number;
  send: (data: string) => void;
}

export type EmitToClient = (
  client: WsClient,
  payload: { type: string; [k: string]: unknown },
  dropIfBacklogged?: boolean,
) => void;

export interface SessionRepositoryFacade {
  load(sessionId: string): Session | null;
  save(session: Session): void;
  list(): Array<Pick<Session, 'id' | 'agent' | 'title' | 'updatedAt'>>;
}

export interface OrchestratorContext {
  registry: AgentRegistry;
  sessions: SessionRepositoryFacade;
  manifest: CommandManifestEntry[];
  emit: EmitToClient;
  log: (level: string, event: string, meta?: Record<string, unknown>) => void;
}

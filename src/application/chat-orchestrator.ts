/**
 * ChatOrchestrator — phase-1 minimal: validates and normalizes incoming chat
 * messages and delegates to a thin agent-manager facade.
 *
 * The actual spawn / streaming logic stays in lib/agent-manager.js for now;
 * this orchestrator gives us a typed seam to migrate to in subsequent phases.
 */

import type { AgentId, PermissionMode, Session } from '@core/session/session';
import type { AgentRegistry } from '@core/agent/registry';
import { ok, err, type Result, DomainError } from '@core/result';
import type { WsClient } from './types';

export interface IncomingChatMessage {
  sessionId: string;
  text: string;
  attachments?: Array<{ id: string; mime?: string; size?: number; name?: string }>;
}

export interface ChatGate {
  /** Runs only `text` validation; spawn is delegated. */
  preflight(msg: IncomingChatMessage, agent: AgentId): Result<void, DomainError>;
}

export interface AgentManagerFacade {
  handleMessage(
    ws: WsClient,
    sessionId: string,
    text: string,
    attachments?: IncomingChatMessage['attachments'],
  ): Promise<void> | void;
  handleAbort(ws: WsClient, sessionId: string): Promise<void> | void;
}

export interface ChatOrchestrator {
  preflight: ChatGate['preflight'];
  send(ws: WsClient, msg: IncomingChatMessage, session: Session): Promise<Result<void, DomainError>>;
  abort(ws: WsClient, sessionId: string): Promise<void>;
}

export function createChatOrchestrator(opts: {
  registry: AgentRegistry;
  agentManager: AgentManagerFacade;
  maxAttachments: number;
}): ChatOrchestrator {
  const { registry, agentManager, maxAttachments } = opts;

  function preflight(msg: IncomingChatMessage, agent: AgentId): Result<void, DomainError> {
    if (!msg.sessionId) return err(new DomainError('MISSING_SESSION', '缺少 sessionId'));
    if (typeof msg.text !== 'string') return err(new DomainError('BAD_TEXT', 'text 必须是字符串'));
    const adapter = registry.get(agent);
    if (!adapter) return err(new DomainError('UNKNOWN_AGENT', `未注册的 Agent: ${agent}`));
    const attCount = msg.attachments?.length || 0;
    if (attCount > 0 && !adapter.capabilities.attachments) {
      return err(new DomainError('NO_ATTACHMENTS_SUPPORT', `${adapter.displayName} 不支持附件`));
    }
    if (attCount > maxAttachments) {
      return err(new DomainError('TOO_MANY_ATTACHMENTS', `单条消息附件不超过 ${maxAttachments} 个`));
    }
    return ok(undefined);
  }

  return {
    preflight,
    async send(ws, msg, session) {
      const pre = preflight(msg, session.agent);
      if (!pre.ok) return pre;
      await agentManager.handleMessage(ws, msg.sessionId, msg.text, msg.attachments);
      return ok(undefined);
    },
    async abort(ws, sessionId) {
      await agentManager.handleAbort(ws, sessionId);
    },
  };
}

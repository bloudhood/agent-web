/**
 * Bridge between the typed WS client and the Svelte stores.
 *
 * Server messages are dispatched into authStore / sessionsStore / chatStore /
 * toastStore. Client-initiated messages have small helpers here so views
 * don't have to know the wire format.
 */

import type { WsClient } from './ws';
import { authStore } from './stores/auth.svelte';
import { sessionsStore } from './stores/sessions.svelte';
import { chatStore } from './stores/chat.svelte';
import { toastStore } from './stores/toast.svelte';
import { normalizeHistoryMessages, type ServerHistoryMessage } from './history-normalizer';
import type { WsOutbound } from '@shared/ws-messages';

export function bindStoresToWs(ws: WsClient): () => void {
  return ws.on((msg: WsOutbound) => {
    switch (msg.type) {
      case 'auth_result': {
        const m = msg as { success: boolean; token?: string; banned?: boolean; mustChangePassword?: boolean };
        if (m.success && m.token) {
          authStore.setToken(m.token);
          authStore.setMustChange(!!m.mustChangePassword);
          authStore.setError(null);
          authStore.setBanned(false);
        } else {
          authStore.setToken(null);
          authStore.setBanned(!!m.banned);
          authStore.setError(m.banned ? '该 IP 已被封禁' : '密码错误');
        }
        return;
      }

      case 'session_list': {
        const m = msg as { sessions?: unknown[] };
        if (Array.isArray(m.sessions)) {
          sessionsStore.replaceList(m.sessions as Parameters<typeof sessionsStore.replaceList>[0]);
          if (sessionsStore.currentId && !sessionsStore.list.some((s) => s.id === sessionsStore.currentId)) {
            sessionsStore.setCurrent(null);
            chatStore.setForeground(null);
            chatStore.reset();
          }
        }
        return;
      }

      case 'session_info': {
        const m = msg as {
          sessionId: string;
          title?: string;
          messages?: Array<{
            role?: string;
            content?: unknown;
            text?: string;
            timestamp?: string | number | null;
            ts?: number;
            toolCalls?: unknown[];
            thinking?: string;
          }>;
          isRunning?: boolean;
          totalCost?: number;
          totalUsage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
          mode?: string;
          model?: string;
          cwd?: string;
          agent?: string;
          updated?: string | null;
          hasUnread?: boolean;
        };
        // `session_info` is the authoritative "this session is now open" frame
        // after new_session/load_session/import. Without setting current here,
        // new-session and composer send flows wait forever on a null currentId.
        const agent = (m.agent === 'claude' || m.agent === 'codex' || m.agent === 'gemini' || m.agent === 'hermes')
          ? m.agent
          : sessionsStore.currentAgent;
        sessionsStore.upsert({
          id: m.sessionId,
          title: m.title || 'Untitled',
          agent,
          updated: m.updated ?? null,
          isRunning: m.isRunning,
          hasUnread: !!m.hasUnread,
          totalCost: m.totalCost,
          totalUsage: m.totalUsage,
          mode: (m.mode as 'default' | 'plan' | 'yolo' | undefined),
          model: m.model,
          cwd: m.cwd,
        });
        sessionsStore.setCurrent(m.sessionId);
        chatStore.setForeground(m.sessionId);

        chatStore.reset(normalizeHistoryMessages(m.messages || []));
        return;
      }

      case 'session_history_chunk': {
        const m = msg as { sessionId?: string; messages?: ServerHistoryMessage[] };
        if (m.sessionId && m.sessionId === chatStore.foregroundSessionId) {
          chatStore.prependMessages(normalizeHistoryMessages(m.messages || []));
        }
        return;
      }

      case 'text_delta': {
        const m = msg as { sessionId?: string; text: string };
        if (m.sessionId && m.sessionId !== chatStore.foregroundSessionId) {
          sessionsStore.update(m.sessionId, { isRunning: true });
        } else {
          chatStore.appendDelta(m.text);
        }
        return;
      }

      case 'tool_start': {
        const m = msg as {
          sessionId?: string;
          toolUseId: string;
          name: string;
          input?: unknown;
          kind?: string | null;
          meta?: Record<string, unknown> | null;
        };
        if (m.sessionId && m.sessionId !== chatStore.foregroundSessionId) {
          sessionsStore.update(m.sessionId, { isRunning: true });
        } else {
          chatStore.upsertTool({
            id: m.toolUseId,
            name: m.name,
            input: m.input,
            kind: m.kind,
            meta: m.meta,
          });
        }
        return;
      }

      case 'tool_end': {
        const m = msg as {
          sessionId?: string;
          toolUseId: string;
          result?: string;
          meta?: Record<string, unknown> | null;
        };
        if (!m.sessionId || m.sessionId === chatStore.foregroundSessionId) {
          chatStore.completeTool(m.toolUseId, m.result, m.meta);
        }
        return;
      }

      case 'turn_done':
      case 'done': {
        const m = msg as { sessionId?: string };
        if (!m.sessionId || m.sessionId === chatStore.foregroundSessionId) {
          chatStore.finishTurn();
        } else {
          sessionsStore.update(m.sessionId, { isRunning: false });
        }
        return;
      }

      case 'cost': {
        const m = msg as { sessionId?: string; costUsd: number };
        const id = m.sessionId || chatStore.foregroundSessionId;
        if (id) sessionsStore.update(id, { totalCost: m.costUsd });
        return;
      }

      case 'usage': {
        const m = msg as { sessionId?: string; totalUsage: { inputTokens: number; cachedInputTokens: number; outputTokens: number } };
        const id = m.sessionId || chatStore.foregroundSessionId;
        if (id) sessionsStore.update(id, { totalUsage: m.totalUsage });
        return;
      }

      case 'error': {
        const m = msg as { sessionId?: string; message: string };
        if (!m.sessionId || m.sessionId === chatStore.foregroundSessionId) {
          chatStore.failTurn(m.message);
        }
        toastStore.danger('错误', m.message);
        return;
      }

      case 'background_done': {
        const m = msg as { sessionId: string; title?: string };
        toastStore.success(`「${m.title || 'Untitled'}」已完成`);
        sessionsStore.update(m.sessionId, { isRunning: false });
        return;
      }

      case 'system_message': {
        const m = msg as { message: string };
        if (m.message) {
          chatStore.appendMessage({ role: 'system', text: m.message, ts: Date.now() });
        }
        return;
      }

      case 'session_renamed': {
        const m = msg as { sessionId: string; title: string };
        sessionsStore.update(m.sessionId, { title: m.title });
        return;
      }

      case 'mode_changed': {
        const m = msg as { mode?: 'default' | 'plan' | 'yolo' };
        if (m.mode && chatStore.foregroundSessionId) {
          sessionsStore.update(chatStore.foregroundSessionId, { mode: m.mode });
        }
        return;
      }

      case 'model_changed': {
        const m = msg as { model?: string };
        if (m.model && chatStore.foregroundSessionId) {
          sessionsStore.update(chatStore.foregroundSessionId, { model: m.model });
        }
        return;
      }

      case 'resume_generating': {
        const m = msg as { text?: string; toolCalls?: Array<{ id: string; name: string; input?: unknown; result?: string; kind?: string | null; meta?: Record<string, unknown> | null; done?: boolean }> };
        if (m.text) chatStore.appendDelta(m.text);
        if (Array.isArray(m.toolCalls)) {
          for (const tc of m.toolCalls) {
            chatStore.upsertTool({ id: tc.id, name: tc.name, input: tc.input, kind: tc.kind, meta: tc.meta, done: tc.done });
            if (tc.done && tc.result) chatStore.completeTool(tc.id, tc.result, tc.meta);
          }
        }
        return;
      }

      case 'thinking_delta': {
        const m = msg as { sessionId?: string; text: string };
        if (!m.sessionId || m.sessionId === chatStore.foregroundSessionId) {
          chatStore.appendThinking(m.text);
        }
        return;
      }

      case 'permission_prompt': {
        const m = msg as {
          sessionId: string;
          promptId: string;
          toolName: string;
          toolInput?: unknown;
          options?: Array<'allow_once' | 'allow_always' | 'reject'>;
        };
        if (m.sessionId === chatStore.foregroundSessionId) {
          chatStore.pushPrompt({
            promptId: m.promptId,
            sessionId: m.sessionId,
            toolName: m.toolName,
            toolInput: m.toolInput,
            options: m.options ?? ['allow_once', 'reject'],
          });
        }
        return;
      }

      case 'password_changed': {
        const m = msg as { success: boolean; token?: string; message?: string };
        if (m.success) {
          if (m.token) authStore.setToken(m.token);
          authStore.setMustChange(false);
          localStorage.removeItem('cc-web-pw');
          toastStore.success('密码修改成功', m.message);
        } else {
          toastStore.warning('密码修改失败', m.message || '请检查当前密码');
        }
        return;
      }
    }
  });
}

export function sendPermissionResponse(
  ws: WsClient,
  sessionId: string,
  promptId: string,
  decision: 'allow_once' | 'allow_always' | 'reject',
): boolean {
  return ws.send({ type: 'permission_response', sessionId, promptId, decision });
}

export function sendAuth(ws: WsClient, password: string): boolean {
  return ws.send({ type: 'auth', password });
}

export function sendAuthToken(ws: WsClient, token: string): boolean {
  return ws.send({ type: 'auth', token });
}

export function sendListSessions(ws: WsClient): boolean {
  return ws.send({ type: 'list_sessions' });
}

export function sendLoadSession(ws: WsClient, sessionId: string): boolean {
  return ws.send({ type: 'load_session', sessionId });
}

export function sendMessage(
  ws: WsClient,
  sessionId: string,
  text: string,
  attachments?: Array<{ id: string }>,
): boolean {
  // Server expects type: 'message'. Mode is sent so the server can pick a
  // permission mode for this turn (Claude Code requires it explicitly).
  return ws.send({ type: 'message', sessionId, text, attachments });
}

export function sendAbort(ws: WsClient, sessionId: string): boolean {
  return ws.send({ type: 'abort', sessionId });
}

export interface NewSessionOptions {
  agent: 'claude' | 'codex' | 'gemini' | 'hermes';
  title?: string;
  cwd?: string;
  model?: string;
  /** Server-side field name is `mode`, not `permissionMode`. */
  mode?: 'default' | 'plan' | 'yolo';
}

export function sendNewSession(ws: WsClient, opts: NewSessionOptions): boolean {
  return ws.send({ type: 'new_session', ...opts });
}

export function sendDeleteSession(ws: WsClient, sessionId: string): boolean {
  return ws.send({ type: 'delete_session', sessionId });
}

export function sendRenameSession(ws: WsClient, sessionId: string, title: string): boolean {
  return ws.send({ type: 'rename_session', sessionId, title });
}

export function sendSetMode(
  ws: WsClient,
  sessionId: string,
  mode: 'default' | 'plan' | 'yolo',
): boolean {
  return ws.send({ type: 'set_mode', sessionId, mode });
}

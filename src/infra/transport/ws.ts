/**
 * WS dispatcher — single entry that parses raw frames into validated
 * inbound messages and routes them to handlers, with a fallback for
 * unknown types so phase-1 can co-exist with the legacy lib/routes.js.
 */

import { parseInbound, type WsInbound } from '@shared/ws-messages';

export type WsHandler = (msg: WsInbound, ctx: { client: WsClient }) => void | Promise<void>;

export interface WsClient {
  readyState: number;
  bufferedAmount?: number;
  send: (data: string) => void;
}

export interface WsDispatcher {
  on(type: string, handler: WsHandler): void;
  /** Returns true if the message was handled, false otherwise (fallback to legacy). */
  dispatch(client: WsClient, raw: unknown): Promise<boolean>;
}

export function createWsDispatcher(opts: {
  onParseError?: (raw: unknown) => void;
  onUnhandled?: (msg: WsInbound, client: WsClient) => void;
} = {}): WsDispatcher {
  const handlers = new Map<string, WsHandler>();

  return {
    on(type, handler) {
      handlers.set(type, handler);
    },
    async dispatch(client, raw) {
      const parsed = parseInbound(raw);
      if (!parsed) {
        opts.onParseError?.(raw);
        return false;
      }
      const handler = handlers.get(parsed.type);
      if (!handler) {
        opts.onUnhandled?.(parsed, client);
        return false;
      }
      await handler(parsed, { client });
      return true;
    },
  };
}

const WS_BACKLOG_LIMIT = 4 * 1024 * 1024;

export function safeSend(
  client: WsClient,
  payload: unknown,
  dropIfBacklogged = false,
): boolean {
  if (!client || client.readyState !== 1) return false;
  if (dropIfBacklogged && (client.bufferedAmount ?? 0) > WS_BACKLOG_LIMIT) return false;
  try {
    client.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

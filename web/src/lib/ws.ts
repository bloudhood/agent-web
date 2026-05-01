/**
 * Type-safe WebSocket client.
 *
 * - Validates inbound frames with the zod schema from src/shared/ws-messages.ts.
 * - Reconnects with exponential backoff.
 * - Exposes a typed event subscription API.
 */

import { parseOutbound, type WsOutbound } from '@shared/ws-messages';

type Listener = (msg: WsOutbound) => void;

export interface WsClient {
  connect(): void;
  disconnect(): void;
  send(payload: unknown): boolean;
  on(handler: Listener): () => void;
  state(): WsState;
}

export type WsState = 'idle' | 'connecting' | 'open' | 'closed' | 'reconnecting';

export interface WsOptions {
  url: string;
  /** Initial backoff in ms (default 1000). */
  initialBackoffMs?: number;
  /** Cap on backoff (default 30000). */
  maxBackoffMs?: number;
  /** Called whenever connection state changes. */
  onStateChange?: (state: WsState) => void;
  /** Called on parse failure. */
  onParseError?: (raw: string) => void;
}

export function createWsClient(opts: WsOptions): WsClient {
  const {
    url,
    initialBackoffMs = 1000,
    maxBackoffMs = 30000,
    onStateChange,
    onParseError,
  } = opts;

  let socket: WebSocket | null = null;
  let listeners = new Set<Listener>();
  let state: WsState = 'idle';
  let attempts = 0;
  let reconnectTimer: number | null = null;
  let manuallyClosed = false;

  function setState(next: WsState) {
    state = next;
    onStateChange?.(next);
  }

  function scheduleReconnect() {
    if (reconnectTimer != null) return;
    if (manuallyClosed) return;
    setState('reconnecting');
    const delay = Math.min(initialBackoffMs * Math.pow(2, attempts), maxBackoffMs);
    attempts += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    manuallyClosed = false;
    setState('connecting');
    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      attempts = 0;
      setState('open');
    };
    socket.onmessage = (e) => {
      let raw: unknown;
      try { raw = JSON.parse(e.data); } catch { onParseError?.(String(e.data)); return; }
      const parsed = parseOutbound(raw);
      if (!parsed) { onParseError?.(String(e.data)); return; }
      for (const l of listeners) l(parsed);
    };
    socket.onclose = () => {
      setState('closed');
      socket = null;
      scheduleReconnect();
    };
    socket.onerror = () => {
      // onclose will fire afterwards; nothing to do here besides prevent unhandled.
    };
  }

  return {
    connect,
    disconnect() {
      manuallyClosed = true;
      if (reconnectTimer != null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (socket && socket.readyState <= 1) socket.close();
      setState('idle');
    },
    send(payload) {
      if (!socket || socket.readyState !== 1) return false;
      try { socket.send(JSON.stringify(payload)); return true; }
      catch { return false; }
    },
    on(handler) {
      listeners.add(handler);
      return () => { listeners.delete(handler); };
    },
    state: () => state,
  };
}

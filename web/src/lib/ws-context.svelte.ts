import { createWsClient, type WsClient, type WsState } from './ws';
import { bindStoresToWs } from './ws-bridge';
import { authStore } from './stores/auth.svelte';
import { toastStore } from './stores/toast.svelte';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

let ws: WsClient | null = null;
let wsState = $state<WsState>('idle');

export function getWsClient(): WsClient {
  if (ws) return ws;
  ws = createWsClient({
    url: WS_URL,
    onStateChange(s) { wsState = s; },
    onParseError(raw) { console.warn('[ws] failed to parse', raw); },
  });
  bindStoresToWs(ws);
  ws.connect();
  return ws;
}

export function getWsState(): WsState { return wsState; }

/** Resend the cached token whenever the socket re-opens. */
export function ensureAuth() {
  const w = getWsClient();
  $effect(() => {
    if (wsState === 'open' && authStore.token) {
      w.send({ type: 'auth', token: authStore.token });
    }
  });
  $effect(() => {
    if (wsState === 'reconnecting') {
      toastStore.info('正在重连…', '与本地 Agent-Web 服务器的连接已断开');
    }
  });
}

import { describe, it, expect, vi } from 'vitest';
import { createWsDispatcher, safeSend } from '../../../src/infra/transport/ws';

const fakeClient = (overrides: Partial<{ readyState: number; bufferedAmount: number }> = {}) => ({
  readyState: overrides.readyState ?? 1,
  bufferedAmount: overrides.bufferedAmount ?? 0,
  sent: [] as string[],
  send(s: string) { this.sent.push(s); },
});

describe('WsDispatcher', () => {
  it('routes typed messages to handlers', async () => {
    const dispatcher = createWsDispatcher();
    const handler = vi.fn();
    dispatcher.on('auth', handler);

    const client = fakeClient();
    const handled = await dispatcher.dispatch(client as any, { type: 'auth', password: 'x' });
    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it('returns false for unknown type and calls onUnhandled', async () => {
    const onUnhandled = vi.fn();
    const dispatcher = createWsDispatcher({ onUnhandled });
    const client = fakeClient();
    const handled = await dispatcher.dispatch(client as any, { type: 'mystery_x' });
    expect(handled).toBe(false);
    expect(onUnhandled).toHaveBeenCalled();
  });

  it('returns false for malformed payload and calls onParseError', async () => {
    const onParseError = vi.fn();
    const dispatcher = createWsDispatcher({ onParseError });
    const client = fakeClient();
    const handled = await dispatcher.dispatch(client as any, null as any);
    expect(handled).toBe(false);
    expect(onParseError).toHaveBeenCalled();
  });
});

describe('safeSend', () => {
  it('sends when client is open', () => {
    const c = fakeClient({ readyState: 1 });
    expect(safeSend(c as any, { hello: 'world' })).toBe(true);
    expect(c.sent[0]).toBe('{"hello":"world"}');
  });

  it('skips when client closed', () => {
    const c = fakeClient({ readyState: 3 });
    expect(safeSend(c as any, { x: 1 })).toBe(false);
  });

  it('drops when backlogged and dropIfBacklogged is true', () => {
    const c = fakeClient({ bufferedAmount: 5 * 1024 * 1024 });
    expect(safeSend(c as any, { x: 1 }, true)).toBe(false);
  });
});

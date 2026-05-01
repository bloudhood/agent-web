import { describe, it, expect, vi } from 'vitest';
import { createSseConsumer } from '../../../src/adapters/hermes/sse-stream';

describe('SSE consumer', () => {
  it('parses a single event', () => {
    const onEvent = vi.fn();
    const c = createSseConsumer({ onEvent });
    c.feed('event: ping\ndata: hello\n\n');
    expect(onEvent).toHaveBeenCalledWith({ event: 'ping', data: 'hello', id: undefined });
  });

  it('joins multiline data', () => {
    const onEvent = vi.fn();
    const c = createSseConsumer({ onEvent });
    c.feed('data: line1\ndata: line2\n\n');
    expect(onEvent).toHaveBeenCalledWith({ event: undefined, id: undefined, data: 'line1\nline2' });
  });

  it('tracks last event id across frames', () => {
    const onEvent = vi.fn();
    const c = createSseConsumer({ onEvent });
    c.feed('id: 1\nevent: a\ndata: x\n\n');
    c.feed('id: 2\nevent: b\ndata: y\n\n');
    expect(c.lastEventId()).toBe('2');
  });

  it('handles \\r\\n\\r\\n frame separators', () => {
    const onEvent = vi.fn();
    const c = createSseConsumer({ onEvent });
    c.feed('event: ping\r\ndata: ok\r\n\r\n');
    expect(onEvent).toHaveBeenCalledWith({ event: 'ping', id: undefined, data: 'ok' });
  });

  it('flushes pending block on close', () => {
    const onEvent = vi.fn();
    const onClose = vi.fn();
    const c = createSseConsumer({ onEvent, onClose });
    c.feed('event: end\ndata: bye\n');
    c.close();
    expect(onEvent).toHaveBeenCalledWith({ event: 'end', id: undefined, data: 'bye' });
    expect(onClose).toHaveBeenCalledWith(null);
  });

  it('ignores comment lines', () => {
    const onEvent = vi.fn();
    const c = createSseConsumer({ onEvent });
    c.feed(': keep-alive\nevent: ping\ndata: x\n\n');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('skips events without data', () => {
    const onEvent = vi.fn();
    const c = createSseConsumer({ onEvent });
    c.feed('event: meta\nid: 1\n\n');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('handles partial chunks across feeds', () => {
    const onEvent = vi.fn();
    const c = createSseConsumer({ onEvent });
    c.feed('event: ping\nda');
    c.feed('ta: hi\n\n');
    expect(onEvent).toHaveBeenCalledWith({ event: 'ping', id: undefined, data: 'hi' });
  });
});

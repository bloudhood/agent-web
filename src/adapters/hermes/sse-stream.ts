/**
 * Resilient SSE consumer for Hermes responses.
 *
 * - Parses SSE frames according to https://html.spec.whatwg.org/multipage/server-sent-events.html
 * - Tracks `id:` lines so the consumer can reconnect with `Last-Event-ID`.
 * - Surfaces a clean `onEvent / onClose / onError` callback API.
 */

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

export interface SseConsumerOptions {
  onEvent: (event: SseEvent) => void;
  onClose?: (lastEventId: string | null) => void;
  onError?: (error: Error) => void;
}

export interface SseConsumer {
  feed(chunk: string): void;
  close(): void;
  lastEventId(): string | null;
}

export function createSseConsumer(opts: SseConsumerOptions): SseConsumer {
  let buffer = '';
  let lastEventId: string | null = null;
  let closed = false;

  function dispatchBlock(block: string) {
    if (!block.trim()) return;
    let event: string | undefined;
    let id: string | undefined;
    const dataLines: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^\s/, '');
      if (field === 'event') event = value;
      else if (field === 'id') { id = value; lastEventId = value; }
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length === 0) return;
    opts.onEvent({ id, event, data: dataLines.join('\n') });
  }

  return {
    feed(chunk) {
      if (closed) return;
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        try { dispatchBlock(block); } catch (e) {
          opts.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
      }
      // Some servers terminate frames with \r\n\r\n
      while ((idx = buffer.indexOf('\r\n\r\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 4);
        try { dispatchBlock(block); } catch (e) {
          opts.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
      }
    },
    close() {
      if (closed) return;
      closed = true;
      if (buffer.trim().length > 0) {
        try { dispatchBlock(buffer); } catch (e) {
          opts.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
        buffer = '';
      }
      opts.onClose?.(lastEventId);
    },
    lastEventId: () => lastEventId,
  };
}

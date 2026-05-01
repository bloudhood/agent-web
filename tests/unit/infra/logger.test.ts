import { describe, it, expect, vi } from 'vitest';
import { createLogger, fromPlog } from '@infra/log/logger';

describe('Logger', () => {
  it('respects level filter', () => {
    const sink = vi.fn();
    const log = createLogger({ sink, level: 'WARN' });
    log.info('skip', { x: 1 });
    log.debug('skip2');
    log.warn('keep');
    log.error('keep2');
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls.map((c) => c[1])).toEqual(['keep', 'keep2']);
  });

  it('with() merges contexts', () => {
    const sink = vi.fn();
    const base = createLogger({ sink, context: { app: 'agent-web' } });
    const scoped = base.with({ sessionId: 's1' });
    scoped.info('event', { foo: 'bar' });
    expect(sink).toHaveBeenCalledWith('INFO', 'event', { app: 'agent-web', sessionId: 's1', foo: 'bar' });
  });

  it('fromPlog adapts a legacy plog function', () => {
    const plog = vi.fn();
    const log = fromPlog(plog);
    log.error('boom', { e: 1 });
    expect(plog).toHaveBeenCalledWith('ERROR', 'boom', { e: 1 });
  });
});

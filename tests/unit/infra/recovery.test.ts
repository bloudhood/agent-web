import { describe, it, expect, vi } from 'vitest';
import { runRecovery } from '@infra/process/recovery';

const fakeDeadPid = 9_999_999;
const livingPid = process.pid;

describe('runRecovery', () => {
  it('attaches living processes', () => {
    const records = [
      { sessionId: 's-alive', pid: livingPid, startedAt: 0 },
    ];
    const repo = { list: () => records, remove: vi.fn() };
    const attach = vi.fn().mockReturnValue(true);
    const r = runRecovery(repo, {
      alreadyAttached: () => false,
      attach,
      log: vi.fn(),
    });
    expect(r.attached).toEqual(['s-alive']);
    expect(attach).toHaveBeenCalled();
  });

  it('skips already-attached', () => {
    const records = [{ sessionId: 's-attached', pid: livingPid, startedAt: 0 }];
    const repo = { list: () => records, remove: vi.fn() };
    const r = runRecovery(repo, {
      alreadyAttached: () => true,
      attach: vi.fn(),
      log: vi.fn(),
    });
    expect(r.skippedAttached).toEqual(['s-attached']);
  });

  it('cleans dead pid from repository', () => {
    const records = [{ sessionId: 's-dead', pid: fakeDeadPid, startedAt: 0 }];
    const remove = vi.fn();
    const repo = { list: () => records, remove };
    const r = runRecovery(repo, {
      alreadyAttached: () => false,
      attach: vi.fn(),
      log: vi.fn(),
    });
    expect(r.cleanedDead).toEqual(['s-dead']);
    expect(remove).toHaveBeenCalledWith('s-dead');
  });

  it('errors during attach are captured and logged', () => {
    const records = [{ sessionId: 's-err', pid: livingPid, startedAt: 0 }];
    const repo = { list: () => records, remove: vi.fn() };
    const log = vi.fn();
    const r = runRecovery(repo, {
      alreadyAttached: () => false,
      attach: () => { throw new Error('boom'); },
      log,
    });
    expect(r.errors[0]).toMatchObject({ sessionId: 's-err', message: 'boom' });
    expect(log).toHaveBeenCalledWith('ERROR', 'recovery_attach_failed', expect.any(Object));
  });

  it('is idempotent across runs', () => {
    const records = [{ sessionId: 's', pid: livingPid, startedAt: 0 }];
    const repo = { list: () => records, remove: vi.fn() };
    const attach = vi.fn().mockReturnValue(true);
    const attached = new Set<string>();
    const opts = {
      alreadyAttached: (id: string) => attached.has(id),
      attach: (rec: { sessionId: string }) => { attached.add(rec.sessionId); return true; },
      log: vi.fn(),
    };
    const r1 = runRecovery(repo, opts);
    const r2 = runRecovery(repo, opts);
    expect(r1.attached).toEqual(['s']);
    expect(r2.attached).toEqual([]);
    expect(r2.skippedAttached).toEqual(['s']);
  });
});

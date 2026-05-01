import { describe, it, expect, vi } from 'vitest';
import { inspectActiveProcesses, createHeartbeatRunner, isPidAlive, type HeartbeatEntry } from '@infra/process/heartbeat';

const livingPid = process.pid;
const deadPid = 1; // pid 1 on most systems is init; exists. Use a guaranteed-dead big pid:
const fakeDeadPid = 9_999_999;

describe('isPidAlive', () => {
  it('returns true for current process', () => {
    expect(isPidAlive(livingPid)).toBe(true);
  });
  it('returns false for non-existent pid', () => {
    expect(isPidAlive(fakeDeadPid)).toBe(false);
  });
  it('returns false for falsy input', () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(NaN as unknown as number)).toBe(false);
  });
});

function makeEntry(pid: number, overrides: Partial<HeartbeatEntry> = {}): HeartbeatEntry {
  return {
    pid,
    ws: { readyState: 1, bufferedAmount: 0 },
    ...overrides,
  };
}

describe('inspectActiveProcesses', () => {
  it('marks dead pid as zombie', () => {
    const map = new Map<string, HeartbeatEntry>();
    map.set('s1', makeEntry(fakeDeadPid));
    const r = inspectActiveProcesses(map.entries(), 0);
    expect(r.zombies).toEqual(['s1']);
    expect(r.processes[0].alive).toBe(false);
    expect(r.processes[0].zombie).toBe(true);
  });

  it('does not flag reaped entries as zombie', () => {
    const map = new Map<string, HeartbeatEntry>();
    map.set('s1', makeEntry(fakeDeadPid, { reaped: true }));
    const r = inspectActiveProcesses(map.entries(), 0);
    expect(r.zombies).toEqual([]);
  });

  it('flags backpressured WS', () => {
    const map = new Map<string, HeartbeatEntry>();
    map.set('s1', { pid: livingPid, ws: { readyState: 1, bufferedAmount: 5 * 1024 * 1024 } });
    const r = inspectActiveProcesses(map.entries(), 0, { bufferedThresholdBytes: 4 * 1024 * 1024 });
    expect(r.backpressured).toEqual(['s1']);
  });

  it('reports activeCount and wsClients', () => {
    const map = new Map<string, HeartbeatEntry>();
    map.set('s1', makeEntry(livingPid));
    map.set('s2', makeEntry(livingPid));
    const r = inspectActiveProcesses(map.entries(), 5);
    expect(r.activeCount).toBe(2);
    expect(r.wsClients).toBe(5);
  });
});

describe('createHeartbeatRunner', () => {
  it('tickOnce calls onZombie + onBackpressure for matching sessions', () => {
    const map = new Map<string, HeartbeatEntry>();
    map.set('zomb', makeEntry(fakeDeadPid));
    map.set('press', { pid: livingPid, ws: { readyState: 1, bufferedAmount: 5 * 1024 * 1024 } });
    const onZombie = vi.fn();
    const onBackpressure = vi.fn();
    const runner = createHeartbeatRunner({
      intervalMs: 1000,
      getActive: () => map.entries(),
      getWsClientCount: () => 1,
      log: vi.fn(),
      bufferedThresholdBytes: 4 * 1024 * 1024,
      onZombie,
      onBackpressure,
    });
    runner.tickOnce();
    expect(onZombie).toHaveBeenCalledWith('zomb');
    expect(onBackpressure).toHaveBeenCalledWith('press');
  });

  it('start/stop is idempotent and unrefs', () => {
    const runner = createHeartbeatRunner({
      intervalMs: 60000,
      getActive: () => [],
      getWsClientCount: () => 0,
      log: vi.fn(),
    });
    runner.start();
    runner.start();
    runner.stop();
    runner.stop();
  });
});

/**
 * Heartbeat — periodic introspection over active agent processes.
 *
 * Replaces the inline 60s setInterval block in server.js with a tested
 * unit. Detects zombies (entry exists but PID not alive), reports
 * backpressure (WS send buffer above threshold), and emits structured
 * log entries suitable for /api/health and downstream alerting.
 */

export interface HeartbeatEntry {
  pid: number;
  ws?: { readyState: number; bufferedAmount?: number } | null;
  wsDisconnectTime?: number | null;
  fullText?: string;
  /** Set when manager already considers this entry dead but hasn't reaped yet. */
  reaped?: boolean;
}

export interface HeartbeatSnapshot {
  sessionId: string;
  pid: number;
  alive: boolean;
  zombie: boolean;
  wsConnected: boolean;
  wsDisconnectTime: number | null;
  bufferedAmount: number;
  responseLen: number;
}

export interface HeartbeatReport {
  activeCount: number;
  wsClients: number;
  zombies: string[];
  backpressured: string[];
  processes: HeartbeatSnapshot[];
}

export interface HeartbeatOptions {
  bufferedThresholdBytes?: number;
}

const DEFAULT_BUFFERED_THRESHOLD = 4 * 1024 * 1024;

export function isPidAlive(pid: number): boolean {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    // EPERM means the process exists but we lack permission to signal it.
    return code === 'EPERM';
  }
}

export function inspectActiveProcesses(
  active: Iterable<[string, HeartbeatEntry]>,
  wsClients: number,
  opts: HeartbeatOptions = {},
): HeartbeatReport {
  const threshold = opts.bufferedThresholdBytes ?? DEFAULT_BUFFERED_THRESHOLD;
  const processes: HeartbeatSnapshot[] = [];
  const zombies: string[] = [];
  const backpressured: string[] = [];

  for (const [sessionId, entry] of active) {
    const alive = isPidAlive(entry.pid);
    const zombie = !alive && !entry.reaped;
    const buffered = entry.ws?.bufferedAmount ?? 0;
    const wsConnected = !!entry.ws && entry.ws.readyState === 1;
    if (zombie) zombies.push(sessionId);
    if (buffered > threshold) backpressured.push(sessionId);
    processes.push({
      sessionId,
      pid: entry.pid,
      alive,
      zombie,
      wsConnected,
      wsDisconnectTime: entry.wsDisconnectTime ?? null,
      bufferedAmount: buffered,
      responseLen: (entry.fullText || '').length,
    });
  }

  return {
    activeCount: processes.length,
    wsClients,
    zombies,
    backpressured,
    processes,
  };
}

export interface HeartbeatRunnerOptions extends HeartbeatOptions {
  intervalMs: number;
  getActive: () => Iterable<[string, HeartbeatEntry]>;
  getWsClientCount: () => number;
  log: (level: string, event: string, meta?: Record<string, unknown>) => void;
  onZombie?: (sessionId: string) => void;
  onBackpressure?: (sessionId: string) => void;
}

export interface HeartbeatRunner {
  start(): void;
  stop(): void;
  tickOnce(): HeartbeatReport;
}

export function createHeartbeatRunner(opts: HeartbeatRunnerOptions): HeartbeatRunner {
  let timer: NodeJS.Timeout | null = null;

  function tickOnce(): HeartbeatReport {
    const report = inspectActiveProcesses(
      opts.getActive(),
      opts.getWsClientCount(),
      { bufferedThresholdBytes: opts.bufferedThresholdBytes },
    );
    if (report.activeCount > 0) {
      opts.log('INFO', 'heartbeat', {
        activeCount: report.activeCount,
        wsClients: report.wsClients,
        zombies: report.zombies,
        backpressured: report.backpressured,
        processes: report.processes,
      });
    }
    if (opts.onZombie) for (const id of report.zombies) opts.onZombie(id);
    if (opts.onBackpressure) for (const id of report.backpressured) opts.onBackpressure(id);
    return report;
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tickOnce, opts.intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tickOnce,
  };
}

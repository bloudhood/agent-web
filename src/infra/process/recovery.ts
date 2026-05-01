/**
 * Recovery — idempotent rehydration of running agent processes after restart.
 *
 * lib/agent-manager.js currently runs `recoverProcesses()` once at boot. This
 * module formalizes the contract:
 *   - recover(repository) returns the list of session ids that were re-attached.
 *   - re-running it is idempotent: already-attached sessions are skipped.
 *   - failures during attach do not throw; they are returned per-session and
 *     logged through the provided log callback.
 */

import { isPidAlive } from './heartbeat';

export interface RunningProcessRecord {
  sessionId: string;
  pid: number;
  startedAt: number;
}

export interface RunStateRepository {
  list(): RunningProcessRecord[];
  remove(sessionId: string): void;
}

export interface RecoveryOptions {
  alreadyAttached: (sessionId: string) => boolean;
  attach: (record: RunningProcessRecord) => boolean;
  log: (level: string, event: string, meta?: Record<string, unknown>) => void;
}

export interface RecoveryReport {
  attached: string[];
  skippedAttached: string[];
  cleanedDead: string[];
  errors: Array<{ sessionId: string; message: string }>;
}

export function runRecovery(
  repository: RunStateRepository,
  opts: RecoveryOptions,
): RecoveryReport {
  const report: RecoveryReport = {
    attached: [],
    skippedAttached: [],
    cleanedDead: [],
    errors: [],
  };

  const records = repository.list();
  for (const record of records) {
    try {
      if (opts.alreadyAttached(record.sessionId)) {
        report.skippedAttached.push(record.sessionId);
        continue;
      }
      if (!isPidAlive(record.pid)) {
        repository.remove(record.sessionId);
        report.cleanedDead.push(record.sessionId);
        continue;
      }
      const ok = opts.attach(record);
      if (ok) {
        report.attached.push(record.sessionId);
      } else {
        report.errors.push({ sessionId: record.sessionId, message: 'attach returned false' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report.errors.push({ sessionId: record.sessionId, message: msg });
      opts.log('ERROR', 'recovery_attach_failed', { sessionId: record.sessionId, error: msg });
    }
  }

  opts.log('INFO', 'recovery_complete', {
    attached: report.attached.length,
    skipped: report.skippedAttached.length,
    cleaned: report.cleanedDead.length,
    errors: report.errors.length,
  });

  return report;
}

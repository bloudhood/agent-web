/**
 * SessionRepository — atomic JSON store for sessions.
 *
 * Phase 1.4 introduces the typed contract and a filesystem-backed implementation.
 * Phase 1.5 will let the existing lib/session-store.js delegate writes/reads
 * through this repository so we have a single concurrent-safe path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Session } from '@core/session/session';
import { type Result, ok, err, trySync } from '@core/result';

export interface SessionListItem {
  id: string;
  agent: Session['agent'];
  title: string;
  updatedAt: number;
  createdAt: number;
  totalCost?: number;
  totalUsage?: Session['totalUsage'];
}

export interface SessionRepository {
  load(id: string): Session | null;
  exists(id: string): boolean;
  save(session: Session): Result<void, Error>;
  delete(id: string): Result<boolean, Error>;
  list(): SessionListItem[];
  pathFor(id: string): string;
}

/** Validate a candidate id to avoid path traversal. */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function atomicWrite(filepath: string, data: string): void {
  const tmp = `${filepath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, { encoding: 'utf8' });
  fs.renameSync(tmp, filepath);
}

export interface SessionRepositoryOptions {
  rootDir: string;
  /** Fields that should never be persisted (sanitized on save). */
  redact?: readonly (keyof Session)[];
}

export function createSessionRepository(opts: SessionRepositoryOptions): SessionRepository {
  const { rootDir, redact = [] } = opts;
  fs.mkdirSync(rootDir, { recursive: true });

  function pathFor(id: string): string {
    if (!isSafeId(id)) throw new Error(`unsafe session id: ${id}`);
    return path.join(rootDir, `${id}.json`);
  }

  function sanitize(session: Session): Session {
    if (!redact.length) return session;
    const copy = { ...session } as unknown as Record<string, unknown>;
    for (const key of redact) delete copy[key as string];
    return copy as unknown as Session;
  }

  return {
    pathFor,

    exists(id) {
      if (!isSafeId(id)) return false;
      try { return fs.existsSync(pathFor(id)); } catch { return false; }
    },

    load(id) {
      if (!isSafeId(id)) return null;
      try {
        const raw = fs.readFileSync(pathFor(id), 'utf8');
        return JSON.parse(raw) as Session;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') return null;
        throw e;
      }
    },

    save(session) {
      if (!isSafeId(session.id)) {
        return err(new Error(`unsafe session id: ${session.id}`));
      }
      session.updatedAt = Date.now();
      const sanitized = sanitize(session);
      const r = trySync(() => atomicWrite(pathFor(session.id), JSON.stringify(sanitized, null, 2)));
      if (r.ok === true) return ok(undefined);
      return err(r.error);
    },

    delete(id) {
      if (!isSafeId(id)) return err(new Error(`unsafe session id: ${id}`));
      const filepath = pathFor(id);
      try {
        fs.unlinkSync(filepath);
        return ok(true);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') return ok(false);
        return err(e instanceof Error ? e : new Error(String(e)));
      }
    },

    list() {
      const items: SessionListItem[] = [];
      let entries: string[];
      try { entries = fs.readdirSync(rootDir); } catch { return items; }
      for (const name of entries) {
        if (!name.endsWith('.json') || name.startsWith('_')) continue;
        const id = name.slice(0, -5);
        if (!isSafeId(id)) continue;
        try {
          const raw = fs.readFileSync(path.join(rootDir, name), 'utf8');
          const parsed = JSON.parse(raw) as Session;
          items.push({
            id: parsed.id || id,
            agent: parsed.agent,
            title: parsed.title || 'Untitled',
            updatedAt: parsed.updatedAt || 0,
            createdAt: parsed.createdAt || 0,
            totalCost: parsed.totalCost,
            totalUsage: parsed.totalUsage,
          });
        } catch {
          // skip corrupted; logging is the caller's job
        }
      }
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      return items;
    },
  };
}

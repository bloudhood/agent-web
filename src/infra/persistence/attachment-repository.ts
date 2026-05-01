/**
 * AttachmentRepository — image attachment storage.
 *
 * Layout:
 *   <rootDir>/<id>.bin    raw bytes
 *   <rootDir>/<id>.json   metadata (mime, size, ts, sessionId)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Result, ok, err } from '@core/result';

export interface AttachmentMeta {
  id: string;
  mime: string;
  size: number;
  name?: string;
  createdAt: number;
  sessionId?: string;
}

export interface AttachmentRepository {
  dataPath(id: string): string;
  metaPath(id: string): string;
  saveMeta(meta: AttachmentMeta): Result<void, Error>;
  readMeta(id: string): AttachmentMeta | null;
  remove(id: string): Result<boolean, Error>;
  /** List ids with mtime older than `olderThanMs`. */
  expired(olderThanMs: number): string[];
}

const ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

function isSafeId(id: string): boolean { return ID_REGEX.test(id); }

export function createAttachmentRepository(rootDir: string): AttachmentRepository {
  fs.mkdirSync(rootDir, { recursive: true });

  return {
    dataPath(id) {
      if (!isSafeId(id)) throw new Error(`unsafe attachment id: ${id}`);
      return path.join(rootDir, `${id}.bin`);
    },
    metaPath(id) {
      if (!isSafeId(id)) throw new Error(`unsafe attachment id: ${id}`);
      return path.join(rootDir, `${id}.json`);
    },
    saveMeta(meta) {
      if (!isSafeId(meta.id)) return err(new Error(`unsafe id: ${meta.id}`));
      try {
        fs.writeFileSync(path.join(rootDir, `${meta.id}.json`), JSON.stringify(meta, null, 2), 'utf8');
        return ok(undefined);
      } catch (e) {
        return err(e instanceof Error ? e : new Error(String(e)));
      }
    },
    readMeta(id) {
      if (!isSafeId(id)) return null;
      try {
        const raw = fs.readFileSync(path.join(rootDir, `${id}.json`), 'utf8');
        return JSON.parse(raw) as AttachmentMeta;
      } catch {
        return null;
      }
    },
    remove(id) {
      if (!isSafeId(id)) return err(new Error(`unsafe id: ${id}`));
      let removed = false;
      for (const ext of ['.bin', '.json']) {
        try { fs.unlinkSync(path.join(rootDir, `${id}${ext}`)); removed = true; }
        catch (e) {
          const code = (e as NodeJS.ErrnoException)?.code;
          if (code !== 'ENOENT') return err(e instanceof Error ? e : new Error(String(e)));
        }
      }
      return ok(removed);
    },
    expired(olderThanMs) {
      const out: string[] = [];
      const cutoff = Date.now() - olderThanMs;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(rootDir, { withFileTypes: true }); } catch { return out; }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.json')) continue;
        const id = e.name.slice(0, -5);
        if (!isSafeId(id)) continue;
        try {
          const stat = fs.statSync(path.join(rootDir, e.name));
          if (stat.mtimeMs < cutoff) out.push(id);
        } catch { /* ignore */ }
      }
      return out;
    },
  };
}

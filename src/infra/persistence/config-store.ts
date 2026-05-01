/**
 * Generic typed JSON config store.
 *
 * Replaces ad-hoc fs.readFileSync/writeFileSync patterns scattered through
 * lib/config-manager.js. Each named config (model, codex, dev, notify, auth)
 * gets its own instance bound to a filename.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Result, ok, err } from '@core/result';

export interface ConfigStore<T> {
  read(): T | null;
  write(value: T): Result<void, Error>;
  exists(): boolean;
  filepath: string;
}

export interface ConfigStoreOptions<T> {
  dir: string;
  filename: string;
  /** Default value to return when the file does not exist. */
  defaults?: T;
  /** Validate-and-normalize before write (and on read for legacy migration). */
  normalize?: (raw: unknown) => T;
}

function atomicWrite(filepath: string, data: string): void {
  const tmp = `${filepath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, { encoding: 'utf8' });
  fs.renameSync(tmp, filepath);
}

export function createConfigStore<T>(opts: ConfigStoreOptions<T>): ConfigStore<T> {
  const { dir, filename, defaults, normalize } = opts;
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, filename);

  return {
    filepath,
    exists: () => {
      try { return fs.existsSync(filepath); } catch { return false; }
    },
    read: () => {
      try {
        const raw = fs.readFileSync(filepath, 'utf8');
        const parsed = JSON.parse(raw);
        return normalize ? normalize(parsed) : (parsed as T);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') return defaults ?? null;
        return defaults ?? null;
      }
    },
    write: (value) => {
      try {
        const out = normalize ? normalize(value) : value;
        atomicWrite(filepath, JSON.stringify(out, null, 2));
        return ok(undefined);
      } catch (e) {
        return err(e instanceof Error ? e : new Error(String(e)));
      }
    },
  };
}

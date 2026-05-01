import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createConfigStore } from '@infra/persistence/config-store';

let tmp = '';

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-web-config-')); });

describe('ConfigStore', () => {
  it('returns null when file missing and no defaults', () => {
    const store = createConfigStore<{ a: number }>({ dir: tmp, filename: 'x.json' });
    expect(store.read()).toBeNull();
  });

  it('returns defaults when file missing', () => {
    const store = createConfigStore({ dir: tmp, filename: 'x.json', defaults: { a: 1 } });
    expect(store.read()).toEqual({ a: 1 });
  });

  it('write -> read round-trips', () => {
    const store = createConfigStore<{ token: string }>({ dir: tmp, filename: 'auth.json' });
    expect(store.write({ token: 'xyz' }).ok).toBe(true);
    expect(store.read()).toEqual({ token: 'xyz' });
  });

  it('normalize is applied on read and write', () => {
    const store = createConfigStore<{ count: number }>({
      dir: tmp,
      filename: 'c.json',
      normalize: (raw) => ({ count: Number((raw as { count?: unknown })?.count ?? 0) }),
    });
    fs.writeFileSync(path.join(tmp, 'c.json'), '{"count":"42"}', 'utf8');
    expect(store.read()).toEqual({ count: 42 });
  });

  it('write is atomic — no leftover .tmp files', () => {
    const store = createConfigStore<{ a: number }>({ dir: tmp, filename: 'a.json' });
    store.write({ a: 1 });
    const entries = fs.readdirSync(tmp);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });

  it('exists reflects file presence', () => {
    const store = createConfigStore<{ a: number }>({ dir: tmp, filename: 'a.json' });
    expect(store.exists()).toBe(false);
    store.write({ a: 1 });
    expect(store.exists()).toBe(true);
  });
});

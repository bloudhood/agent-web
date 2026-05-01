import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSessionRepository } from '@infra/persistence/session-repository';
import { createEmptySession } from '@core/session/session';

let tmp = '';

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-web-test-sessions-'));
}

describe('SessionRepository', () => {
  beforeEach(() => { tmp = freshDir(); });

  it('save/load round-trips a session', () => {
    const repo = createSessionRepository({ rootDir: tmp });
    const s = createEmptySession('claude', 'sess-abc');
    s.title = 'Hello';
    const r = repo.save(s);
    expect(r.ok).toBe(true);
    const loaded = repo.load('sess-abc');
    expect(loaded?.title).toBe('Hello');
    expect(loaded?.agent).toBe('claude');
  });

  it('load returns null for missing id', () => {
    const repo = createSessionRepository({ rootDir: tmp });
    expect(repo.load('does-not-exist')).toBeNull();
  });

  it('rejects unsafe id on save', () => {
    const repo = createSessionRepository({ rootDir: tmp });
    const s = createEmptySession('codex', '../../etc/passwd');
    const r = repo.save(s);
    expect(r.ok).toBe(false);
  });

  it('rejects unsafe id on load', () => {
    const repo = createSessionRepository({ rootDir: tmp });
    expect(repo.load('../etc')).toBeNull();
  });

  it('list ignores corrupted files', () => {
    const repo = createSessionRepository({ rootDir: tmp });
    repo.save(createEmptySession('codex', 's1'));
    fs.writeFileSync(path.join(tmp, 's2.json'), '{garbage', 'utf8');
    const items = repo.list();
    expect(items.map((i) => i.id)).toContain('s1');
    expect(items.map((i) => i.id)).not.toContain('s2');
  });

  it('list returns most-recent first', async () => {
    const repo = createSessionRepository({ rootDir: tmp });
    const a = createEmptySession('claude', 'sa');
    repo.save(a);
    await new Promise((r) => setTimeout(r, 5));
    const b = createEmptySession('codex', 'sb');
    repo.save(b);
    const items = repo.list();
    expect(items[0].id).toBe('sb');
  });

  it('redacts configured fields on save', () => {
    const repo = createSessionRepository({ rootDir: tmp, redact: ['codexHomeDir', 'codexRuntimeKey'] });
    const s = createEmptySession('codex', 's-r');
    s.codexHomeDir = '/secret';
    s.codexRuntimeKey = 'k123';
    repo.save(s);
    const raw = JSON.parse(fs.readFileSync(repo.pathFor('s-r'), 'utf8'));
    expect(raw.codexHomeDir).toBeUndefined();
    expect(raw.codexRuntimeKey).toBeUndefined();
  });

  it('delete returns true when file existed, false otherwise', () => {
    const repo = createSessionRepository({ rootDir: tmp });
    repo.save(createEmptySession('claude', 'd1'));
    const r1 = repo.delete('d1');
    expect(r1.ok && r1.value).toBe(true);
    const r2 = repo.delete('d1');
    expect(r2.ok && r2.value).toBe(false);
  });

  it('save is atomic — no partial files left on success path', () => {
    const repo = createSessionRepository({ rootDir: tmp });
    repo.save(createEmptySession('claude', 'atomic'));
    const entries = fs.readdirSync(tmp);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });
});

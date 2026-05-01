import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createAttachmentRepository } from '@infra/persistence/attachment-repository';

let tmp = '';

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-web-test-att-')); });

describe('AttachmentRepository', () => {
  it('saves and reads metadata', () => {
    const repo = createAttachmentRepository(tmp);
    const meta = { id: 'a1', mime: 'image/png', size: 100, createdAt: 1 };
    expect(repo.saveMeta(meta).ok).toBe(true);
    expect(repo.readMeta('a1')).toEqual(meta);
  });

  it('rejects unsafe id', () => {
    const repo = createAttachmentRepository(tmp);
    const r = repo.saveMeta({ id: '../etc', mime: 'image/png', size: 1, createdAt: 0 });
    expect(r.ok).toBe(false);
  });

  it('expired() returns ids whose mtime is older than cutoff', async () => {
    const repo = createAttachmentRepository(tmp);
    repo.saveMeta({ id: 'old', mime: 'image/png', size: 1, createdAt: 0 });
    const stale = path.join(tmp, 'old.json');
    const past = Date.now() - 24 * 3600 * 1000;
    fs.utimesSync(stale, past / 1000, past / 1000);

    repo.saveMeta({ id: 'new', mime: 'image/png', size: 1, createdAt: Date.now() });
    const expired = repo.expired(60 * 60 * 1000);
    expect(expired).toContain('old');
    expect(expired).not.toContain('new');
  });

  it('remove deletes both .bin and .json when they exist', () => {
    const repo = createAttachmentRepository(tmp);
    repo.saveMeta({ id: 'r1', mime: 'image/png', size: 1, createdAt: 0 });
    fs.writeFileSync(path.join(tmp, 'r1.bin'), 'data', 'utf8');
    const r = repo.remove('r1');
    expect(r.ok && r.value).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'r1.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'r1.bin'))).toBe(false);
  });
});

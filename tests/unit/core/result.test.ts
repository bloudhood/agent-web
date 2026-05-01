import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, map, mapErr, unwrap, tryAsync, trySync, DomainError } from '@core/result';

describe('Result', () => {
  it('ok() wraps values', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('err() wraps errors', () => {
    const e = new Error('boom');
    const r = err(e);
    expect(isErr(r)).toBe(true);
    if (!r.ok) expect(r.error).toBe(e);
  });

  it('map transforms ok value', () => {
    expect(map(ok(2), (x) => x * 3)).toEqual({ ok: true, value: 6 });
  });

  it('map passes through err', () => {
    const e = new Error('x');
    expect(map(err(e), (x: number) => x * 3)).toEqual({ ok: false, error: e });
  });

  it('mapErr transforms err only', () => {
    const r = mapErr(err('a'), (s) => s + '!');
    expect(r).toEqual({ ok: false, error: 'a!' });
    expect(mapErr(ok(1), (s: string) => s + '!')).toEqual({ ok: true, value: 1 });
  });

  it('unwrap returns value or throws', () => {
    expect(unwrap(ok('x'))).toBe('x');
    expect(() => unwrap(err(new Error('boom')))).toThrow('boom');
  });

  it('trySync converts thrown to err', () => {
    const r = trySync(() => { throw new Error('sync'); });
    expect(isErr(r)).toBe(true);
  });

  it('tryAsync converts rejection to err', async () => {
    const r = await tryAsync(async () => { throw new Error('async'); });
    expect(isErr(r)).toBe(true);
  });
});

describe('DomainError', () => {
  it('captures code and meta', () => {
    const e = new DomainError('AGENT_NOT_FOUND', 'no agent', { id: 'foo' });
    expect(e.code).toBe('AGENT_NOT_FOUND');
    expect(e.meta).toEqual({ id: 'foo' });
    expect(e.message).toBe('no agent');
  });
});

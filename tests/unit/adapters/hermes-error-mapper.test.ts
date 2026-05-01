import { describe, it, expect } from 'vitest';
import { mapHermesError } from '../../../src/adapters/hermes/error-mapper';
import { HermesError } from '../../../src/adapters/hermes/gateway-client';

describe('mapHermesError', () => {
  it('401 -> auth guidance', () => {
    const r = mapHermesError(new HermesError('bad', { status: 401, code: 'invalid_api_key' }));
    expect(r.title).toContain('鉴权失败');
    expect(r.actionable).toBe(true);
  });

  it('429 -> rate limit with countdown', () => {
    const r = mapHermesError(new HermesError('too many', { status: 429, retryAfterMs: 7000 }));
    expect(r.body).toContain('7 秒');
    expect(r.retryAfterMs).toBe(7000);
  });

  it('5xx -> non-actionable', () => {
    const r = mapHermesError(new HermesError('bad', { status: 503 }));
    expect(r.actionable).toBe(false);
  });

  it('context_length_exceeded -> compact suggestion', () => {
    const r = mapHermesError(new HermesError('ctx', { code: 'context_length_exceeded' }));
    expect(r.body).toContain('/compact');
  });

  it('unknown error falls through', () => {
    const r = mapHermesError(new HermesError('boom'));
    expect(r.title).toContain('Hermes');
  });
});

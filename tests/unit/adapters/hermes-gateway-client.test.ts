import { describe, it, expect, vi } from 'vitest';
import { createHermesClient, HermesError } from '../../../src/adapters/hermes/gateway-client';

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((url: string, init?: RequestInit) => Promise.resolve(handler(url, init))) as typeof fetch;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init,
  });
}

describe('HermesClient', () => {
  it('createResponse returns ok for 2xx', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'r1' }));
    const client = createHermesClient({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
    const r = await client.createResponse({ model: 'm', input: 'hi' });
    expect(r.ok).toBe(true);
  });

  it('createResponse maps 4xx errors with code', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: { message: 'bad', code: 'invalid_api_key' } }, { status: 401 }));
    const client = createHermesClient({ baseUrl: 'http://h', fetchImpl });
    const r = await client.createResponse({ model: 'm', input: 'hi' });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBeInstanceOf(HermesError);
      expect(r.error.status).toBe(401);
      expect(r.error.code).toBe('invalid_api_key');
    }
  });

  it('createResponse parses Retry-After header', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(
      { error: { message: 'too many', code: 'rate_limit_exceeded' } },
      { status: 429, headers: { 'Retry-After': '5' } }
    ));
    const client = createHermesClient({ baseUrl: 'http://h', fetchImpl });
    const r = await client.createResponse({ model: 'm', input: 'hi' });
    if (r.ok === false) {
      expect(r.error.retryAfterMs).toBe(5000);
    }
  });

  it('cancelResponse returns ok for 2xx', async () => {
    const fetchImpl = fakeFetch((url) => {
      expect(url).toMatch(/\/v1\/responses\/r-1\/cancel$/);
      return jsonResponse({ ok: true });
    });
    const client = createHermesClient({ baseUrl: 'http://h', fetchImpl });
    const r = await client.cancelResponse('r-1');
    expect(r.ok).toBe(true);
  });

  it('listConversations returns array', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ data: [{ id: 'c1', title: 'A' }, { id: 'c2', title: 'B' }] }));
    const client = createHermesClient({ baseUrl: 'http://h', fetchImpl });
    const r = await client.listConversations();
    expect(r.ok && r.value.length).toBe(2);
  });

  it('listResources tolerates missing data', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({}));
    const client = createHermesClient({ baseUrl: 'http://h', fetchImpl });
    const r = await client.listResources();
    expect(r.ok && r.value.length).toBe(0);
  });

  it('uses Authorization header when apiKey is set', async () => {
    const headers = vi.fn();
    const fetchImpl = fakeFetch((_url, init) => {
      headers(Object.fromEntries(new Headers(init?.headers).entries()));
      return jsonResponse({});
    });
    const client = createHermesClient({ baseUrl: 'http://h', apiKey: 'sk-test', fetchImpl });
    await client.listResources();
    expect(headers).toHaveBeenCalledWith(expect.objectContaining({ authorization: 'Bearer sk-test' }));
  });
});

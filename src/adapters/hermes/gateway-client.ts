/**
 * Hermes Gateway client — typed wrapper around the Hermes-compatible
 * Responses API (https://platform.openai.com/docs/api-reference/responses).
 *
 * Provides:
 *  - createResponse(): POST /v1/responses with optional SSE streaming.
 *  - cancelResponse(): POST /v1/responses/{id}/cancel.
 *  - listConversations(): GET /v1/conversations (when supported).
 *  - listResources(): GET /v1/resources (MCP tools/resources view).
 *  - reconnect with Last-Event-ID (consumer side; transport must surface it).
 *
 * Phase 3.2 introduces this as a separate, unit-testable client. The existing
 * lib/agent-manager.js continues to drive the runtime via its own SSE loop;
 * this client will gradually take over once the orchestrator migrates.
 */

import { type Result, ok, err } from '@core/result';

export interface GatewayConfig {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface HermesResponseRequest {
  model: string;
  input: unknown;
  conversation?: string;
  instructions?: string;
  stream?: boolean;
  tools?: unknown[];
  metadata?: Record<string, string>;
}

export interface HermesConversation {
  id: string;
  title?: string;
  updatedAt?: number;
}

export interface HermesResource {
  serverName: string;
  toolName: string;
  description?: string;
}

export class HermesError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;
  constructor(message: string, opts: { status?: number; code?: string; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'HermesError';
    this.status = opts.status;
    this.code = opts.code;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function authHeaders(cfg: GatewayConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) h['Authorization'] = `Bearer ${cfg.apiKey}`;
  return h;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.floor(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

async function readBody(response: Response): Promise<{ message: string; code?: string }> {
  try {
    const data = (await response.json()) as { error?: { message?: string; code?: string } };
    if (data?.error?.message) return { message: data.error.message, code: data.error.code };
    return { message: response.statusText };
  } catch {
    return { message: response.statusText };
  }
}

export interface HermesClient {
  createResponse(req: HermesResponseRequest): Promise<Result<Response, HermesError>>;
  cancelResponse(responseId: string): Promise<Result<void, HermesError>>;
  listConversations(): Promise<Result<HermesConversation[], HermesError>>;
  listResources(): Promise<Result<HermesResource[], HermesError>>;
}

export function createHermesClient(cfg: GatewayConfig): HermesClient {
  const fetchImpl = cfg.fetchImpl ?? fetch;

  return {
    async createResponse(req) {
      const response = await fetchImpl(joinUrl(cfg.baseUrl, '/v1/responses'), {
        method: 'POST',
        headers: {
          ...authHeaders(cfg),
          ...(req.stream ? { Accept: 'text/event-stream' } : {}),
        },
        body: JSON.stringify(req),
      });
      if (!response.ok) {
        const body = await readBody(response);
        return err(
          new HermesError(body.message, {
            status: response.status,
            code: body.code,
            retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
          }),
        );
      }
      return ok(response);
    },

    async cancelResponse(responseId) {
      const response = await fetchImpl(joinUrl(cfg.baseUrl, `/v1/responses/${responseId}/cancel`), {
        method: 'POST',
        headers: authHeaders(cfg),
      });
      if (!response.ok) {
        const body = await readBody(response);
        return err(new HermesError(body.message, { status: response.status, code: body.code }));
      }
      return ok(undefined);
    },

    async listConversations() {
      const response = await fetchImpl(joinUrl(cfg.baseUrl, '/v1/conversations'), {
        method: 'GET',
        headers: authHeaders(cfg),
      });
      if (!response.ok) {
        const body = await readBody(response);
        return err(new HermesError(body.message, { status: response.status, code: body.code }));
      }
      const data = (await response.json()) as { data?: HermesConversation[] };
      return ok(Array.isArray(data?.data) ? data.data : []);
    },

    async listResources() {
      const response = await fetchImpl(joinUrl(cfg.baseUrl, '/v1/resources'), {
        method: 'GET',
        headers: authHeaders(cfg),
      });
      if (!response.ok) {
        const body = await readBody(response);
        return err(new HermesError(body.message, { status: response.status, code: body.code }));
      }
      const data = (await response.json()) as { data?: HermesResource[] };
      return ok(Array.isArray(data?.data) ? data.data : []);
    },
  };
}

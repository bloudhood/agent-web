import { describe, it, expect } from 'vitest';
import {
  parseInbound,
  parseOutbound,
  WsInboundCoreSchema,
  WsOutboundCoreSchema,
} from '@shared/ws-messages';

describe('WS inbound schema', () => {
  it('accepts well-formed auth', () => {
    expect(parseInbound({ type: 'auth', password: 'x' })).toMatchObject({ type: 'auth' });
  });

  it('rejects send_message without sessionId', () => {
    const r = WsInboundCoreSchema.safeParse({ type: 'send_message', text: 'hi' });
    expect(r.success).toBe(false);
  });

  it('accepts runtime message payload used by the live server', () => {
    const r = WsInboundCoreSchema.safeParse({ type: 'message', agent: 'codex', text: 'hi', mode: 'yolo' });
    expect(r.success).toBe(true);
  });

  it('passes through unknown types for backward compat', () => {
    const r = parseInbound({ type: 'foo', bar: 1 });
    expect(r).toMatchObject({ type: 'foo', bar: 1 });
  });

  it('returns null for malformed payload', () => {
    expect(parseInbound(null)).toBeNull();
    expect(parseInbound({ no_type: true })).toBeNull();
  });

  it('validates set_mode permission enum', () => {
    expect(WsInboundCoreSchema.safeParse({ type: 'set_mode', sessionId: 's', mode: 'yolo' }).success).toBe(true);
    expect(WsInboundCoreSchema.safeParse({ type: 'set_mode', sessionId: 's', mode: 'YOLO' }).success).toBe(false);
  });

  it('accepts permission responses', () => {
    const r = WsInboundCoreSchema.safeParse({ type: 'permission_response', sessionId: 's', promptId: 'p', decision: 'reject' });
    expect(r.success).toBe(true);
  });

  it('requires currentPassword for change_password core contract', () => {
    expect(WsInboundCoreSchema.safeParse({
      type: 'change_password',
      currentPassword: 'old',
      newPassword: 'Strongpw1',
    }).success).toBe(true);
    expect(WsInboundCoreSchema.safeParse({
      type: 'change_password',
      oldPassword: 'old',
      newPassword: 'Strongpw1',
    }).success).toBe(false);
  });
});

describe('WS outbound schema', () => {
  it('accepts text_delta with sessionId', () => {
    expect(parseOutbound({ type: 'text_delta', sessionId: 's', text: 'hi' })).toBeTruthy();
  });

  it('accepts auth_result minimal', () => {
    const r = WsOutboundCoreSchema.safeParse({ type: 'auth_result', success: true });
    expect(r.success).toBe(true);
  });

  it('accepts cost without sessionId', () => {
    expect(parseOutbound({ type: 'cost', costUsd: 0.5 })).toBeTruthy();
  });

  it('passes through unknown outbound types', () => {
    expect(parseOutbound({ type: 'something_new', foo: 'bar' })).toMatchObject({ type: 'something_new', foo: 'bar' });
  });

  it('rejects malformed totalUsage', () => {
    const r = WsOutboundCoreSchema.safeParse({ type: 'usage', totalUsage: { inputTokens: 'x' } });
    expect(r.success).toBe(false);
  });

  it('accepts password_changed with replacement token', () => {
    const r = WsOutboundCoreSchema.safeParse({ type: 'password_changed', success: true, token: 'new-token' });
    expect(r.success).toBe(true);
  });

  it('accepts chunked session history', () => {
    const r = WsOutboundCoreSchema.safeParse({
      type: 'session_history_chunk',
      sessionId: 's1',
      messages: [{ role: 'assistant', content: 'older answer', timestamp: Date.now() }],
      remaining: 0,
    });
    expect(r.success).toBe(true);
  });

  it('accepts thinking_delta with optional tokens', () => {
    const r = WsOutboundCoreSchema.safeParse({ type: 'thinking_delta', text: 'hmm…', tokens: 12 });
    expect(r.success).toBe(true);
  });

  it('accepts permission_prompt with default options', () => {
    const r = WsOutboundCoreSchema.safeParse({
      type: 'permission_prompt',
      sessionId: 's1',
      promptId: 'p1',
      toolName: 'Bash',
    });
    expect(r.success).toBe(true);
  });

  it('rejects permission_prompt with invalid option', () => {
    const r = WsOutboundCoreSchema.safeParse({
      type: 'permission_prompt',
      sessionId: 's1',
      promptId: 'p1',
      toolName: 'Bash',
      options: ['nope'],
    });
    expect(r.success).toBe(false);
  });
});

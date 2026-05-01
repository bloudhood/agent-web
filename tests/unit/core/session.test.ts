import { describe, it, expect } from 'vitest';
import {
  createEmptySession,
  isAgentId,
  isPermissionMode,
  VALID_AGENTS,
  VALID_PERMISSION_MODES,
} from '@core/session/session';

describe('Session domain', () => {
  it('VALID_AGENTS lists all 4 agents', () => {
    expect([...VALID_AGENTS].sort()).toEqual(['claude', 'codex', 'gemini', 'hermes']);
  });

  it('VALID_PERMISSION_MODES lists 3 modes', () => {
    expect([...VALID_PERMISSION_MODES].sort()).toEqual(['default', 'plan', 'yolo']);
  });

  it('isAgentId is strict', () => {
    expect(isAgentId('claude')).toBe(true);
    expect(isAgentId('CLAUDE')).toBe(false);
    expect(isAgentId(null)).toBe(false);
    expect(isAgentId('xyz')).toBe(false);
  });

  it('isPermissionMode is strict', () => {
    expect(isPermissionMode('plan')).toBe(true);
    expect(isPermissionMode('Plan')).toBe(false);
    expect(isPermissionMode('')).toBe(false);
  });

  it('createEmptySession produces well-formed defaults', () => {
    const s = createEmptySession('codex', 'sess-1');
    expect(s.id).toBe('sess-1');
    expect(s.agent).toBe('codex');
    expect(s.title).toBe('Untitled');
    expect(s.permissionMode).toBe('yolo');
    expect(s.totalCost).toBe(0);
    expect(s.totalUsage).toEqual({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
    expect(s.createdAt).toBeLessThanOrEqual(Date.now());
    expect(s.updatedAt).toBeLessThanOrEqual(Date.now());
    expect(s.messages).toEqual([]);
  });
});

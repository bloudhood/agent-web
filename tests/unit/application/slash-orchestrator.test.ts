import { describe, it, expect, beforeEach } from 'vitest';
import { createSlashOrchestrator } from '@application/slash-orchestrator';
import { createAgentRegistry } from '@core/agent/registry';
import { createEmptySession } from '@core/session/session';
import type { AgentAdapter } from '@core/agent/agent';
import type { CommandManifestEntry } from '@shared/commands';

function makeAdapter(id: AgentAdapter['id'], usage: 'usd' | 'tokens' = 'tokens'): AgentAdapter {
  return {
    id,
    displayName: id,
    capabilities: {
      attachments: false,
      thinkingBlocks: false,
      mcpTools: false,
      permissionModes: ['default', 'plan', 'yolo'],
      resume: 'native',
      modelList: 'static',
      usage,
    },
    parseEvent: () => {},
  };
}

const MANIFEST: CommandManifestEntry[] = [
  { cmd: '/help', desc: '帮助', kind: 'web', agents: ['claude', 'codex', 'gemini', 'hermes'] },
  { cmd: '/clear', desc: '清空', kind: 'web', agents: ['claude', 'codex', 'gemini', 'hermes'] },
  { cmd: '/status', desc: '状态', kind: 'web', agents: ['claude', 'codex', 'gemini', 'hermes'] },
];

describe('SlashOrchestrator', () => {
  let registry = createAgentRegistry();
  beforeEach(() => {
    registry = createAgentRegistry();
    registry.register(makeAdapter('claude', 'usd'));
    registry.register(makeAdapter('codex', 'tokens'));
  });

  it('has() detects supported commands case-insensitively', () => {
    const o = createSlashOrchestrator();
    expect(o.has('/help')).toBe(true);
    expect(o.has('/HELP')).toBe(true);
    expect(o.has('/foo')).toBe(false);
  });

  it('returns ok with system message for /help', () => {
    const o = createSlashOrchestrator();
    const res = o.run('/help', { agent: 'claude', session: null, registry, manifest: MANIFEST });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.systemMessage).toMatch(/Agent-Web 内置命令/);
  });

  it('/clear emits clear_session effect', () => {
    const o = createSlashOrchestrator();
    const res = o.run('/clear', { agent: 'claude', session: null, registry, manifest: MANIFEST });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.effect).toEqual({ type: 'clear_session' });
  });

  it('/status without session shows empty notice', () => {
    const o = createSlashOrchestrator();
    const res = o.run('/status', { agent: 'claude', session: null, registry, manifest: MANIFEST });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.systemMessage).toMatch(/没有载入会话/);
  });

  it('/status with usd-usage agent shows USD cost', () => {
    const o = createSlashOrchestrator();
    const session = createEmptySession('claude', 'sess-1');
    session.totalCost = 0.1234;
    const res = o.run('/status', { agent: 'claude', session, registry, manifest: MANIFEST });
    if (res.ok) expect(res.value.systemMessage).toContain('费用: $0.1234');
  });

  it('/status with token-usage agent shows tokens', () => {
    const o = createSlashOrchestrator();
    const session = createEmptySession('codex', 'sess-2');
    session.totalUsage = { inputTokens: 100, cachedInputTokens: 20, outputTokens: 50 };
    const res = o.run('/status', { agent: 'codex', session, registry, manifest: MANIFEST });
    if (res.ok) expect(res.value.systemMessage).toContain('输入 100');
  });

  it('/mode with no arg shows current', () => {
    const o = createSlashOrchestrator();
    const session = createEmptySession('claude', 'sess-3');
    session.permissionMode = 'plan';
    const res = o.run('/mode', { agent: 'claude', session, registry, manifest: MANIFEST });
    if (res.ok) expect(res.value.systemMessage).toContain('plan');
  });

  it('/mode with valid arg sets mode effect', () => {
    const o = createSlashOrchestrator();
    const session = createEmptySession('claude', 'sess-4');
    const res = o.run('/mode plan', { agent: 'claude', session, registry, manifest: MANIFEST });
    if (res.ok) expect(res.value.effect).toEqual({ type: 'set_mode', mode: 'plan' });
  });

  it('/mode with invalid arg returns DomainError', () => {
    const o = createSlashOrchestrator();
    const res = o.run('/mode foo', { agent: 'claude', session: null, registry, manifest: MANIFEST });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error.code).toBe('INVALID_MODE');
  });

  it('returns UNKNOWN_COMMAND for unmapped slash', () => {
    const o = createSlashOrchestrator();
    const res = o.run('/nonexistent', { agent: 'claude', session: null, registry, manifest: MANIFEST });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error.code).toBe('UNKNOWN_COMMAND');
  });

  it('/doctor lists adapter caps', () => {
    const o = createSlashOrchestrator();
    const res = o.run('/doctor', { agent: 'claude', session: null, registry, manifest: MANIFEST });
    if (res.ok) {
      expect(res.value.systemMessage).toContain('claude');
      expect(res.value.systemMessage).toContain('codex');
    }
  });
});

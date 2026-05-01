import { describe, it, expect, beforeEach } from 'vitest';
import { createAgentRegistry } from '@core/agent/registry';
import type { AgentAdapter } from '@core/agent/agent';

function makeAdapter(id: AgentAdapter['id']): AgentAdapter {
  return {
    id,
    displayName: id.toUpperCase(),
    capabilities: {
      attachments: false,
      thinkingBlocks: false,
      mcpTools: false,
      permissionModes: ['yolo'],
      resume: 'none',
      modelList: 'static',
      usage: 'tokens',
    },
    parseEvent: () => {},
  };
}

describe('AgentRegistry', () => {
  let registry = createAgentRegistry();
  beforeEach(() => { registry = createAgentRegistry(); });

  it('registers and retrieves adapters', () => {
    const a = makeAdapter('claude');
    registry.register(a);
    expect(registry.get('claude')).toBe(a);
    expect(registry.has('claude')).toBe(true);
    expect(registry.has('codex')).toBe(false);
  });

  it('throws on duplicate registration', () => {
    registry.register(makeAdapter('claude'));
    expect(() => registry.register(makeAdapter('claude'))).toThrow();
  });

  it('require throws for missing id', () => {
    expect(() => registry.require('codex')).toThrow();
  });

  it('list returns registered adapters', () => {
    registry.register(makeAdapter('claude'));
    registry.register(makeAdapter('codex'));
    expect(registry.list().map((a) => a.id).sort()).toEqual(['claude', 'codex']);
  });
});

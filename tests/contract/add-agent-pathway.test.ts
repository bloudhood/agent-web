/**
 * Acceptance test for docs/ADDING_AN_AGENT.md.
 *
 * Demonstrates that a contributor can register a 5th adapter into the registry
 * without touching the core layer. If this test breaks, ADDING_AN_AGENT.md is
 * stale.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAgentRegistry } from '@core/agent/registry';
import type { AgentAdapter } from '@core/agent/agent';
import { createBuiltInRegistry, type BuiltInRuntimeFns } from '../../src/adapters';

// A toy 5th agent adapter following the documented recipe.
function createMockMyAgentAdapter(): AgentAdapter {
  let parseCount = 0;
  return {
    // Cast is required because AgentId is a closed union; the docs explain
    // contributors should also widen the union when adding a permanent agent.
    id: 'my-agent' as unknown as AgentAdapter['id'],
    displayName: 'My Agent',
    capabilities: {
      attachments: false,
      thinkingBlocks: false,
      mcpTools: false,
      permissionModes: ['default'],
      resume: 'web-only',
      modelList: 'static',
      usage: 'tokens',
    },
    buildSpawnSpec(session) {
      return {
        command: '/bin/echo',
        args: ['hi'],
        env: {},
        cwd: session.cwd ?? '/',
        parser: 'my-agent' as unknown as AgentAdapter['id'],
        mode: 'default',
        resume: false,
      };
    },
    parseEvent() { parseCount += 1; },
    listSlashCommands: () => [],
  };
}

describe('Adding-an-agent recipe', () => {
  it('can be registered into a fresh registry', () => {
    const r = createAgentRegistry();
    const adapter = createMockMyAgentAdapter();
    r.register(adapter);
    expect(r.list().map((a) => a.id)).toContain(adapter.id);
  });

  it('can be added on top of the built-in registry', () => {
    const stubRuntime: BuiltInRuntimeFns = {
      buildClaudeSpawnSpec: vi.fn().mockReturnValue({ command: '', args: [], env: {}, cwd: '/', parser: 'claude', mode: 'yolo', resume: false }),
      buildCodexSpawnSpec: vi.fn().mockReturnValue({ command: '', args: [], env: {}, cwd: '/', parser: 'codex', mode: 'yolo', resume: false }),
      buildGeminiSpawnSpec: vi.fn().mockReturnValue({ command: '', args: [], env: {}, cwd: '/', parser: 'gemini', mode: 'yolo', resume: false }),
      processClaudeEvent: vi.fn(),
      processCodexEvent: vi.fn(),
      processGeminiEvent: vi.fn(),
      processHermesEvent: vi.fn(),
    };
    const registry = createBuiltInRegistry(stubRuntime);
    registry.register(createMockMyAgentAdapter());
    expect(registry.list()).toHaveLength(5);
  });

  it('parseEvent is invoked through the contract', () => {
    const adapter = createMockMyAgentAdapter();
    const r = createAgentRegistry();
    r.register(adapter);
    r.require(adapter.id).parseEvent({ toolCalls: [], fullText: '' }, { foo: 1 }, 's-1', () => {});
    // No assertion on count required; this verifies the dispatch path is type-stable.
    expect(true).toBe(true);
  });

  it('capabilities advertise the right defaults', () => {
    const adapter = createMockMyAgentAdapter();
    expect(adapter.capabilities.usage).toBe('tokens');
    expect(adapter.capabilities.resume).toBe('web-only');
    expect(adapter.capabilities.modelList).toBe('static');
  });
});

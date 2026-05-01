import { describe, it, expect, vi } from 'vitest';
import { createBuiltInRegistry, type BuiltInRuntimeFns } from '../../src/adapters';
import { createEmptySession } from '@core/session/session';
import type { AgentEntry } from '@core/agent/agent';

function makeStubRuntime(): BuiltInRuntimeFns {
  return {
    buildClaudeSpawnSpec: vi.fn().mockReturnValue({
      command: 'claude', args: [], env: {}, cwd: '/tmp', parser: 'claude', mode: 'yolo', resume: false,
    }),
    buildCodexSpawnSpec: vi.fn().mockReturnValue({
      command: 'codex', args: [], env: {}, cwd: '/tmp', parser: 'codex', mode: 'yolo', resume: false,
    }),
    buildGeminiSpawnSpec: vi.fn().mockReturnValue({
      command: 'gemini', args: [], env: {}, cwd: '/tmp', parser: 'gemini', mode: 'yolo', resume: false,
    }),
    processClaudeEvent: vi.fn(),
    processCodexEvent: vi.fn(),
    processGeminiEvent: vi.fn(),
    processHermesEvent: vi.fn(),
  };
}

function makeEntry(): AgentEntry {
  return { toolCalls: [], fullText: '' };
}

describe('Built-in adapter registry', () => {
  it('registers all 4 adapters', () => {
    const registry = createBuiltInRegistry(makeStubRuntime());
    expect(registry.list().map((a) => a.id).sort()).toEqual(['claude', 'codex', 'gemini', 'hermes']);
  });

  it('every adapter declares non-trivial capabilities', () => {
    const registry = createBuiltInRegistry(makeStubRuntime());
    for (const adapter of registry.list()) {
      expect(adapter.capabilities.permissionModes.length).toBeGreaterThan(0);
      expect(['cli', 'static', 'gateway']).toContain(adapter.capabilities.modelList);
      expect(['native', 'web-only', 'none']).toContain(adapter.capabilities.resume);
      expect(['usd', 'tokens', 'both']).toContain(adapter.capabilities.usage);
    }
  });

  it('Claude/Codex have spawnSpec, Hermes has gateway, Gemini spawn-only', () => {
    const registry = createBuiltInRegistry(makeStubRuntime());
    expect(typeof registry.require('claude').buildSpawnSpec).toBe('function');
    expect(typeof registry.require('codex').buildSpawnSpec).toBe('function');
    expect(typeof registry.require('gemini').buildSpawnSpec).toBe('function');
    expect(typeof registry.require('hermes').buildGatewayCall).toBe('function');
    expect(registry.require('hermes').buildSpawnSpec).toBeUndefined();
  });

  it('Hermes is the only adapter with gateway conversations capability', () => {
    const registry = createBuiltInRegistry(makeStubRuntime());
    const conv = registry.list().filter((a) => a.capabilities.conversations === 'gateway');
    expect(conv.length).toBe(1);
    expect(conv[0].id).toBe('hermes');
  });

  it('parseEvent delegates to the runtime impl', () => {
    const runtime = makeStubRuntime();
    const registry = createBuiltInRegistry(runtime);
    const entry = makeEntry();
    const emit = vi.fn();

    registry.require('claude').parseEvent(entry, { type: 'system' }, 's1', emit);
    expect(runtime.processClaudeEvent).toHaveBeenCalledWith(entry, { type: 'system' }, 's1');

    registry.require('codex').parseEvent(entry, { type: 'thread.started' }, 's1', emit);
    expect(runtime.processCodexEvent).toHaveBeenCalledWith(entry, { type: 'thread.started' }, 's1');

    registry.require('gemini').parseEvent(entry, { type: 'init' }, 's1', emit);
    expect(runtime.processGeminiEvent).toHaveBeenCalledWith(entry, { type: 'init' }, 's1');

    registry.require('hermes').parseEvent(entry, { event: 'response.created' }, 's1', emit);
    expect(runtime.processHermesEvent).toHaveBeenCalledWith(entry, { event: 'response.created' }, 's1');
  });

  it('buildSpawnSpec is forwarded with the session', () => {
    const runtime = makeStubRuntime();
    const registry = createBuiltInRegistry(runtime);
    const session = createEmptySession('claude', 's-claude');
    registry.require('claude').buildSpawnSpec!(session, {});
    expect(runtime.buildClaudeSpawnSpec).toHaveBeenCalledWith(session, {});
  });
});

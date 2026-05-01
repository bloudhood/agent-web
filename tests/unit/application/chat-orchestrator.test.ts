import { describe, it, expect, vi } from 'vitest';
import { createChatOrchestrator } from '@application/chat-orchestrator';
import { createAgentRegistry } from '@core/agent/registry';
import type { AgentAdapter } from '@core/agent/agent';
import { createEmptySession } from '@core/session/session';

function adapter(id: AgentAdapter['id'], attachments: boolean): AgentAdapter {
  return {
    id,
    displayName: id,
    capabilities: {
      attachments,
      thinkingBlocks: false,
      mcpTools: false,
      permissionModes: ['yolo'],
      resume: 'native',
      modelList: 'static',
      usage: 'tokens',
    },
    parseEvent: () => {},
  };
}

const fakeWs = { readyState: 1, send: () => {} };

describe('ChatOrchestrator preflight', () => {
  it('rejects empty sessionId', () => {
    const registry = createAgentRegistry();
    registry.register(adapter('claude', true));
    const o = createChatOrchestrator({ registry, agentManager: { handleMessage: vi.fn(), handleAbort: vi.fn() }, maxAttachments: 4 });
    const r = o.preflight({ sessionId: '', text: 'hi' }, 'claude');
    expect(r.ok).toBe(false);
  });

  it('rejects unknown agent', () => {
    const registry = createAgentRegistry();
    const o = createChatOrchestrator({ registry, agentManager: { handleMessage: vi.fn(), handleAbort: vi.fn() }, maxAttachments: 4 });
    const r = o.preflight({ sessionId: 's', text: 'hi' }, 'claude');
    expect(r.ok).toBe(false);
  });

  it('rejects attachments for non-attachment agent', () => {
    const registry = createAgentRegistry();
    registry.register(adapter('gemini', false));
    const o = createChatOrchestrator({ registry, agentManager: { handleMessage: vi.fn(), handleAbort: vi.fn() }, maxAttachments: 4 });
    const r = o.preflight({ sessionId: 's', text: 'hi', attachments: [{ id: 'a' }] }, 'gemini');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error.code).toBe('NO_ATTACHMENTS_SUPPORT');
  });

  it('rejects too many attachments', () => {
    const registry = createAgentRegistry();
    registry.register(adapter('claude', true));
    const o = createChatOrchestrator({ registry, agentManager: { handleMessage: vi.fn(), handleAbort: vi.fn() }, maxAttachments: 2 });
    const r = o.preflight({
      sessionId: 's', text: 'hi',
      attachments: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    }, 'claude');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error.code).toBe('TOO_MANY_ATTACHMENTS');
  });

  it('passes preflight for valid input', () => {
    const registry = createAgentRegistry();
    registry.register(adapter('claude', true));
    const o = createChatOrchestrator({ registry, agentManager: { handleMessage: vi.fn(), handleAbort: vi.fn() }, maxAttachments: 4 });
    const r = o.preflight({ sessionId: 's', text: 'hi' }, 'claude');
    expect(r.ok).toBe(true);
  });

  it('send delegates to manager when preflight ok', async () => {
    const registry = createAgentRegistry();
    registry.register(adapter('claude', true));
    const handleMessage = vi.fn();
    const o = createChatOrchestrator({ registry, agentManager: { handleMessage, handleAbort: vi.fn() }, maxAttachments: 4 });
    const session = createEmptySession('claude', 's-1');
    const r = await o.send(fakeWs, { sessionId: 's-1', text: 'hi' }, session);
    expect(r.ok).toBe(true);
    expect(handleMessage).toHaveBeenCalledWith(fakeWs, 's-1', 'hi', undefined);
  });

  it('abort calls manager', async () => {
    const registry = createAgentRegistry();
    const handleAbort = vi.fn();
    const o = createChatOrchestrator({ registry, agentManager: { handleMessage: vi.fn(), handleAbort }, maxAttachments: 4 });
    await o.abort(fakeWs, 's-1');
    expect(handleAbort).toHaveBeenCalledWith(fakeWs, 's-1');
  });
});

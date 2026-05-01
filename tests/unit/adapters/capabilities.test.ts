/**
 * Capability declarations are part of the user-facing contract:
 * the frontend uses them to decide UI affordances. Lock them down.
 */
import { describe, it, expect } from 'vitest';
import { createBuiltInRegistry, type BuiltInRuntimeFns } from '../../../src/adapters';

const stub: BuiltInRuntimeFns = {
  buildClaudeSpawnSpec: () => ({ command: 'claude', args: [], env: {}, cwd: '/', parser: 'claude', mode: 'yolo', resume: false }),
  buildCodexSpawnSpec: () => ({ command: 'codex', args: [], env: {}, cwd: '/', parser: 'codex', mode: 'yolo', resume: false }),
  buildGeminiSpawnSpec: () => ({ command: 'gemini', args: [], env: {}, cwd: '/', parser: 'gemini', mode: 'yolo', resume: false }),
  processClaudeEvent: () => {},
  processCodexEvent: () => {},
  processGeminiEvent: () => {},
  processHermesEvent: () => {},
};

describe('Adapter capability matrix (locked)', () => {
  const registry = createBuiltInRegistry(stub);
  const cap = (id: 'claude' | 'codex' | 'gemini' | 'hermes') => registry.require(id).capabilities;

  it('Claude usage is USD', () => {
    expect(cap('claude').usage).toBe('usd');
  });
  it('Codex/Gemini/Hermes usage is tokens', () => {
    expect(cap('codex').usage).toBe('tokens');
    expect(cap('gemini').usage).toBe('tokens');
    expect(cap('hermes').usage).toBe('tokens');
  });
  it('Claude/Codex support attachments; Gemini/Hermes do not (current state)', () => {
    expect(cap('claude').attachments).toBe(true);
    expect(cap('codex').attachments).toBe(true);
    expect(cap('gemini').attachments).toBe(false);
    expect(cap('hermes').attachments).toBe(false);
  });
  it('Hermes only supports yolo permission mode', () => {
    expect(cap('hermes').permissionModes).toEqual(['yolo']);
  });
  it('Gemini excludes default permission mode because browser approvals are not wired', () => {
    expect(cap('gemini').permissionModes).toEqual(['plan', 'yolo']);
  });
  it('Hermes resume is web-only; others native', () => {
    expect(cap('hermes').resume).toBe('web-only');
    expect(cap('claude').resume).toBe('native');
    expect(cap('codex').resume).toBe('native');
    expect(cap('gemini').resume).toBe('native');
  });
  it('modelList: claude/codex/gemini=cli; hermes=gateway', () => {
    expect(cap('claude').modelList).toBe('cli');
    expect(cap('codex').modelList).toBe('cli');
    expect(cap('gemini').modelList).toBe('cli');
    expect(cap('hermes').modelList).toBe('gateway');
  });
  it('inlinePermissionPrompts is false for all in phase 1 (phase 3.1 will flip Claude)', () => {
    for (const id of ['claude', 'codex', 'gemini', 'hermes'] as const) {
      expect(cap(id).inlinePermissionPrompts).toBe(false);
    }
  });
});

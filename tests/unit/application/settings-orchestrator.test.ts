import { describe, it, expect, vi } from 'vitest';
import { createSettingsOrchestrator } from '@application/settings-orchestrator';
import { ok, err, DomainError } from '@core/result';

describe('SettingsOrchestrator', () => {
  it('parses save_model_config', () => {
    const o = createSettingsOrchestrator();
    expect(o.parse({ type: 'save_model_config', config: { foo: 1 } })).toBeTruthy();
  });

  it('parse returns null for unknown types', () => {
    const o = createSettingsOrchestrator();
    expect(o.parse({ type: 'unknown' })).toBeNull();
  });

  it('dispatch routes save_model_config', async () => {
    const o = createSettingsOrchestrator();
    const handlers = {
      saveModelConfig: vi.fn().mockResolvedValue(ok({ ok: true })),
      saveCodexConfig: vi.fn(),
      saveNotifyConfig: vi.fn(),
      saveDevConfig: vi.fn(),
      changePassword: vi.fn(),
    };
    const msg = o.parse({ type: 'save_model_config', config: { x: 1 } })!;
    await o.dispatch(msg, handlers);
    expect(handlers.saveModelConfig).toHaveBeenCalledWith({ x: 1 });
  });

  it('change_password rejects weak password', async () => {
    const o = createSettingsOrchestrator();
    const handlers = {
      saveModelConfig: vi.fn(),
      saveCodexConfig: vi.fn(),
      saveNotifyConfig: vi.fn(),
      saveDevConfig: vi.fn(),
      changePassword: vi.fn().mockResolvedValue(ok({ token: 't' })),
    };
    const msg = o.parse({ type: 'change_password', newPassword: '12' })!;
    const r = await o.dispatch(msg, handlers);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error.code).toBe('WEAK_PASSWORD');
    expect(handlers.changePassword).not.toHaveBeenCalled();
  });

  it('change_password forwards strong password', async () => {
    const o = createSettingsOrchestrator();
    const handlers = {
      saveModelConfig: vi.fn(),
      saveCodexConfig: vi.fn(),
      saveNotifyConfig: vi.fn(),
      saveDevConfig: vi.fn(),
      changePassword: vi.fn().mockResolvedValue(ok({ token: 'new-token' })),
    };
    const msg = o.parse({ type: 'change_password', newPassword: 'strongpw', oldPassword: 'old' })!;
    const r = await o.dispatch(msg, handlers);
    expect(r.ok).toBe(true);
    expect(handlers.changePassword).toHaveBeenCalledWith('old', 'strongpw');
  });
});

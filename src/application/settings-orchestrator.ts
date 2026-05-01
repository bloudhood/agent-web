/**
 * SettingsOrchestrator — typed dispatcher for settings WS messages.
 *
 * Phase 1 scope: define the contract, keep the implementation as thin
 * delegating adapter onto the existing config/notify managers. Each setter
 * returns a Result so the transport can map domain errors to typed WS replies.
 */

import { z } from 'zod';
import { type Result, ok, err, DomainError } from '@core/result';
import { validatePasswordStrength } from '@shared/password-policy';

export const SaveModelConfigSchema = z.object({
  type: z.literal('save_model_config'),
  config: z.unknown(),
});

export const SaveCodexConfigSchema = z.object({
  type: z.literal('save_codex_config'),
  config: z.unknown(),
});

export const SaveNotifyConfigSchema = z.object({
  type: z.literal('save_notify_config'),
  config: z.unknown(),
});

export const SaveDevConfigSchema = z.object({
  type: z.literal('save_dev_config'),
  config: z.unknown(),
});

export const ChangePasswordSchema = z.object({
  type: z.literal('change_password'),
  currentPassword: z.string(),
  newPassword: z.string(),
});

export const SettingsInboundSchema = z.discriminatedUnion('type', [
  SaveModelConfigSchema,
  SaveCodexConfigSchema,
  SaveNotifyConfigSchema,
  SaveDevConfigSchema,
  ChangePasswordSchema,
]);

export type SettingsInbound = z.infer<typeof SettingsInboundSchema>;

export interface SettingsHandlers {
  saveModelConfig(config: unknown): Promise<Result<unknown, DomainError>>;
  saveCodexConfig(config: unknown): Promise<Result<unknown, DomainError>>;
  saveNotifyConfig(config: unknown): Promise<Result<unknown, DomainError>>;
  saveDevConfig(config: unknown): Promise<Result<unknown, DomainError>>;
  changePassword(currentPassword: string, newPassword: string): Promise<Result<{ token: string }, DomainError>>;
}

export interface SettingsOrchestrator {
  parse(raw: unknown): SettingsInbound | null;
  dispatch(msg: SettingsInbound, handlers: SettingsHandlers): Promise<Result<unknown, DomainError>>;
}

export function createSettingsOrchestrator(): SettingsOrchestrator {
  return {
    parse(raw) {
      const r = SettingsInboundSchema.safeParse(raw);
      return r.success ? r.data : null;
    },
    async dispatch(msg, handlers) {
      switch (msg.type) {
        case 'save_model_config':
          return handlers.saveModelConfig(msg.config);
        case 'save_codex_config':
          return handlers.saveCodexConfig(msg.config);
        case 'save_notify_config':
          return handlers.saveNotifyConfig(msg.config);
        case 'save_dev_config':
          return handlers.saveDevConfig(msg.config);
        case 'change_password':
          {
            const strength = validatePasswordStrength(msg.newPassword);
            if (!strength.valid) {
              return err(new DomainError('WEAK_PASSWORD', strength.message));
            }
            return handlers.changePassword(msg.currentPassword, msg.newPassword);
          }
      }
    },
  };
}

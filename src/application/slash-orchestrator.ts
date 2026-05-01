/**
 * SlashOrchestrator — turns a slash-command WS payload into a Result.
 *
 * Phase 1 scope: handle the "pure" web commands (no spawn / no IO):
 *   /clear /help /status /usage /cost /resume /doctor /github /ssh
 * The runtime-mutating commands (/model, /mode, /init, /compact) and the
 * native-CLI streaming commands stay in lib/routes.js for now and will be
 * migrated in a follow-up that backfills more orchestrators.
 *
 * The point of phase 1.3 is to prove the slot: text-only formatters move
 * here and become unit-testable in isolation; lib/routes.js can dispatch
 * to this module for the matching commands.
 */

import type { CommandManifestEntry } from '@shared/commands';
import type { AgentId, PermissionMode, Session } from '@core/session/session';
import type { AgentRegistry } from '@core/agent/registry';
import { type Result, ok, err, DomainError } from '@core/result';

export interface SlashContext {
  agent: AgentId;
  session: Session | null;
  registry: AgentRegistry;
  manifest: CommandManifestEntry[];
}

export interface SlashHandlerResult {
  systemMessage: string;
  /** Optional follow-up effect the caller should perform. */
  effect?: { type: 'clear_session' } | { type: 'set_mode'; mode: PermissionMode };
}

export type SlashHandler = (
  args: string[],
  ctx: SlashContext,
) => Result<SlashHandlerResult, DomainError>;

const HANDLERS: Record<string, SlashHandler> = {
  '/clear': () => ok({ systemMessage: '已清空当前会话上下文。', effect: { type: 'clear_session' } }),

  '/help': (_args, ctx) => ok({
    systemMessage: formatHelp(ctx),
  }),

  '/status': (_args, ctx) => ok({ systemMessage: formatStatus(ctx) }),

  '/usage': (_args, ctx) => ok({ systemMessage: formatUsage(ctx) }),

  '/cost': (_args, ctx) => ok({ systemMessage: formatCost(ctx) }),

  '/resume': (_args, ctx) => ok({ systemMessage: formatResume(ctx) }),

  '/doctor': (_args, ctx) => ok({ systemMessage: formatDoctor(ctx) }),

  '/mode': (args, ctx) => {
    const mode = (args[0] || '').toLowerCase();
    if (!mode) return ok({ systemMessage: `当前权限模式: ${ctx.session?.permissionMode || 'yolo'}` });
    if (!isValidMode(mode)) {
      return err(new DomainError(
        'INVALID_MODE',
        `不支持的权限模式: ${mode}。可选: default / plan / yolo`,
      ));
    }
    const adapter = ctx.registry.get(ctx.agent);
    if (adapter && !adapter.capabilities.permissionModes.includes(mode as PermissionMode)) {
      return err(new DomainError(
        'MODE_NOT_SUPPORTED',
        `${adapter.displayName} 不支持 ${mode} 模式`,
      ));
    }
    return ok({
      systemMessage: `权限模式已切换为 ${mode}`,
      effect: { type: 'set_mode', mode: mode as PermissionMode },
    });
  },

  '/permissions': (args, ctx) => HANDLERS['/mode'](args, ctx),
};

function isValidMode(value: string): value is PermissionMode {
  return value === 'default' || value === 'plan' || value === 'yolo';
}

function formatHelp(ctx: SlashContext): string {
  const lines = ['Agent-Web 内置命令:'];
  for (const cmd of ctx.manifest) {
    if (cmd.kind !== 'web') continue;
    if (!cmd.agents.includes(ctx.agent)) continue;
    lines.push(`  ${cmd.cmd.padEnd(14)} ${cmd.desc}`);
  }
  return lines.join('\n');
}

function formatStatus(ctx: SlashContext): string {
  const adapter = ctx.registry.get(ctx.agent);
  const session = ctx.session;
  if (!session) return `当前 Agent: ${adapter?.displayName || ctx.agent}\n当前没有载入会话。`;
  const usage = session.totalUsage || { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  const lines = [
    `Agent: ${adapter?.displayName || ctx.agent}`,
    `会话: ${session.title || 'Untitled'} (${session.id.slice(0, 8)})`,
    `模式: ${session.permissionMode || 'yolo'}`,
    `模型: ${session.model || '默认'}`,
    `目录: ${session.cwd || '无'}`,
  ];
  if (adapter?.capabilities.usage === 'usd') {
    lines.push(`费用: $${Number(session.totalCost || 0).toFixed(4)}`);
  } else {
    lines.push(`Token: 输入 ${usage.inputTokens}，缓存 ${usage.cachedInputTokens}，输出 ${usage.outputTokens}`);
  }
  return lines.join('\n');
}

function formatUsage(ctx: SlashContext): string {
  const adapter = ctx.registry.get(ctx.agent);
  const session = ctx.session;
  if (adapter?.capabilities.usage === 'usd') {
    return `当前会话累计费用: $${(session?.totalCost || 0).toFixed(4)}`;
  }
  const u = session?.totalUsage || { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  return `当前会话累计 Token: 输入 ${u.inputTokens}，缓存 ${u.cachedInputTokens}，输出 ${u.outputTokens}`;
}

function formatCost(ctx: SlashContext): string {
  return formatUsage(ctx);
}

function formatResume(ctx: SlashContext): string {
  const adapter = ctx.registry.get(ctx.agent);
  const session = ctx.session;
  if (!session) {
    return '当前没有载入会话。请从左侧会话列表选择 agent-web 会话，或使用"导入本地会话"导入 Claude/Codex 原生历史。';
  }
  if (!adapter) return '未识别的 Agent。';
  switch (adapter.capabilities.resume) {
    case 'native': {
      const id = nativeRuntimeIdFor(adapter.id, session);
      return id
        ? `当前会话已绑定原生会话 ID：${id}\n继续发送消息将自动 resume。`
        : '当前会话尚未建立原生会话 ID。发送第一条消息后会自动建立。';
    }
    case 'web-only':
      return '该 Agent 通过 Gateway 维持上下文；agent-web 仅管理本地会话记录。';
    case 'none':
    default:
      return '该 Agent 不支持恢复对话。';
  }
}

function nativeRuntimeIdFor(agent: AgentId, session: Session): string | undefined {
  switch (agent) {
    case 'claude': return session.claudeSessionId;
    case 'codex': return session.codexThreadId;
    case 'gemini': return session.geminiSessionId;
    case 'hermes': return session.hermesResponseId;
  }
}

function formatDoctor(ctx: SlashContext): string {
  const adapters = ctx.registry.list();
  const lines = ['Agent 能力检查:'];
  for (const adapter of adapters) {
    const cap = adapter.capabilities;
    lines.push(`  ${adapter.displayName.padEnd(8)} resume=${cap.resume} usage=${cap.usage} modes=[${cap.permissionModes.join(',')}]`);
  }
  if (ctx.session) {
    lines.push('');
    lines.push(`当前 Agent: ${ctx.registry.get(ctx.agent)?.displayName || ctx.agent}`);
  }
  return lines.join('\n');
}

export interface SlashOrchestrator {
  has(cmd: string): boolean;
  run(rawInput: string, ctx: SlashContext): Result<SlashHandlerResult, DomainError>;
}

export function createSlashOrchestrator(): SlashOrchestrator {
  return {
    has(cmd) {
      return Object.prototype.hasOwnProperty.call(HANDLERS, cmd.toLowerCase());
    },
    run(rawInput, ctx) {
      const parts = String(rawInput).trim().split(/\s+/);
      const head = (parts[0] || '').toLowerCase();
      if (!head.startsWith('/')) {
        return err(new DomainError('NOT_A_COMMAND', `不是 slash 命令: ${rawInput}`));
      }
      const handler = HANDLERS[head];
      if (!handler) {
        return err(new DomainError('UNKNOWN_COMMAND', `未知命令: ${head}`));
      }
      const args = parts.slice(1);
      return handler(args, ctx);
    },
  };
}

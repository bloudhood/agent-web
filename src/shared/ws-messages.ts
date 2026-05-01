/**
 * WebSocket message schema (zod) — single source of truth for client/server contracts.
 *
 * - Inbound (browser -> server): parsed and validated before dispatching.
 * - Outbound (server -> browser): parsed only in tests/dev; runtime trusts source.
 *
 * Phase 1 introduces the schema in parallel with existing code; orchestrators
 * in src/application gradually adopt it. Until full migration, `WsAnyInbound.passthrough()`
 * keeps backward compatibility.
 */

import { z } from 'zod';

export const AgentIdSchema = z.enum(['claude', 'codex', 'hermes', 'gemini']);
export const PermissionModeSchema = z.enum(['default', 'plan', 'yolo']);

export const AttachmentRefSchema = z.object({
  id: z.string(),
  mime: z.string().optional(),
  name: z.string().optional(),
  size: z.number().optional(),
});

export const InAuthSchema = z.object({
  type: z.literal('auth'),
  password: z.string().optional(),
  token: z.string().optional(),
});

export const InSendMessageSchema = z.object({
  type: z.literal('send_message'),
  sessionId: z.string(),
  text: z.string(),
  attachments: z.array(AttachmentRefSchema).optional(),
});

export const InMessageSchema = z.object({
  type: z.literal('message'),
  sessionId: z.string().optional(),
  agent: AgentIdSchema.optional(),
  text: z.string(),
  mode: PermissionModeSchema.optional(),
  attachments: z.array(AttachmentRefSchema).optional(),
});

export const InAbortSchema = z.object({
  type: z.literal('abort'),
  sessionId: z.string(),
});

export const InListSessionsSchema = z.object({ type: z.literal('list_sessions') });
export const InLoadSessionSchema = z.object({
  type: z.literal('load_session'),
  sessionId: z.string(),
});
export const InNewSessionSchema = z.object({
  type: z.literal('new_session'),
  agent: AgentIdSchema.optional(),
  title: z.string().optional(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  mode: PermissionModeSchema.optional(),
  permissionMode: PermissionModeSchema.optional(),
});
export const InDeleteSessionSchema = z.object({
  type: z.literal('delete_session'),
  sessionId: z.string(),
});
export const InRenameSessionSchema = z.object({
  type: z.literal('rename_session'),
  sessionId: z.string(),
  title: z.string(),
});
export const InSetModeSchema = z.object({
  type: z.literal('set_mode'),
  sessionId: z.string(),
  mode: PermissionModeSchema,
});

export const InPermissionResponseSchema = z.object({
  type: z.literal('permission_response'),
  sessionId: z.string(),
  promptId: z.string(),
  decision: z.enum(['allow_once', 'allow_always', 'reject']),
});

export const InChangePasswordSchema = z.object({
  type: z.literal('change_password'),
  currentPassword: z.string(),
  newPassword: z.string(),
});

export const WsInboundCoreSchema = z.discriminatedUnion('type', [
  InAuthSchema,
  InMessageSchema,
  InSendMessageSchema,
  InAbortSchema,
  InListSessionsSchema,
  InLoadSessionSchema,
  InNewSessionSchema,
  InDeleteSessionSchema,
  InRenameSessionSchema,
  InSetModeSchema,
  InPermissionResponseSchema,
  InChangePasswordSchema,
]);

/**
 * Permissive inbound — accepts the core typed messages above OR any other
 * type:string message (passthrough) for backward compatibility while
 * orchestrators migrate.
 */
export const WsInboundSchema = z.union([
  WsInboundCoreSchema,
  z.object({ type: z.string() }).passthrough(),
]);

export type WsInbound = z.infer<typeof WsInboundSchema>;
export type InAuth = z.infer<typeof InAuthSchema>;
export type InSendMessage = z.infer<typeof InSendMessageSchema>;

// ── Outbound (server -> client) ────────────────────────────────────────────

export const OutAuthResultSchema = z.object({
  type: z.literal('auth_result'),
  success: z.boolean(),
  token: z.string().optional(),
  banned: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
});

export const OutTextDeltaSchema = z.object({
  type: z.literal('text_delta'),
  sessionId: z.string().optional(),
  text: z.string(),
});

export const OutToolStartSchema = z.object({
  type: z.literal('tool_start'),
  sessionId: z.string().optional(),
  toolUseId: z.string(),
  name: z.string(),
  input: z.unknown().optional(),
  kind: z.string().nullable().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
});

export const OutToolEndSchema = z.object({
  type: z.literal('tool_end'),
  sessionId: z.string().optional(),
  toolUseId: z.string(),
  result: z.string().optional(),
  kind: z.string().nullable().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
});

export const OutTurnDoneSchema = z.object({
  type: z.literal('turn_done'),
  sessionId: z.string().optional(),
  reason: z.string().optional(),
});

export const OutDoneSchema = z.object({
  type: z.literal('done'),
  sessionId: z.string().optional(),
});

export const OutCostSchema = z.object({
  type: z.literal('cost'),
  sessionId: z.string().optional(),
  costUsd: z.number(),
});

export const OutUsageSchema = z.object({
  type: z.literal('usage'),
  sessionId: z.string().optional(),
  totalUsage: z.object({
    inputTokens: z.number(),
    cachedInputTokens: z.number(),
    outputTokens: z.number(),
  }),
});

export const OutErrorSchema = z.object({
  type: z.literal('error'),
  sessionId: z.string().optional(),
  message: z.string(),
});

export const HistoryMessageSchema = z.object({
  role: z.string().optional(),
  content: z.unknown().optional(),
  text: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).nullable().optional(),
  ts: z.number().optional(),
  thinking: z.string().optional(),
  toolCalls: z.array(z.unknown()).optional(),
}).passthrough();

export const TotalUsageSchema = z.object({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
});

export const OutSessionInfoSchema = z.object({
  type: z.literal('session_info'),
  sessionId: z.string(),
  messages: z.array(HistoryMessageSchema).optional(),
  title: z.string().optional(),
  mode: PermissionModeSchema.optional(),
  model: z.string().optional(),
  agent: AgentIdSchema.optional(),
  hasUnread: z.boolean().optional(),
  cwd: z.string().nullable().optional(),
  totalCost: z.number().optional(),
  totalUsage: TotalUsageSchema.nullable().optional(),
  historyTotal: z.number().optional(),
  historyBuffered: z.number().optional(),
  historyPending: z.boolean().optional(),
  updated: z.string().nullable().optional(),
  isRunning: z.boolean().optional(),
});

export const OutSessionHistoryChunkSchema = z.object({
  type: z.literal('session_history_chunk'),
  sessionId: z.string(),
  messages: z.array(HistoryMessageSchema),
  remaining: z.number().optional(),
});

export const OutPasswordChangedSchema = z.object({
  type: z.literal('password_changed'),
  success: z.boolean(),
  token: z.string().optional(),
  message: z.string().optional(),
});

/**
 * Reasoning / thinking-block delta. Phase 3.1 adds dedicated UI for this so
 * thinking blocks can be folded independently of the main answer text.
 */
export const OutThinkingDeltaSchema = z.object({
  type: z.literal('thinking_delta'),
  sessionId: z.string().optional(),
  text: z.string(),
  tokens: z.number().optional(),
});

/**
 * Inline permission prompt — when supported by the agent (Claude default mode),
 * the server emits this and the client surfaces an Accept / Reject UI.
 */
export const OutPermissionPromptSchema = z.object({
  type: z.literal('permission_prompt'),
  sessionId: z.string(),
  promptId: z.string(),
  toolName: z.string(),
  toolInput: z.unknown().optional(),
  options: z.array(z.enum(['allow_once', 'allow_always', 'reject'])).default(['allow_once', 'reject']),
});

export const WsOutboundCoreSchema = z.discriminatedUnion('type', [
  OutAuthResultSchema,
  OutTextDeltaSchema,
  OutToolStartSchema,
  OutToolEndSchema,
  OutTurnDoneSchema,
  OutDoneSchema,
  OutCostSchema,
  OutUsageSchema,
  OutErrorSchema,
  OutSessionInfoSchema,
  OutSessionHistoryChunkSchema,
  OutPasswordChangedSchema,
  OutThinkingDeltaSchema,
  OutPermissionPromptSchema,
]);

export const WsOutboundSchema = z.union([
  WsOutboundCoreSchema,
  z.object({ type: z.string() }).passthrough(),
]);

export type WsOutbound = z.infer<typeof WsOutboundSchema>;

export function parseInbound(raw: unknown): WsInbound | null {
  const result = WsInboundSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function parseOutbound(raw: unknown): WsOutbound | null {
  const result = WsOutboundSchema.safeParse(raw);
  return result.success ? result.data : null;
}

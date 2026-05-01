/**
 * AgentAdapter — single contract every agent integration must satisfy.
 *
 * Phase 1 introduces the type. Phase 1.2 implements four adapters that wrap
 * the existing logic in `lib/agent-runtime.js`. Eventually the lib version
 * is removed and src/adapters becomes the source of truth.
 */

import type { AgentId, PermissionMode, Session } from '@core/session/session';

export interface AgentCapabilities {
  /** Can submit image/file attachments alongside the user message. */
  attachments: boolean;
  /** Renders a foldable "thinking" / reasoning block in the chat. */
  thinkingBlocks: boolean;
  /** Surfaces MCP tool calls (server, tool name, arguments, status). */
  mcpTools: boolean;
  /** Permission modes this agent honors via the Web UI. */
  permissionModes: readonly PermissionMode[];
  /** Resume strategy: agent-native (CLI/runtime resumes), web-only (we replay), or none. */
  resume: 'native' | 'web-only' | 'none';
  /** Where the model picker pulls its options from. */
  modelList: 'cli' | 'static' | 'gateway';
  /** Conversation listing (currently Hermes Gateway only). */
  conversations?: 'gateway';
  /** Can the Web surface accept/deny native permission prompts in-line? */
  inlinePermissionPrompts?: boolean;
  /** Cost / usage display preference. */
  usage: 'usd' | 'tokens' | 'both';
}

export interface SpawnSpec {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  parser: AgentId;
  mode: PermissionMode;
  resume: boolean;
  /** Codex-only metadata kept on the entry for runtime housekeeping. */
  codexRuntimeKey?: string;
  codexHomeDir?: string;
}

export interface SpawnError {
  error: string;
}

export interface SpawnOptions {
  attachments?: Array<{ id: string; path: string; mime?: string }>;
  text?: string;
}

export interface GatewayCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  method: 'POST' | 'GET' | 'DELETE';
  /** Whether the call uses Server-Sent Events for streaming. */
  stream: boolean;
}

export interface GatewayOptions extends SpawnOptions {}

export type EmitFn = (payload: { type: string; [k: string]: unknown }) => void;

export interface AgentEntry {
  toolCalls: Array<{
    id: string;
    name: string;
    input?: unknown;
    result?: string;
    kind?: string | null;
    meta?: Record<string, unknown> | null;
    done?: boolean;
  }>;
  toolCallsTruncated?: boolean;
  fullText: string;
  fullTextTruncated?: boolean;
  lastUsage?: unknown;
  lastCost?: number | null;
  lastError?: string | null;
  reconnectRetryCount?: number;
  codexHomeDir?: string;
  codexRuntimeKey?: string;
  turnFinalized?: boolean;
  ws?: { readyState: number; bufferedAmount?: number; send: (s: string) => void };
}

export interface SlashCommand {
  cmd: string;
  desc: string;
  kind: 'web' | 'native';
  agents: AgentId[];
}

/**
 * The contract every agent (claude/codex/gemini/hermes) implements.
 *
 * - `buildSpawnSpec` for CLI-backed agents (Claude/Codex/Gemini).
 * - `buildGatewayCall` for HTTP-backed agents (Hermes).
 *   At least one of the two must be defined.
 */
export interface AgentAdapter {
  readonly id: AgentId;
  readonly displayName: string;
  readonly capabilities: AgentCapabilities;

  buildSpawnSpec?(session: Session, opts: SpawnOptions): SpawnSpec | SpawnError;
  buildGatewayCall?(session: Session, opts: GatewayOptions): GatewayCall | SpawnError;

  /**
   * Parse a single raw event from the agent's stream and emit normalized
   * WS events via `emit`. Mutates `entry` (toolCalls, fullText, usage).
   */
  parseEvent(entry: AgentEntry, raw: unknown, sessionId: string, emit: EmitFn): void;

  /** Slash commands the adapter wants to register on top of the manifest. */
  listSlashCommands?(): SlashCommand[];
}

export function isSpawnError(v: unknown): v is SpawnError {
  return !!v && typeof v === 'object' && typeof (v as { error?: unknown }).error === 'string';
}

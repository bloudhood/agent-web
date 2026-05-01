/**
 * Pure Session domain types.
 *
 * Source of truth for what a session "is". IO/persistence lives in
 * src/infra/persistence; orchestration in src/application.
 */

export type AgentId = 'claude' | 'codex' | 'hermes' | 'gemini';
export type PermissionMode = 'default' | 'plan' | 'yolo';

export const VALID_AGENTS: readonly AgentId[] = ['claude', 'codex', 'hermes', 'gemini'];
export const VALID_PERMISSION_MODES: readonly PermissionMode[] = ['default', 'plan', 'yolo'];

export interface SessionUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  attachments?: Array<{
    id: string;
    mime: string;
    size: number;
    name?: string;
  }>;
  toolCalls?: Array<{
    id: string;
    name: string;
    input?: unknown;
    result?: string;
    kind?: string | null;
    meta?: Record<string, unknown> | null;
    done?: boolean;
  }>;
}

export interface Session {
  id: string;
  agent: AgentId;
  title: string;
  cwd?: string;
  model?: string;
  permissionMode?: PermissionMode;
  createdAt: number;
  updatedAt: number;
  messages: SessionMessage[];
  totalCost?: number;
  totalUsage?: SessionUsage;

  // Native runtime IDs by agent
  claudeSessionId?: string;
  codexThreadId?: string;
  geminiSessionId?: string;
  hermesResponseId?: string;

  // Codex custom runtime per-session (when using a custom CODEX_HOME)
  codexHomeDir?: string;
  codexRuntimeKey?: string;
}

export function createEmptySession(agent: AgentId, id: string): Session {
  const now = Date.now();
  return {
    id,
    agent,
    title: 'Untitled',
    permissionMode: 'yolo',
    createdAt: now,
    updatedAt: now,
    messages: [],
    totalCost: 0,
    totalUsage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
  };
}

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (VALID_AGENTS as readonly string[]).includes(value);
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (VALID_PERMISSION_MODES as readonly string[]).includes(value);
}

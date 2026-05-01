/**
 * Sessions store — list, current id, and minimal metadata.
 * Detailed messages live in chatStore (loaded lazily).
 */

export type AgentId = 'claude' | 'codex' | 'hermes' | 'gemini';
export type PermissionMode = 'default' | 'plan' | 'yolo';

export interface SessionMeta {
  id: string;
  agent: AgentId;
  title: string;
  /** ISO string from server (`updated`); we keep both for convenience. */
  updated?: string | null;
  isRunning?: boolean;
  hasUnread?: boolean;
  totalCost?: number;
  totalUsage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
  mode?: PermissionMode;
  model?: string;
  cwd?: string;
}

const VALID_AGENTS: readonly AgentId[] = ['claude', 'codex', 'hermes', 'gemini'];

function readAgent(): AgentId {
  if (typeof localStorage === 'undefined') return 'claude';
  const v = localStorage.getItem('cc-web-agent');
  return (v && (VALID_AGENTS as readonly string[]).includes(v)) ? (v as AgentId) : 'claude';
}

function createSessionsStore() {
  let list = $state<SessionMeta[]>([]);
  let currentId = $state<string | null>(null);
  let currentAgent = $state<AgentId>(readAgent());

  const currentMeta = $derived(currentId ? list.find((s) => s.id === currentId) ?? null : null);

  return {
    get list() { return list; },
    get currentId() { return currentId; },
    get currentAgent() { return currentAgent; },
    get currentMeta() { return currentMeta; },

    replaceList(next: SessionMeta[]) {
      const existing = new Map(list.map((session) => [session.id, session]));
      list = next.map((session) => ({ ...(existing.get(session.id) || {}), ...session }));
    },
    upsert(meta: SessionMeta) {
      const idx = list.findIndex((s) => s.id === meta.id);
      if (idx >= 0) list = list.map((s, i) => (i === idx ? { ...s, ...meta } : s));
      else list = [meta, ...list];
    },
    update(id: string, patch: Partial<SessionMeta>) {
      list = list.map((s) => (s.id === id ? { ...s, ...patch } : s));
    },
    remove(id: string) { list = list.filter((s) => s.id !== id); },

    setCurrent(id: string | null) { currentId = id; },
    setAgent(agent: AgentId) {
      currentAgent = agent;
      localStorage.setItem('cc-web-agent', agent);
    },
  };
}

export const sessionsStore = createSessionsStore();

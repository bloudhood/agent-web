<script lang="ts" module>
  export interface ClaudeNativeSession {
    sessionId: string;
    title?: string;
    cwd?: string | null;
    updatedAt?: string | null;
    alreadyImported?: boolean;
  }

  export interface ClaudeNativeGroup {
    dir: string;
    sessions: ClaudeNativeSession[];
  }

  export interface CodexNativeSession {
    threadId: string;
    title?: string;
    cwd?: string | null;
    updatedAt?: string | null;
    cliVersion?: string;
    source?: string;
    rolloutPath?: string;
    alreadyImported?: boolean;
  }
</script>

<script lang="ts">
  import { RotateCw, Download, Search } from 'lucide-svelte';
  import { Badge, Sheet, Spinner } from '@web/ui';

  interface Props {
    open: boolean;
    loading?: boolean;
    nativeGroups?: ClaudeNativeGroup[];
    codexSessions?: CodexNativeSession[];
    onClose?: () => void;
    onRefresh?: () => void;
    onImportClaude?: (session: ClaudeNativeSession, group: ClaudeNativeGroup) => void;
    onImportCodex?: (session: CodexNativeSession) => void;
  }

  let {
    open,
    loading = false,
    nativeGroups = [],
    codexSessions = [],
    onClose,
    onRefresh,
    onImportClaude,
    onImportCodex,
  }: Props = $props();

  let source = $state<'claude' | 'codex'>('claude');
  let query = $state('');
  const MAX_VISIBLE = 60;

  const claudeCount = $derived(nativeGroups.reduce((sum, group) => sum + group.sessions.length, 0));
  const codexCount = $derived(codexSessions.length);
  const normalizedQuery = $derived(query.trim().toLowerCase());

  function matches(value: unknown) {
    if (!normalizedQuery) return true;
    return String(value || '').toLowerCase().includes(normalizedQuery);
  }

  function matchesClaude(session: ClaudeNativeSession, group: ClaudeNativeGroup) {
    return matches(group.dir) || matches(session.title) || matches(session.cwd) || matches(session.sessionId);
  }

  function matchesCodex(session: CodexNativeSession) {
    return matches(session.title) || matches(session.cwd) || matches(session.threadId) || matches(session.cliVersion);
  }

  const filteredNativeGroups = $derived.by(() => nativeGroups
    .map((group) => ({ ...group, sessions: group.sessions.filter((session) => matchesClaude(session, group)) }))
    .filter((group) => group.sessions.length > 0));
  const filteredCodexSessions = $derived.by(() => codexSessions.filter(matchesCodex));
  const visibleNativeGroups = $derived.by(() => {
    let remaining = MAX_VISIBLE;
    const groups: ClaudeNativeGroup[] = [];
    for (const group of filteredNativeGroups) {
      if (remaining <= 0) break;
      const sessions = group.sessions.slice(0, remaining);
      remaining -= sessions.length;
      if (sessions.length) groups.push({ ...group, sessions });
    }
    return groups;
  });
  const visibleCodexSessions = $derived(filteredCodexSessions.slice(0, MAX_VISIBLE));
  const hiddenNativeCount = $derived(filteredNativeGroups.reduce((sum, group) => sum + group.sessions.length, 0) - visibleNativeGroups.reduce((sum, group) => sum + group.sessions.length, 0));
  const hiddenCodexCount = $derived(filteredCodexSessions.length - visibleCodexSessions.length);

  function timeLabel(value?: string | null) {
    if (!value) return '';
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) return '';
    return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
</script>

<Sheet {open} onClose={onClose} title="导入本地会话" side="right">
  <div class="flex flex-col gap-5">
    <div class="flex items-end gap-2">
      <label class="min-w-0 flex-1">
        <span class="mb-1.5 block px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Source</span>
        <select class="native-select-glass w-full px-3.5 py-2 text-sm" bind:value={source}>
          <option value="claude">Claude Code ({claudeCount})</option>
          <option value="codex">Codex CLI ({codexCount})</option>
        </select>
      </label>
      <button
        type="button"
        class="grid h-10 w-10 flex-none place-items-center rounded-md border border-border/70 bg-surface-panel text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary disabled:opacity-50"
        title="刷新"
        aria-label="刷新"
        disabled={loading}
        onclick={onRefresh}
      >
        {#if loading}<Spinner size="xs" />{:else}<RotateCw size={15} />{/if}
      </button>
    </div>

    <label class="relative block">
      <Search class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
      <input
        class="h-10 w-full rounded-lg border border-border/70 bg-surface-panel/75 px-9 py-2 text-sm text-text-primary shadow-1 outline-none backdrop-blur transition-shadow placeholder:text-text-muted focus:border-accent/60 focus:shadow-2 focus:ring-2 focus:ring-accent/20"
        bind:value={query}
        placeholder="搜索标题、目录或 ID"
      />
    </label>

    {#if loading && claudeCount === 0 && codexCount === 0}
      <div class="flex items-center gap-2 rounded-md border border-border/70 bg-surface-page px-4 py-3 text-sm text-text-muted">
        <Spinner size="xs" />
        正在读取本机历史
      </div>
    {:else if source === 'claude'}
      {#if filteredNativeGroups.length === 0}
        <div class="rounded-md border border-border/70 bg-surface-page px-4 py-3 text-sm text-text-muted">
          未找到可导入的 Claude Code 会话。
        </div>
      {:else}
        <div class="flex flex-col gap-4">
          {#each visibleNativeGroups as group (group.dir)}
            <section class="flex flex-col gap-2">
              <div class="truncate px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{group.dir}</div>
              {#each group.sessions as session (session.sessionId)}
                <article class="rounded-lg border border-border/70 bg-surface-page p-4">
                  <div class="mb-3 flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <h4 class="truncate text-sm font-semibold text-text-primary">{session.title || session.sessionId}</h4>
                      <div class="mt-1 flex flex-wrap gap-2 text-[11px] text-text-muted">
                        {#if session.updatedAt}<span>{timeLabel(session.updatedAt)}</span>{/if}
                        {#if session.cwd}<span class="truncate">{session.cwd}</span>{/if}
                      </div>
                    </div>
                    {#if session.alreadyImported}<Badge tone="neutral">已导入</Badge>{/if}
                  </div>
                  <button
                    type="button"
                    class="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-xs font-medium text-white shadow-1 transition-colors hover:bg-accent-hover disabled:bg-surface-muted disabled:text-text-muted disabled:shadow-none"
                    disabled={loading || session.alreadyImported}
                    onclick={() => onImportClaude?.(session, group)}
                  >
                    <Download size={14} />
                    导入
                  </button>
                </article>
              {/each}
            </section>
          {/each}
          {#if hiddenNativeCount > 0}
            <div class="rounded-md border border-border/70 bg-surface-page px-4 py-3 text-xs text-text-muted">
              还有 {hiddenNativeCount} 条未显示。
            </div>
          {/if}
        </div>
      {/if}
    {:else}
      {#if filteredCodexSessions.length === 0}
        <div class="rounded-md border border-border/70 bg-surface-page px-4 py-3 text-sm text-text-muted">
          未找到可导入的 Codex CLI 会话。
        </div>
      {:else}
        <div class="flex flex-col gap-2">
          {#each visibleCodexSessions as session (session.threadId)}
            <article class="rounded-lg border border-border/70 bg-surface-page p-4">
              <div class="mb-3 flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h4 class="truncate text-sm font-semibold text-text-primary">{session.title || session.threadId}</h4>
                  <div class="mt-1 flex flex-wrap gap-2 text-[11px] text-text-muted">
                    {#if session.updatedAt}<span>{timeLabel(session.updatedAt)}</span>{/if}
                    {#if session.cwd}<span class="truncate">{session.cwd}</span>{/if}
                    {#if session.cliVersion}<span>{session.cliVersion}</span>{/if}
                  </div>
                </div>
                {#if session.alreadyImported}<Badge tone="neutral">已导入</Badge>{/if}
              </div>
              <button
                type="button"
                class="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-xs font-medium text-white shadow-1 transition-colors hover:bg-accent-hover disabled:bg-surface-muted disabled:text-text-muted disabled:shadow-none"
                disabled={loading || session.alreadyImported}
                onclick={() => onImportCodex?.(session)}
              >
                <Download size={14} />
                导入
              </button>
            </article>
          {/each}
          {#if hiddenCodexCount > 0}
            <div class="rounded-md border border-border/70 bg-surface-page px-4 py-3 text-xs text-text-muted">
              还有 {hiddenCodexCount} 条未显示。
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</Sheet>

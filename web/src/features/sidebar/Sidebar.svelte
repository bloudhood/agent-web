<script lang="ts">
  import { Plus, Upload, Settings, MessageSquare, Trash2 } from 'lucide-svelte';
  import { sessionsStore, type AgentId, type SessionMeta } from '@web/lib/stores/sessions.svelte';

  interface Props {
    onNew?: () => void;
    onImport?: () => void;
    onOpenSettings?: () => void;
    onSelect?: (id: string) => void;
    onDelete?: (id: string) => void;
  }
  let { onNew, onImport, onOpenSettings, onSelect, onDelete }: Props = $props();

  function timeAgo(iso?: string | null): string {
    if (!iso) return '';
    const ts = typeof iso === 'string' ? Date.parse(iso) : Number(iso);
    if (!Number.isFinite(ts)) return '';
    const diff = Date.now() - ts;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
    return new Date(ts).toLocaleDateString('zh-CN');
  }

  const AGENT_THEME: Record<SessionMeta['agent'], { label: string; glyph: string; color: string; soft: string }> = {
    claude: { label: 'Claude', glyph: 'C', color: '#d97757', soft: 'rgba(217,119,87,0.14)' },
    codex: { label: 'Codex', glyph: 'X', color: '#6a9bcc', soft: 'rgba(106,155,204,0.16)' },
    gemini: { label: 'Gemini', glyph: 'G', color: '#788c5d', soft: 'rgba(120,140,93,0.16)' },
    hermes: { label: 'Hermes', glyph: 'H', color: '#141413', soft: 'rgba(20,20,19,0.08)' },
  };

  const AGENTS: Array<{ id: AgentId; label: string }> = [
    { id: 'claude', label: 'Claude' },
    { id: 'codex', label: 'Codex' },
    { id: 'gemini', label: 'Gemini' },
    { id: 'hermes', label: 'Hermes' },
  ];

  function selectAgent(event: Event) {
    sessionsStore.setAgent((event.currentTarget as HTMLSelectElement).value as AgentId);
  }

  // Group sessions by date bucket (Today / Yesterday / Earlier).
  function bucketLabel(iso?: string | null): string {
    if (!iso) return '更早';
    const ts = typeof iso === 'string' ? Date.parse(iso) : Number(iso);
    if (!Number.isFinite(ts)) return '更早';
    const now = new Date();
    const d = new Date(ts);
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return '今天';
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return '昨天';
    if ((Date.now() - ts) < 7 * 86_400_000) return '本周';
    return '更早';
  }

  const groups = $derived.by(() => {
    const order = ['今天', '昨天', '本周', '更早'];
    const map = new Map<string, SessionMeta[]>();
    for (const s of sessionsStore.list) {
      const b = bucketLabel(s.updated);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(s);
    }
    return order.filter((b) => map.has(b)).map((b) => ({ label: b, items: map.get(b)! }));
  });
</script>

<div
  class="flex h-full flex-col border-r border-border/70 bg-surface-page"
  style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);"
>
  <header class="flex flex-col gap-3 border-b border-border/70 px-4 py-4">
    <label class="flex flex-col gap-1.5">
      <span class="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Agent</span>
      <select
        aria-label="新会话默认 Agent"
        class="native-select-glass w-full px-3.5 py-2 text-sm"
        onchange={selectAgent}
      >
      {#each AGENTS as agent (agent.id)}
        <option value={agent.id} selected={sessionsStore.currentAgent === agent.id}>{agent.label}</option>
      {/each}
      </select>
    </label>

    <div class="flex items-center gap-2.5">
      <button
        type="button"
        onclick={onNew}
        class="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white shadow-1 transition-colors hover:bg-accent-hover active:scale-[0.98]"
      >
        <Plus size={16} />
        新会话
      </button>
      <button
        type="button"
        onclick={onImport}
        title="导入本地 CLI 会话"
        aria-label="导入"
        class="grid h-10 w-10 place-items-center rounded-md border border-border/70 bg-surface-panel text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary active:scale-95"
      >
        <Upload size={16} />
      </button>
    </div>
  </header>

  <div class="flex-1 overflow-y-auto overscroll-contain">
    {#if sessionsStore.list.length === 0}
      <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-text-muted">
        <MessageSquare size={24} class="opacity-40" />
        <p>暂无会话</p>
      </div>
    {:else}
      <div class="px-3 py-4">
        {#each groups as group (group.label)}
          <div class="mt-5 first:mt-0">
            <div class="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted/80">
              {group.label}
            </div>
            <ul class="flex flex-col gap-1.5">
              {#each group.items as session (session.id)}
                {@const theme = AGENT_THEME[session.agent] ?? AGENT_THEME.claude}
                {@const active = session.id === sessionsStore.currentId}
              <li class="group relative flex items-center gap-2 rounded-md border px-1 transition-colors {active
                  ? 'border-accent/25 bg-surface-panel shadow-1'
                  : 'border-transparent hover:bg-surface-panel/75'}">
                  <button
                    type="button"
                    onclick={() => onSelect?.(session.id)}
                    class="flex flex-1 items-center gap-3 rounded-md px-2 py-2.5 text-left transition-transform active:scale-[0.99]"
                  >
                    <span
                      class="grid h-9 w-9 flex-none place-items-center rounded-md font-mono text-sm font-bold"
                      style:background-color={theme.soft}
                      style:color={theme.color}
                      aria-hidden="true"
                    >
                      {theme.glyph}
                    </span>

                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                          <span class="truncate text-[14px] font-medium leading-tight text-text-primary">
                          {session.title || 'Untitled'}
                        </span>
                        {#if session.hasUnread}
                          <span class="h-1.5 w-1.5 flex-none rounded-full bg-accent"></span>
                        {/if}
                      </div>
                      <div class="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted">
                        <span
                          class="rounded-sm px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider"
                          style:background-color={theme.soft}
                          style:color={theme.color}
                        >
                          {theme.label}
                        </span>
                        {#if session.isRunning}
                          <span class="inline-flex items-center gap-1 text-state-success">
                            <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-state-success"></span>
                            运行中
                          </span>
                        {:else}
                          <span>{timeAgo(session.updated)}</span>
                        {/if}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label="删除会话"
                    onclick={() => onDelete?.(session.id)}
                    class="invisible mr-1 flex-none rounded-md p-1.5 text-text-muted opacity-0 transition-opacity hover:bg-state-danger/10 hover:text-state-danger focus:visible focus:opacity-100 group-hover:visible group-hover:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <footer class="flex items-center justify-between gap-2 border-t border-border/70 px-4 py-3">
    <button
      type="button"
      onclick={onOpenSettings}
      title="设置"
      aria-label="设置"
      class="grid h-10 w-10 place-items-center rounded-md text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary active:scale-95"
    >
      <Settings size={16} />
    </button>
    <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted">Agent Web</span>
  </footer>
</div>

<script lang="ts">
  import { Plus, Settings, MessageSquare, Upload } from 'lucide-svelte';
  import { sessionsStore, type AgentId, type SessionMeta } from '@web/lib/stores/sessions.svelte';
  import SessionRow from './SessionRow.svelte';

  interface Props {
    onNew?: () => void;
    onImport?: () => void;
    onOpenSettings?: () => void;
    onSelect?: (id: string) => void;
    onDelete?: (id: string) => void;
    onRename?: (id: string, title: string) => void;
  }
  let { onNew, onImport, onOpenSettings, onSelect, onDelete, onRename }: Props = $props();

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
        class="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white shadow-1 transition-[background-color,box-shadow,transform] duration-200 ease-out-soft hover:bg-accent-hover hover:shadow-2 active:scale-[0.98] motion-reduce:transition-none"
      >
        <Plus size={16} />
        新会话
      </button>
      <button
        type="button"
        onclick={onImport}
        title="导入本地 CLI 会话"
        aria-label="导入"
        class="grid h-10 w-10 place-items-center rounded-md border border-border/70 bg-surface-panel text-text-secondary transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out-soft hover:bg-surface-muted hover:text-text-primary hover:shadow-1 active:scale-95 motion-reduce:transition-none"
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
                <SessionRow
                  {session}
                  {theme}
                  {active}
                  timeLabel={timeAgo(session.updated)}
                  {onSelect}
                  {onDelete}
                  {onRename}
                />
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
      class="grid h-10 w-10 place-items-center rounded-md text-text-secondary transition-[background-color,color,transform] duration-200 ease-out-soft hover:bg-surface-muted hover:text-text-primary active:scale-95 motion-reduce:transition-none"
    >
      <Settings size={16} />
    </button>
    <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted">Agent Web</span>
  </footer>
</div>

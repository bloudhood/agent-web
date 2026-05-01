<script lang="ts" module>
  export interface SlashCompletion {
    cmd: string;
    completion: string;
    desc: string;
    kind: 'web' | 'native';
    source: string;
  }
</script>

<script lang="ts">
  import { authStore } from '@web/lib/stores/auth.svelte';

  interface Props {
    open: boolean;
    input: string;
    agent: string;
    onClose: () => void;
    onPick: (completion: string) => void;
  }
  let { open, input, agent, onClose, onPick }: Props = $props();

  let items = $state<SlashCompletion[]>([]);
  let cursor = $state(0);
  let loading = $state(false);
  let lastFetch = '';

  async function fetchCompletions(query: string, currentAgent: string) {
    const fetchKey = `${currentAgent}:${query}`;
    if (fetchKey === lastFetch) return;
    lastFetch = fetchKey;
    loading = true;
    try {
      const url = `/api/slash-completions?agent=${encodeURIComponent(currentAgent)}&input=${encodeURIComponent(query)}`;
      const r = await fetch(url, {
        headers: authStore.token ? { Authorization: `Bearer ${authStore.token}` } : undefined,
      });
      if (!r.ok) { items = []; return; }
      const data = await r.json();
      items = Array.isArray(data?.commands) ? data.commands : [];
      cursor = 0;
    } catch {
      items = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (!open) return;
    fetchCompletions(input || '/', agent);
  });

  function handleKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'ArrowDown') { cursor = (cursor + 1) % Math.max(items.length, 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { cursor = (cursor - 1 + items.length) % Math.max(items.length, 1); e.preventDefault(); }
    else if (e.key === 'Enter' && items[cursor]) { onPick(items[cursor].completion); e.preventDefault(); }
    else if (e.key === 'Escape') { onClose(); }
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <div class="absolute bottom-full left-0 right-0 mx-auto mb-3 max-w-4xl rounded-md border border-border/80 bg-surface-panel shadow-3">
    <div class="max-h-80 overflow-y-auto p-2">
      {#if loading && items.length === 0}
        <div class="px-3 py-2.5 text-xs text-text-muted">加载中…</div>
      {:else if items.length === 0}
        <div class="px-3 py-2.5 text-xs text-text-muted">无匹配命令</div>
      {:else}
        {#each items as item, idx (item.cmd + idx)}
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs {idx === cursor ? 'bg-accent-dim' : 'hover:bg-surface-muted'}"
            onmouseenter={() => (cursor = idx)}
            onclick={() => onPick(item.completion)}
          >
            <span class="font-mono font-medium {item.kind === 'web' ? 'text-accent' : 'text-state-info'}">{item.cmd}</span>
            <span class="flex-1 truncate text-text-secondary">{item.desc}</span>
            <span class="text-[10px] uppercase tracking-wider text-text-muted">{item.source}</span>
          </button>
        {/each}
      {/if}
    </div>
  </div>
{/if}

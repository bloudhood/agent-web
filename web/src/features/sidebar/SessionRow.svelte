<script lang="ts">
  import { Check, Pencil, Trash2, X } from 'lucide-svelte';
  import type { SessionMeta } from '@web/lib/stores/sessions.svelte';

  interface Theme {
    label: string;
    glyph: string;
    color: string;
    soft: string;
  }

  interface Props {
    session: SessionMeta;
    theme: Theme;
    active: boolean;
    timeLabel: string;
    onSelect?: (id: string) => void;
    onDelete?: (id: string) => void;
    onRename?: (id: string, title: string) => void;
  }

  let { session, theme, active, timeLabel, onSelect, onDelete, onRename }: Props = $props();
  let editing = $state(false);
  let editingTitle = $state('');
  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (editing) requestAnimationFrame(() => inputEl?.focus());
  });

  function startRename() {
    editing = true;
    editingTitle = session.title || '';
  }

  function cancelRename() {
    editing = false;
    editingTitle = '';
  }

  function commitRename() {
    const title = editingTitle.trim().replace(/\s+/g, ' ');
    if (title && title !== session.title) onRename?.(session.id, title);
    cancelRename();
  }

  function handleRenameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }
</script>

<li class="group relative flex items-center gap-2 rounded-md border px-1 transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out-soft motion-reduce:transition-none {active ? 'border-accent/25 bg-surface-panel shadow-1' : 'border-transparent hover:-translate-y-0.5 hover:bg-surface-panel/75 hover:shadow-1 motion-reduce:hover:translate-y-0'}">
  {#if editing}
    <div class="flex min-w-0 flex-1 items-center gap-2 px-2 py-2.5">
      <span class="grid h-9 w-9 flex-none place-items-center rounded-md font-mono text-sm font-bold" style:background-color={theme.soft} style:color={theme.color} aria-hidden="true">
        {theme.glyph}
      </span>
      <input
        bind:this={inputEl}
        bind:value={editingTitle}
        class="min-w-0 flex-1 rounded-lg border border-accent/35 bg-surface-panel px-2.5 py-1.5 text-[13px] text-text-primary shadow-inner outline-none transition-[border-color,box-shadow] duration-200 focus:border-accent/65 focus:shadow-1"
        aria-label="会话标题"
        maxlength="100"
        onkeydown={handleRenameKey}
      />
    </div>
    <button type="button" aria-label="保存标题" onclick={commitRename} class="mr-0.5 grid h-8 w-8 flex-none place-items-center rounded-md text-state-success transition-[background-color,transform] duration-200 hover:bg-state-success/10 hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100">
      <Check size={14} />
    </button>
    <button type="button" aria-label="取消编辑" onclick={cancelRename} class="mr-1 grid h-8 w-8 flex-none place-items-center rounded-md text-text-muted transition-[background-color,color,transform] duration-200 hover:bg-surface-muted hover:text-text-primary hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100">
      <X size={14} />
    </button>
  {:else}
    <button type="button" onclick={() => onSelect?.(session.id)} class="flex flex-1 items-center gap-3 rounded-md px-2 py-2.5 text-left transition-transform duration-200 ease-out-soft active:scale-[0.99] motion-reduce:transition-none">
      <span class="grid h-9 w-9 flex-none place-items-center rounded-md font-mono text-sm font-bold transition-transform duration-200 ease-out-soft group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100" style:background-color={theme.soft} style:color={theme.color} aria-hidden="true">
        {theme.glyph}
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="truncate text-[14px] font-medium leading-tight text-text-primary">{session.title || 'Untitled'}</span>
          {#if session.hasUnread}<span class="h-1.5 w-1.5 flex-none rounded-full bg-accent"></span>{/if}
        </div>
        <div class="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted">
          <span class="rounded-sm px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider" style:background-color={theme.soft} style:color={theme.color}>{theme.label}</span>
          {#if session.isRunning}
            <span class="inline-flex items-center gap-1 text-state-success">
              <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-state-success"></span>
              运行中
            </span>
          {:else}
            <span>{timeLabel}</span>
          {/if}
        </div>
      </div>
    </button>
    <button type="button" aria-label="修改会话标题" onclick={startRename} class="invisible flex-none rounded-md p-1.5 text-text-muted opacity-0 transition-[opacity,background-color,color,transform] duration-200 ease-out-soft hover:bg-surface-muted hover:text-text-primary hover:scale-105 focus:visible focus:opacity-100 group-hover:visible group-hover:opacity-100 motion-reduce:transition-none motion-reduce:hover:scale-100">
      <Pencil size={14} />
    </button>
    <button type="button" aria-label="删除会话" onclick={() => onDelete?.(session.id)} class="invisible mr-1 flex-none rounded-md p-1.5 text-text-muted opacity-0 transition-[opacity,background-color,color,transform] duration-200 ease-out-soft hover:bg-state-danger/10 hover:text-state-danger hover:scale-105 focus:visible focus:opacity-100 group-hover:visible group-hover:opacity-100 motion-reduce:transition-none motion-reduce:hover:scale-100">
      <Trash2 size={14} />
    </button>
  {/if}
</li>

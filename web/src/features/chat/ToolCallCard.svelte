<script lang="ts">
  import { ChevronRight, Terminal, FileEdit, Wrench, Brain } from 'lucide-svelte';
  import type { ToolCall } from '@web/lib/stores/chat.svelte';

  interface Props { tool: ToolCall; }
  let { tool }: Props = $props();

  let expanded = $state(false);

  const kind = $derived((tool.kind || tool.meta?.kind || 'tool') as string);
  const title = $derived((tool.meta?.title as string) || tool.name);
  const subtitle = $derived((tool.meta?.subtitle as string) || '');
  const exitCode = $derived(tool.meta?.exitCode as number | null | undefined);

  const statusTone = $derived.by(() => {
    const status = tool.meta?.status as string | undefined;
    if (!status) return tool.done ? 'text-state-success' : 'text-text-muted';
    if (status === 'error' || status === 'failed') return 'text-state-danger';
    if (status === 'success' || status === 'completed') return 'text-state-success';
    return 'text-text-muted';
  });

  const statusLabel = $derived.by(() => {
    const status = tool.meta?.status as string | undefined;
    if (typeof exitCode === 'number') return exitCode === 0 ? '完成' : `退出码 ${exitCode}`;
    if (status === 'in_progress') return '执行中';
    if (status === 'error' || status === 'failed') return '失败';
    return tool.done ? '完成' : '执行中';
  });
</script>

<div class="rounded-lg border border-border/70 bg-surface-panel shadow-1">
  <button
    type="button"
    onclick={() => (expanded = !expanded)}
    class="flex w-full items-center gap-3 px-4 py-3 text-left text-xs"
  >
    <span class="grid h-7 w-7 place-items-center rounded-lg bg-surface-muted/80 text-text-secondary">
      {#if kind === 'command_execution'}
        <Terminal size={12} />
      {:else if kind === 'file_change'}
        <FileEdit size={12} />
      {:else if kind === 'reasoning'}
        <Brain size={12} />
      {:else}
        <Wrench size={12} />
      {/if}
    </span>
    <span class="flex-1 truncate font-medium text-text-primary">{title}</span>
    {#if subtitle}
      <span class="truncate text-text-muted">{subtitle}</span>
    {/if}
    <span class="whitespace-nowrap {statusTone}">{statusLabel}</span>
    <ChevronRight size={14} class="transition-transform {expanded ? 'rotate-90' : ''} text-text-muted" />
  </button>
  {#if expanded}
    <div class="border-t border-border/70 px-4 py-3 font-mono text-xs">
      {#if tool.input != null}
        <details class="mb-3">
          <summary class="cursor-pointer text-text-muted">参数</summary>
          <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted/80 p-3 text-text-primary">{JSON.stringify(tool.input, null, 2)}</pre>
        </details>
      {/if}
      {#if tool.result}
        <details open>
          <summary class="cursor-pointer text-text-muted">输出</summary>
          <pre class="tool-output mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted/80 p-3 text-text-primary">{tool.result}</pre>
        </details>
      {/if}
    </div>
  {/if}
</div>

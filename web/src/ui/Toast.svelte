<script lang="ts" module>
  export type ToastTone = 'info' | 'success' | 'warning' | 'danger';
  export interface ToastItem {
    id: string;
    tone?: ToastTone;
    title?: string;
    body?: string;
    durationMs?: number;
  }
</script>

<script lang="ts">
  interface Props {
    items: ToastItem[];
    onDismiss?: (id: string) => void;
  }

  let { items, onDismiss }: Props = $props();

  const toneMap: Record<ToastTone, string> = {
    info: 'border-state-info bg-state-info/10 text-state-info',
    success: 'border-state-success bg-state-success/10 text-state-success',
    warning: 'border-state-warning bg-state-warning/10 text-state-warning',
    danger: 'border-state-danger bg-state-danger/10 text-state-danger',
  };
</script>

<div class="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
  {#each items as item (item.id)}
    <div
      class="pointer-events-auto rounded-md border bg-surface-panel p-3 shadow-2 {toneMap[item.tone ?? 'info']}"
    >
      {#if item.title}
        <div class="font-medium text-text-primary">{item.title}</div>
      {/if}
      {#if item.body}
        <div class="mt-0.5 text-xs text-text-secondary">{item.body}</div>
      {/if}
      <button
        type="button"
        aria-label="dismiss"
        class="absolute right-1 top-1 rounded p-1 text-text-muted hover:text-text-primary"
        onclick={() => onDismiss?.(item.id)}
      >
        ×
      </button>
    </div>
  {/each}
</div>

<script lang="ts" module>
  export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
</script>

<script lang="ts">
  interface Props {
    tone?: BadgeTone;
    children?: import('svelte').Snippet;
    class?: string;
  }

  let { tone = 'neutral', children, class: extra = '' }: Props = $props();

  const toneMap: Record<BadgeTone, string> = {
    neutral: 'bg-surface-muted text-text-secondary',
    accent: 'bg-accent-dim text-accent',
    success: 'bg-state-success/15 text-state-success',
    warning: 'bg-state-warning/15 text-state-warning',
    danger: 'bg-state-danger/15 text-state-danger',
    info: 'bg-state-info/15 text-state-info',
  };
</script>

<span class="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium {toneMap[tone]} {extra}">
  {#if children}{@render children()}{/if}
</span>

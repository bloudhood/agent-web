<script lang="ts">
  import { untrack } from 'svelte';
  import { ChevronRight, Brain } from 'lucide-svelte';

  interface Props {
    text: string;
    tokens?: number;
    defaultOpen?: boolean;
  }
  let props: Props = $props();
  let open = $state(untrack(() => props.defaultOpen ?? false));
</script>

<div class="rounded-md border border-border/70 bg-surface-muted/35">
  <button
    type="button"
    onclick={() => (open = !open)}
    class="flex w-full items-center gap-3 px-4 py-3 text-left text-xs"
  >
    <span class="grid h-7 w-7 place-items-center rounded-md bg-state-info/15 text-state-info">
      <Brain size={12} />
    </span>
    <span class="flex-1 font-medium text-text-secondary">思考过程</span>
    {#if props.tokens != null}
      <span class="text-text-muted">{props.tokens} tokens</span>
    {/if}
    <ChevronRight size={14} class="transition-transform {open ? 'rotate-90' : ''} text-text-muted" />
  </button>
  {#if open && props.text}
    <div class="whitespace-pre-wrap border-t border-border/70 px-4 py-3 font-mono text-xs leading-6 text-text-secondary">{props.text}</div>
  {/if}
</div>

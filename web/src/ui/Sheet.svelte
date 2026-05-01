<script lang="ts">
  // Lightweight bottom-sheet / side-sheet primitive. bits-ui has a richer Dialog,
  // but this is sized for our common case (mobile-friendly bottom sheet, desktop
  // right-aligned drawer). It traps clicks via the scrim.
  interface Props {
    open: boolean;
    side?: 'bottom' | 'right';
    title?: string;
    onClose?: () => void;
    children?: import('svelte').Snippet;
  }

  let { open, side = 'right', title, onClose, children }: Props = $props();

  const sideClasses = {
    right: 'right-0 top-0 h-full w-full max-w-lg translate-x-0',
    bottom: 'bottom-0 left-0 right-0 max-h-[80vh] translate-y-0 rounded-t-md',
  };

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) onClose?.();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="fixed inset-0 z-50 bg-black/30" onclick={onClose} role="presentation"></div>
  <div
    class="fixed z-50 flex flex-col bg-surface-panel shadow-3 {sideClasses[side]}"
    role="dialog"
    aria-modal="true"
  >
    {#if title}
      <header class="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <h3 class="text-base font-semibold text-text-primary">{title}</h3>
        <button
          type="button"
          aria-label="关闭"
          class="rounded-md px-2.5 py-1.5 text-text-secondary hover:bg-surface-muted hover:text-text-primary"
          onclick={onClose}
        >×</button>
      </header>
    {/if}
    <div class="flex-1 overflow-y-auto p-5">
      {#if children}{@render children()}{/if}
    </div>
  </div>
{/if}

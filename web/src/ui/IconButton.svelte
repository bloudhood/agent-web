<script lang="ts">
  interface Props {
    title?: string;
    'aria-label'?: string;
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
    children?: import('svelte').Snippet;
    class?: string;
  }

  let {
    title,
    'aria-label': ariaLabel,
    disabled = false,
    onclick,
    children,
    class: extra = '',
    ...rest
  }: Props = $props();
</script>

<button
  type="button"
  {title}
  aria-label={ariaLabel ?? title}
  {disabled}
  class="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors duration-200 hover:bg-surface-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 {extra}"
  {onclick}
  {...rest}
>
  {#if children}{@render children()}{/if}
</button>

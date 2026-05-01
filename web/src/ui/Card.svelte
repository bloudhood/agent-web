<script lang="ts">
  interface Props {
    elevation?: 1 | 2 | 3;
    padding?: 'sm' | 'md' | 'lg';
    children?: import('svelte').Snippet;
    class?: string;
  }

  let { elevation = 1, padding = 'md', children, class: extra = '', ...rest }: Props = $props();

  const padMap = { sm: 'p-4', md: 'p-5', lg: 'p-7' };
  const shadowMap = { 1: 'shadow-1', 2: 'shadow-2', 3: 'shadow-3' } as const;
</script>

<div
  class="surface-card {padMap[padding]} {shadowMap[elevation]} {extra}"
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>

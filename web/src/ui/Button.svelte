<script lang="ts" module>
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
  export type ButtonSize = 'sm' | 'md' | 'lg';
</script>

<script lang="ts">
  interface Props {
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit' | 'reset';
    onclick?: (event: MouseEvent) => void;
    children?: import('svelte').Snippet;
    class?: string;
  }

  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    type = 'button',
    onclick,
    children,
    class: extra = '',
    ...rest
  }: Props = $props();

  const base =
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-200 ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50';

  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'bg-surface-muted/75 text-text-primary hover:bg-surface-panel border border-border/75',
    ghost: 'text-text-secondary hover:bg-surface-muted/75 hover:text-text-primary',
    danger: 'bg-state-danger text-white hover:opacity-90',
  };

  const sizes: Record<ButtonSize, string> = {
    sm: 'h-9 px-3.5 text-xs',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-5 text-base',
  };
</script>

<button
  {type}
  disabled={disabled || loading}
  class="{base} {variants[variant]} {sizes[size]} {extra}"
  {onclick}
  {...rest}
>
  {#if loading}
    <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</button>

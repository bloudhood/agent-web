<script lang="ts">
  interface Props {
    value?: string;
    type?: 'text' | 'password' | 'email' | 'number' | 'search';
    placeholder?: string;
    disabled?: boolean;
    autocomplete?: AutoFill;
    onkeydown?: (e: KeyboardEvent) => void;
    oninput?: (e: Event) => void;
    class?: string;
  }

  let {
    value = $bindable(''),
    type = 'text',
    placeholder,
    disabled,
    autocomplete,
    onkeydown,
    oninput,
    class: extra = '',
    ...rest
  }: Props = $props();
</script>

<input
  {type}
  bind:value
  {placeholder}
  {disabled}
  {autocomplete}
  {onkeydown}
  {oninput}
  class="h-11 w-full rounded-md border border-border/75 bg-surface-panel px-3.5 text-sm text-text-primary placeholder:text-text-muted shadow-1 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50 {extra}"
  {...rest}
/>

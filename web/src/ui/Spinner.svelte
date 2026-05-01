<script lang="ts">
  interface Props {
    size?: 'xs' | 'sm' | 'md';
    class?: string;
  }
  let { size = 'sm', class: extra = '' }: Props = $props();
  const sizeMap = { xs: 'h-3 w-3 border-[1.5px]', sm: 'h-4 w-4 border-2', md: 'h-6 w-6 border-2' };
</script>

<span class="inline-block animate-spin rounded-full border-current/30 border-t-current {sizeMap[size]} {extra}" aria-hidden="true"></span>

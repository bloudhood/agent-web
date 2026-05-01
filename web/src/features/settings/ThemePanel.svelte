<script lang="ts">
  import { Card } from '@web/ui';
  import { uiStore, type Theme } from '@web/lib/stores/ui.svelte';

  const themes: Array<{ id: Theme; label: string; desc: string; swatches: string[] }> = [
    {
      id: 'washi',
      label: 'Claude Light',
      desc: '暖白底、炭黑正文、陶土橙强调',
      swatches: ['#faf9f5', '#141413', '#e8e6dc', '#d97757'],
    },
    {
      id: 'washi-dark',
      label: 'Claude Dark',
      desc: '炭黑底、暖白正文、低饱和强调',
      swatches: ['#141413', '#faf9f5', '#43403a', '#d97757'],
    },
  ];
</script>

<Card padding="md">
  <h3 class="text-sm font-semibold">主题</h3>
  <p class="mb-4 mt-1 text-xs text-text-muted">选择适合你的视觉风格。</p>

  <div class="grid gap-3 md:grid-cols-2">
    {#each themes as theme (theme.id)}
      {@const active = uiStore.theme === theme.id}
      <button
        type="button"
        onclick={() => uiStore.setTheme(theme.id)}
        class="flex flex-col gap-3 rounded-md border p-4 text-left transition-colors {active ? 'border-accent/60 bg-accent-dim' : 'border-border/75 bg-surface-panel hover:border-text-muted'}"
      >
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">{theme.label}</span>
          {#if active}<span class="text-xs text-accent">已选</span>{/if}
        </div>
        <p class="text-xs leading-5 text-text-secondary">{theme.desc}</p>
        <div class="flex gap-2">
          {#each theme.swatches as color (color)}
            <span class="h-5 w-5 rounded-sm border border-border/50" style:background-color={color}></span>
          {/each}
        </div>
      </button>
    {/each}
  </div>
</Card>

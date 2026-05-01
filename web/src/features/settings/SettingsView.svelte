<script lang="ts" module>
  export type SettingsTabId = 'account' | 'theme' | 'ccswitch' | 'agents' | 'about';
</script>

<script lang="ts">
  import { Sheet } from '@web/ui';
  import AccountPanel from './AccountPanel.svelte';
  import ThemePanel from './ThemePanel.svelte';
  import CcSwitchPanel from './CcSwitchPanel.svelte';
  import AgentsPanel from './AgentsPanel.svelte';
  import AboutPanel from './AboutPanel.svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
  }
  let { open, onClose }: Props = $props();

  let active = $state<SettingsTabId>('account');

  const tabs: Array<{ id: SettingsTabId; label: string }> = [
    { id: 'account',  label: '账户' },
    { id: 'theme',    label: '外观' },
    { id: 'ccswitch', label: 'CC Switch' },
    { id: 'agents',   label: 'Agent' },
    { id: 'about',    label: '关于' },
  ];

  const activeIndex = $derived(Math.max(0, tabs.findIndex((tab) => tab.id === active)));
</script>

<Sheet {open} {onClose} title="设置" side="right">
  <div class="flex flex-col gap-5">
    <nav class="relative grid rounded-lg bg-surface-muted/75 p-1.5" style:grid-template-columns={`repeat(${tabs.length}, minmax(0, 1fr))`}>
      <span
        class="pointer-events-none absolute inset-y-1.5 left-1.5 rounded-lg bg-surface-panel shadow-1 transition-transform duration-300 ease-out-soft motion-reduce:transition-none"
        style={`width: calc((100% - 0.75rem) / ${tabs.length}); transform: translateX(${activeIndex * 100}%);`}
        aria-hidden="true"
      ></span>
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          class="relative z-10 rounded-lg px-3 py-2 text-xs font-medium transition-colors duration-200 {active === tab.id
            ? 'text-text-primary'
            : 'text-text-secondary hover:text-text-primary'}"
          onclick={() => (active = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </nav>

    {#key active}
      <section class="settings-tab-panel">
        {#if active === 'account'}
          <AccountPanel />
        {:else if active === 'theme'}
          <ThemePanel />
        {:else if active === 'ccswitch'}
          <CcSwitchPanel />
        {:else if active === 'agents'}
          <AgentsPanel />
        {:else}
          <AboutPanel />
        {/if}
      </section>
    {/key}
  </div>
</Sheet>

<style>
  .settings-tab-panel {
    animation: settings-panel-in 180ms var(--ease-out-soft, ease-out);
  }

  @keyframes settings-panel-in {
    from {
      opacity: 0.78;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .settings-tab-panel {
      animation: none;
    }
  }
</style>

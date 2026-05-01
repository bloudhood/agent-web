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
</script>

<Sheet {open} {onClose} title="设置" side="right">
  <div class="flex flex-col gap-5">
    <nav class="flex flex-wrap gap-1.5 rounded-md bg-surface-muted/75 p-1.5">
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          class="flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors {active === tab.id
            ? 'bg-surface-panel text-text-primary shadow-1'
            : 'text-text-secondary hover:text-text-primary'}"
          onclick={() => (active = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </nav>

    <section>
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
  </div>
</Sheet>

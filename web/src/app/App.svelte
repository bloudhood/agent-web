<script lang="ts">
  import { onMount } from 'svelte';
  import LoginView from '@web/features/login/LoginView.svelte';
  import MainLayout from './MainLayout.svelte';
  import { Toast } from '@web/ui';
  import { authStore } from '@web/lib/stores/auth.svelte';
  import { toastStore } from '@web/lib/stores/toast.svelte';
  import { ensureAuth, getWsClient } from '@web/lib/ws-context.svelte';

  ensureAuth();

  onMount(() => {
    getWsClient();
  });
</script>

<Toast items={toastStore.items} onDismiss={toastStore.dismiss} />

{#if authStore.authed}
  <MainLayout />
{:else}
  <LoginView />
{/if}

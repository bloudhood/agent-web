<script lang="ts">
  import { onMount } from 'svelte';
  import { RotateCw, ExternalLink } from 'lucide-svelte';
  import { Card, Spinner, Badge } from '@web/ui';
  import { getWsClient } from '@web/lib/ws-context.svelte';
  import { toastStore } from '@web/lib/stores/toast.svelte';

  type App = 'claude' | 'codex' | 'gemini';

  interface Provider {
    id: string;
    name: string;
    apiUrl?: string;
    current?: boolean;
  }
  interface AppState {
    ok: boolean;
    app: App;
    providers: Provider[];
    currentProviderId?: string;
    currentProviderName?: string;
    envStatus?: { ok?: boolean; summary?: string; error?: string };
    toolStatus?: { ok?: boolean; status?: string; version?: string };
    error?: string;
  }
  interface CcSwitchState {
    cli: { ok: boolean; path?: string; error?: string };
    toolStatus?: unknown;
    apps: Record<App, AppState>;
  }

  let ccState: CcSwitchState | null = $state(null);
  let loading = $state(true);
  let switching: Record<string, boolean> = $state({});

  const APP_META: Record<App, { label: string; glyph: string; color: string; soft: string }> = {
    claude: { label: 'Claude Code', glyph: 'C', color: '#d97757', soft: 'rgba(217,119,87,0.14)' },
    codex: { label: 'Codex CLI', glyph: 'X', color: '#6a9bcc', soft: 'rgba(106,155,204,0.16)' },
    gemini: { label: 'Gemini CLI', glyph: 'G', color: '#788c5d', soft: 'rgba(120,140,93,0.16)' },
  };

  function refresh() {
    loading = true;
    if (!getWsClient().send({ type: 'get_ccswitch_state' })) {
      toastStore.warning('未连接', 'WebSocket 未就绪，请稍后重试');
      loading = false;
      return;
    }
    setTimeout(() => { loading = false; }, 1500);
  }

  function refreshDesktop() {
    if (!getWsClient().send({ type: 'refresh_ccswitch_desktop' })) {
      toastStore.warning('未连接', 'WebSocket 未就绪，请稍后重试');
    }
  }

  function switchProvider(app: App, providerId: string) {
    const key = `${app}:${providerId}`;
    switching = { ...switching, [key]: true };
    if (!getWsClient().send({ type: 'switch_ccswitch_provider', app, providerId })) {
      toastStore.warning('未连接', 'WebSocket 未就绪，请稍后重试');
      switching = { ...switching, [key]: false };
      return;
    }
    setTimeout(() => {
      switching = { ...switching, [key]: false };
    }, 1500);
  }

  function appIsSwitching(app: App) {
    return Object.entries(switching).some(([key, value]) => value && key.startsWith(`${app}:`));
  }

  function healthText(status?: { ok?: boolean; summary?: string; status?: string; error?: string; version?: string }) {
    if (!status) return '未检测';
    return status.ok ? '正常' : '异常';
  }

  /**
   * Listen for ccswitch_state and ccswitch_switch_result via the global WS.
   * The bridge already routes settings messages through CCWeb-style settings
   * handlers; here we listen directly for simplicity.
   */
  onMount(() => {
    const ws = getWsClient();
    refresh();
    return ws.on((msg) => {
      if (msg.type === 'ccswitch_state') {
        const m = msg as unknown as { state: CcSwitchState };
        ccState = m.state;
        loading = false;
      } else if (msg.type === 'ccswitch_switch_result') {
        const m = msg as unknown as { success: boolean; message?: string; app?: App; providerId?: string };
        if (m.app && m.providerId) {
          const key = `${m.app}:${m.providerId}`;
          switching = { ...switching, [key]: false };
        }
        if (m.success) {
          toastStore.success('已切换 Provider', m.message);
          refresh();
        } else {
          toastStore.danger('切换失败', m.message);
          refresh();
        }
      } else if (msg.type === 'ccswitch_desktop_refresh_result') {
        const m = msg as unknown as { success: boolean; message?: string };
        if (m.success) toastStore.success('CC Switch 桌面端', m.message);
        else toastStore.warning('CC Switch 桌面端', m.message);
      }
    });
  });
</script>

<Card padding="md">
  <header class="mb-4 flex items-center justify-between">
    <div>
      <h3 class="text-sm font-semibold text-text-primary">CC Switch</h3>
      <p class="mt-0.5 text-xs text-text-muted">本机 provider 状态</p>
    </div>
    <div class="flex items-center gap-1.5">
      <button
        type="button"
        onclick={refresh}
        title="刷新状态"
        aria-label="刷新"
        class="grid h-9 w-9 place-items-center rounded-md text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary active:scale-95"
      >
        <RotateCw size={14} />
      </button>
      <button
        type="button"
        onclick={refreshDesktop}
        title="刷新桌面端显示"
        aria-label="刷新桌面端显示"
        class="grid h-9 w-9 place-items-center rounded-md text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary active:scale-95"
      >
        <ExternalLink size={14} />
      </button>
    </div>
  </header>

  {#if loading && !ccState}
    <div class="flex items-center gap-2 text-xs text-text-muted">
      <Spinner size="xs" /> 正在读取 CC Switch 状态…
    </div>
  {:else if ccState && ccState.cli && !ccState.cli.ok}
    <div class="rounded-md bg-state-warning/10 px-3 py-2 text-xs text-state-warning">
      未找到 cc-switch CLI。请安装后重试：<code class="font-mono">npm i -g @leoli0605/cc-switch</code>
      {#if ccState.cli.error}
        <div class="mt-1 text-text-muted">{ccState.cli.error}</div>
      {/if}
    </div>
  {:else if ccState}
    <div class="flex flex-col gap-4">
      {#each Object.entries(ccState.apps) as entry (entry[0])}
        {@const app = entry[0] as App}
        {@const appState = entry[1] as AppState}
        {@const meta = APP_META[app]}
        {@const appSwitching = appIsSwitching(app)}
        {@const currentProvider = appState.providers.find((provider) => provider.id === appState.currentProviderId)}
        <div class="rounded-lg border border-border/70 bg-surface-page p-4">
          <div class="mb-3 flex items-center gap-3">
            <span
              class="grid h-8 w-8 place-items-center rounded-md font-mono text-sm font-bold"
              style:background-color={meta.soft}
              style:color={meta.color}
            >
              {meta.glyph}
            </span>
            <span class="flex-1 text-[13px] font-semibold text-text-primary">{meta.label}</span>
            {#if appState.ok && appState.currentProviderName}
              <Badge tone="accent">{appState.currentProviderName}</Badge>
            {/if}
          </div>
          <div class="mb-3 flex flex-wrap gap-1.5">
            <Badge tone={appState.envStatus?.ok ? 'success' : 'warning'}>环境 {healthText(appState.envStatus)}</Badge>
            <Badge tone={appState.toolStatus?.ok ? 'success' : 'warning'}>CLI {healthText(appState.toolStatus)}</Badge>
          </div>

          {#if !appState.ok}
            <div class="rounded-md bg-state-warning/10 px-2 py-1.5 text-[11px] text-state-warning">
              {appState.error || '无法读取 provider 列表'}
            </div>
          {:else if appState.providers.length === 0}
            <div class="text-[11px] text-text-muted">未配置任何 Provider</div>
          {:else}
            <label class="flex flex-col gap-1.5">
              <span class="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Provider</span>
              <span class="relative">
                <select
                  aria-label={`${meta.label} Provider`}
                  class="native-select-glass w-full px-3.5 py-2 pr-9 text-[13px] disabled:opacity-60"
                  disabled={appSwitching}
                  onchange={(e) => {
                    const providerId = (e.currentTarget as HTMLSelectElement).value;
                    if (providerId && providerId !== appState.currentProviderId) switchProvider(app, providerId);
                  }}
                >
              {#each appState.providers as provider (provider.id)}
                <option value={provider.id} selected={provider.id === appState.currentProviderId}>{provider.name}</option>
              {/each}
                </select>
                {#if appSwitching}
                  <span class="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-text-muted">
                    <Spinner size="xs" />
                  </span>
                {/if}
              </span>
            </label>
            {#if currentProvider?.apiUrl}
              <div class="mt-2 truncate px-1 text-[11px] text-text-muted">{currentProvider.apiUrl}</div>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</Card>

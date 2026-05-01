<script lang="ts">
  import { Menu } from 'lucide-svelte';
  import { sessionsStore, type AgentId, type PermissionMode } from '@web/lib/stores/sessions.svelte';
  import { getWsClient } from '@web/lib/ws-context.svelte';
  import { sendSetMode } from '@web/lib/ws-bridge';

  interface Props {
    onToggleSidebar?: () => void;
  }
  let { onToggleSidebar }: Props = $props();

  const meta = $derived(sessionsStore.currentMeta);

  const DEFAULT_MODEL_LABEL: Record<AgentId, string> = {
    claude: 'Opus',
    codex: 'Codex 默认模型',
    gemini: 'Gemini CLI 默认模型',
    hermes: 'Hermes Gateway',
  };

  const currentAgent = $derived(meta?.agent ?? sessionsStore.currentAgent);
  const currentModelLabel = $derived.by(() => {
    const raw = (meta?.model || '').trim();
    return raw ? raw.replace(/\[1m\]$/, '') : DEFAULT_MODEL_LABEL[currentAgent];
  });

  const usageText = $derived.by(() => {
    if (!meta) return '';
    if (meta.totalCost && meta.totalCost > 0) return `$${meta.totalCost.toFixed(4)}`;
    const u = meta.totalUsage;
    if (u && (u.inputTokens || u.outputTokens)) {
      const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
      return `${fmt(u.inputTokens)}↑ ${fmt(u.outputTokens)}↓`;
    }
    return '';
  });

  const modes = $derived.by<PermissionMode[]>(() => {
    if (currentAgent === 'gemini') return ['plan', 'yolo'];
    if (currentAgent === 'hermes') return ['yolo'];
    return ['default', 'plan', 'yolo'];
  });

  function pickMode(mode: PermissionMode) {
    if (meta) sendSetMode(getWsClient(), meta.id, mode);
  }

  function modeLabel(mode: PermissionMode | undefined) {
    if (mode === 'plan') return 'Plan';
    if (mode === 'default') return '默认';
    return 'YOLO';
  }

</script>

<header
  class="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border/60 bg-surface-page/95 px-5 backdrop-blur"
  style="padding-top: env(safe-area-inset-top); height: calc(64px + env(safe-area-inset-top));"
>
  <button
    type="button"
    onclick={onToggleSidebar}
    title="菜单"
    aria-label="菜单"
    class="grid h-10 w-10 flex-none place-items-center rounded-xl text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary active:scale-95 md:hidden"
  >
    <Menu size={18} />
  </button>

  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-1.5">
      <h2 class="truncate text-[16px] font-semibold tracking-tight text-text-primary">
        {meta?.title || '新会话'}
      </h2>
    </div>

    {#if meta}
      <div class="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
        <span
          aria-label="当前模型"
          title={currentModelLabel}
          class="inline-flex h-8 max-w-[16rem] items-center gap-1.5 rounded-xl border border-border/70 bg-surface-raised/75 px-3 text-[12px] shadow-sm"
        >
          <span class="text-text-muted">模型</span>
          <span class="truncate font-medium text-text-primary">{currentModelLabel}</span>
        </span>

        <select
          aria-label="权限模式"
          class="native-select-glass h-8 min-h-0 max-w-[9rem] px-2.5 py-1 text-[12px]"
          onchange={(e) => pickMode((e.currentTarget as HTMLSelectElement).value as PermissionMode)}
        >
          {#each modes as mode (mode)}
            <option value={mode} selected={(meta.mode ?? 'yolo') === mode}>{modeLabel(mode)}</option>
          {/each}
        </select>

        {#if usageText}
          <span class="font-mono text-[10px] text-text-muted">{usageText}</span>
        {/if}
      </div>
    {/if}
  </div>
</header>

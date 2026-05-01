<script lang="ts" module>
  export interface PermissionRequest {
    promptId: string;
    sessionId: string;
    toolName: string;
    toolInput?: unknown;
    options: Array<'allow_once' | 'allow_always' | 'reject'>;
  }
</script>

<script lang="ts">
  import { Card, Button } from '@web/ui';
  import { Shield, AlertTriangle } from 'lucide-svelte';

  interface Props {
    request: PermissionRequest;
    onDecide: (decision: PermissionRequest['options'][number]) => void;
  }
  let { request, onDecide }: Props = $props();
</script>

<Card padding="md" elevation={2} class="border-state-warning/50">
  <header class="mb-2 flex items-center gap-2">
    <span class="grid h-7 w-7 place-items-center rounded bg-state-warning/15 text-state-warning">
      <Shield size={14} />
    </span>
    <h4 class="text-sm font-semibold text-text-primary">需要授权</h4>
    <span class="ml-auto inline-flex items-center gap-1 rounded-sm bg-state-warning/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-state-warning">
      <AlertTriangle size={10} />
      Permission
    </span>
  </header>

  <p class="mb-2 text-xs text-text-secondary">
    Agent 想要执行 <code class="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-text-primary">{request.toolName}</code>
  </p>

  {#if request.toolInput}
    <details class="mb-3 text-xs">
      <summary class="cursor-pointer text-text-muted">查看参数</summary>
      <pre class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2 font-mono">{JSON.stringify(request.toolInput, null, 2)}</pre>
    </details>
  {/if}

  <div class="flex flex-wrap gap-2">
    {#each request.options as option (option)}
      {#if option === 'allow_once'}
        <Button size="sm" onclick={() => onDecide('allow_once')}>仅本次允许</Button>
      {:else if option === 'allow_always'}
        <Button size="sm" variant="secondary" onclick={() => onDecide('allow_always')}>始终允许</Button>
      {:else}
        <Button size="sm" variant="danger" onclick={() => onDecide('reject')}>拒绝</Button>
      {/if}
    {/each}
  </div>
</Card>

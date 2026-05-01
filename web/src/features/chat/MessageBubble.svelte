<script lang="ts">
  import type { ChatMessage } from '@web/lib/stores/chat.svelte';
  import ToolCallCard from './ToolCallCard.svelte';

  interface Props {
    message: ChatMessage;
    streaming?: boolean;
  }
  let { message, streaming = false }: Props = $props();

  const isUser = $derived(message.role === 'user');
  const isSystem = $derived(message.role === 'system');
</script>

{#if isSystem}
  <div class="mx-auto rounded-md border border-border/70 bg-surface-muted/65 px-4 py-1.5 text-center text-[12px] text-text-secondary">
    {message.text}
  </div>
{:else}
  <div class="flex flex-col gap-3 {isUser ? 'items-end' : 'items-start'}">
    <div
      class="max-w-[82%] whitespace-pre-wrap break-words rounded-md px-5 py-3 text-[15px] leading-7 {isUser
        ? 'bg-accent text-white shadow-1'
        : 'border border-border/70 bg-surface-panel text-text-primary shadow-1'}"
    >
      {message.text}
      {#if streaming}<span class="ml-0.5 inline-block h-4 w-[3px] animate-pulse bg-text-primary/60 align-middle"></span>{/if}
    </div>
    {#if message.toolCalls && message.toolCalls.length > 0}
      <div class="flex w-full max-w-[82%] flex-col gap-3">
        {#each message.toolCalls as tc (tc.id)}
          <ToolCallCard tool={tc} />
        {/each}
      </div>
    {/if}
  </div>
{/if}

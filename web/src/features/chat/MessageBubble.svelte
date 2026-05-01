<script lang="ts">
  import { Image, Paperclip } from 'lucide-svelte';
  import type { ChatMessage } from '@web/lib/stores/chat.svelte';
  import ToolCallCard from './ToolCallCard.svelte';

  interface Props {
    message: ChatMessage;
    streaming?: boolean;
  }
  let { message, streaming = false }: Props = $props();

  const isUser = $derived(message.role === 'user');
  const isSystem = $derived(message.role === 'system');

  function formatFileSize(size?: number) {
    if (!Number.isFinite(size || NaN)) return '';
    const value = Number(size);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }
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
      {#if message.attachments && message.attachments.length > 0}
        <div class="mt-3 flex flex-wrap gap-2">
          {#each message.attachments as attachment, index (attachment.id || attachment.filename || index)}
            <span
              class="inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1 text-[12px] leading-5 {isUser
                ? 'border-white/25 bg-white/10 text-white/90'
                : 'border-border/70 bg-surface-muted/75 text-text-secondary'}"
              title={attachment.storageState === 'expired' ? '附件已过期' : attachment.filename || '附件'}
            >
              {#if attachment.kind === 'image' || attachment.mime?.startsWith('image/')}
                <Image size={13} />
              {:else}
                <Paperclip size={13} />
              {/if}
              <span class="truncate">{attachment.filename || '附件'}</span>
              {#if formatFileSize(attachment.size)}
                <span class={isUser ? 'text-white/65' : 'text-text-muted'}>{formatFileSize(attachment.size)}</span>
              {/if}
              {#if attachment.storageState === 'expired'}
                <span class={isUser ? 'text-white/65' : 'text-text-muted'}>已过期</span>
              {/if}
            </span>
          {/each}
        </div>
      {/if}
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

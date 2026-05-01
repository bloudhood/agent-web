<script lang="ts">
  import { chatStore } from '@web/lib/stores/chat.svelte';
  import MessageBubble from './MessageBubble.svelte';
  import ToolCallCard from './ToolCallCard.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import PermissionPrompt from './PermissionPrompt.svelte';
  import { getWsClient } from '@web/lib/ws-context.svelte';
  import { sendPermissionResponse } from '@web/lib/ws-bridge';

  let scrollEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    void chatStore.messages.length;
    void chatStore.streamingText;
    void chatStore.streamingThinking;
    if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  const activeTools = $derived(Array.from(chatStore.activeTools.values()));

  function decide(promptId: string, sessionId: string, decision: 'allow_once' | 'allow_always' | 'reject') {
    sendPermissionResponse(getWsClient(), sessionId, promptId, decision);
    chatStore.resolvePrompt(promptId);
  }

  const isEmpty = $derived(chatStore.messages.length === 0 && !chatStore.streamingText && !chatStore.streamingThinking);
</script>

<div bind:this={scrollEl} class="flex-1 overflow-y-auto overscroll-contain">
  <div class="mx-auto flex max-w-4xl flex-col gap-5 px-5 pb-8 pt-8 md:px-8 md:pt-10">
    {#if isEmpty}
      <div class="min-h-[38vh]" aria-hidden="true"></div>
    {/if}

    {#each chatStore.messages as msg, idx (idx)}
      {#if msg.thinking}
        <ThinkingBlock text={msg.thinking} defaultOpen={false} />
      {/if}
      <MessageBubble message={msg} />
    {/each}

    {#if chatStore.isGenerating}
      <div class="space-y-3">
        {#if !chatStore.streamingThinking && !chatStore.streamingText && activeTools.length === 0}
          <div class="assistant-pending flex items-start">
            <div class="inline-flex max-w-[82%] items-center gap-2 rounded-lg border border-border/70 bg-surface-panel px-4 py-3 text-[13px] text-text-secondary shadow-1" aria-label="等待 AI 回复">
              <span class="inline-flex h-6 items-center gap-1" aria-hidden="true">
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted"></span>
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:160ms]"></span>
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:320ms]"></span>
              </span>
            </div>
          </div>
        {/if}
        {#if chatStore.streamingThinking}
          <ThinkingBlock text={chatStore.streamingThinking} defaultOpen />
        {/if}
        {#if chatStore.streamingText}
          <MessageBubble message={{ role: 'assistant', text: chatStore.streamingText, ts: Date.now() }} streaming />
        {/if}
        {#each activeTools as tc (tc.id)}
          <ToolCallCard tool={tc} />
        {/each}
      </div>
    {/if}

    {#each chatStore.pendingPrompts as prompt (prompt.promptId)}
      <PermissionPrompt
        request={prompt}
        onDecide={(d) => decide(prompt.promptId, prompt.sessionId, d)}
      />
    {/each}
  </div>
</div>

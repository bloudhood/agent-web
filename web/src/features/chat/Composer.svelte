<script lang="ts">
  import { Loader2, Paperclip, Send, Square, X } from 'lucide-svelte';
  import { authStore } from '@web/lib/stores/auth.svelte';
  import { chatStore } from '@web/lib/stores/chat.svelte';
  import { sessionsStore } from '@web/lib/stores/sessions.svelte';
  import { toastStore } from '@web/lib/stores/toast.svelte';
  import { getWsClient } from '@web/lib/ws-context.svelte';
  import { sendMessage, sendAbort, sendNewSession } from '@web/lib/ws-bridge';
  import { onMount } from 'svelte';
  import CommandPalette from './CommandPalette.svelte';

  let text = $state('');
  let textarea: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let paletteDismissedFor = $state('');
  let pendingAttachments = $state<Array<{ id: string; filename: string; mime: string; size: number }>>([]);
  let uploadingAttachments = $state(0);

  const showPalette = $derived(text.startsWith('/') && !text.includes('\n') && paletteDismissedFor !== text);
  const activeAgent = $derived(sessionsStore.currentMeta?.agent ?? sessionsStore.currentAgent);
  const supportsImageUpload = $derived(activeAgent === 'claude' || activeAgent === 'codex' || activeAgent === 'hermes');

  function autoResize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }

  $effect(() => {
    void text;
    if (!text.startsWith('/')) paletteDismissedFor = '';
    autoResize();
  });

  /**
   * Allow the welcome screen and other patterns to pre-fill the composer.
   */
  onMount(() => {
    function onFill(e: Event) {
      const ev = e as CustomEvent<string>;
      if (typeof ev.detail === 'string') {
        text = ev.detail;
        requestAnimationFrame(() => textarea?.focus());
      }
    }
    document.addEventListener('cc-web-fill-composer', onFill);
    return () => document.removeEventListener('cc-web-fill-composer', onFill);
  });

  async function ensureSession(): Promise<string | null> {
    if (sessionsStore.currentId) return sessionsStore.currentId;
    // No session → create one with the current agent, then wait briefly for
    // session_info to land before sending the message.
    if (!sendNewSession(getWsClient(), { agent: sessionsStore.currentAgent, mode: 'yolo' })) {
      toastStore.warning('未连接', 'WebSocket 未就绪，请稍后重试');
      return null;
    }
    return new Promise((resolve) => {
      let attempts = 0;
      const tick = () => {
        attempts += 1;
        if (sessionsStore.currentId) { resolve(sessionsStore.currentId); return; }
        if (attempts > 50) { resolve(null); return; }
        setTimeout(tick, 60);
      };
      tick();
    });
  }

  async function submit() {
    const value = text.trim();
    if (!value && pendingAttachments.length === 0) return;
    if (pendingAttachments.length > 0 && !supportsImageUpload) {
      toastStore.warning('暂不支持附件', '当前 Agent 不支持图片附件');
      return;
    }
    if (pendingAttachments.length > 0 && value.startsWith('/')) {
      toastStore.warning('无法发送', '命令消息暂不支持同时附带图片');
      return;
    }
    let id = sessionsStore.currentId;
    if (!id) {
      id = await ensureSession();
      if (!id) return;
    }
    const attachments = pendingAttachments.map((attachment) => ({ id: attachment.id }));
    if (!sendMessage(getWsClient(), id, value, attachments.length ? attachments : undefined)) {
      toastStore.warning('发送失败', 'WebSocket 未就绪，请稍后重试');
      return;
    }
    chatStore.appendMessage({
      role: 'user',
      text: value || `图片: ${pendingAttachments.map((attachment) => attachment.filename).join(', ')}`,
      attachments: pendingAttachments.map((attachment) => ({ ...attachment, kind: 'image', storageState: 'available' })),
      ts: Date.now(),
    });
    chatStore.startTurn();
    text = '';
    pendingAttachments = [];
  }

  function handleKey(e: KeyboardEvent) {
    if (showPalette && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey))) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function abort() {
    const id = sessionsStore.currentId;
    if (id) sendAbort(getWsClient(), id);
  }

  function pickCompletion(completion: string) {
    text = completion;
    paletteDismissedFor = completion;
    requestAnimationFrame(() => textarea?.focus());
  }

  function openFilePicker() {
    if (!supportsImageUpload) {
      toastStore.warning('暂不支持附件', '当前 Agent 不支持图片附件');
      return;
    }
    fileInput?.click();
  }

  function formatFileSize(size: number) {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${Math.round(size / 1024)} KB`;
    return `${size} B`;
  }

  async function uploadImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toastStore.warning('不支持的文件', '当前只支持上传图片');
      return;
    }
    if (pendingAttachments.length + uploadingAttachments >= 4) {
      toastStore.warning('附件过多', '一条消息最多添加 4 张图片');
      return;
    }

    uploadingAttachments += 1;
    try {
      const response = await fetch('/api/attachments', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name || 'image'),
          ...(authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {}),
        },
        body: file,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok || !payload?.attachment?.id) {
        toastStore.warning('上传失败', payload?.message || `HTTP ${response.status}`);
        return;
      }
      pendingAttachments = [...pendingAttachments, payload.attachment];
    } catch (err) {
      toastStore.warning('上传失败', err instanceof Error ? err.message : '图片上传中断');
    } finally {
      uploadingAttachments = Math.max(0, uploadingAttachments - 1);
    }
  }

  async function handleSelectedFiles(fileList: FileList | null) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      await uploadImageFile(file);
    }
  }

  async function removeAttachment(id: string) {
    pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== id);
    try {
      await fetch(`/api/attachments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authStore.token ? { Authorization: `Bearer ${authStore.token}` } : undefined,
      });
    } catch {}
  }
</script>

<div
  class="relative z-10 flex-none border-t border-border/50 bg-surface-page/95 px-5 pt-4 backdrop-blur"
  style="padding-bottom: calc(16px + env(safe-area-inset-bottom));"
>
  <CommandPalette
    open={showPalette}
    input={text}
    agent={activeAgent}
    onClose={() => (paletteDismissedFor = text)}
    onPick={pickCompletion}
  />

  <div class="mx-auto flex w-full max-w-4xl items-end gap-3">
    <input
      bind:this={fileInput}
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      tabindex="-1"
      onchange={(e) => {
        const input = e.currentTarget as HTMLInputElement;
        void handleSelectedFiles(input.files);
        input.value = '';
      }}
    />
    <button
      type="button"
      onclick={openFilePicker}
      title="上传图片"
      aria-label="上传图片"
      class="grid h-11 w-11 flex-none place-items-center rounded-lg border border-border/75 bg-surface-panel text-text-secondary shadow-1 transition-colors hover:bg-surface-muted hover:text-text-primary active:scale-95 disabled:opacity-50"
      disabled={uploadingAttachments > 0}
    >
      {#if uploadingAttachments > 0}
        <Loader2 size={18} class="animate-spin" />
      {:else}
        <Paperclip size={18} />
      {/if}
    </button>

    <div class="flex flex-1 flex-col gap-2 rounded-lg border border-border/75 bg-surface-panel px-4 py-3 shadow-2 transition-shadow focus-within:border-accent/60 focus-within:shadow-3">
      {#if pendingAttachments.length > 0 || uploadingAttachments > 0}
        <div class="flex flex-wrap gap-2">
          {#each pendingAttachments as attachment (attachment.id)}
            <span class="inline-flex max-w-[16rem] items-center gap-2 rounded-lg border border-border/70 bg-surface-muted/75 px-2.5 py-1 text-[12px] text-text-secondary">
              <span class="truncate">{attachment.filename}</span>
              <span class="text-text-muted">{formatFileSize(attachment.size)}</span>
              <button
                type="button"
                class="grid h-5 w-5 place-items-center rounded-full text-text-muted hover:bg-surface-panel hover:text-text-primary"
                title="移除附件"
                aria-label="移除附件"
                onclick={() => void removeAttachment(attachment.id)}
              >
                <X size={12} />
              </button>
            </span>
          {/each}
          {#if uploadingAttachments > 0}
            <span class="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-surface-muted/75 px-2.5 py-1 text-[12px] text-text-muted">
              <Loader2 size={12} class="animate-spin" />
              上传中
            </span>
          {/if}
        </div>
      {/if}

      <div class="flex items-end gap-2">
        <textarea
          bind:this={textarea}
          bind:value={text}
          onkeydown={handleKey}
          rows="1"
          placeholder="给 Agent 发消息…  /  查看命令"
          class="min-h-[26px] w-full resize-none border-0 bg-transparent text-[15px] leading-7 text-text-primary placeholder:text-text-muted focus:outline-none"
        ></textarea>

        {#if chatStore.isGenerating}
          <button
            type="button"
            onclick={abort}
            title="停止生成"
            aria-label="停止生成"
            class="grid h-9 w-9 flex-none place-items-center rounded-lg bg-state-danger/12 text-state-danger transition-transform active:scale-95"
          >
            <Square size={14} />
          </button>
        {:else}
          <button
            type="button"
            onclick={submit}
            disabled={!text.trim() && pendingAttachments.length === 0}
            title="发送"
            aria-label="发送"
            class="grid h-9 w-9 flex-none place-items-center rounded-lg bg-accent text-white shadow-1 transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:bg-surface-muted disabled:text-text-muted disabled:shadow-none"
          >
            <Send size={14} />
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

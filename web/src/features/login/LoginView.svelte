<script lang="ts">
  import { Eye, EyeOff, Sparkles } from 'lucide-svelte';
  import { Button, Card, Input, IconButton } from '@web/ui';
  import { authStore } from '@web/lib/stores/auth.svelte';
  import { getWsClient } from '@web/lib/ws-context.svelte';
  import { sendAuth } from '@web/lib/ws-bridge';

  let password = $state('');
  let showPassword = $state(false);
  let remember = $state(localStorage.getItem('cc-web-pw') !== null);
  let submitting = $state(false);

  $effect(() => {
    const saved = localStorage.getItem('cc-web-pw');
    if (saved) password = saved;
  });

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!password) return;
    submitting = true;
    if (remember) localStorage.setItem('cc-web-pw', password);
    else localStorage.removeItem('cc-web-pw');
    sendAuth(getWsClient(), password);
  }

  $effect(() => {
    if (authStore.lastError || authStore.token) submitting = false;
  });
</script>

<div class="grid h-[100dvh] w-full place-items-center bg-surface-page p-6">
  <div class="w-full max-w-md">
    <Card padding="lg" elevation={2}>
      <div class="flex flex-col gap-6">
        <div class="flex flex-col items-center gap-4 text-center">
          <div>
            <div class="grid h-14 w-14 place-items-center rounded-md bg-accent text-white shadow-1">
              <Sparkles size={24} strokeWidth={1.6} />
            </div>
          </div>
          <h1 class="font-ui text-[24px] font-semibold tracking-tight text-text-primary">Agent-Web</h1>
          <p class="text-[13px] text-text-muted">本地 Claude / Codex / Gemini / Hermes 控制台</p>
        </div>

        <form onsubmit={handleSubmit} class="flex flex-col gap-4">
          <div class="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              bind:value={password}
              placeholder="输入密码"
              autocomplete="current-password"
              class="h-11 pr-10 text-[15px]"
            />
            <div class="absolute right-1 top-0.5">
              <IconButton onclick={() => (showPassword = !showPassword)} aria-label="显示/隐藏密码">
                {#if showPassword}<EyeOff size={18} />{:else}<Eye size={18} />{/if}
              </IconButton>
            </div>
          </div>

          <label class="flex items-center gap-2 text-[12px] text-text-secondary">
            <input type="checkbox" bind:checked={remember} class="h-4 w-4 rounded border-border accent-accent" />
            记住密码
          </label>

          {#if authStore.lastError}
            <div class="rounded-lg bg-state-danger/10 px-3 py-2 text-[12px] text-state-danger">
              {authStore.lastError}
            </div>
          {/if}

          <Button type="submit" size="lg" disabled={!password || submitting} loading={submitting}>
            {submitting ? '登录中…' : '登录'}
          </Button>
        </form>
      </div>
    </Card>
  </div>
</div>

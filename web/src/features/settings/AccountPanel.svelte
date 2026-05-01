<script lang="ts">
  import { Button, Input, Card } from '@web/ui';
  import { authStore } from '@web/lib/stores/auth.svelte';
  import { toastStore } from '@web/lib/stores/toast.svelte';
  import { getWsClient } from '@web/lib/ws-context.svelte';
  import { validatePasswordStrength } from '@shared/password-policy';

  let oldPassword = $state('');
  let newPassword = $state('');
  let confirm = $state('');
  let submitting = $state(false);

  function submit() {
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      toastStore.warning('密码不符合要求', strength.message);
      return;
    }
    if (newPassword !== confirm) {
      toastStore.warning('两次输入不一致', '请确认新密码');
      return;
    }
    submitting = true;
    getWsClient().send({
      type: 'change_password',
      currentPassword: oldPassword,
      newPassword,
    });
    setTimeout(() => { submitting = false; }, 1500);
  }

  function logout() {
    authStore.clear();
    location.reload();
  }
</script>

<Card padding="md">
  <div class="flex flex-col gap-5">
    <header>
      <h3 class="text-sm font-semibold">修改密码</h3>
      <p class="mt-1 text-xs text-text-muted">用于本地 Web 控制台登录。</p>
    </header>

    <div class="grid gap-3">
      <Input bind:value={oldPassword} type="password" placeholder="当前密码" />
      <Input bind:value={newPassword} type="password" placeholder="新密码（至少 8 位，包含 2 类字符）" />
      <Input bind:value={confirm} type="password" placeholder="确认新密码" />
    </div>

    <div class="flex justify-end gap-2.5">
      <Button variant="ghost" onclick={logout}>登出</Button>
      <Button onclick={submit} loading={submitting} disabled={!newPassword}>保存</Button>
    </div>

    {#if authStore.mustChangePassword}
      <p class="rounded-md bg-state-warning/10 px-3 py-2 text-xs text-state-warning">
        管理员要求首次登录后修改密码。
      </p>
    {/if}
  </div>
</Card>

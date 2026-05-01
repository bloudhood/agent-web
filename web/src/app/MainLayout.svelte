<script lang="ts">
  import Sidebar from '@web/features/sidebar/Sidebar.svelte';
  import ImportSessionsDialog, {
    type ClaudeNativeGroup,
    type ClaudeNativeSession,
    type CodexNativeSession,
  } from '@web/features/sidebar/ImportSessionsDialog.svelte';
  import ChatView from '@web/features/chat/ChatView.svelte';
  import SettingsView from '@web/features/settings/SettingsView.svelte';
  import { sessionsStore } from '@web/lib/stores/sessions.svelte';
  import { chatStore } from '@web/lib/stores/chat.svelte';
  import { uiStore } from '@web/lib/stores/ui.svelte';
  import { toastStore } from '@web/lib/stores/toast.svelte';
  import { getWsClient } from '@web/lib/ws-context.svelte';
  import {
    sendListSessions,
    sendLoadSession,
    sendNewSession,
    sendDeleteSession,
  } from '@web/lib/ws-bridge';
  import { onMount } from 'svelte';

  let settingsOpen = $state(false);
  let importOpen = $state(false);
  let importLoading = $state(false);
  let importPending = $state(0);
  let importingSession = $state(false);
  let nativeGroups = $state<ClaudeNativeGroup[]>([]);
  let codexSessions = $state<CodexNativeSession[]>([]);

  onMount(() => {
    const ws = getWsClient();
    sendListSessions(ws);
    return ws.on((msg) => {
      if (msg.type === 'native_sessions') {
        const m = msg as unknown as { groups?: ClaudeNativeGroup[] };
        nativeGroups = Array.isArray(m.groups) ? m.groups : [];
        markImportResponse();
      } else if (msg.type === 'codex_sessions') {
        const m = msg as unknown as { sessions?: CodexNativeSession[] };
        codexSessions = Array.isArray(m.sessions) ? m.sessions : [];
        markImportResponse();
      } else if (msg.type === 'session_info' && importingSession) {
        importingSession = false;
        importLoading = false;
        importOpen = false;
      } else if (msg.type === 'error' && importingSession) {
        importingSession = false;
        importLoading = false;
      }
    });
  });

  function selectSession(id: string) {
    sessionsStore.setCurrent(id);
    chatStore.setForeground(id);
    chatStore.reset();
    sendLoadSession(getWsClient(), id);
    uiStore.closeSidebar();
  }

  function newSession() {
    const sent = sendNewSession(getWsClient(), {
      agent: sessionsStore.currentAgent,
      mode: 'yolo',
    });
    if (!sent) toastStore.warning('未连接', 'WebSocket 未就绪，请稍后重试');
    uiStore.closeSidebar();
  }

  function deleteSession(id: string) {
    if (!confirm('确认删除这个会话？')) return;
    sendDeleteSession(getWsClient(), id);
  }

  function importSessions() {
    importOpen = true;
    refreshImportSessions();
  }

  function markImportResponse() {
    importPending = Math.max(0, importPending - 1);
    if (importPending === 0 && !importingSession) importLoading = false;
  }

  function refreshImportSessions() {
    importLoading = true;
    importPending = 0;
    const ws = getWsClient();
    const sentClaude = ws.send({ type: 'list_native_sessions' });
    const sentCodex = ws.send({ type: 'list_codex_sessions' });
    if (sentClaude) importPending += 1;
    if (sentCodex) importPending += 1;
    if (!sentClaude || !sentCodex) {
      toastStore.warning('未连接', 'WebSocket 未就绪，请稍后重试');
    }
    if (importPending === 0) importLoading = false;
  }

  function importClaudeSession(session: ClaudeNativeSession, group: ClaudeNativeGroup) {
    importingSession = true;
    importLoading = true;
    if (!getWsClient().send({ type: 'import_native_session', sessionId: session.sessionId, projectDir: group.dir })) {
      importingSession = false;
      importLoading = false;
      toastStore.warning('未连接', 'WebSocket 未就绪，请稍后重试');
    }
  }

  function importCodexSession(session: CodexNativeSession) {
    importingSession = true;
    importLoading = true;
    if (!getWsClient().send({ type: 'import_codex_session', threadId: session.threadId, rolloutPath: session.rolloutPath })) {
      importingSession = false;
      importLoading = false;
      toastStore.warning('未连接', 'WebSocket 未就绪，请稍后重试');
    }
  }

  // Edge-swipe and full-pan gestures (iOS-style). Active only on touch
  // devices; pointer-events do not trigger this.
  let touchStartX = $state<number | null>(null);
  let touchStartY = $state<number | null>(null);
  let touchDelta = $state(0);
  let dragging = $state(false);

  function onTouchStart(e: TouchEvent) {
    if (settingsOpen) return;
    const t = e.touches[0];
    if (!t) return;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    const isEdge = t.clientX < 28;
    dragging = uiStore.sidebarOpen ? true : isEdge;
  }
  function onTouchMove(e: TouchEvent) {
    if (!dragging || touchStartX == null || touchStartY == null) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - touchStartX;
    const dy = Math.abs(t.clientY - touchStartY);
    if (dy > Math.abs(dx)) { dragging = false; return; }
    touchDelta = dx;
  }
  function onTouchEnd() {
    if (!dragging) return;
    dragging = false;
    const open = uiStore.sidebarOpen;
    if (!open && touchDelta > 60) uiStore.openSidebar();
    else if (open && touchDelta < -60) uiStore.closeSidebar();
    touchStartX = null;
    touchStartY = null;
    touchDelta = 0;
  }
</script>

<div
  role="application"
  class="flex h-[100dvh] w-full overflow-hidden bg-surface-page"
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
>
  <!-- Mobile scrim -->
  {#if uiStore.sidebarOpen}
    <button
      type="button"
      aria-label="关闭侧边栏"
      class="fixed inset-0 z-30 bg-black/25 backdrop-blur-[2px] md:hidden"
      onclick={() => uiStore.closeSidebar()}
    ></button>
  {/if}

  <!-- Sidebar: drawer on mobile, persistent flex column on md+ -->
  <aside
    class="fixed inset-y-0 left-0 z-40 w-[86vw] max-w-[20rem] transform transition-transform duration-300 ease-out md:static md:z-auto md:w-80 md:flex-none md:translate-x-0 {uiStore.sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}"
  >
    <Sidebar
      onNew={newSession}
      onImport={importSessions}
      onOpenSettings={() => (settingsOpen = true)}
      onSelect={selectSession}
      onDelete={deleteSession}
    />
  </aside>

  <!-- Main column -->
  <div class="flex min-w-0 flex-1 flex-col">
    <ChatView onToggleSidebar={() => uiStore.toggleSidebar()} />
  </div>

  <SettingsView open={settingsOpen} onClose={() => (settingsOpen = false)} />
  <ImportSessionsDialog
    open={importOpen}
    loading={importLoading}
    nativeGroups={nativeGroups}
    codexSessions={codexSessions}
    onClose={() => (importOpen = false)}
    onRefresh={refreshImportSessions}
    onImportClaude={importClaudeSession}
    onImportCodex={importCodexSession}
  />
</div>

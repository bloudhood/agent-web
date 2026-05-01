<script lang="ts">
  import Sidebar from '@web/features/sidebar/Sidebar.svelte';
  import ImportSessionsDialog, {
    type ClaudeNativeGroup,
    type ClaudeNativeSession,
    type CodexNativeSession,
    type GeminiNativeSession,
  } from '@web/features/sidebar/ImportSessionsDialog.svelte';
  import ChatView from '@web/features/chat/ChatView.svelte';
  import SettingsView from '@web/features/settings/SettingsView.svelte';
  import { sessionsStore } from '@web/lib/stores/sessions.svelte';
  import { chatStore } from '@web/lib/stores/chat.svelte';
  import { authStore } from '@web/lib/stores/auth.svelte';
  import { uiStore } from '@web/lib/stores/ui.svelte';
  import { toastStore } from '@web/lib/stores/toast.svelte';
  import { getWsClient } from '@web/lib/ws-context.svelte';
  import {
    sendListSessions,
    sendLoadSession,
    sendNewSession,
    sendDeleteSession,
    sendRenameSession,
  } from '@web/lib/ws-bridge';
  import { createSidebarGesture } from './sidebar-gesture.svelte';
  import { onMount } from 'svelte';

  let settingsOpen = $state(false);
  let importOpen = $state(false);
  let importLoading = $state(false);
  let importPending = $state(0);
  let importingSession = $state(false);
  let nativeGroups = $state<ClaudeNativeGroup[]>([]);
  let codexSessions = $state<CodexNativeSession[]>([]);
  let geminiSessions = $state<GeminiNativeSession[]>([]);

  $effect(() => {
    if (authStore.mustChangePassword) settingsOpen = true;
  });

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
      } else if (msg.type === 'gemini_sessions') {
        const m = msg as unknown as { sessions?: GeminiNativeSession[] };
        geminiSessions = Array.isArray(m.sessions) ? m.sessions : [];
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

  function renameSession(id: string, title: string) {
    if (!sendRenameSession(getWsClient(), id, title)) {
      toastStore.warning('未连接', 'WebSocket 未就绪，请稍后重试');
    }
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
    const sentGemini = ws.send({ type: 'list_gemini_sessions' });
    if (sentClaude) importPending += 1;
    if (sentCodex) importPending += 1;
    if (sentGemini) importPending += 1;
    if (!sentClaude || !sentCodex || !sentGemini) {
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

  function importGeminiSession(session: GeminiNativeSession) {
    importingSession = true;
    importLoading = true;
    if (!getWsClient().send({ type: 'import_gemini_session', sessionId: session.sessionId, chatPath: session.chatPath })) {
      importingSession = false;
      importLoading = false;
      toastStore.warning('未连接', 'WebSocket 未就绪，请稍后重试');
    }
  }

  const sidebarGesture = createSidebarGesture({
    isOpen: () => uiStore.sidebarOpen,
    open: () => uiStore.openSidebar(),
    close: () => uiStore.closeSidebar(),
    isBlocked: () => settingsOpen,
  });
</script>

<div
  role="application"
  class="flex h-[100dvh] w-full overflow-hidden overscroll-x-contain bg-surface-page"
  onpointerdown={sidebarGesture.rootPointerDown}
  onpointermove={sidebarGesture.pointerMove}
  onpointerup={sidebarGesture.pointerUp}
  onpointercancel={sidebarGesture.pointerCancel}
>
  <!-- Mobile scrim -->
  {#if sidebarGesture.showScrim}
    <button
      type="button"
      aria-label="关闭侧边栏"
      class="fixed inset-0 z-30 bg-black/25 backdrop-blur-[2px] transition-opacity duration-300 ease-out-soft motion-reduce:transition-none md:hidden"
      style={sidebarGesture.scrimStyle}
      style:touch-action={'pan-y'}
      onclick={sidebarGesture.scrimClick}
      onpointerdown={sidebarGesture.drawerPointerDown}
    ></button>
  {/if}

  <!-- Sidebar: drawer on mobile, persistent flex column on md+ -->
  <aside
    class="fixed inset-y-0 left-0 z-40 w-[86vw] max-w-[20rem] transform-gpu will-change-transform md:static md:z-auto md:w-80 md:flex-none md:!transform-none {sidebarGesture.active ? '' : 'transition-transform duration-300 ease-out-soft motion-reduce:transition-none'}"
    style={sidebarGesture.drawerStyle}
    style:touch-action={'pan-y'}
    onpointerdown={sidebarGesture.drawerPointerDown}
  >
    <Sidebar
      onNew={newSession}
      onImport={importSessions}
      onOpenSettings={() => (settingsOpen = true)}
      onSelect={selectSession}
      onDelete={deleteSession}
      onRename={renameSession}
    />
  </aside>

  <!-- Main column -->
  <div class="flex min-w-0 flex-1 flex-col">
    <ChatView onToggleSidebar={() => uiStore.toggleSidebar()} />
  </div>

  <SettingsView open={settingsOpen} onClose={() => { if (!authStore.mustChangePassword) settingsOpen = false; }} />
  <ImportSessionsDialog
    open={importOpen}
    loading={importLoading}
    nativeGroups={nativeGroups}
    codexSessions={codexSessions}
    geminiSessions={geminiSessions}
    onClose={() => (importOpen = false)}
    onRefresh={refreshImportSessions}
    onImportClaude={importClaudeSession}
    onImportCodex={importCodexSession}
    onImportGemini={importGeminiSession}
  />
</div>

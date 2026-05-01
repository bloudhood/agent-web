/**
 * Chat store — streaming message buffer for the foreground session.
 *
 * Tool calls are merged by id; thinking blocks live alongside text. The store
 * intentionally keeps the runtime cheap (mutations only on the foreground
 * session); background sessions are tracked in sessionsStore via isRunning.
 */

export interface ToolCall {
  id: string;
  name: string;
  input?: unknown;
  result?: string;
  kind?: string | null;
  meta?: Record<string, unknown> | null;
  done?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  ts: number;
}

export interface PermissionPrompt {
  promptId: string;
  sessionId: string;
  toolName: string;
  toolInput?: unknown;
  options: Array<'allow_once' | 'allow_always' | 'reject'>;
}

function createChatStore() {
  let messages = $state<ChatMessage[]>([]);
  let streamingText = $state('');
  let streamingThinking = $state('');
  let activeTools = $state<Map<string, ToolCall>>(new Map());
  let isGenerating = $state(false);
  let foregroundSessionId = $state<string | null>(null);
  let pendingPrompts = $state<PermissionPrompt[]>([]);

  return {
    get messages() { return messages; },
    get streamingText() { return streamingText; },
    get streamingThinking() { return streamingThinking; },
    get activeTools() { return activeTools; },
    get isGenerating() { return isGenerating; },
    get foregroundSessionId() { return foregroundSessionId; },
    get pendingPrompts() { return pendingPrompts; },

    setForeground(id: string | null) {
      foregroundSessionId = id;
    },

    reset(messagesNext: ChatMessage[] = []) {
      messages = messagesNext.slice();
      streamingText = '';
      streamingThinking = '';
      activeTools = new Map();
      isGenerating = false;
      pendingPrompts = [];
    },

    appendMessage(msg: ChatMessage) {
      messages = [...messages, msg];
    },

    startTurn() {
      streamingText = '';
      streamingThinking = '';
      activeTools = new Map();
      isGenerating = true;
    },

    appendDelta(text: string) {
      streamingText += text;
      isGenerating = true;
    },

    appendThinking(text: string) {
      streamingThinking += text;
      isGenerating = true;
    },

    pushPrompt(prompt: PermissionPrompt) {
      pendingPrompts = [...pendingPrompts, prompt];
    },

    resolvePrompt(promptId: string) {
      pendingPrompts = pendingPrompts.filter((p) => p.promptId !== promptId);
    },

    upsertTool(tc: ToolCall) {
      const next = new Map(activeTools);
      const prev = next.get(tc.id);
      next.set(tc.id, { ...prev, ...tc });
      activeTools = next;
      isGenerating = true;
    },

    completeTool(id: string, result?: string, meta?: Record<string, unknown> | null) {
      const next = new Map(activeTools);
      const prev = next.get(id);
      if (prev) next.set(id, { ...prev, done: true, result, meta: meta ?? prev.meta });
      activeTools = next;
    },

    finishTurn() {
      const tools = Array.from(activeTools.values());
      if (streamingText || tools.length > 0 || streamingThinking) {
        messages = [
          ...messages,
          {
            role: 'assistant',
            text: streamingText,
            thinking: streamingThinking || undefined,
            toolCalls: tools.length > 0 ? tools : undefined,
            ts: Date.now(),
          } as ChatMessage,
        ];
      }
      streamingText = '';
      streamingThinking = '';
      activeTools = new Map();
      isGenerating = false;
    },

    failTurn(message: string) {
      messages = [...messages, { role: 'system', text: message, ts: Date.now() }];
      streamingText = '';
      streamingThinking = '';
      activeTools = new Map();
      isGenerating = false;
    },
  };
}

export const chatStore = createChatStore();

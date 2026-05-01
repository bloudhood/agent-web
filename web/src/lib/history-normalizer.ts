import type { ChatMessage, ToolCall } from './stores/chat.svelte';

export type ServerHistoryMessage = {
  role?: string;
  content?: unknown;
  text?: string;
  timestamp?: string | number | null;
  ts?: number;
  toolCalls?: unknown[];
  thinking?: string;
};

export function normalizeHistoryMessages(messages: ServerHistoryMessage[] = []): ChatMessage[] {
  return messages.map((raw) => {
    const role = raw.role === 'assistant' || raw.role === 'system' ? raw.role : 'user';
    const text = typeof raw.text === 'string'
      ? raw.text
      : typeof raw.content === 'string'
        ? raw.content
        : Array.isArray(raw.content)
          ? (raw.content as Array<{ text?: string }>).map((c) => c?.text || '').filter(Boolean).join('')
          : '';
    const ts = typeof raw.ts === 'number'
      ? raw.ts
      : typeof raw.timestamp === 'number'
        ? raw.timestamp
        : typeof raw.timestamp === 'string'
          ? Date.parse(raw.timestamp) || Date.now()
          : Date.now();
    return {
      role,
      text,
      ts,
      thinking: raw.thinking,
      toolCalls: Array.isArray(raw.toolCalls) ? (raw.toolCalls as ToolCall[]) : undefined,
    };
  });
}

import type { ChatMessage, MessageAttachment, ToolCall } from './stores/chat.svelte';

export type ServerHistoryMessage = {
  role?: string;
  content?: unknown;
  text?: string;
  timestamp?: string | number | null;
  ts?: number;
  toolCalls?: unknown[];
  thinking?: string;
  attachments?: unknown[];
};

function normalizeAttachments(raw: unknown[] | undefined): MessageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: String(item.id || ''),
      kind: typeof item.kind === 'string' ? item.kind : undefined,
      filename: typeof item.filename === 'string'
        ? item.filename
        : typeof item.name === 'string'
          ? item.name
          : undefined,
      mime: typeof item.mime === 'string' ? item.mime : undefined,
      size: typeof item.size === 'number' ? item.size : undefined,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
      expiresAt: typeof item.expiresAt === 'string' ? item.expiresAt : undefined,
      storageState: typeof item.storageState === 'string' ? item.storageState : undefined,
    }))
    .filter((item) => item.id || item.filename || item.mime);
}

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
      attachments: normalizeAttachments(raw.attachments),
    };
  });
}

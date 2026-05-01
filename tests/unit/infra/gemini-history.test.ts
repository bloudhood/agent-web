import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { createGeminiHistoryStore } = require('../../../lib/gemini-history.js');

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-web-gemini-history-'));
}

function writeGeminiSession(home: string) {
  const geminiHome = path.join(home, '.gemini');
  const chatDir = path.join(geminiHome, 'tmp', 'portable-project', 'chats');
  fs.mkdirSync(chatDir, { recursive: true });
  fs.mkdirSync(path.join(geminiHome, 'history', 'portable-project'), { recursive: true });
  fs.writeFileSync(path.join(geminiHome, 'history', 'portable-project', '.project_root'), path.join(home, 'work'));

  const chatPath = path.join(chatDir, 'session-2026-05-01T00-00-gemini123.jsonl');
  const lines = [
    {
      sessionId: 'gemini-native-id',
      projectHash: 'portable-hash',
      startTime: '2026-05-01T00:00:00.000Z',
      lastUpdated: '2026-05-01T00:00:00.000Z',
      kind: 'main',
    },
    {
      id: 'u1',
      timestamp: '2026-05-01T00:00:01.000Z',
      type: 'user',
      content: [{ text: 'Gemini import prompt' }],
    },
    { $set: { lastUpdated: '2026-05-01T00:00:01.000Z' } },
    {
      id: 'g1',
      timestamp: '2026-05-01T00:00:02.000Z',
      type: 'gemini',
      content: 'Gemini import answer',
      tokens: { input: 10, cached: 2, output: 3 },
      model: 'gemini-2.5-flash-lite',
      toolCalls: [
        {
          id: 'tool-1',
          name: 'run_shell_command',
          args: { command: 'echo hello' },
          resultDisplay: 'hello',
          status: 'success',
        },
      ],
    },
    { $set: { lastUpdated: '2026-05-01T00:00:03.000Z' } },
  ].map((line) => JSON.stringify(line));
  fs.writeFileSync(chatPath, `${lines.join('\n')}\n`);
  return { geminiHome, chatPath };
}

describe('Gemini CLI native history store', () => {
  it('lists sessions from a portable Gemini home directory', () => {
    const home = tempHome();
    const { geminiHome, chatPath } = writeGeminiSession(home);
    const store = createGeminiHistoryStore({ geminiHomeDir: geminiHome, sessionsDir: path.join(home, 'sessions') });

    const sessions = store.listGeminiSessions();

    expect(sessions).toEqual([
      expect.objectContaining({
        sessionId: 'gemini-native-id',
        title: 'Gemini import prompt',
        cwd: path.join(home, 'work'),
        chatPath,
        alreadyImported: false,
      }),
    ]);
  });

  it('parses Gemini chat jsonl into cc-web messages, tools, usage, and model', () => {
    const home = tempHome();
    const { geminiHome, chatPath } = writeGeminiSession(home);
    const store = createGeminiHistoryStore({ geminiHomeDir: geminiHome, sessionsDir: path.join(home, 'sessions') });

    const parsed = store.parseGeminiChatFile(chatPath);

    expect(parsed?.meta.sessionId).toBe('gemini-native-id');
    expect(parsed?.meta.title).toBe('Gemini import prompt');
    expect(parsed?.meta.model).toBe('gemini-2.5-flash-lite');
    expect(parsed?.messages[0]).toMatchObject({ role: 'user', content: 'Gemini import prompt' });
    expect(parsed?.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Gemini import answer',
      toolCalls: [expect.objectContaining({ name: 'run_shell_command', done: true, result: 'hello' })],
    });
    expect(parsed?.totalUsage).toEqual({ inputTokens: 10, cachedInputTokens: 2, outputTokens: 3 });
  });

  it('rejects requested chat files outside the Gemini home directory', () => {
    const home = tempHome();
    const { geminiHome } = writeGeminiSession(home);
    const outside = path.join(home, 'outside.jsonl');
    fs.writeFileSync(outside, '{}\n');
    const store = createGeminiHistoryStore({ geminiHomeDir: geminiHome, sessionsDir: path.join(home, 'sessions') });

    expect(store.resolveGeminiChatPath(outside)).toBeNull();
  });
});

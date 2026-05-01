'use strict';

const fs = require('fs');
const path = require('path');

function isPathInside(parentDir, candidatePath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function readHeadLines(filePath, maxBytes = 256 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(maxBytes, stat.size));
      fs.readSync(fd, buffer, 0, buffer.length, 0);
      return buffer.toString('utf8').split(/\r?\n/);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (!part) return '';
    if (typeof part === 'string') return part;
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    return '';
  }).join('');
}

function normalizeTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return null;
  return {
    inputTokens: tokens.input || tokens.inputTokens || tokens.input_tokens || 0,
    cachedInputTokens: tokens.cached || tokens.cachedInputTokens || tokens.cached_input_tokens || 0,
    outputTokens: tokens.output || tokens.outputTokens || tokens.output_tokens || 0,
  };
}

function extractToolResult(call) {
  if (typeof call?.resultDisplay === 'string') return call.resultDisplay;
  if (typeof call?.result === 'string') return call.result;
  if (call?.result?.response?.output) return String(call.result.response.output);
  if (Array.isArray(call?.result)) {
    const outputs = [];
    for (const item of call.result) {
      const output = item?.functionResponse?.response?.output;
      if (output) outputs.push(String(output));
    }
    if (outputs.length) return outputs.join('\n');
  }
  return '';
}

function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((call) => ({
    id: String(call?.id || call?.tool_id || call?.name || 'gemini-tool'),
    name: String(call?.name || call?.displayName || 'GeminiTool'),
    input: call?.args ?? call?.input ?? null,
    result: extractToolResult(call),
    done: call?.status ? call.status !== 'pending' : true,
  }));
}

function createGeminiHistoryStore(deps = {}) {
  const geminiHomeDir = path.resolve(String(deps.geminiHomeDir || ''));
  const sessionsDir = path.resolve(String(deps.sessionsDir || ''));

  function workspaceFromPath(filePath) {
    const rel = path.relative(path.join(geminiHomeDir, 'tmp'), filePath);
    const [workspace] = rel.split(/[\\/]/);
    return workspace || '';
  }

  function cwdForWorkspace(workspace) {
    if (!workspace) return null;
    const rootFile = path.join(geminiHomeDir, 'history', workspace, '.project_root');
    try {
      const value = fs.readFileSync(rootFile, 'utf8').trim();
      if (value) return value;
    } catch {}
    const projects = readJson(path.join(geminiHomeDir, 'projects.json'))?.projects || {};
    for (const [projectPath, key] of Object.entries(projects)) {
      if (key === workspace) return projectPath;
    }
    return null;
  }

  function getImportedGeminiSessionIds() {
    const imported = new Set();
    try {
      for (const f of fs.readdirSync(sessionsDir).filter((name) => name.endsWith('.json'))) {
        try {
          const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
          if (session.geminiSessionId) imported.add(session.geminiSessionId);
        } catch {}
      }
    } catch {}
    return imported;
  }

  function walkChatFiles(dir, files = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'tool-outputs') continue;
        if (entry.name === 'chats') {
          try {
            for (const child of fs.readdirSync(fullPath)) {
              if (child.endsWith('.jsonl')) files.push(path.join(fullPath, child));
            }
          } catch {}
        } else {
          walkChatFiles(fullPath, files);
        }
      }
    }
    return files;
  }

  function resolveGeminiChatPath(requestedPath) {
    if (!requestedPath) return null;
    const candidate = path.resolve(geminiHomeDir, String(requestedPath));
    if (!isPathInside(geminiHomeDir, candidate)) return null;
    if (!fs.existsSync(candidate) || !candidate.endsWith('.jsonl')) return null;
    return candidate;
  }

  function parseGeminiChatLines(lines, filePath = '') {
    const messages = [];
    const responseIndexes = new Map();
    const responseTokens = new Map();
    const workspace = filePath ? workspaceFromPath(filePath) : '';
    const meta = { sessionId: null, title: '', cwd: cwdForWorkspace(workspace), updatedAt: null, model: null, workspace };

    lines.forEach((line, index) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      let entry;
      try { entry = JSON.parse(trimmed); } catch { return; }
      if (entry.sessionId && !entry.type) {
        meta.sessionId = entry.sessionId;
        meta.updatedAt = entry.lastUpdated || entry.startTime || meta.updatedAt;
        return;
      }
      if (entry.$set?.lastUpdated) {
        meta.updatedAt = entry.$set.lastUpdated;
        return;
      }
      if (entry.timestamp) meta.updatedAt = entry.timestamp;
      if (entry.type === 'user') {
        const content = extractTextContent(entry.content).trim();
        if (!content) return;
        if (!meta.title) meta.title = content.slice(0, 80).replace(/\n/g, ' ');
        messages.push({ role: 'user', content, timestamp: entry.timestamp || null });
        return;
      }
      if (entry.type !== 'gemini') return;
      if (entry.model) meta.model = entry.model;
      const toolCalls = normalizeToolCalls(entry.toolCalls);
      const content = String(entry.content || '');
      if (!content.trim() && toolCalls.length === 0) return;
      const message = { role: 'assistant', content, toolCalls, timestamp: entry.timestamp || null };
      const responseId = entry.id || `line-${index}`;
      if (responseIndexes.has(responseId)) messages[responseIndexes.get(responseId)] = message;
      else {
        responseIndexes.set(responseId, messages.length);
        messages.push(message);
      }
      const tokens = normalizeTokens(entry.tokens);
      if (tokens) responseTokens.set(responseId, tokens);
    });

    const totalUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    for (const tokens of responseTokens.values()) {
      totalUsage.inputTokens += tokens.inputTokens;
      totalUsage.cachedInputTokens += tokens.cachedInputTokens;
      totalUsage.outputTokens += tokens.outputTokens;
    }
    if (!meta.title && meta.sessionId) meta.title = meta.sessionId.slice(0, 20);
    return { meta, messages, totalUsage };
  }

  function parseGeminiChatFile(filePath) {
    const resolved = resolveGeminiChatPath(filePath);
    if (!resolved) return null;
    try {
      const parsed = parseGeminiChatLines(fs.readFileSync(resolved, 'utf8').split(/\r?\n/), resolved);
      parsed.filePath = resolved;
      return parsed;
    } catch {
      return null;
    }
  }

  function listGeminiSessions() {
    const imported = getImportedGeminiSessionIds();
    return walkChatFiles(path.join(geminiHomeDir, 'tmp'), [])
      .map((filePath) => {
        const parsed = parseGeminiChatLines(readHeadLines(filePath), filePath);
        if (!parsed.meta.sessionId) return null;
        let mtime = null;
        try { mtime = fs.statSync(filePath).mtime.toISOString(); } catch {}
        return {
          sessionId: parsed.meta.sessionId,
          title: parsed.meta.title || parsed.meta.sessionId.slice(0, 20),
          cwd: parsed.meta.cwd,
          updatedAt: parsed.meta.updatedAt || mtime,
          model: parsed.meta.model || '',
          workspace: parsed.meta.workspace,
          chatPath: filePath,
          alreadyImported: imported.has(parsed.meta.sessionId),
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }

  return {
    resolveGeminiChatPath,
    parseGeminiChatLines,
    parseGeminiChatFile,
    listGeminiSessions,
  };
}

module.exports = { createGeminiHistoryStore };

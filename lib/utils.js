'use strict';

const fs = require('fs');
const path = require('path');

// ── Path / file helpers ──────────────────────────────────────────────────────

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9\-]/g, '');
}

function isPathInside(parentDir, candidatePath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeFilename(name) {
  return String(name || 'image')
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'image';
}

function extFromMime(mime) {
  switch (mime) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/webp': return '.webp';
    case 'image/gif': return '.gif';
    default: return '';
  }
}

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : '';
}

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  res.end(JSON.stringify(payload));
}

// ── Attachment helpers ────────────────────────────────────────────────────────

function createAttachmentHelpers(attachmentsDir) {
  function attachmentDataPath(id, ext = '') {
    return path.join(attachmentsDir, `${sanitizeId(id)}${ext}`);
  }

  function attachmentMetaPath(id) {
    return path.join(attachmentsDir, `${sanitizeId(id)}.json`);
  }

  function loadAttachmentMeta(id) {
    try {
      return JSON.parse(fs.readFileSync(attachmentMetaPath(id), 'utf8'));
    } catch {
      return null;
    }
  }

  function saveAttachmentMeta(meta) {
    fs.writeFileSync(attachmentMetaPath(meta.id), JSON.stringify(meta, null, 2));
  }

  function removeAttachmentById(id) {
    const meta = loadAttachmentMeta(id);
    const paths = new Set([attachmentMetaPath(id)]);
    if (meta?.path) paths.add(meta.path);
    for (const filePath of paths) {
      try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }
  }

  function currentAttachmentState(meta) {
    if (!meta) return 'missing';
    const expiresAtMs = new Date(meta.expiresAt || 0).getTime();
    if (expiresAtMs && Date.now() > expiresAtMs) return 'expired';
    if (!meta.path || !fs.existsSync(meta.path)) return 'missing';
    return 'available';
  }

  function normalizeMessageAttachments(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];
    const normalized = [];
    for (const attachment of attachments) {
      const id = sanitizeId(attachment?.id || '');
      if (!id) continue;
      const meta = loadAttachmentMeta(id);
      const state = currentAttachmentState(meta);
      if (state === 'expired') removeAttachmentById(id);
      normalized.push({
        id,
        kind: 'image',
        filename: meta?.filename || attachment?.filename || 'image',
        mime: meta?.mime || attachment?.mime || 'image/png',
        size: meta?.size || attachment?.size || 0,
        createdAt: meta?.createdAt || attachment?.createdAt || null,
        expiresAt: meta?.expiresAt || attachment?.expiresAt || null,
        storageState: state === 'available' ? 'available' : 'expired',
      });
    }
    return normalized;
  }

  function resolveMessageAttachments(attachments) {
    const resolved = [];
    for (const attachment of normalizeMessageAttachments(attachments)) {
      if (attachment.storageState !== 'available') continue;
      const meta = loadAttachmentMeta(attachment.id);
      if (!meta?.path || !fs.existsSync(meta.path)) continue;
      resolved.push({
        ...attachment,
        path: meta.path,
      });
    }
    return resolved;
  }

  function cleanupExpiredAttachments() {
    try {
      const files = fs.readdirSync(attachmentsDir).filter((name) => name.endsWith('.json'));
      for (const file of files) {
        const id = file.replace(/\.json$/, '');
        const meta = loadAttachmentMeta(id);
        if (!meta || currentAttachmentState(meta) === 'expired') {
          removeAttachmentById(id);
        }
      }
    } catch {}
  }

  function collectSessionAttachmentIds(session) {
    const ids = new Set();
    for (const message of Array.isArray(session?.messages) ? session.messages : []) {
      for (const attachment of Array.isArray(message?.attachments) ? message.attachments : []) {
        const id = sanitizeId(attachment?.id || '');
        if (id) ids.add(id);
      }
    }
    return Array.from(ids);
  }

  return {
    attachmentDataPath,
    attachmentMetaPath,
    loadAttachmentMeta,
    saveAttachmentMeta,
    removeAttachmentById,
    currentAttachmentState,
    normalizeMessageAttachments,
    resolveMessageAttachments,
    cleanupExpiredAttachments,
    collectSessionAttachmentIds,
  };
}

// ── Process launch helper (Windows) ──────────────────────────────────────────

const IS_WIN = process.platform === 'win32';

function buildProcessLaunch(command, args) {
  const ext = path.extname(command).toLowerCase();
  if (ext === '.js') {
    return {
      command: process.execPath,
      args: [command, ...args],
    };
  }
  if (!IS_WIN) return { command, args };
  if (ext === '.ps1') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', command, ...args],
    };
  }
  if (!ext || ext === '.cmd' || ext === '.bat') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/c', command, ...args],
    };
  }
  return { command, args };
}

// ── Directory browser helpers ─────────────────────────────────────────────────

function dedupePaths(paths) {
  const seen = new Set();
  const result = [];
  for (const item of paths) {
    if (!item) continue;
    const resolved = path.resolve(item);
    const key = IS_WIN ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function getDirectoryRoots() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const roots = [
    home,
    process.cwd(),
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
  ];

  if (IS_WIN) {
    const systemDrive = process.env.SystemDrive ? `${process.env.SystemDrive}\\` : '';
    if (systemDrive) roots.unshift(systemDrive);
    for (let i = 67; i <= 90; i += 1) {
      roots.push(`${String.fromCharCode(i)}:\\`);
    }
  } else {
    roots.unshift('/');
  }

  return dedupePaths(roots).filter((dir) => {
    try { return fs.existsSync(dir) && fs.statSync(dir).isDirectory(); } catch { return false; }
  });
}

function directoryHasFiles(dir) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isFile()) return true;
      if (entry.isDirectory() && directoryHasFiles(entryPath)) return true;
    }
  } catch {}
  return false;
}

// ── Port occupant killer ────────────────────────────────────────────────────

function killPortOccupant(port) {
  const cp = require('child_process');
  if (process.platform === 'win32') {
    try {
      const output = cp.execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const pids = new Set();
      for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5 || parts[0] !== 'TCP') continue;
        const local = parts[1] || '';
        const state = parts[3] || '';
        const pid = Number(parts[4]);
        if (!pid || pid === process.pid || state !== 'LISTENING') continue;
        if (local.endsWith(`:${port}`)) pids.add(pid);
      }
      if (pids.size === 0) return false;
      for (const pid of pids) {
        try { cp.execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
      }
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const check = cp.execSync('netstat -ano -p tcp', { encoding: 'utf8' });
        const stillListening = check.split(/\r?\n/).some((line) => {
          const parts = line.trim().split(/\s+/);
          return parts.length >= 5 && parts[0] === 'TCP' && parts[1]?.endsWith(`:${port}`) && parts[3] === 'LISTENING';
        });
        if (!stillListening) return true;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
      return true;
    } catch { return false; }
  }

  try {
    const result = cp.execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
    if (!result) return false;
    for (const pid of result.split('\n').map(Number).filter(Boolean)) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try {
        const check = cp.execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
        if (!check) return true;
      } catch { return true; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    return true;
  } catch { return false; }
}

// ── Windows environment fix ─────────────────────────────────────────────────

function fixWindowsEnv() {
  if (process.platform !== 'win32') return;
  const pathMod = require('path');
  function isMissing(value) { return !value || /%[A-Za-z0-9_]+%/.test(String(value)); }
  const fallbackUserProfile = process.env.USERPROFILE || (process.env.HOME && /^[A-Za-z]:[\\/]/.test(process.env.HOME) ? process.env.HOME : '');
  if (isMissing(process.env.SystemDrive)) process.env.SystemDrive = 'C:';
  if (isMissing(process.env.SystemRoot)) process.env.SystemRoot = `${process.env.SystemDrive}\\Windows`;
  if (isMissing(process.env.windir)) process.env.windir = process.env.SystemRoot;
  if (isMissing(process.env.ComSpec)) process.env.ComSpec = `${process.env.SystemRoot}\\System32\\cmd.exe`;
  if (isMissing(process.env.ProgramData)) process.env.ProgramData = `${process.env.SystemDrive}\\ProgramData`;
  if (fallbackUserProfile) {
    process.env.USERPROFILE = fallbackUserProfile;
    if (isMissing(process.env.APPDATA)) process.env.APPDATA = pathMod.join(fallbackUserProfile, 'AppData', 'Roaming');
    if (isMissing(process.env.LOCALAPPDATA)) process.env.LOCALAPPDATA = pathMod.join(fallbackUserProfile, 'AppData', 'Local');
  }
}

module.exports = {
  sanitizeId,
  isPathInside,
  safeFilename,
  extFromMime,
  extractBearerToken,
  jsonResponse,
  buildProcessLaunch,
  dedupePaths,
  getDirectoryRoots,
  directoryHasFiles,
  createAttachmentHelpers,
  killPortOccupant,
  fixWindowsEnv,
};

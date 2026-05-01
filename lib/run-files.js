'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createRunPaths(baseRunDir) {
  const dir = path.join(baseRunDir, crypto.randomUUID());
  return {
    dir,
    inputPath: path.join(dir, 'input.txt'),
    outputPath: path.join(dir, 'output.jsonl'),
    errorPath: path.join(dir, 'error.log'),
    pidPath: path.join(dir, 'pid'),
  };
}

function listRunEntries(sessionsDir) {
  const entries = [];
  const baseRunDirs = fs
    .readdirSync(sessionsDir)
    .filter((name) => name.endsWith('-run') && fs.statSync(path.join(sessionsDir, name)).isDirectory());

  for (const dirName of baseRunDirs) {
    const sessionId = dirName.replace(/-run$/, '');
    const baseDir = path.join(sessionsDir, dirName);
    pushRunEntry(entries, sessionId, baseDir);
    for (const childName of fs.readdirSync(baseDir)) {
      const childDir = path.join(baseDir, childName);
      try {
        if (fs.statSync(childDir).isDirectory()) pushRunEntry(entries, sessionId, childDir);
      } catch {}
    }
  }

  return entries;
}

function pushRunEntry(entries, sessionId, dir) {
  const pidPath = path.join(dir, 'pid');
  if (!fs.existsSync(pidPath)) return;
  entries.push({
    sessionId,
    dir,
    pidPath,
    outputPath: path.join(dir, 'output.jsonl'),
    errorPath: path.join(dir, 'error.log'),
  });
}

module.exports = {
  createRunPaths,
  listRunEntries,
};

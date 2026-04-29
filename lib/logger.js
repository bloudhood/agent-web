'use strict';

const fs = require('fs');
const path = require('path');

const LOG_MAX_SIZE = 2 * 1024 * 1024; // 2MB per file

/**
 * Create a process logger that writes JSON lines to `<logDir>/process.log`.
 * Rotates when the file exceeds 2 MB (renames to `.old.log`, starts fresh).
 * Creates `logDir` if it doesn't exist.  Never throws.
 *
 * @param {string} logDir  Absolute or relative path to the log directory.
 * @returns {{ plog: (level: string, event: string, data?: object) => void }}
 */
function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });

  const LOG_FILE = path.join(logDir, 'process.log');

  function plog(level, event, data = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...data,
    };
    const line = JSON.stringify(entry) + '\n';
    try {
      // Simple rotation: if file > 2MB, rename to .old and start fresh
      try {
        const stat = fs.statSync(LOG_FILE);
        if (stat.size > LOG_MAX_SIZE) {
          const oldFile = LOG_FILE.replace('.log', '.old.log');
          try { fs.unlinkSync(oldFile); } catch {}
          fs.renameSync(LOG_FILE, oldFile);
        }
      } catch {}
      fs.appendFileSync(LOG_FILE, line);
    } catch {}
  }

  return { plog };
}

module.exports = { createLogger };

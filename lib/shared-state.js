'use strict';

// Mutable singletons shared across modules
const MODEL_MAP = { opus: null, sonnet: null, haiku: null };
const activeProcesses = new Map();  // sessionId -> { proc, agent, pid, ... }
const wsSessionMap = new Map();     // ws -> sessionId
const pendingSlashCommands = new Map();
const pendingCompactRetries = new Map();
const activeTokens = new Map();     // token -> lastActive
const wssRef = { value: null };     // WebSocketServer reference

module.exports = {
  MODEL_MAP,
  activeProcesses,
  wsSessionMap,
  pendingSlashCommands,
  pendingCompactRetries,
  activeTokens,
  wssRef,
};

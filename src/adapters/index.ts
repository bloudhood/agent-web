/**
 * Adapter bootstrap — builds an AgentRegistry pre-populated with the four
 * built-in adapters wired to a runtime instance.
 *
 * The runtime is the existing factory result from lib/agent-runtime.js
 * so we don't break behavior in phase 1.
 */

import { createAgentRegistry, type AgentRegistry } from '@core/agent/registry';
import { createClaudeAdapter, type ClaudeRuntimeFns } from './claude';
import { createCodexAdapter, type CodexRuntimeFns } from './codex';
import { createGeminiAdapter, type GeminiRuntimeFns } from './gemini';
import { createHermesAdapter, type HermesRuntimeFns } from './hermes';

export type BuiltInRuntimeFns = ClaudeRuntimeFns &
  CodexRuntimeFns &
  GeminiRuntimeFns &
  HermesRuntimeFns;

export function createBuiltInRegistry(runtime: BuiltInRuntimeFns): AgentRegistry {
  const registry = createAgentRegistry();
  registry.register(createClaudeAdapter(runtime));
  registry.register(createCodexAdapter(runtime));
  registry.register(createGeminiAdapter(runtime));
  registry.register(createHermesAdapter(runtime));
  return registry;
}

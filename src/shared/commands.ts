/**
 * Slash command manifest helpers.
 * The JSON manifest in shared/commands.json is the source of truth at runtime;
 * this module wraps it with type-safety and lookup helpers.
 */

import type { AgentId } from '@core/session/session';

export type CommandKind = 'web' | 'native';

export interface CommandManifestEntry {
  cmd: string;
  desc: string;
  kind: CommandKind;
  agents: AgentId[];
}

export function isCommandKind(value: unknown): value is CommandKind {
  return value === 'web' || value === 'native';
}

export function isManifestEntry(value: unknown): value is CommandManifestEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.cmd === 'string' && v.cmd.startsWith('/') &&
    typeof v.desc === 'string' &&
    isCommandKind(v.kind) &&
    Array.isArray(v.agents)
  );
}

export function filterCommandsForAgent(
  manifest: CommandManifestEntry[],
  agent: AgentId,
): CommandManifestEntry[] {
  return manifest.filter((c) => c.agents.includes(agent));
}

export function findCommand(
  manifest: CommandManifestEntry[],
  cmd: string,
): CommandManifestEntry | undefined {
  return manifest.find((c) => c.cmd === cmd.toLowerCase());
}

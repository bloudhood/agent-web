import { describe, it, expect } from 'vitest';
import { filterCommandsForAgent, findCommand, isManifestEntry } from '@shared/commands';
import manifest from '../../../shared/commands.json';

describe('Slash command manifest', () => {
  it('every entry passes the type guard', () => {
    for (const entry of manifest as unknown[]) {
      expect(isManifestEntry(entry)).toBe(true);
    }
  });

  it('filterCommandsForAgent narrows by agent', () => {
    const claudeOnly = filterCommandsForAgent(manifest as Parameters<typeof filterCommandsForAgent>[0], 'claude');
    expect(claudeOnly.every((c) => c.agents.includes('claude'))).toBe(true);
  });

  it('findCommand exact-matches', () => {
    const found = findCommand(manifest as Parameters<typeof findCommand>[0], '/help');
    expect(found?.cmd).toBe('/help');
    expect(findCommand(manifest as Parameters<typeof findCommand>[0], '/HELP')).toBeTruthy();
    expect(findCommand(manifest as Parameters<typeof findCommand>[0], '/nope')).toBeUndefined();
  });

  it('every web slash command supports at least one agent', () => {
    for (const c of manifest as Parameters<typeof filterCommandsForAgent>[0]) {
      expect(c.agents.length).toBeGreaterThan(0);
    }
  });

  it('does not contain duplicate command strings', () => {
    const seen = new Set<string>();
    for (const c of manifest as Parameters<typeof filterCommandsForAgent>[0]) {
      expect(seen.has(c.cmd)).toBe(false);
      seen.add(c.cmd);
    }
  });
});

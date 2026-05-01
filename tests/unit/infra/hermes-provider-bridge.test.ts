import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { createHermesProviderBridge } = require('../../../lib/hermes-provider-bridge');
const { HERMES_PROVIDER_SCRIPT_PATHS, readHermesProviderScript } = require('../../../lib/hermes-provider-scripts');

describe('Hermes provider bridge', () => {
  it('caches model label reads within the state cache TTL', () => {
    let calls = 0;
    let now = 1_000;
    const bridge = createHermesProviderBridge({
      isWindows: false,
      now: () => now,
      stateCacheTtlMs: 5_000,
      discoverConfigLocation: () => ({ ok: true, kind: 'file', configPath: '/tmp/config.yaml', cliPath: '' }),
      runProviderScript: () => {
        calls += 1;
        return {
          ok: true,
          app: 'hermes',
          providers: [{ id: `p${calls}`, name: `Provider ${calls}`, current: true }],
          currentProviderName: `Provider ${calls}`,
        };
      },
    });

    expect(bridge.resolveModelLabel()).toBe('Provider 1');
    expect(bridge.resolveModelLabel()).toBe('Provider 1');
    expect(calls).toBe(1);

    now += 5_001;
    expect(bridge.resolveModelLabel()).toBe('Provider 2');
    expect(calls).toBe(2);
  });

  it('allows callers to force refresh cached state', () => {
    let calls = 0;
    const bridge = createHermesProviderBridge({
      isWindows: false,
      stateCacheTtlMs: 60_000,
      discoverConfigLocation: () => ({ ok: true, kind: 'file', configPath: '/tmp/config.yaml', cliPath: '' }),
      runProviderScript: () => {
        calls += 1;
        return {
          ok: true,
          app: 'hermes',
          providers: [{ id: `p${calls}`, name: `Provider ${calls}`, current: true }],
          currentProviderName: `Provider ${calls}`,
        };
      },
    });

    expect(bridge.getState().currentProviderName).toBe('Provider 1');
    expect(bridge.getState().currentProviderName).toBe('Provider 1');
    expect(bridge.getState({ forceRefresh: true }).currentProviderName).toBe('Provider 2');
    expect(calls).toBe(2);
  });

  it('keeps provider scripts in standalone files instead of bridge string literals', () => {
    expect(fs.existsSync(HERMES_PROVIDER_SCRIPT_PATHS.read)).toBe(true);
    expect(fs.existsSync(HERMES_PROVIDER_SCRIPT_PATHS.switch)).toBe(true);
    expect(readHermesProviderScript('read')).toContain('custom_providers');
    expect(readHermesProviderScript('switch')).toContain('yaml.safe_dump');

    const bridgeSource = fs.readFileSync(path.join(process.cwd(), 'lib', 'hermes-provider-bridge.js'), 'utf8');
    expect(bridgeSource).not.toContain('const readScript = String.raw`');
    expect(bridgeSource).not.toContain('const switchScript = String.raw`');
  });
});

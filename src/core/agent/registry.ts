/**
 * AgentRegistry — single place to look up an AgentAdapter by id.
 *
 * Adding a new agent means: write an adapter, register it here in bootstrap,
 * declare its slash commands in shared/commands.json. No core changes.
 */

import type { AgentId } from '@core/session/session';
import type { AgentAdapter } from './agent';

export class AgentRegistry {
  private readonly adapters = new Map<AgentId, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`AgentAdapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: AgentId): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  require(id: AgentId): AgentAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`No AgentAdapter registered for id=${id}`);
    return adapter;
  }

  list(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  has(id: AgentId): boolean {
    return this.adapters.has(id);
  }

  clear(): void {
    this.adapters.clear();
  }
}

export function createAgentRegistry(): AgentRegistry {
  return new AgentRegistry();
}

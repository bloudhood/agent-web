<script lang="ts">
  import { Card, Badge } from '@web/ui';

  // Static capability matrix mirroring src/adapters/* — must be kept in sync.
  // Phase 3.3 will wire this from /api/health if the server starts publishing it.
  interface AgentInfo {
    id: 'claude' | 'codex' | 'gemini' | 'hermes';
    label: string;
    description: string;
    capabilities: {
      attachments: boolean;
      thinkingBlocks: boolean;
      mcpTools: boolean;
      resume: 'native' | 'web-only' | 'none';
      modelList: 'cli' | 'static' | 'gateway';
      usage: 'usd' | 'tokens' | 'both';
    };
  }

  const agents: AgentInfo[] = [
    {
      id: 'claude',
      label: 'Claude Code',
      description: '通过本机 claude CLI 子进程驱动；支持图片附件、思考块、原生 resume。',
      capabilities: { attachments: true, thinkingBlocks: true, mcpTools: true, resume: 'native', modelList: 'cli', usage: 'usd' },
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      description: '通过本机 codex CLI 子进程驱动；支持图片附件、reasoning、原生 resume。',
      capabilities: { attachments: true, thinkingBlocks: true, mcpTools: true, resume: 'native', modelList: 'cli', usage: 'tokens' },
    },
    {
      id: 'gemini',
      label: 'Gemini CLI',
      description: '通过本机 gemini CLI 子进程驱动；目前不支持图片附件。',
      capabilities: { attachments: false, thinkingBlocks: true, mcpTools: true, resume: 'native', modelList: 'cli', usage: 'tokens' },
    },
    {
      id: 'hermes',
      label: 'Hermes Gateway',
      description: '通过 HTTP/SSE 直接对接 Hermes Gateway（兼容 OpenAI Responses API）。',
      capabilities: { attachments: false, thinkingBlocks: false, mcpTools: true, resume: 'web-only', modelList: 'gateway', usage: 'tokens' },
    },
  ];
</script>

<Card padding="md">
  <h3 class="text-sm font-semibold">Agent 能力矩阵</h3>
  <p class="mb-4 mt-1 text-xs text-text-muted">每个 Agent 在 Web UI 中的可用功能由其 capabilities 决定。</p>

  <div class="flex flex-col gap-4">
    {#each agents as agent (agent.id)}
      <div class="rounded-md border border-border/70 bg-surface-panel p-4">
        <header class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <Badge tone="accent">{agent.id}</Badge>
            <h4 class="text-sm font-semibold text-text-primary">{agent.label}</h4>
          </div>
          <span class="text-[10px] uppercase tracking-wider text-text-muted">{agent.capabilities.usage}</span>
        </header>
        <p class="mb-3 text-xs leading-5 text-text-secondary">{agent.description}</p>
        <div class="flex flex-wrap gap-1.5">
          <Badge tone={agent.capabilities.attachments ? 'success' : 'neutral'}>附件 {agent.capabilities.attachments ? '✓' : '×'}</Badge>
          <Badge tone={agent.capabilities.thinkingBlocks ? 'success' : 'neutral'}>思考块 {agent.capabilities.thinkingBlocks ? '✓' : '×'}</Badge>
          <Badge tone={agent.capabilities.mcpTools ? 'success' : 'neutral'}>MCP {agent.capabilities.mcpTools ? '✓' : '×'}</Badge>
          <Badge tone="info">resume: {agent.capabilities.resume}</Badge>
          <Badge tone="info">models: {agent.capabilities.modelList}</Badge>
        </div>
      </div>
    {/each}
  </div>
</Card>

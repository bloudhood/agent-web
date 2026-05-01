<script lang="ts">
  import { Card } from '@web/ui';
</script>

<Card padding="md">
  <h3 class="text-sm font-semibold">关于</h3>
  <p class="mt-2 text-xs text-text-secondary">
    Agent-Web 是一个本地优先的 Web 控制台，统一管理 Claude Code、Codex CLI、Gemini CLI、Hermes 的会话。
  </p>
  <ul class="mt-3 space-y-1 text-xs text-text-muted">
    <li>架构：Vite + Svelte 5 + Tailwind + bits-ui</li>
    <li>后端：Node.js 18+ · 子进程 + Gateway · 单一 AgentAdapter 抽象</li>
    <li>开源协议：MIT</li>
  </ul>
  <a
    class="mt-3 inline-block text-xs text-accent hover:underline"
    href="https://github.com/bloudhood/agent-web"
    target="_blank"
    rel="noopener"
  >
    GitHub 仓库 →
  </a>
</Card>

# Agent-Web

> 4-Agent unified local console for **Claude Code**, **Codex CLI**, **Gemini CLI**, and **Hermes** — capability-driven UI, zero vendor lock-in, runs entirely on your machine.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

[English README](./README.en.md) · [架构说明](./docs/ARCHITECTURE.md) · [能力矩阵](./docs/CAPABILITIES.md) · [新增 Agent 指南](./docs/ADDING_AN_AGENT.md) · [更新日志](./CHANGELOG.md)

## 为什么选 Agent-Web

| | Agent-Web | OpenWebUI / LobeChat | 单 Agent CLI 网页 |
|---|---|---|---|
| **本地优先** | 双击 `start.bat` 即跑，零云依赖 | 多依赖云端模型/向量库 | 各自独立 |
| **多 Agent 统一** | Claude / Codex / Gemini / Hermes 同一界面 | 偏 LLM Chat，单 SDK 路径 | 仅一个 Agent |
| **可扩展** | `AgentAdapter` 抽象 + 能力位，30 分钟接入新 Agent | 自定义需要改核心 | 不可扩展 |
| **CLI 原生对齐** | 思考块、工具调用、resume、Permission 全部映射到原生 CLI 语义 | 只是 LLM 接口 | 取决于具体 Agent |

## 特性

- **多 Agent 会话**：Claude、Codex、Gemini CLI、Hermes，侧边栏统一展示，按 Agent 标签分组。
- **能力驱动 UI**：思考块、工具调用、permission prompt、slash 菜单、`/usage` `/cost` `/resume` 都根据每个 Agent 的 `capabilities` 自动适配。
- **原生工作流对齐**：`/model`、`/mode`、`/permissions`、`/status`、`/usage`、`/resume`、`/doctor` 等 Web 命令；`/` 补全从当前本机 CLI help 解析。
- **本地历史导入**：从 `~/.claude/projects/` 与 `~/.codex/sessions/` 导入原生历史。
- **进程恢复**：浏览器断开后任务继续；服务重启后幂等恢复运行态。
- **Hermes Gateway 深化**：conversations 列表、并发取消、Last-Event-ID 重连、错误本地化。
- **现代化前端**：Vite + Svelte 5 + Tailwind + bits-ui，~50KB gzip，移动端友好。
- **可双主题**：Washi Light / Washi Dark，和风暖色克制美学。

## 快速开始

```bash
git clone https://github.com/bloudhood/agent-web.git
cd agent-web
npm install
cp .env.example .env       # 可选；不设置密码时首次启动会生成随机密码
npm start
```

Windows 可双击 `start.bat`，或运行 `node server.js`。访问 `http://localhost:8002`。首次未配置密码时，控制台会打印临时密码并要求登录后修改。

**局域网访问**（手机和电脑在同一 WiFi）：默认监听 `0.0.0.0:8002`，从手机访问 `http://电脑局域网IP:8002` 即可。仅本机使用建议设置 `HOST=127.0.0.1`，远程访问推荐 Tailscale / Cloudflare Tunnel。

## 前提条件

- Node.js >= 18
- 至少安装一个本机 Agent：

```bash
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
# Gemini CLI / Hermes 按各自官方方式安装并登录
```

Hermes 需要可访问的 Gateway，例如默认 `http://127.0.0.1:8644`。

## 配置

| 变量 | 必填 | 默认值 | 说明 |
|---|:---:|---|---|
| `CC_WEB_PASSWORD` | 否 | 自动生成 | Web 登录密码，首次启动会迁移到 `config/auth.json` |
| `HOST` / `CC_WEB_HOST` | 否 | `0.0.0.0` | 服务监听地址 |
| `PORT` | 否 | `8002` | 服务端口 |
| `CLAUDE_PATH` | 否 | `claude` | Claude Code CLI 路径 |
| `CODEX_PATH` | 否 | `codex` | Codex CLI 路径 |
| `GEMINI_PATH` | 否 | `gemini` | Gemini CLI 路径 |
| `CC_WEB_HERMES_API_BASE` | 否 | `http://127.0.0.1:8644` | Hermes Gateway 地址 |
| `CC_WEB_HERMES_API_KEY` | 否 | 空 | Hermes Gateway API Key |
| `CC_WEB_CONFIG_DIR` | 否 | `./config` | 配置目录覆写 |
| `CC_WEB_SESSIONS_DIR` | 否 | `./sessions` | 会话目录覆写 |
| `CC_WEB_LOGS_DIR` | 否 | `./logs` | 日志目录覆写 |

敏感配置写入 `config/`，会话写入 `sessions/`，日志写入 `logs/`，附件写入 `sessions/_attachments/`。这些目录都已被 gitignore。

## 架构概览

```text
Browser (Svelte 5)
  ↕ WebSocket (zod-validated)
Node.js
  ├─ AgentRegistry (Adapter for each agent)
  │   ├─ ClaudeAdapter ──► spawn `claude`
  │   ├─ CodexAdapter ──► spawn `codex`
  │   ├─ GeminiAdapter ──► spawn `gemini`
  │   └─ HermesAdapter ──► HTTP/SSE Gateway
  ├─ ChatOrchestrator / SlashOrchestrator / SettingsOrchestrator
  └─ SessionRepository / ConfigStore / AttachmentRepository
```

详细设计、模块边界、贡献者地图见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

新增 Agent 30 分钟入门：[docs/ADDING_AN_AGENT.md](./docs/ADDING_AN_AGENT.md)。

## 命令体系

Web 直接处理的命令：`/clear` `/model` `/mode` `/permissions` `/status` `/cost` `/usage` `/compact` `/init` `/resume` `/doctor` `/github` `/ssh` `/help`。

原生 CLI 管理命令会被识别。需要 TTY 或会改全局认证/配置的动作只给终端说明；基础读命令会通过本机 CLI 子进程实时输出。`/` 菜单的顶层、子命令和选项候选来自当前 CLI 的 `--help` 输出。

## 运行诊断

- `GET /api/health`：版本、PID、Node 版本、监听地址、运行任务数、能力开关。
- `GET /api/commands`：返回 Web/原生命令清单。
- `GET /api/slash-completions?agent=claude&input=/mcp%20`：当前 Agent 的原生 slash 候选。

## 开发与验证

```bash
# Backend
npm run check         # node --check + tsc --noEmit
npm run unit          # vitest (130+ specs)
npm run regression    # mock CLI integration suite
npm test              # all of the above

# Frontend
npm run dev:web       # Vite HMR (proxies WS/HTTP to :8002)
npm run build:web     # Vite production build → public/
npx svelte-check --workspace web

# E2E (phase 3.4 will boot server with mock CLIs automatically)
npm run e2e
```

CI 在 Windows + Ubuntu × Node 18/22 矩阵上运行 `type-check`、`unit`、`test`。前端构建产物 (`public/index.html` + `public/assets/`) 与源码同步提交，CI 校验产物一致性。

## 紧急回退

如果新前端有问题，访问 `http://localhost:8002/?legacy=1` 可临时切换回上一代 IIFE 前端（位于 `public/legacy/`）。

## 安全边界

Agent-Web 是本地开发者工具，不是公开 SaaS。远程访问建议使用 Tailscale、Cloudflare Tunnel 或带 HTTPS 和访问控制的反向代理。

不要公开提交：`.env`、`config/*.json`、`sessions/`、`logs/`、`attachments/`、`.claude/`、`.codex/`。

更多说明见 [SECURITY.md](./SECURITY.md)。

## 致谢

基于 [ZgDaniel/cc-web](https://github.com/ZgDaniel/cc-web) 独立维护的社区分支。

## License

MIT

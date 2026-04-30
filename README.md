# Agent-Web

> 基于 [ZgDaniel/cc-web](https://github.com/ZgDaniel/cc-web) 独立维护的社区分支。

本地优先的 Web 控制台，用一个移动端友好的界面管理 Claude Code、Codex、Gemini CLI 和 WSL Hermes 会话。

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

[English README](./README.en.md) | [架构说明](./docs/ARCHITECTURE.md) | [更新日志](./CHANGELOG.md) | [安全说明](./SECURITY.md)

## 特性

- **多 Agent 会话**：支持 Claude、Codex、Gemini CLI、Hermes，侧边栏按最近时间统一展示并标识来源 Agent。
- **移动端控制**：针对 iOS/Chrome 的聊天、侧栏、底部输入和原生选择体验优化。
- **原生工作流对齐**：支持 `/model`、`/mode`、`/permissions`、`/status`、`/usage`、`/resume`、`/doctor` 等 Web 命令；`/` 补全从当前本机 CLI help 解析命令、子命令和选项，基础读命令可实时输出。
- **本地历史导入**：可导入 Claude `~/.claude/projects/` 和 Codex `~/.codex/sessions/` 历史。
- **进程恢复**：Claude/Codex/Gemini 通过本机 CLI 子进程运行，浏览器断开后任务可继续；服务重启后尽量恢复运行态。
- **Hermes Gateway**：通过 WSL/本机 Hermes API Server 对接 Hermes 对话，并展示工具调用。
- **开发者配置**：可保存 GitHub 仓库和 SSH 主机配置，供 `/github`、`/ssh` 工作流使用。
- **通知**：支持 PushPlus、Telegram、Server 酱、飞书机器人、Qmsg。

## 前提条件

- Node.js >= 18
- 至少安装一个本机 Agent：

```bash
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
# Gemini CLI / Hermes 按各自官方方式安装和登录
```

Hermes 需要可访问的 Gateway，例如默认 `http://127.0.0.1:8644`。

## 快速开始

```bash
git clone https://github.com/bloudhood/agent-web.git
cd agent-web
npm install
cp .env.example .env   # 可选；不设置密码时首次启动会生成随机密码
npm start
```

Windows 可双击 `start.bat`，或运行：

```cmd
node server.js
```

启动后访问 `http://localhost:8002`。首次未配置密码时，控制台会打印临时密码并要求登录后修改。

**局域网访问**（手机和电脑在同一 WiFi）：
- Agent-Web 默认监听 `0.0.0.0:8002`，便于从手机访问 `http://电脑局域网IP:8002`。
- 仅本机使用时建议设置 `HOST=127.0.0.1`。远程访问推荐通过 Nginx、Tailscale 或 Cloudflare Tunnel，并配合防火墙限制来源。

## 配置

| 变量 | 必填 | 默认值 | 说明 |
|---|:---:|---|---|
| `CC_WEB_PASSWORD` | 否 | 自动生成 | Web 登录密码，首次启动会迁移到 `config/auth.json` |
| `HOST` / `CC_WEB_HOST` | 否 | `0.0.0.0` | 服务监听地址；仅本机使用可设为 `127.0.0.1` |
| `PORT` | 否 | `8002` | 服务端口 |
| `CLAUDE_PATH` | 否 | `claude` | Claude Code CLI 路径 |
| `CODEX_PATH` | 否 | `codex` | Codex CLI 路径 |
| `GEMINI_PATH` | 否 | `gemini` | Gemini CLI 路径 |
| `CC_WEB_HERMES_API_BASE` | 否 | `http://127.0.0.1:8644` | Hermes Gateway 地址 |
| `CC_WEB_HERMES_API_KEY` | 否 | 空 | Hermes Gateway API Key |
| `CC_WEB_CONFIG_DIR` | 否 | `./config` | 配置目录覆写 |
| `CC_WEB_SESSIONS_DIR` | 否 | `./sessions` | 会话目录覆写 |
| `CC_WEB_LOGS_DIR` | 否 | `./logs` | 日志目录覆写 |
| `PUSHPLUS_TOKEN` | 否 | 空 | PushPlus Token，首次启动可迁移到通知配置 |

敏感配置会写入 `config/`，会话写入 `sessions/`，日志写入 `logs/`。这些目录不应提交到 git。

## 命令体系

Web 直接处理的命令包括：

- `/clear`
- `/model`
- `/mode` / `/permissions`
- `/status`
- `/cost` / `/usage`
- `/compact`
- `/init`
- `/resume`
- `/doctor`
- `/github`
- `/ssh`
- `/help`

原生 CLI 管理命令会被识别。需要 TTY 或会改全局认证/配置的动作只给终端说明；基础读命令会通过本机 CLI 子进程实时输出。`/` 菜单的顶层、子命令和选项候选来自当前 CLI 的 `--help` 输出，Web 命令清单来自后端 `shared/commands.json`。

## 运行诊断

- `GET /api/health`：返回版本、PID、Node 版本、实际监听地址、运行中任务数、命令清单数量和能力开关。
- `GET /api/commands`：返回 Web/原生命令清单。
- `GET /api/slash-completions?agent=claude&input=/mcp%20`：返回当前 Agent 的原生 slash 候选。

## 项目结构

```text
agent-web/
├── server.js                  # 入口：组装模块、启动 HTTP/WS 服务
├── lib/
│   ├── agent-manager.js        # Agent 进程生命周期（spawn/kill/recover）
│   ├── agent-runtime.js         # Claude/Codex/Gemini/Hermes 事件解析和 spawn spec
│   ├── auth.js                  # 认证与密码管理
│   ├── codex-rollouts.js        # Codex rollout 历史解析
│   ├── config-manager.js        # 模型、Codex、CCSwitch、开发者配置管理
│   ├── logger.js                # 日志轮转与写入
│   ├── notify.js                # PushPlus / Telegram / Server酱 / 飞书 / Qmsg
│   ├── routes.js                # HTTP + WebSocket 路由及 slash 命令处理
│   ├── session-store.js         # 会话持久化、原子写入、缓存
│   ├── shared-state.js          # 跨 Agent 共享状态（CCSwitch 桌面同步）
│   └── utils.js                 # 通用工具函数
├── public/                     # 前端页面、样式、图标
│   ├── app.js                  # 入口：常量、状态、DOM、WS、消息路由、事件绑定
│   └── js/
│       ├── helpers.js           # 工具函数（escapeHtml、timeAgo、formatFileSize 等）
│       ├── markdown.js          # Markdown 渲染与 XSS 过滤
│       ├── ui.js                # 主题、侧栏、滚动条、Toast、Picker、输入框
│       ├── session.js           # 会话列表、缓存、切换、创建、删除、导入
│       ├── chat.js              # 消息流、工具调用、AskUser、生成态
│       └── settings.js          # 设置面板（模型/通知/Codex/CCSwitch/开发者/密码）
├── shared/commands.json         # slash command 单一清单
├── scripts/                    # 回归脚本与 mock CLI
├── .github/workflows/ci.yml     # CI
├── .env.example
├── SECURITY.md
├── CONTRIBUTING.md
└── LICENSE
```

## 架构

```text
Browser <-WebSocket-> Node.js <-local process/API-> Claude / Codex / Gemini / Hermes
```

- **后端**：`server.js` 作为入口组装 `lib/` 下 11 个模块，各模块职责单一（路由、会话存储、Agent 生命周期、配置管理、通知等）。
- **前端**：`app.js` 作为入口，6 个 JS 模块（helpers/markdown/ui/session/chat/settings）通过 `CCWeb` 命名空间通信，全部 IIFE 模式无构建工具依赖。
- Claude、Codex、Gemini 通过本机 CLI 子进程运行。
- Hermes 通过 Gateway SSE/API 流接入。
- 会话以 JSON 存储，关键写入采用临时文件加 rename 的原子写入方式。
- 附件限制为图片，默认最多 4 张、单张 10MB、7 天过期。
- 运行日志写入 `logs/process.log`，自动按 2MB 轮转。

## 安全边界

Agent-Web 是本地开发者工具，不是公开 SaaS。远程访问建议使用 Tailscale、Cloudflare Tunnel 或带 HTTPS 和访问控制的反向代理。

不要公开提交这些内容：

- `.env`
- `config/*.json`
- `sessions/`
- `logs/`
- `attachments/`
- `.claude/`
- `.codex/`

更多说明见 [SECURITY.md](./SECURITY.md)。

## 开发与验证

```bash
npm run check
npm run regression
npm test
```

`npm test` 会先做语法检查，再运行隔离式回归脚本。CI 会在 Windows 和 Ubuntu 的 Node 18/22 上运行同样检查。

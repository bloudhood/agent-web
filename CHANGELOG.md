# 更新记录

## 2.0.0

### 三阶段重构（Phase 1 + 2 + 3）

后端、前端、Agent 集成层全面重构。从"工厂模块 + 巨型单文件 + 散落分支"迁移到"分层 + AgentAdapter 注册表 + Vite/TS/Svelte 前端 + 设计系统"。

#### Phase 1 — 后端骨架

- **类型与测试地基**：引入 TypeScript（`tsconfig.json` allowJs + checkJs + noEmit）、Vitest（`vitest.config.ts`）、zod（WS 消息 schema），134 个新单测覆盖核心层。
- **AgentAdapter 抽象**：在 [src/core/agent/agent.ts](src/core/agent/agent.ts) 定义 `AgentAdapter`、`AgentCapabilities`、`SpawnSpec`、`GatewayCall` 接口；`AgentRegistry` 提供 `register/get/list/require`。
- **四个 adapter**：Claude/Codex/Gemini/Hermes 拆出独立 TS 模块（`src/adapters/<id>/index.ts`），与现有 `lib/agent-runtime.js` 双轨。
- **Orchestrator 三件套**：`ChatOrchestrator`（消息预检）、`SlashOrchestrator`（slash 命令处理）、`SettingsOrchestrator`（设置 WS 路由），切碎 `lib/routes.js` 的巨型 `deps`。
- **持久化抽象**：`SessionRepository`（原子写、id 安全检查、redact 字段）、`AttachmentRepository`、`ConfigStore`。
- **鲁棒性**：`heartbeat.ts`（zombie + backpressure + 结构化日志）、`recovery.ts`（幂等重连）、`logger.ts`（带级别和上下文绑定）。

#### Phase 2 — 前端现代化

- **构建链**：Vite + Svelte 5（runes）+ TypeScript + Tailwind v3 + bits-ui + lucide-svelte，构建产物提交到 `public/`，~50 KB gzip。
- **设计系统**：tokens（30 个 RGB-triplet 语义化变量）→ primitives（Button/IconButton/Input/Card/Badge/Toast/Sheet/Spinner，由 Tailwind utilities 组合）→ patterns（MessageBubble/ToolCallCard/ThinkingBlock/PermissionPrompt/CommandPalette）。
- **Stores**：以 Svelte 5 runes 重写 auth / sessions / chat / toast / ui，WS client 用 phase 1 的 zod schema 做运行时验证 + 类型推断。
- **视图重做**：登录、主布局（侧栏/header/消息流/composer）、Settings（账户/主题/Agent 能力/关于 四个 Tab，每个 < 200 行）、移动端抽屉式侧栏。
- **双轨过渡**：旧 IIFE 前端搬到 `public/legacy/`，`?legacy=1` 紧急回退路径。
- **E2E**：Playwright 配置 + 桌面 / iPhone 13 双 profile，phase 3.4 接入 mock CLI 自动化。

#### Phase 3 — Agent 原生度对齐 + Hermes 深化

- **思考块**：`ThinkingBlock.svelte` 折叠组件、`thinking_delta` WS 事件 schema 与 store 处理。
- **工具调用卡片**：按 `meta.kind` 分支（command_execution / file_change / mcp_tool_call / reasoning），可展开看 input/output。
- **Permission Prompt**：`PermissionPrompt.svelte` + `permission_prompt` 出站事件 + `permission_response` 入站事件 schema，前端可点 Allow once / Always / Reject。
- **Slash 自动补全**：`CommandPalette.svelte` 联动 `/api/slash-completions`，键盘导航。
- **Hermes 深化**：
  - 独立 `gateway-client.ts`（`createResponse / cancelResponse / listConversations / listResources`），处理 4xx/5xx 错误，解析 `Retry-After`。
  - `sse-stream.ts` SSE 解析器，支持 `\n\n` / `\r\n\r\n` 帧、`Last-Event-ID` 跟踪、partial-chunk 跨 feed 拼接。
  - `error-mapper.ts` 把 OpenAI 兼容的错误码映射成中文可操作提示。
- **文档**：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 重写为反映新四层结构；新增 [docs/CAPABILITIES.md](docs/CAPABILITIES.md)（Agent 能力矩阵）和 [docs/ADDING_AN_AGENT.md](docs/ADDING_AN_AGENT.md)（30 分钟接入新 Agent）。
- **README**：突出"4-Agent unified local console"定位 + 与 OpenWebUI/LobeChat 的对比表。

### 工程化

- CI 增加 `type-check`、`unit` 两个独立 job，原 Windows + Ubuntu × Node 18/22 矩阵保留。
- `npm test` 现在串联 `check` → `type-check` → `audit:repo` → `unit` → `regression`。
- 134 个 vitest 单测 + 17 个集成断言 + 11 个 e2e 用例。

### 破坏性变更

- 前端入口从 `public/index.html` 直接加载多个 IIFE 改为 Vite 构建产物。旧前端搬到 `public/legacy/`，`?legacy=1` 兜底。
- `npm run check` 现在校验 `public/legacy/app.js` 而非 `public/app.js`。

## Unreleased

### 架构重构

- **后端模块化**：`server.js` 从单体拆分为入口 + 11 个 `lib/` 模块，各模块职责单一：
  - `auth.js` — 认证与密码管理
  - `session-store.js` — 会话持久化、原子写入、缓存
  - `agent-manager.js` — Agent 进程生命周期（spawn/kill/recover）
  - `config-manager.js` — 模型、Codex、CCSwitch、开发者配置管理
  - `routes.js` — HTTP + WebSocket 路由及 slash 命令处理
  - `notify.js` — PushPlus / Telegram / Server酱 / 飞书 / Qmsg
  - `agent-runtime.js` — Claude/Codex/Gemini/Hermes 事件解析
  - `codex-rollouts.js` — Codex rollout 历史解析
  - `shared-state.js` — 跨 Agent 共享状态（CCSwitch 桌面同步）
  - `logger.js` — 日志轮转与写入
  - `utils.js` — 通用工具函数
- **前端模块化**：`app.js` 从 5442 行拆分为入口 + 6 个 `public/js/` 模块（helpers / markdown / ui / session / chat / settings），全部 IIFE 模式通过 `CCWeb` 命名空间通信，无构建工具依赖。
- **CSS 设计系统收敛**：移除 CoolVibe 主题，统一 CSS 自定义属性与媒体查询，保留 washi / washi-dark 两套主题。

### 收敛

- 补齐开源项目元数据：MIT LICENSE、贡献指南、安全说明、CI、package 发布字段与 Node engines。
- 同步 README / README.en 项目结构与架构描述，覆盖全部后端模块与前端模块。
- 新增 `shared/commands.json` 作为 slash command 单一清单，前端命令菜单由后端 manifest 提供，与 routes.js 自动同步。
- 扩展 `.gitignore`，排除本地运行态、CLI 配置缓存和封禁列表。
- Codex 搜索功能标记 `TODO(v1.4)`，当前硬编码 `enableSearch: false`。
- Gemini 默认 mode 限制在 UI 中增加 tooltip 说明。

### 稳定性

- 前端 Markdown 渲染拦截原始 HTML 与危险 URL，降低模型输出注入风险。
- 静态文件和本地历史路径检查改用 `path.relative` 边界判断，避免前缀匹配误判。
- 回归脚本增加命令 manifest 与 Markdown 安全护栏检查。
- 配置写入增加备份/恢复机制，防止并发写入导致配置损坏。
- Codex 冷启动性能优化：跳过全局 plugins/marketplace 目录复制。

## v1.3.1

### 新增

- Codex 模型配置：支持通过配置动态管理可选模型
- 浏览器标签页：新增站点 favicon

### 修复

- 修复长时间运行服务中的内存泄漏风险
- 修复新建会话时本地目录输入与选择状态不同步的问题
- 修复 Claude 认证 token 处理异常的问题

## v1.3.0

### 新增

- 开发者配置：新增 SSH 主机管理（支持密钥/密码认证），新增 /ssh 命令便捷连接远程主机
- 开发者配置：新增 GitHub Token 与仓库管理，新增 /github 命令快速提交仓库
- 设置面板：统一 Claude 与 Codex API 配置到同一面板
- 设置面板：新增"本地配置"模板化机制，支持读取/快照/恢复本地 API 配置
- 新建会话：新增"本地任务/远程任务"选择，支持固定目录和 SSH 远程主机

## v1.2.12

### 修复

- 修复 Claude opus/sonnet 会话在切换自定义 API 模板后因模型名 `[1m]` 后缀不匹配导致 403 报错的问题
- 修复编辑模板模型名或删除模板后，已有会话的模型名无法正确重映射的问题

## v1.2.11

### 改进

- Claude 默认设置为 1M 上下文（opus / sonnet 自动使用 `[1m]` 模型，haiku 保持不变）

## v1.2.10

### 改进

- 实现与原生 claude code / codex cli 一致的 `/init` 功能

## v1.2.9

### 新功能

- **通知 AI 摘要** — 任务完成时调用 Claude API 生成摘要内容推送，支持正常完成/异常/上下文压缩等多种情况分类，摘要 API 凭证可独立配置或复用活跃 Claude 模板/Codex Profile，各渠道按字符限制自动截断，摘要失败时降级为原始信息
- **通知配置收进二级菜单** — Claude 和 Codex 设置面板中的通知区域改为 nav-card 入口，点击进入独立子页，与主题设置风格统一

## v1.2.8

### 新功能

- **Codex 双 Agent** — 新建会话时可选 Claude 或 Codex，共享后端内核，侧边栏按 Agent 隔离
- **图片上传** — 拖拽 / 粘贴 / 附件按钮上传图片，客户端自动压缩，单条消息最多 4 张
- **主题系统** — 新增 CoolVibe Light 等多套主题，设置中一键切换
- **Codex 本地历史导入** — 导入 `~/.codex/sessions/` 下的会话历史
- **隔离式回归脚本** — `npm run regression` 使用 mock CLI 在临时目录中校验主路径

### 改进

- 会话加载增加遮罩与热缓存，减少切换卡顿
- 移动端侧栏支持右滑唤起 / 左滑关闭
- 后端 spawn 与事件解析拆分为独立模块

### 修复

- 切后台再切回时运行中内容短暂消失
- 移动端附件按钮、新会话按钮比例失调

## v1.2.7

- 导入本地 CLI 会话（`~/.claude/projects/`），可续接历史对话
- 新建会话时指定工作目录
- 设置面板新增「检查更新」

## v1.2.6

- 工具调用超过 5 个时自动折叠
- 模板编辑弹窗支持拉取上游模型列表
- AskUserQuestion 选项预览区
- 自定义滚动条，会话历史分批渲染
- 修复配置文件写入竞争导致的随机 401
- 修复流式输出与工具调用 UI 共存时的覆盖问题
- 删除会话时同步清除本地 CLI 历史

## v1.2.3

- 模型配置系统：local / custom 两种模式，支持多 API 模板切换

## v1.2.2

- `/compact` 对齐 Claude Code 原生压缩策略
- 上下文超限时自动压缩并重放失败请求

## v1.2.1

- 修复 AskUserQuestion 交互选项不显示的问题
- 点击选项快捷填充到输入框

## v1.2

- 修复长代码块导致页面横向溢出
- 移动端回车改为换行，发送改为按钮触发

## v1.1

- Windows 环境兼容支持

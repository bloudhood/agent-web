# CC-Web 项目收敛设计

**日期**: 2026-04-29
**目标**: 提高项目整体的可维护性、稳定性、完整性和协同性
**策略**: 方案 C — 混合并行，分阶段增量推进

---

## 现状分析

### 代码规模

| 文件 | 行数 | 问题 |
|------|------|------|
| `server.js` | ~4000+ | 单体文件，所有后端逻辑混在一起 |
| `public/app.js` | ~3800+ | 单体文件，所有前端逻辑混在一起 |
| `public/style.css` | ~4087 | 3 次 design pass 叠加，`:root` 变量被覆盖 3 次 |
| `lib/agent-runtime.js` | ~800 | 已独立，职责清晰 |

### 已知技术债

1. **CSS 设计系统混乱** — 多次 design pass 导致变量覆盖、冗余规则、主题描述与实际不符
2. **配置污染风险** — Claude custom 模式直接写全局 `~/.claude/settings.json`
3. **测试可靠性** — Windows 缺 sqlite3 导致部分回归失败
4. **功能半成品** — Codex search 未接入、Gemini default mode 已禁用
5. **CoolVibe 主题** — 与 Claude 设计语言不协调，维护成本高

---

## 架构目标

### 后端模块化

```
server.js                    ← 轻量入口：HTTP/WS 服务器启动、静态文件服务 (~200 行)
lib/
  auth.js                    ← 认证：密码生成、token 验证、IP 封禁、暴力破解防护 (~300 行)
  agent-manager.js           ← Agent 生命周期：spawn/kill/reconnect、进程恢复、事件流转发 (~800 行)
  session-store.js           ← 会话持久化：CRUD、JSONL 读写、导入/删除、Codex rollout (~600 行)
  config-manager.js          ← 配置管理：模型配置、CC Switch、Codex profile、目录选择器 (~500 行)
  notification.js            ← 通知推送：5 个 provider、AI 摘要生成 (~400 行)
  routes.js                  ← 路由分发：HTTP API + WebSocket 消息类型分发 (~400 行)
  agent-runtime.js           ← 事件解析层（已有，保留）
```

#### 模块接口

```js
// auth.js
createAuthMiddleware(config) → (req, res, next) => { ... }

// agent-manager.js
createAgentManager(sessionStore, config) → {
  spawn(sessionId, agent, opts),
  kill(sessionId),
  reconnect(sessionId),
  getActiveAgents(),
  recoverProcesses()  // 服务器重启后恢复
}

// session-store.js
createSessionStore(dataDir) → {
  list(agent),
  get(sessionId),
  create(agent, opts),
  update(sessionId, patch),
  delete(sessionId),
  importNative(agent)  // 从 Claude/Codex 原生历史导入
}

// config-manager.js
createConfigManager(dataDir) → {
  getModelConfig(),
  setModelConfig(cfg),
  getCodexProfiles(),
  setCodexProfile(name, cfg),
  switchProvider(agent, profile),
  browsePaths(baseDir)
}

// notification.js
createNotifier(config) → {
  send(event, data),
  buildSummary(content)  // AI 摘要
}

// routes.js
createRouter(auth, agents, sessions, config, notifier) → router
```

### 前端模块化

```
public/
  app.js                     ← 入口：初始化、全局状态、WebSocket 连接 (~400 行)
  js/
    chat.js                  ← 消息渲染、工具调用卡片、流式输出、附件处理 (~1000 行)
    session.js               ← 会话列表、LRU 缓存、切换、创建、删除 (~600 行)
    settings.js              ← 设置面板系统、所有子页面 (~800 行)
    ui.js                    ← DOM 工具、滚动条、侧边栏、主题、移动端适配 (~500 行)
    markdown.js              ← Markdown 渲染 + 安全过滤 (~200 行)
  index.html
  style.css                  ← 单一设计系统，双主题
```

#### 模块通信

通过全局命名空间 `CCWeb` 通信，避免引入构建工具：

```js
window.CCWeb = {
  chat: { renderMessage, renderToolCall, appendStream, ... },
  session: { list, get, create, switch, cache, ... },
  settings: { open, close, get, set, ... },
  ui: { scrollToBottom, toggleSidebar, applyTheme, ... },
  markdown: { render, safeUrl, ... },
  ws: { send, on, off, ... }
};
```

### CSS 设计系统

```css
:root                           /* Light 主题 — Claude 设计语言 */
html[data-theme='washi-dark']   /* Dark 主题 */
```

**Token 体系（统一，无冗余覆盖）**:
- 间距: `--sp-1` ~ `--sp-12`
- 圆角: `--r-sm` ~ `--r-pill`
- 阴影: `--shadow-1` ~ `--shadow-3`
- 动画: `--dur-fast` / `--dur-base` / `--dur-slow`，`--ease-out` / `--ease-spring`

**字体**: Poppins (UI) + Lora (正文) + Chivo Mono (代码)

**移除**: CoolVibe 主题的所有 CSS 和 JS 引用

---

## 分阶段执行计划

### P0 — 提交当前工作

**目标**: 保存当前所有未提交变更作为安全回退点

- `git add` 14 个变更文件（排除敏感文件）
- Commit message: 概括开源规范化 + 安全加固 + 命令清单 + 回归增强
- 验证: `npm test` 通过

### P1 — 配置隔离 + 测试修复

**目标**: 消除配置污染风险，确保测试在 Windows 上 100% 通过

#### P1a. Claude custom 模式配置隔离
- 会话启动时备份 `~/.claude/settings.json` → `settings.json.bak`
- 会话结束/切换时恢复备份
- 检测备份与当前一致时直接删除（无变更）
- 保留已有的原子写机制（tmp+rename）

#### P1b. Codex 会话冷启动优化
- 问题：per-session CODEX_HOME 复制了全局 plugins/marketplace/memories 配置，导致冷启动 ~116 秒
- 方案：只复制必要的 `config.toml`，不复制全局插件和 marketplace 配置
- 验证：新 Codex 会话启动时间显著缩短

#### P1c. 回归测试 Windows 修复
- 评估 `sqlite3` CLI 依赖：用 better-sqlite3 或标记 skipIfUnavailable
- 确保 `npm test` 在 Windows 上 100% 通过

#### P1d. 测试覆盖补齐
- 路径遍历防护的边界测试
- 配置备份/恢复测试
- Markdown 安全过滤覆盖所有 agent 输出

**验证**: `npm test` 全绿，配置隔离行为正确

### P2 — CSS 整合 + server.js 模块化（并行）

#### P2a. CSS 设计系统整合

**步骤**:
1. 删除 CoolVibe 相关 CSS 规则和 JS 引用
2. 提取当前生效的 `:root` 变量（最后一次覆盖的值）为权威定义
3. 删除之前的冗余覆盖块
4. 合并重复的 `@media` 查询
5. 统一组件样式（按钮、输入框、卡片、弹窗）
6. 提升质感：更精致的阴影层次、更平滑的过渡、更统一的间距

**验证**: 三个主题（Light/Dark + 旧 CoolVibe 已移除）视觉正确，无回归

#### P2b. server.js 模块化拆分

**步骤**:
1. 创建 `lib/auth.js` — 提取认证相关代码
2. 创建 `lib/session-store.js` — 提取会话持久化代码
3. 创建 `lib/config-manager.js` — 提取配置管理代码
4. 创建 `lib/notification.js` — 提取通知推送代码
5. 创建 `lib/agent-manager.js` — 提取 Agent 生命周期代码
6. 创建 `lib/routes.js` — 提取路由分发代码
7. `server.js` 瘦身为入口文件
8. 每拆一个模块，运行 `npm test` 验证

**验证**: `npm test` 全绿，所有 API 行为不变

### P3 — app.js 模块化 + CSS 打磨

#### P3a. app.js 模块化拆分

**步骤**:
1. 创建 `public/js/markdown.js` — 提取 Markdown 渲染和安全过滤
2. 创建 `public/js/ui.js` — 提取 DOM 工具、滚动条、侧边栏、主题
3. 创建 `public/js/session.js` — 提取会话管理、缓存
4. 创建 `public/js/chat.js` — 提取消息渲染、工具调用卡片
5. 创建 `public/js/settings.js` — 提取设置面板系统
6. `app.js` 瘦身为入口 + WebSocket + 全局状态
7. `index.html` 更新 script 加载顺序
8. 每拆一个模块，手动验证前端功能

**验证**: 所有前端功能正常（会话创建/切换、消息发送/接收、工具调用渲染、设置面板、主题切换）

#### P3b. CSS 细节打磨
- 修复发现的视觉问题
- 确保移动端布局正确
- 暗色模式下所有组件可读性验证

### P4 — 功能闭环 + 文档同步

- Codex search 死代码清理或标记 `// TODO: v1.4`
- Gemini default mode 禁用原因在 UI 中明确提示
- README 中英文与实际功能同步
- `shared/commands.json` 与实际可用命令验证
- CHANGELOG 整理为正式发布版本
- `npm test` 最终全量验证

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 模块化后 API 行为变化 | 高 | 每拆一个模块立即运行 `npm test` |
| CSS 整合导致视觉回归 | 中 | 分主题逐一验证，保留截图对比 |
| 前端模块加载顺序错误 | 中 | 显式声明依赖顺序，入口文件最后加载 |
| 配置备份恢复逻辑出错 | 中 | 充分测试边界情况（无备份、备份损坏、并发） |

---

## 成功标准

1. `npm test` 在 Windows 上 100% 通过
2. 没有单个文件超过 1000 行
3. CSS 中 `:root` 变量只定义一次，无冗余覆盖
4. Claude custom 模式不污染全局配置
5. 三个主题（Light/Dark）视觉一致且高质量
6. 所有现有功能正常工作（无回归）

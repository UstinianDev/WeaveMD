# ai-panel-redesign — 实施计划（档位 L）

> 2026-08-16 | 对照需求 `docs/requirements/ai-panel-redesign.req.md` 逐文件核实

## 0. 关键探索结论（影响设计的事实）

| 事实 | 位置 | 影响 |
|---|---|---|
| `IPC_CHANNELS` 常量在 `src/shared/constants.ts` | 主/预加载/渲染共用 | 新增 `AI_LIST_MODELS` 放此处 |
| `ai.listModels` 主进程读 key 用 `decryptApiKey(enc)`（`secureConfig.ts`） | `src/main/ai/secureConfig.ts:32` | 复用，key 不落渲染 |
| 会话创建有两处：渲染 store 和主进程都可能建 | `agentStore.sendMessage/sendAgentMessage`；主进程 `runChatFlow`(ipc.ts)、`agentLoop.ts` | 首条消息写 summary 必须在**渲染 store 建会话成功后**执行（R20 落点） |
| `ChatTab.tsx` **全仓仅自引用** | `src/render/components/AIAgent/ChatTab.tsx` | 废弃，直接删除 |
| 设置弹窗由 `TopBar`→`HelpMenu`→`openModal('settings')` 打开，`MainPage` 渲染 `<SettingsModal isOpen={activeModal==='settings'}>` | `TopBar.tsx:166`、`MainPage.tsx:194` | ai Tab 迁走后设置弹窗保留 system/account |
| `probeOllama` 先例（纯函数，global fetch） | `src/main/ai/llmClient.ts:48` | 新函数仿此模式，便于单测 |
| `aiPanelWidth` 默认 320，两处持久化兜底 | `uiStore.ts:69`(默认) 、`uiStore.ts:203`(loadSettings 兜底) | 默认改 480 需同步两处 |
| rewriteStore 已有 `clearRewrite()` 重置全部 | `rewriteStore.ts:236` | R16 关闭按钮可复用（或加轻量 dismiss） |
| `updateConversationSummary` 会 `updated_at=now` | `db/ai.ts:261` | 首条消息写 summary 天然满足「首条问题排最前」 |
| i18n 三语言文件存在 | `zh-CN.json`/`en.json`/`zh-TW.json` | 键三处同步 |
| 测试约定：纯函数 `tests/main/ai/*`、store `tests/stores/*`、E2E `e2e/*.spec.ts` | 已有 `llmClient.test.ts`/`ipc.test.ts` | 新 IPC handler 纯函数放 `tests/main/ai/` |
| Playwright E2E 走真实 Chromium；mock bridge 在 `src/render/utils/weaveMDBridge.ts`（ai 域 `:646` 起） | `weaveMDBridge.ts` | mock bridge `WeaveMDApi` 类型必须全量实现，否则 tsc 报错 |

## 1. 变更清单

### 新增文件
1. **`src/render/components/AIAgent/AIPanelHome.tsx`** — 主界面 home 视图。
2. **`src/render/components/AIAgent/AIPanelSession.tsx`** — 会话视图（消息流 + composer，拆自 AgentTab）。
3. **`src/render/components/AIAgent/AIPanelSettings.tsx`** — 设置视图容器（左栏 3 子项 + 右内容区）。
4. **`src/render/components/AIAgent/settings/ModelForm.tsx`** — 从 SettingsModal 迁出的 AI 设置表单 + 模型下拉。
5. **`src/render/components/AIAgent/settings/SkillsPanel.tsx`** — skills 只读列表面板。
6. **`src/render/components/AIAgent/settings/McpPanel.tsx`** — MCP 占位面板（延期说明）。
7. **`src/render/components/AIAgent/ModelDropdown.tsx`** — composer 底部模型选择下拉（R18/R19）。
8. **`src/render/components/AIAgent/AIPanelComposer.tsx`** — 共享 composer（模式 + 模型下拉 + textarea + 发送/停止；handleSendAgent 原样保留于此层一份）。
9. **`src/main/ai/modelList.ts`** — `listModelsForUser(userId)` 纯函数 + `normalizeModels(backend, json)`（ollama `/api/tags`、remote `/models`）。

### 修改文件
- **`src/shared/constants.ts`** — `IPC_CHANNELS` 增 `AI_LIST_MODELS: 'ai:list-models'`。
- **`src/shared/ai.ts`** — 复用 `IpcResponse<string[]>`，无需新类型（若需语义可加 `AiModelsResult`）。
- **`src/main/preload.ts`** — `WeaveMDApi['ai']` 增 `listModels`；实现 `ipcRenderer.invoke(AI_LIST_MODELS, userId)`。
- **`src/main/ai/ipc.ts`** — 注册 `ipcMain.handle(AI_LIST_MODELS, ...)` 委托 `listModelsForUser`；失败 `{success:false}`（不阻断）。
- **`src/render/stores/agentStore.ts`** — `sendMessage`/`sendAgentMessage` 建会话成功后追加首条 summary 写入（截断 50 字符）。
- **`src/render/stores/uiStore.ts`** — `aiPanelWidth` 默认改 `480`（初始值 + loadSettings 兜底两处）。
- **`src/render/stores/rewriteStore.ts`** — 新增 `dismissRewriteBanner()`（仅清 `staleRejected`/`rewriteError`，保留 `pendingRewrite`）。
- **`src/render/components/AIAgent/AIAgentPanel.tsx`** — 重构为三视图容器 + 顶部栏 + 拖拽把手 + ConsentOverlay 保留；移除原模式下拉头部。
- **`src/render/components/AIAgent/AgentTab.tsx`** — 瘦身为消息流展示区（含 RewritePreviewCard/ToolCallTrace/IntentCard），**handleSendAgent 分流逻辑移交 AIPanelComposer 且原样保留**。
- **`src/render/components/AIAgent/RewritePreviewCard.tsx`** — 无提案各提示条末尾增 ✕ dismiss 按钮（R16）。
- **`src/render/components/Settings/SettingsModal.tsx`** — 移除 `ai` Tab 与其全部表单逻辑；保留 system/account。
- **`src/render/utils/weaveMDBridge.ts`** — mock bridge `ai` 域增 `listModels`。
- **`src/render/i18n/zh-CN.json` / `en.json` / `zh-TW.json`** — 新增 i18n 键（§7 清单）。

### 删除文件
- **`src/render/components/AIAgent/ChatTab.tsx`** — 已确认无引用，删除。

## 2. 三视图组件组织

```
AIAgentPanel (外壳：顶部bar + view 切换 + 拖拽 + ConsentOverlay)
 ├─ 顶部 bar（home/session/settings 复用）：
 │   左「WeaveMD」· 右 [+ 新建] [⚙ 设置] [× 关闭 toggleAIPanel]
 ├─ view==='home'    → AIPanelHome
 │     ├─ 大图标 + "What can I do for you?"
 │     ├─ RECENT 区块（最近3会话，updatedAt倒序，点击→loadConversation+进 session）+ View All
 │     └─ AIPanelComposer（发送即建会话并入 session）
 ├─ view==='session' → AIPanelSession
 │     ├─ 当前会话标题 + ×（关闭会话→ newChat + 回 home，R14）
 │     ├─ agent 模式 && 有会话：KnowledgeBaseSettings（R15，原样复用）
 │     ├─ 消息流（RewritePreviewCard/ToolCallTrace/IntentCard/AIMessageBubble）
 │     └─ AIPanelComposer + 模式 + 模型下拉
 └─ view==='settings'→ AIPanelSettings
       ├─ 左侧栏：模型 / skills / MCP（从上至下）
       └─ 右内容：ModelForm / SkillsPanel / McpPanel；返回按钮→回原 view
```

- 视图状态放 `AIAgentPanel` 内部 `useState`（平凡、无需建 store）：`view: 'home'|'session'|'settings'`、`settingsTab: 'model'|'skills'|'mcp'`。
- **composer 抽共享组件 `AIPanelComposer`**：handleSendAgent 分流逻辑一份，杜绝两处重复。
- **决策**：导航栏设置弹窗移除 ai Tab，AI 设置唯一入口为面板内 ⚙。

## 3. 新增 IPC：`ai.listModels`

- 通道：`IPC_CHANNELS.AI_LIST_MODELS = 'ai:list-models'`。
- 返回：`IpcResponse<string[]>`。
- `modelList.ts`：
  - ollama → `GET {ollamaBaseUrl}/api/tags` → `models[].name`；
  - remote → `GET {remoteBaseUrl}/models`（`Authorization: Bearer <decryptApiKey>`，key 不落渲染）→ `data[].id`；
  - 超时 `AbortSignal.timeout(8000)`；失败/非 200/无 key → `[]`（不抛不阻断）。
  - `normalizeModels(backend, json)` 顶层导出纯函数，可单测。
- preload + mock bridge 同步暴露。

## 4. 会话标题（R20/R21）

- 插入点：`agentStore.sendMessage`/`sendAgentMessage` 建会话成功分支后：
  ```ts
  const firstMsg = trimmed.slice(0, 50);
  await ai.updateConversationSummary(conversationId, userId, firstMsg);
  await get().loadConversations(activeMode);
  ```
- 兜底：标题沿用 `c.summary || t(activeMode)`（现有已实现）。

## 5. RewritePreviewCard 关闭（R16）

- rewriteStore 新增 `dismissRewriteBanner()`：仅清 `staleRejected`/`rewriteError`，保留 `pendingRewrite`。
- RewritePreviewCard 无提案各提示条末尾渲染 ✕，`onClick={() => dismissRewriteBanner()}`。

## 6. 模型下拉（R18/R19）

- `ModelDropdown`：挂载拉取 `ai.listModels`；选中 → `setConfig({ model })` 持久化；失败/空降级「当前配置 model + 手动输入」。
- composer 底部左→右：模式下拉（chat/agent）+ 模型下拉。

## 7. i18n 新增键（zh-CN/en/zh-TW 三处同步）

`ai.home.cta`、`ai.home.recent`、`ai.home.viewAll`、`ai.home.noRecent`、`ai.session.close`、`ai.settings.model`、`ai.settings.skills`、`ai.settings.mcp`、`ai.settings.mcpDeferred`、`ai.modelDropdown.label`、`ai.modelDropdown.loadFailed`。其余表单键沿用既有 `ai.settings.*`。

## 8. 测试计划

### 单元（Vitest）
- `tests/main/ai/modelList.test.ts`：ollama/remote 解析、无 key→[]、fetch 失败→[]、`normalizeModels` 半包。
- `tests/stores/agentStore.test.ts`：首条消息后 `updateConversationSummary` 调用与参数。
- `tests/stores/uiStore.test.ts`：`aiPanelWidth` 默认 480、clamp 260~520。
- 组件测试：AIPanelHome（RECENT 最近3/空态）、AIPanelSettings（三 tab 切换）、RewritePreviewCard（dismiss 清 error）、ModelDropdown（拉取/降级）。

### E2E（Playwright，`e2e/`）
- 回归现有 `ai-agent-panel.spec.ts`。
- 新用例：默认 home；+ 建会话进 session；首条消息→标题=首条问题+RECENT 显示；点击最近会话进 session；标题行 × 关闭回 home；⚙ 三 tab 切换 + ModelForm 保存；composer 模型下拉列出/选中持久化；agent 模式显示 KB 导入 chat 不显示；改写失败条 × 可关闭。

## 9. 风险与验收

| 风险 | 缓解 |
|---|---|
| AgentTab 拆分引入 handleSendAgent 回归 | 分流函数原样拷入 AIPanelComposer；ai-agent-panel.spec 全量回归 |
| 会话创建双路径标题重复覆盖 | summary 仅存 store 首条用户消息文本（定值），幂等无副作用 |
| ai.listModels 依赖 key 解密 | 复用 `decryptApiKey`，key 绝不入渲染；失败静默空数组 |
| 默认宽 320→480 影响窄屏 | clamp 260~520 不变，用户可拖回 |
| SettingsModal ai Tab 迁出漏字段 | ModelForm 逐字段对照原 SettingsModal ai Tab 手工核对 |

验收对照 R1~R21 见需求文档；全量门禁 tsc 0 + vitest 全绿 + lint 0 + vite build + Playwright 全绿。

## 10. 实现顺序（依赖）

- **A 基础设施**：constants+shared → modelList+ipc+preload+mock → 测试 → agentStore 首条标题 → 测试。
- **B 三视图骨架**：uiStore 默认宽 480 → AIPanel 外壳 + AIPanelHome/Session/Settings 空壳 → AIPanelComposer 抽取。
- **C 设置内容**：ModelForm 迁入 + SettingsModal 移除 ai Tab → SkillsPanel + McpPanel。
- **D 打磨**：RewritePreviewCard dismiss → i18n → 删除 ChatTab。
- **E 门禁**：全量 tsc/vitest/lint/build/Playwright + 新增 E2E。

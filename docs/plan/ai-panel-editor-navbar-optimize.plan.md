# AI面板+编辑主区+导航栏优化 — 实施计划

> 任务 slug: `ai-panel-editor-navbar-optimize`
> 创建时间: 2026-08-23
> 分级: **L级**（跨模块、TDD strict）
> 需求文档: `docs/requirements/ai-panel-editor-navbar-optimize.req.md`

---

## 变更清单总览

| 模块 | 文件 | 变更类型 | 风险 |
|------|------|----------|------|
| FloatingToolbar | `src/render/components/Editor/v2/FloatingToolbar.tsx` | 删除AI改写按钮 | LOW |
| MainPage | `src/render/pages/MainPage.tsx` | 侧栏固定宽度 | LOW |
| uiStore | `src/render/stores/uiStore.ts` | 删除outlineWidth、新增editorCollapse | LOW |
| TopBar | `src/render/components/Navbar/TopBar.tsx` | 布局重构 | MEDIUM |
| CreatePanel | `src/render/components/Navbar/CreatePanel.tsx` | **新增** | MEDIUM |
| FileMenu | `src/render/components/Navbar/FileMenu.tsx` | 触发方式修改 | LOW |
| agentStore | `src/render/stores/agentStore.ts` | 删除chat模式、消息增强 | HIGH |
| AIMessageBubble | `src/render/components/AIAgent/AIMessageBubble.tsx` | 操作栏+响应时间 | MEDIUM |
| AgentTab | `src/render/components/AIAgent/AgentTab.tsx` | 状态展示+回调 | MEDIUM |
| AIPanelComposer | `src/render/components/AIAgent/AIPanelComposer.tsx` | 重构composer | MEDIUM |
| ToolCallTrace | `src/render/components/AIAgent/ToolCallTrace.tsx` | 增强展示 | LOW |
| RewritePreviewCard | `src/render/components/AIAgent/RewritePreviewCard.tsx` | 多文件修订 | HIGH |
| RewriteDetailModal | `src/render/components/AIAgent/RewriteDetailModal.tsx` | **新增** | MEDIUM |
| FileOpPreviewCard | `src/render/components/AIAgent/FileOpPreviewCard.tsx` | **新增** | MEDIUM |
| IntentCard | `src/render/components/AIAgent/IntentCard.tsx` | 文件路径输入 | LOW |
| AIPanelSession | `src/render/components/AIAgent/AIPanelSession.tsx` | 删除KB开关 | LOW |
| AIPanelSettings | `src/render/components/AIAgent/AIPanelSettings.tsx` | 新增tabs | LOW |
| EmbeddingSettings | `src/render/components/AIAgent/settings/EmbeddingSettings.tsx` | **新增** | MEDIUM |
| SearchSettings | `src/render/components/AIAgent/settings/SearchSettings.tsx` | **新增** | MEDIUM |
| rewriteStore | `src/render/stores/rewriteStore.ts` | 多文件修订状态 | HIGH |
| shared/ai.ts | `src/shared/ai.ts` | 类型扩展 | LOW |
| shared/constants.ts | `src/shared/constants.ts` | 新增IPC通道 | LOW |
| db/ai.ts | `src/main/db/ai.ts` | 表扩展 | MEDIUM |
| db/index.ts | `src/main/db/index.ts` | 迁移SQL | MEDIUM |
| agentLoop.ts | `src/main/ai/agentLoop.ts` | 状态事件+响应时间 | MEDIUM |
| toolRegistry.ts | `src/main/ai/toolRegistry.ts` | 新增工具 | HIGH |
| embeddingClient.ts | `src/main/ai/embeddingClient.ts` | **新增** | MEDIUM |
| searchClient.ts | `src/main/ai/searchClient.ts` | **新增** | MEDIUM |
| embeddingHandlers.ts | `src/main/ai/ipc/embeddingHandlers.ts` | **新增** | MEDIUM |
| searchHandlers.ts | `src/main/ai/ipc/searchHandlers.ts` | **新增** | MEDIUM |
| chatHandlers.ts | `src/main/ai/ipc/chatHandlers.ts` | 废弃/删除 | LOW |
| i18n zh-CN/en | `src/render/i18n/locales/*.ts` | 新增翻译键 | LOW |

---

## 实施阶段

### Phase 1：无依赖，可并行（LOW风险）

#### Module 1：浮动工具栏删除AI改写（REQ-EDIT-AI）

**文件**: `src/render/components/Editor/v2/FloatingToolbar.tsx`

**变更**:
- 删除 `handleRewriteClick` 回调及其依赖（useEditorStore/useRewriteStore）
- 删除非混合选区下的AI改写 `ToolbarButton`
- 删除混合选区下的"跨块选区"提示和AI改写按钮
- 删除AI改写前的 `ft-divider`
- 清理未使用的 imports

**验收**: 工具栏无AI改写按钮，其他功能完整，typecheck通过

#### Module 2：目录区侧栏固定宽度（REQ-EDIT-SIDEBAR）

**文件**: `src/render/pages/MainPage.tsx`, `src/render/stores/uiStore.ts`

**变更**:
- MainPage: 删除 `isDraggingOutline` 状态、`handleOutlineDragStart`、拖拽手柄div
- MainPage: 侧栏宽度改为固定 `style={{ width: '20%' }}`
- uiStore: 删除 `outlineWidth`/`setOutlineWidth` 及其持久化

**验收**: 侧栏固定20%宽度，不可拖拽，可收缩，typecheck通过

#### Module 14：i18n翻译键

**文件**: `src/render/i18n/locales/zh-CN.ts`, `src/render/i18n/locales/en.ts`

**新增键**: ai.msg.*, ai.status.*, ai.composer.*, ai.settings.*, ai.embedding.*, ai.search.*, ai.rewrite.*, ai.fileOp.*, navbar.*, create.*

---

### Phase 2：基础层（MEDIUM~HIGH风险）

#### Module 5：删除Chat模式（REQ-AI-MODE）⚠️ HIGH风险

**文件**: agentStore.ts, shared/ai.ts, AIPanelComposer.tsx, AIPanelSession.tsx, chatHandlers.ts

**变更**:
1. `shared/ai.ts`: `ConversationMode = 'agent'`（删除 `'chat'`）
2. `agentStore.ts`: 删除 `activeTab`/`toggleTab`，`activeMode` 默认 `'agent'`，删除 `sendMessage`，init时删除chat会话
3. `AIPanelComposer.tsx`: 删除模式下拉，始终走 `handleSendAgent`
4. `AIPanelSession.tsx`: 删除 `isAgentMode` 条件判断
5. `chatHandlers.ts`: 标记废弃或删除

**验收**: 无模式选择器，所有会话为agent模式，agent消息正常，typecheck通过

#### Module 3：导航栏布局重构（REQ-NAV-LAYOUT）

**文件**: TopBar.tsx, uiStore.ts

**变更**:
1. TopBar: 删除账号badge，左侧新增"收起编辑器"和"收起AI面板"按钮
2. TopBar: 从右侧删除AI面板切换按钮
3. uiStore: 新增 `isEditorCollapsed`/`toggleEditorCollapse`

**验收**: 无账号显示，编辑器/AI面板切换在左侧，菜单正常，typecheck通过

#### Module 6.1-6.2：响应时间后端

**文件**: shared/ai.ts, db/ai.ts, db/index.ts, agentLoop.ts

**变更**:
1. `IAIMessage` 新增 `responseTime?: number`
2. `ai_messages` 表新增 `response_time` 列
3. agentLoop记录 startTime，done时计算 responseTime

---

### Phase 3：依赖Phase 2（MEDIUM风险）

#### Module 4：新建文件/文件夹面板（REQ-NAV-CREATE）

**新增**: `src/render/components/Navbar/CreatePanel.tsx`
**修改**: FileMenu.tsx, TopBar.tsx

**设计**: 居中面板，存储位置（默认根目录+浏览）+ 名称输入 + .md后缀 + 确认/取消

#### Module 6.3-6.4：消息操作栏（REQ-AI-MSG）

**文件**: AIMessageBubble.tsx, AgentTab.tsx

**设计**:
- 用户消息hover: 复制+编辑（右对齐），响应时间（左）
- AI消息hover: 复制+重试（左对齐），响应时间（右）
- 编辑: 内联编辑模式，修改后重发
- 重试: 用前一条用户消息重新发送

#### Module 7：AI处理流程状态展示（REQ-AI-STATUS）

**文件**: shared/ai.ts, agentLoop.ts, AgentTab.tsx, ToolCallTrace.tsx

**新增状态类型**: thinking/tool_calling/generating_cards/waiting_input/reading_file/user_answered/generating_rewrite/batch_processed

**ToolCallTrace增强**: 可折叠链、每步耗时、状态badge

#### Module 8：Composer重构（REQ-AI-MODE）

**文件**: AIPanelComposer.tsx

**变更**:
- 删除模式下拉
- 新增: 上传文件(📎)、上传图片(🖼)、自动/手动应用开关、联网搜索按钮
- 模型选择移到发送按钮旁边
- 上下文圆环缩小

#### Module 10：知识库设置重构（REQ-AI-KB）

**新增**: EmbeddingSettings.tsx, SearchSettings.tsx
**修改**: AIPanelSettings.tsx, AIPanelSession.tsx, agentStore.ts, db/ai.ts, db/index.ts

**Embedding配置**: Provider/模型名/API Key/Base URL/多模态开关/测试/保存
**搜索配置**: 总开关 + SegmentedTabs选服务商 + 独立配置
**删除**: KB开关（统一自动索引）

---

### Phase 4：依赖Phase 3（MEDIUM~HIGH风险）

#### Module 9：多文件修订预览（REQ-AI-STATUS）⚠️ HIGH风险

**文件**: rewriteStore.ts, RewritePreviewCard.tsx
**新增**: RewriteDetailModal.tsx

**设计**: 汇总卡片(N个文件修订) + 查看详情弹窗(左文件列表+右diff+应用/废弃)

#### Module 11：Embedding客户端

**新增**: embeddingClient.ts, embeddingHandlers.ts
**修改**: shared/constants.ts, ipc/index.ts

#### Module 12：搜索客户端

**新增**: searchClient.ts, searchHandlers.ts
**修改**: toolRegistry.ts, agentLoop.ts, shared/constants.ts, ipc/index.ts

**四个引擎**: Firecrawl(搜索+抓取)、Tavily(Agent友好)、Exa(语义搜索)、智谱(chat集成)

#### Module 13：AI文件操作工具（REQ-AI-FILE）⚠️ HIGH风险

**修改**: toolRegistry.ts, agentStore.ts, IntentCard.tsx
**新增**: FileOpPreviewCard.tsx

**铁律一**: createFile/createFolder 仅产proposal，用户确认后才落盘

---

### Phase 5：集成测试

- `npm run typecheck` — 0 error
- `npm run test` — 全部通过
- `npm run lint` — 0 error
- `npm run build` — 成功
- `npx playwright test` — 全部通过

---

## 风险矩阵

| 风险 | 模块 | 缓解措施 |
|------|------|----------|
| HIGH | 5.x Chat删除 | 保留IPC handler为deprecated stub，渐进删除 |
| HIGH | 9.x 多文件修订 | 独立状态管理，不影响现有单文件流程 |
| HIGH | 13.x 文件操作 | 严格遵循铁律一，仅产proposal |
| MEDIUM | 3.x/4.x 导航栏 | 模块化实现，独立可测 |
| MEDIUM | 6.x/7.x/8.x AI面板 | 逐步增强，每步可验证 |
| MEDIUM | 10.x/11.x/12.x 后端 | 新增模块，不影响现有功能 |
| LOW | 1.x/2.x/14.x 编辑器 | 简单删除和配置变更 |

# ai-redesign-m3-ui — 三视图 UI 重构 + 设置侧栏 + i18n（渲染侧）

角色：fullstack-detail-dev | TDD standard | 分支 feat/ai-agent-ph3-ph4 | 需求 R1~R15（依赖 M1 listModels + M2 store 已就绪）

## 范围

**重构 AI 面板为三视图**（view 状态放 AIAgentPanel 内部 useState）：
- `src/render/components/AIAgent/AIAgentPanel.tsx`：外壳改造——顶部栏（左「WeaveMD」，右 [+ 新建会话] [⚙ 设置] [× 关闭 toggleAIPanel]）+ view 切换 + 保留左侧反向拖拽把手 + ConsentOverlay；移除原「标题+模式下拉」头部
- **`AIPanelHome.tsx`（新）**：居中大图标 + "What can I do for you?" + RECENT 区块（左标题 / 右 View All>）+ 最近 3 会话列表（updatedAt 倒序，标题=summary 或模式兜底，日期=月/日）+ 空态 + 底部 AIPanelComposer
- **`AIPanelSession.tsx`（新）**：当前会话标题行（最右 ×=关闭会话→newChat+回 home）+ agent 模式显示 KnowledgeBaseSettings（原样复用）+ 消息流（RewritePreviewCard/ToolCallTrace/IntentCard/AIMessageBubble/流式）+ 底部 AIPanelComposer
- **`AIPanelComposer.tsx`（新）**：共享 composer——模式下拉（chat/agent）+ ModelDropdown（模型）+ textarea + 发送/停止 + CompletionMenu（`/` `@` 补全）；**handleSendAgent 分流逻辑从 AgentTab 原样移入**（选区改写/`/技能`/`@文档`/`@知识库`/整篇写/纯 agent）
- `AgentTab.tsx`：瘦身为消息流展示区（或并入 AIPanelSession），handleSendAgent 移交 composer 后不再重复
- **`ModelDropdown.tsx`（新）**：挂载拉取 `ai.listModels`；选中 → `setConfig({ model })` 持久化；失败/空降级「当前配置 model + 手动输入」
- **`AIPanelSettings.tsx`（新）**：左侧栏 模型/skills/MCP 三选项（从上至下）+ 右内容区 + 返回按钮
- **`settings/ModelForm.tsx`（新）**：从 `SettingsModal` ai Tab **整体迁入**（后端选择/ollama地址/remote地址/模型ID/API密钥 hasApiKey/同意开关 allowNetwork+allowSend/KB检索参数 topK/fuse/threshold/pinnedWeight/embedding host+model）；保存复用 setConfig/setConsent/setKbSettings
- **`settings/SkillsPanel.tsx`（新）**：只读列出技能（`ai.listSkills`：名称+描述）
- **`settings/McpPanel.tsx`（新）**：占位页注明「真 MCP server 管理已延期」
- `src/render/components/Settings/SettingsModal.tsx`：**移除 ai Tab** 与其全部表单 state/useEffect/TABS 条目；保留 system/account
- `src/render/components/AIAgent/ChatTab.tsx`：**删除**（已确认无引用）
- i18n 三语言同步：`zh-CN.json`/`en.json`/`zh-TW.json` 新增 `ai.home.*`（cta/recent/viewAll/noRecent）、`ai.session.close`、`ai.settings.model/skills/mcp`、`ai.settings.mcpDeferred`、`ai.modelDropdown.label/loadFailed`；其余表单键沿用既有 `ai.settings.*`
- 测试：`tests/components/AIAgent/AIPanelHome.test.tsx`（RECENT 最近3/空态/点击进会话）、`AIPanelSettings.test.tsx`（三 tab 切换 + ModelForm 保存调 setConfig）、`ModelDropdown.test.tsx`（拉取/降级）、`AIPanelSession.test.tsx`（标题行 + × 关闭 + agent 模式 KB 显示）

## 关键实现点

- **handleSendAgent 分流逻辑逐字保留**（不得改写协议），仅换宿主
- KnowledgeBaseSettings 原样复用不改造
- ModelForm 逐字段对照原 SettingsModal ai Tab 迁移，保存行为与现状一致
- composer 在 home 发送后自动建会话并入 session 视图
- 视图切换：home/session/settings 互跳；settings 返回回原视图；home/session 顶部栏共用
- i18n 三语言必须同步，缺键会导致 t() 回退
- 铁律：AI 无直接落盘（写路径仍走预览确认）；无 dangerouslySetInnerHTML；无 any

## 门禁

- `npm run typecheck` 0 error | 相关 vitest 全绿 | `npm run lint` 0 error（本模块文件）| `npx vite build` 通过
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}

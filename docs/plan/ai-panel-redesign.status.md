# ai-panel-redesign — 进度/分级状态

> 更新：2026-08-16 | 任务 slug：`ai-panel-redesign`
> 工作流：/devflow-core

## 阶段 0 — 任务分级与分类

**请求类型**：功能开发（界面调整/重构）。用户声明「已完成的功能可复用，只需调整位置」，但实际含**新增 UI 状态**（AI 主界面 home/RECENT、设置侧栏、会话标题栏、关闭按钮）与**潜在新增 IPC**（模型下拉列表），故定为功能重构而非纯位置调整。

**跨模块判断**：**跨模块**。
- 渲染侧：AIAgentPanel / AgentTab / SettingsModal（AI 设置迁出）重构；
- 主进程侧：可能新增 `ai.listModels` IPC（ollama /api/tags + remote /models）、skills/MCP 配置读取；
- 数据语义：会话标题=第一个问题（复用 updateConversationSummary IPC）。

**定档**：**L**（跨模块、涉及多文件重构、可能新 IPC、涉 Agent/Skill/MCP 配置域）。

**裁剪决定**：
- 阶段 1 需求对齐：一次 AskUserQuestion 对齐 4 个关键决策（面板形态 / MCP·Skills 配置范围 / 模型下拉数据源 / 会话标题实现）；
- 阶段 2 规划：Plan 智能体，M/L 级技术调研按需；
- 阶段 3~5：并行派发项目级智能体，TDD strict；
- 阶段 6~8：全量门禁 + 合规 + 交付核对全走。

## 需求来源（用户原始输入）

见 `/devflow-core` ARGUMENTS（三部分：AI 主界面 / 齿轮设置 / 会话视图），已存档于本任务。

## 阶段 1 — 需求对齐（AskUserQuestion 已确认）

| 决策点 | 结论 |
| --- | --- |
| 面板形态 | 仍为右侧 dock，默认宽加大到 ~480px（可拖 260~520），内部重排 |
| 设置范围 | 最小：模型模块=现有 AI 设置表单整体迁入；skills=只读列出（listSkills IPC）；MCP=占位注明延期 |
| 模型下拉数据源 | 新增 `ai.listModels` IPC（ollama /api/tags；remote /models，key 在主进程） |
| 会话标题 | 首条消息写入 summary（复用 updateConversationSummary IPC，无迁移） |

需求文档：`docs/requirements/ai-panel-redesign.req.md`

## 阶段 3~5 — 实现进度

### M1（infra，已交付）：`ai.listModels` IPC
- `src/shared/constants.ts` `AI_LIST_MODELS`；`src/main/ai/modelList.ts`（`listModelsForUser` 纯函数 + `normalizeModels`）；`src/main/ai/ipc.ts` 注册 handler；preload `WeaveMDApi.ai.listModels`；mock bridge 就绪；`tests/main/ai/modelList.test.ts` 覆盖 ollama/remote/无 key/失败。

### M2（stores，已交付）：首条标题 + uiStore 宽 480 + rewrite dismiss + R16
- `agentStore.sendMessage/sendAgentMessage` 建会话成功追加首条 summary（截断 50 字符，复用 `updateConversationSummary`，R20/R21）。
- `uiStore.aiPanelWidth` 默认 480（初始 + loadSettings 兜底两处），clamp 260~520 不变。
- `rewriteStore.dismissRewriteBanner()`（仅清 staleRejected/rewriteError）。
- `RewritePreviewCard` 无提案各提示条末尾 ✕ dismiss（R16）。

### M3（UI 重构，本次交付）：三视图 + 设置侧栏 + i18n
- `AIAgentPanel.tsx` 外壳：顶部栏（WeaveMD / + / ⚙ / ×）+ view 切换（home/session/settings）+ 保留反向拖拽把手 + ConsentOverlay。
- 新增 `AIPanelHome.tsx`（大图标 + CTA + RECENT 最近3 倒序 + 日期月/日 + 空态 + composer）、`AIPanelSession.tsx`（标题行 × 关闭 + agent 模式 KnowledgeBaseSettings + 消息流 + composer）、`AIPanelSettings.tsx`（左栏 模型/skills/MCP + 右内容 + 返回）、`AIPanelComposer.tsx`（共享 composer，**handleSendAgent 分流逐字保留** + 模式下拉 + ModelDropdown + textarea + 发送/停止 + CompletionMenu）、`ModelDropdown.tsx`（listModels 拉取/降级手动）、`settings/ModelForm.tsx`（迁自 SettingsModal ai Tab，保存行为 setConfig/setConsent/setKbSettings 一致）、`settings/SkillsPanel.tsx`（只读列出）、`settings/McpPanel.tsx`（延期占位）。
- `AgentTab.tsx` 精瘦为消息流展示区（RewritePreviewCard/ToolCallTrace/IntentCard/AIMessageBubble/流式/previewWrite），handleSendAgent 移交 composer。
- `SettingsModal.tsx` 移除 ai Tab（保留 system/account）；`ChatTab.tsx` 与其测试删除。
- i18n 三语言同步新增 `ai.home.* / ai.session.close / ai.settings.tab.* / ai.settings.mcpDeferred / ai.modelDropdown.*`。

**M3 + 阶段6 E2E 门禁（本次全验）**：`npm run typecheck` 0 | vitest 1371 全绿（98 文件）| `npm run lint` 0（8 既有 warning）| `npx vite build` 通过 | Playwright **102 passed / 5 failed（5 全为存量已知 drag-selection-markers DSG-R1/R2a/R2b/R3/P「当前 RED」）**，其中 `ai-agent-panel.spec.ts` 31/31 全绿（含 6 个新增三视图用例）。

### 阶段 6 — 全量质量门禁（orchestrator 复核）

| 门禁 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 error |
| `npx vitest run` | 98 文件 / **1371 passed**（新增 modelList 15 + 三视图组件 11 + ModelForm 2 + store 用例等） |
| `npm run lint` | 0 error（8 条存量 warning：useContentSync/useEditorActions，非本任务） |
| `npx vite build` | ✓（renderer + main + preload） |
| `npx playwright test` | **102 passed / 5 failed**（5 个均为存量已知 drag-selection-markers DSG-R1/R2a/R2b/R3/P「当前 RED」，历史多期一致）；`ai-agent-panel.spec.ts` **31/31 全绿**（含 6 新增三视图用例） |

### 阶段 7 — 合规核对

- **代码 vs 需求 R1~R21**：逐条满足（home 三视图/RECENT 最近3/设置侧栏三模块/会话标题×/agent KB 复用/改写失败条×/模型下拉 listModels/首条消息写 summary）。
- **代码 vs 规范**：无 `any`；无 `dangerouslySetInnerHTML`（assistant 走 MarkdownMessage 安全渲染）；无硬编码密钥（remote `/models` 的 Bearer 来自主进程 `decryptApiKey`，key 不落渲染）；SQL 无关；IPC 均 userId 隔离。
- **测试纪律**：未删除有效测试——`ChatTab.test`（ChatTab 已删）与 `SettingsModal.ai.test` 迁至 `settings/ModelForm.test.tsx`，断言保留；其余测试更新而非删除。
- **计划外改动**：`AIAgentPanel` 增加「改写自动切 session 视图」effect（E2E 暴露：改写预览/状态条仅 session 渲染），已在 status 记录并注释定位。

### 阶段 8 — 交付核对

**变更清单核对**（对照 plan §1）：26 个已跟踪文件改动 + 新组件全部在计划内。
- 新增：modelList.ts / AIPanelHome / AIPanelSession / AIPanelSettings / AIPanelComposer / ModelDropdown / settings/{ModelForm,SkillsPanel,McpPanel} + 各自测试 + agent 定义（.claude/agents/ai-redesign-m{1,2,3}）。
- 修改：constants / preload / ipc / weaveMDBridge / agentStore / uiStore / rewriteStore / AIAgentPanel / AgentTab / RewritePreviewCard / SettingsModal / i18n×3 + 测试。
- 删除：ChatTab.tsx + ChatTab.test.tsx。

**剩余风险**：
- **R1**：`AIAgentPanel` 改写自动切 session 的 effect 是新增行为；若未来把预览卡移到 home，需同步移除（文件内已注释定位）。
- **R2**：会话标题=首条消息（R20）导致标题文本与首条气泡文本重复——E2E 已用 `session-title` testid 规避；未来用例注意。
- **R3**：存量 5 个 drag-selection-markers E2E 已知 RED（历史多期一致，未触碰）。
- **R4**：MCP 模块为占位（真 MCP 管理已延期）；skills 只读（启停/编辑不在范围）。

**遗留任务（交付后核对发现）**：
- **G1（需求 R4 未完全满足）**：home「View All >」目前点击仅 `setView('session')`（切到当前会话视图），**未展示「全部会话列表」**。需求要求"可点开全部会话列表视图"。需新增全量会话列表视图（home 全列或独立 view），AIPanelHome.tsx 注释已注明意图。req 范围外仅排除分页，全部列出应在范围内。
- **G2**：改动尚未提交（等用户授权）。

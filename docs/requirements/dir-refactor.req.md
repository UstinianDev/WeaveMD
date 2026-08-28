# 目录重构需求文档

## 目标

严格不改变任何模块功能的前提下，整理目录结构，将 `src/main/ai/` 和 `src/render/components/AIAgent/` 两个大平层目录按功能分类到子文件夹。

## 范围

### 1. `src/main/ai/`（60+ 文件平层 → 6 子目录）

**现状**：所有文件平铺在 `ai/` 下，只有 `ipc/` 和 `tools/` 已有子目录。

**目标**：
```
src/main/ai/
├── agent/          ← agentLoop, agentSession, agentTaskQueue, agentTaskWorker,
│                      agentCheckpoint, agentSnapshot, agentEventStore,
│                      agentLoopGuard, agentExecutionSegments, agentChangeSets,
│                      agentToolPolicy, agentResourceContext, agentMedia
├── llm/            ← streamScaffold, llmClient, anthropicClient, anthropicCompat,
│                      llmConfigs, llmBudget, modelCatalog, modelList, modelDiscovery
├── knowledge/      ← embeddingClient, kbIndexer, imageIndexer, kbSearch, tokenizer,
│                      knowledgeContext, knowledgeRuntime, knowledgeClarify,
│                      queryPlanner, knowledgeHelperCache
├── skills/         ← skillLoader, skillManager, skillInstaller
├── files/          ← fileRevisions, fileRevisionDiff, fileSystemPatches,
│                      workspaceDocuments, globalAgentFiles, documentParser,
│                      conversationExport
├── image/          ← imageStorage, imageRecognition
├── ipc/            (已有，不动)
├── tools/          (已有，不动)
├── secureConfig.ts (保留在根：mail/ipc.ts 外部引用)
├── contextManager.ts (保留在根：agentLoop 依赖)
├── intentRouter.ts   (保留在根：agentLoop 依赖)
├── rewrite.ts        (保留在根：ipc/rewriteHandlers 依赖)
├── searchClient.ts   (保留在根：ipc/searchHandlers 依赖)
├── mcpClient.ts      (保留在根：独立模块)
├── toolRegistry.ts   (保留在根：agentLoop 依赖)
├── toolTypes.ts      (保留在根：toolRegistry 依赖)
└── ipc.ts            (保留在根：re-export shim)
```

**约束**：
- `ipc/` 和 `tools/` 不动
- `secureConfig.ts` 保留在根（`mail/ipc.ts` 用 `../ai/secureConfig` 引用）
- `ipc.ts` re-export shim 保留在根
- 所有 import 路径必须同步更新

### 2. `src/render/components/AIAgent/`（35+ 文件平层 → 6 子目录）

**现状**：所有组件平铺在 `AIAgent/` 下，只有 `settings/` 已有子目录。

**目标**：
```
src/render/components/AIAgent/
├── panel/          ← AIAgentPanel, AIPanelHome, AIPanelSession, AIPanelSettings, AIPanelComposer
├── message/        ← AIMessageBubble, MarkdownMessage, ToolCallTrace
├── cards/          ← AgentWorkflowCard, EditBlocksPreviewCard, IntentCard,
│                      QuestionCard, RetryPreviewCard, BatchOperationCard,
│                      RewritePreviewCard, RewriteDetailModal, FileRevisionDiffDialog
├── composer/       ← CompletionMenu, MentionList, MentionPreview, ContextRing, ModelDropdown, sendRoutes
├── workflow/       ← AgentWorkspace, AgentControlPanel, ExecutionSegments,
│                      AgentLoopLogList, AgentStepTimeline, ChangeSets
├── knowledge/      ← KnowledgeBaseSettings, ClarifyDrawer
├── settings/       (已有，不动)
└── AgentTab.tsx    (保留在根：核心消息流展示区)
```

**约束**：
- `settings/` 不动
- `AIAgentPanel` 是唯一外部入口（MainPage.tsx 引用）
- `settings/*` 被 UnifiedSettings.tsx 引用，路径不变

### 3. `src/render/components/Editor/v2/`（轻度整理）

**现状**：`v2/` 下有 blocks/ 子目录，但工具栏、图片、表格相关文件混在根目录。

**目标**：
```
src/render/components/Editor/v2/
├── blocks/         (已有，不动)
├── toolbar/        ← FloatingToolbar, ImageToolbar, TableToolbar, TablePicker,
│                      ToolbarButton, toolbarState, modalConstants
├── image/          ← ImageResizeBox, ImageEditTool, imageAnchor, resizeMath
├── EditorV2.tsx    (保留在根：入口)
├── EditorScrollContainer.tsx (保留在根)
├── BlockRenderer.tsx (保留在根)
└── types.ts        (保留在根)
```

## 验收标准

1. `npm run typecheck` — 0 新增错误
2. `npm run test` — 所有测试通过
3. `npm run lint` — 0 error
4. `npm run build` — 构建成功
5. 所有 import 路径已更新，无残留旧路径
6. 无任何功能行为变化

## 不做的事

- 不修改任何业务逻辑
- 不修改任何组件 props/state/事件
- 不删除任何文件
- 不修改 `src/main/db/`、`src/render/stores/`、`src/render/editor/kernel/`、`src/render/editor/controllers/`

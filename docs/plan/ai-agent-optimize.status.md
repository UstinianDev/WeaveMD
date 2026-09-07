# AI Agent 优化 — 实施状态

> 更新时间：2026-09-07

## 已完成项

### Phase 1: P0 Bug 修复 + 提示词优化

| # | 任务 | 状态 | 文件 |
|---|------|------|------|
| 1 | 重试不重置累积状态 | ✅ | `llmClient.ts`（onRetry 回调）、`agentLoop.ts`（重试时清空状态） |
| 2 | 不完整对话历史污染 | ✅ | `agentLoop.ts`（cleanupIncompleteMessages） |
| 3 | 精简系统提示词 | ✅ | `agentLoop.ts`（~40% 缩减） |

### Phase 2: P1 核心性能 + 前端体验

| # | 任务 | 状态 | 文件 |
|---|------|------|------|
| 4 | 减少 LLM 调用轮次 | ✅ | `agentLoop.ts`（maxRounds 12→6） |
| 5 | 动态工具选择 | ✅ 已有 | `toolsForIntent` + `classifyIntent` |
| 6 | 优化重排触发条件 | ✅ | `kbSearch.ts`（条件 4→2，阈值收紧） |
| 7 | editBlocks 并行化 | ✅ | `agentLoop.ts`（加入 READ_ONLY_TOOLS） |
| 8 | 优化写入确认规则 | ✅ | `agentLoop.ts`（系统提示词） |
| 9 | 进度反馈优化 | ✅ | `agentLoop.ts`（sendProgress：thinking 阶段） |
| 10 | 顶部导航栏保存按钮 | ✅ | `TopBar.tsx`（保存按钮 + Ctrl+S） |
| 11 | 切换文档前保存提示 | ✅ | `FileTreePanel.tsx` + `ConfirmDialog.tsx` |
| 12 | 退出应用前保存提示 | ✅ | `App.tsx`（beforeunload） |
| 13 | 增强 editBlocks（preview） | ✅ | `editBlocksHandler.ts` + `toolRegistry.ts` |
| 14 | 添加预览阶段逻辑 | ✅ | `agentLoop.ts`（写工具执行后发送 preview 事件） |
| 15 | 自动保存→手动保存 | ✅ | `MainPage.tsx`（移除 debounce auto-save） |

### Phase 3: P2/P3 优化

| # | 任务 | 状态 | 文件 |
|---|------|------|------|
| 16 | Schema 压缩 | ✅ | `toolRegistry.ts`（8 个描述精简 ~50%） |
| 17 | 上下文窗口动态压缩 | ✅ | `agentLoop.ts`（简单 0.85 / 复杂 0.65） |
| 18 | 知识库搜索缓存 | ✅ 已有 | `kbSearch.ts`（3min TTL，100 条上限） |
| 19 | 优化自动滚动 | ✅ | `AgentTab.tsx`（isAtBottomRef + onScroll） |
| 20 | 批量 IPC 传输 | ✅ | `agentLoop.ts`（100ms chunk 合并） |
| 21 | 异步预加载知识库 | ✅ | `agentLoop.ts`（createPreloadedSearchKb） |
| 22 | StatusBar 移除 isDirty | ✅ | `StatusBar.tsx`（仅保留文件名） |
| 23 | Notus 预览类工具 | ✅ 已有 | preview_file_revision + preview_patch_files + agentLoop 预览机制 |
| 24 | Embedding 架构设计 | ✅ | `docs/plan/embedding-architecture.md` |
| 25 | 索引流程兼容性设计 | ✅ | `docs/plan/indexing-compatibility.md` |
| 26 | list_skills/get_skill_details | ✅ | `skillToolsHandler.ts` + `toolRegistry.ts` |
| 27 | searchMode 搜索模式切换 | ✅ | `kb.ts` + `embeddingConfig.ts` + `kbSearch.ts` + `db/index.ts` |
| 28 | Web Worker JSON.parse | ✅ | `jsonParser.worker.ts` + `useJsonParserWorker.ts` + `AgentWorkflowCard.tsx` |
| 29 | Agentic RAG — 自主检索 | ✅ | `agentLoop.ts`（toolsForIntent 扩展 searchKB 到 rewrite/create/tech/web）、`searchKBHandler.ts`、`toolTypes.ts` |
| 30 | HyDE — 假设性文档检索 | ✅ | `agentLoop.ts`（generateHydeVector）、`searchKBHandler.ts`（hyde 参数）、`toolRegistry.ts`（schema）、`agentTaskWorker.ts` |

## 修改文件清单

| 文件 | 修改类型 |
|------|----------|
| `src/main/ai/llm/llmClient.ts` | onRetry 回调 |
| `src/main/ai/agent/agentLoop.ts` | Bug 修复 + 提示词 + 轮次 + 动态压缩 + 进度 + 预览 + IPC 批量 + KB 预加载 + Agentic RAG + HyDE |
| `src/main/ai/knowledge/kbSearch.ts` | 重排条件优化 + searchMode 切换 |
| `src/main/ai/toolRegistry.ts` | Schema 压缩 + preview 参数 + skill 工具注册 |
| `src/main/ai/tools/editBlocksHandler.ts` | preview 参数 + diff 生成 |
| `src/main/ai/tools/skillToolsHandler.ts` | 新文件：list_skills/get_skill_details handler |
| `src/main/ai/tools/searchKBHandler.ts` | HyDE 支持 + searchMode 参数 |
| `src/main/ai/toolTypes.ts` | SearchKbFn 扩展 + generateHydeVector |
| `src/main/ai/agent/agentTaskWorker.ts` | searchKb wrapper 透传 queryVector/searchMode |
| `src/main/db/embeddingConfig.ts` | searchMode 字段 |
| `src/shared/ai/kb.ts` | IEmbeddingProviderConfig.searchMode |
| `src/render/components/Navbar/TopBar.tsx` | 保存按钮 + Ctrl+S |
| `src/render/components/Editor/panels/FileTreePanel.tsx` | 切换确认对话框 |
| `src/render/components/Common/ConfirmDialog.tsx` | 新组件 |
| `src/render/components/Common/StatusBar.tsx` | 移除 isDirty 指示器 |
| `src/render/components/AIAgent/AgentTab.tsx` | 滚动优化 |
| `src/render/components/AIAgent/cards/AgentWorkflowCard.tsx` | Web Worker JSON.parse |
| `src/render/workers/jsonParser.worker.ts` | 新文件：JSON 解析 Worker |
| `src/render/workers/useJsonParserWorker.ts` | 新文件：Worker Hook |
| `src/render/App.tsx` | beforeunload |
| `src/render/pages/MainPage.tsx` | 移除 auto-save |
| `docs/plan/embedding-architecture.md` | 新文件：Embedding 架构设计 |
| `docs/plan/indexing-compatibility.md` | 新文件：索引流程兼容性设计 |
| `tests/main/ai/agentLoop.test.ts` | 更新期望值 |
| `tests/main/ai/toolRegistry.test.ts` | 更新 editBlocks 测试 |
| `tests/components/TopBar.test.tsx` | 更新快捷键测试 |
| `tests/components/FileTreePanel.test.tsx` | 更新确认对话框测试 |

## 测试证据

- TypeScript: 0 error（源码），3 pre-existing（ipc.test.ts）
- Vitest: 1530/1530 passed，1 pre-existing failure（ipc.test.ts）

## 未完成项

（无，30/30 全部完成）

## 风险

- maxRounds 12→6：简单任务足够，复杂多文件任务可能需用户拆分
- 移除 auto-save：用户需习惯 Ctrl+S 保存，已有保存按钮和切换/退出提示兜底
- beforeunload 在 Electron 中依赖 Chromium 版本
- Agentic RAG：非 kbQa 意图也会提供 searchKB 工具，LLM 可能过度调用（已通过系统提示限制2-3次）
- HyDE：每次 hyde=true 增加一次 LLM round-trip（~1-2s），仅在 LLM 主动传参时触发，不影响常规搜索

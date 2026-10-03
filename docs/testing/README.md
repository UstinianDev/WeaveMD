# 测试报告目录（TDD 证据）

> ## ⚠️ 这些是**交付时点快照**，不是现状
>
> 每篇报告记录的是**该任务交付那一刻**的门禁结论：用例总数、覆盖率、变异结果、提交清单。
> **其中的数字随后续开发已全部过期**（例：报告里写「4784 例全绿」，当前是 4868 例）。
> 引用前先跑一次现状验证，**不要把这些数字当成当前事实**。
>
> 唯一不随时间失效的是：**「为什么存在这条测试」「它钉住哪条契约」「哪些用例做过变异验证」** —— 那才是留它们的理由。

## 这些报告是什么 / 不是什么

| 是 | 不是 |
|---|---|
| 测试**意图**的溯源：某条用例为何存在、钉住哪条行为契约、覆盖哪个边界 | 测试本体 —— 那些在 `tests/**` 与 `e2e/**` |
| 变异验证记录（哪个变异被哪条用例杀掉，衡量**测试强度**） | 可执行脚本 —— 报告是散文，`npm run test` 不读它 |
| 红线/豁免的当场核对记录 | 现状说明 —— 现状看 `docs/specs/` 与代码 |

**要跑测试不需要读这些报告**：`npm run test`（全量 vitest）、`npx playwright test`（E2E）。
只有「这条测试为什么长这样、改动它会不会踩到契约」这类问题才需要回来查。

## 活证据在哪

| 位置 | 内容 |
|------|------|
| `tests/**`（209 个文件） | 单元与集成测试，vitest |
| `e2e/**`（16 个 spec） | Playwright 端到端（**基线恒为 31 failed / 104 passed / 1 skipped**，比对失败集合而非要求全绿） |
| `tests/benchmarks/` | 性能基准（`ai-core-perf.test.ts` 可复现速度对比） |
| `tests/main/ai/aiCorePerfGuards.test.ts` | 缓存一致性与并发栅栏的行为守护边界用例 |

## 索引：报告 ↔ 主要测试文件

> 路径均经过存在性校验；只列每篇报告引用最多的前几个文件，完整清单在报告正文里。

### AI 代理 / 记忆 / 成本

| 报告 | 主要测试文件 |
|---|---|
| `agent-cost-optimize/agent-cost-optimize.tdd.md` | `tests/main/ai/agentPromptBuilder.test.ts` `tests/main/ai/consent.test.ts` `tests/main/ai/costTracker.test.ts` `tests/render/stores/agentStore.test.ts` |
| `agent-memory/agent-memory-optimize.tdd.md` | `tests/main/ai/agentContext.test.ts` `tests/main/ai/agentKbPreloader.test.ts` `tests/render/components/AIAgent/QuestionCard.test.tsx` |
| `agent-memory/agent-memory-optimize-2.tdd.md` | `tests/main/db/agentMemoryDao.test.ts` `tests/main/ai/memoryTools.test.ts` `tests/main/ai/kbSearch.test.ts` |
| `agent-memory/agent-memory-optimize-3.tdd.md` | `tests/main/ai/memoryHandlers.test.ts` `tests/main/ai/agentContext.test.ts` |
| `agent-multi-intent/agent-multi-intent.tdd/01-p0-task1-3.md` | `tests/main/ai/agentLoopSplit.test.ts` `tests/main/ai/clarificationMatrix.test.ts` `tests/main/ai/agentPromptBuilder.test.ts` |
| `agent-multi-intent/agent-multi-intent.tdd/02-p0-task5-11.md` | `tests/main/ai/agentToolExecutor.test.ts` `tests/main/ai/agentLoop.test.ts` |
| `agent-multi-intent/agent-multi-intent.tdd/03-p1-task6-7.md` | `tests/main/db/agentSessionIntentJson.test.ts` `tests/main/ai/chainTracking.test.ts` |
| `agent-multi-intent/agent-multi-intent.tdd/04-p1-task4-9.md` | `tests/main/ai/intentRouterTiered.test.ts` `tests/main/ai/kbIntentBridge.test.ts` |
| `agent-multi-intent/agent-multi-intent.tdd/05-p1-task12-13-8-10.md` | `tests/main/ai/chainReport.test.ts` `tests/main/ai/subtaskParallel.test.ts` `tests/main/ai/subtaskSequence.test.ts` `tests/components/BatchConfirmCard.test.tsx` |
| `agent-multi-intent/agent-multi-intent.tdd/06-fix-2026-10-03.md` | `tests/main/ai/subtaskConfirmResume.test.ts` |
| `agent-kb-ux/agent-kb-ux.tdd.md` | `tests/render/components/AIAgent/AIPanelComposer.test.tsx` `tests/components/FileTreePanel.test.tsx` `tests/styles/agentMessageStreamCss.test.ts` |

### 文档处理流水线

| 报告 | 主要测试文件 |
|---|---|
| `doc-pipeline/doc-pipeline-b1.tdd.md` | `tests/main/ai/documentParser.test.ts` |
| `doc-pipeline/doc-pipeline-b2.tdd.md` | `tests/main/ai/parseLimiter.test.ts` `tests/components/composerPaste.test.ts` |
| `doc-pipeline/doc-pipeline-b3.tdd.md` | `tests/main/db/attachments.test.ts` `tests/main/db/aiDao.test.ts` `tests/components/aiMessageBubbleAttach.test.tsx` |
| `doc-pipeline/doc-pipeline-b4.tdd.md` | `tests/main/ai/kbHandlers.test.ts` `tests/components/knowledgeBaseSettings.test.tsx` |
| `doc-pipeline/doc-pipeline-b5.tdd.md` | `tests/main/ai/kbIndexer.test.ts` `tests/main/ai/vectorBackfill.test.ts` |
| `doc-pipeline/doc-pipeline-b6.tdd.md` | `tests/main/ai/agentMedia.test.ts` `tests/main/ai/agentEventStore.test.ts` |
| `doc-pipeline/doc-pipeline-b7.tdd.md` | `tests/main/ai/documentParser.test.ts` `tests/main/ai/kbHandlers.test.ts` |
| `doc-pipeline/doc-pipeline-b8.tdd.md` | `tests/main/ai/docTools.test.ts` `tests/main/ai/deferredToolLoading.test.ts` `tests/main/ai/concurrencyDefs.test.ts` `tests/main/ai/docPipelineEval.test.ts` |
| `doc-pipeline/doc-pipeline-b9.tdd.md` | `tests/main/ai/mdImageResolver.test.ts` `tests/main/ai/agentPromptBuilder.test.ts` |
| `doc-pipeline/doc-pipeline-b10.tdd.md` | `tests/scripts/sizeGate.test.ts` `tests/components/IconInventory.test.tsx` |
| `doc-pipeline/doc-pipeline-b11.tdd.md` | `tests/main/ai/consent.test.ts` `tests/main/ai/kbHandlers.test.ts` `tests/main/ai/ipc.test.ts` |
| `doc-pipeline/doc-pipeline-remedial.tdd.md` | `tests/main/ai/docTools.test.ts` `tests/main/db/migrations.test.ts` |

### 编辑器 / 浮动工具栏

| 报告 | 主要测试文件 |
|---|---|
| `spec-edit/spec-edit-ft.tdd.md` | `tests/components/FloatingToolbarV2.test.tsx` `tests/components/EditorV2Convert.test.tsx` `tests/editor/kernel/syntaxType.test.ts` |
| `spec-edit/spec-edit-ft2.tdd.md` | `tests/components/EditorV2Format.test.tsx` `tests/styles/ft2Css.test.ts` |
| `spec-edit/spec-edit-ft3.tdd.md` | `tests/components/EditorV2StickyFormat.test.tsx` `tests/components/ContentBlockRestore.test.tsx` `tests/editor/controllers/formatCtrl.test.ts` |
| `spec-edit/spec-edit-ft4.tdd.md` | `tests/editor/kernel/inlineRenderer.test.ts` `tests/editor/kernel/selection.test.ts` |
| `spec-edit/spec-edit-cbtp.tdd.md` | `tests/editor/kernel/codeBlockTrailingParagraph.test.ts` `tests/editor/kernel/markdownRoundTrip.test.ts` |
| `spec-edit/spec-edit-dsf.tdd.md` | `tests/components/useCrossBlockDragSelection.test.ts` |

### 跨任务参考

| 报告 | 用途 |
|---|---|
| `agent-multi-intent/agent-multi-intent.tdd.md` | 上列 6 篇分册的索引页 |

## 已知 flaky（跨任务复用）

`tests/main/ai/cacheMonitor.test.ts` 的 `getStats 10 万次调用 < 50ms` 与
`tests/benchmarks/ab-test.test.ts` 的 djb2/MD5 对比 —— **纯耗时断言，并行负载下必红、单跑必绿**。
并行红时单跑复验，**不要判定为回归、不要改被测代码**。

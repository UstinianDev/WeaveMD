# ai-core-perf — 实施计划（Phase 2）

> 输入：`docs/plan/ai-core-perf.bottleneck.md`（13 项瓶颈）
> 范围裁定：**P0 + P1 + P2 全部 13 项**；外部技术调研跳过（理由见 status）
> 硬约束（全程不变）：**行为不变 — 相同输入 → 相同输出**；仅作性能优化，不改细分功能

## 变更清单（Phase 4 白名单，越界即回滚）

| 瓶颈 | 文件 | 改法 | 风险 |
|------|------|------|------|
| MEM-1 | `src/main/db/agentMemory.ts` | 新增 `closeMemories` 批量关闭（单条 `UPDATE ... WHERE id IN (...)`）；`closeMemory` 保留单条路径不动 | 低 |
| MEM-1 | `src/main/ai/agent/memoryPolicy.ts` | `evictStale` / `mergeConflicts` / `mergeSimilarMemories` / `mergeMemoryGroup` 改走批量关闭 | 中（计数口径） |
| MEM-2 | `src/main/ai/agent/memoryPolicy.ts` | `findSimilarMergeGroups` / `maxPairScore` / `isSimilarGroup` 内 trigram Set 单次扫描记忆化 | 低 |
| MEM-3 | `src/main/db/agentMemory.ts` | `buildMemoryMatchQuery` 结果按文本 memo（单调用域内） | 低 |
| MEM-4 | `src/main/db/agentMemory.ts` | `selectActiveRows` 窄列投影（**去掉 `vector` BLOB / `embedding_model` / `merge_skip` / `last_read_at`**）；`listActiveMemoryAccess` 独立窄查询；`listMergeSkipFlags` 加 `AND merge_skip IS NOT NULL` | 低 |
| INT-1 | `src/main/ai/agent/subtaskOrchestrator.ts` | `BranchInteractionGate.wait` 忙轮询 → 事件驱动栅栏（`leave`/`enter`/`dispose` 触发 `notify`） | 中（并发语义） |
| INT-2 | `src/main/ai/intentTiering.ts` | `cacheKey` sha256 → 无碰撞分隔串（`hasHistory` + `\u0000` + text） | 低 |
| TOOL-1 | `src/main/ai/toolRegistry.ts` | `CORE_TOOLS` 排序结果 + stub 表模块级预构建；`buildToolListForPrompt` 复用预构建 stub | 低 |
| TOOL-1 | `src/main/ai/agent/agentToolSelector.ts` | `toolsForIntent` 按 7 元组键 memo，返回**浅拷贝**（`agentLoop.ts:691` 会原地改写数组元素） | 中（缓存一致性） |
| QUE-1 | `src/main/db/agentTaskDao.ts` | `dequeueNext` / `updateTaskStatus` / `getTaskById` / `getTasksByConversation` 显式列名替代 `SELECT *` | 低 |
| QUE-2 | `src/main/db/agentTaskDao.ts` + `agentTaskQueue.ts` + `memoryWriter.ts` | 新增 `hasPendingTask(db, conversationId)`（`EXISTS ... LIMIT 1`）替代全量拉取后 `.some()` | 低 |
| DOC-1 | `src/main/ai/files/pdfLayout.ts` | `clusterLines` 行 y 区间增量维护（`Math.min(...row.map())` → push 时更新） | 低 |
| DOC-2 | `src/main/ai/files/parseLimiter.ts` | `wakeAll` → `wakeOne`（只唤醒一个等待者，其余在下次释放时继续） | 中（FIFO 语义） |
| DOC-3 | `src/main/ai/tools/searchDocument.ts` | `collectHeadingMarks` 改为**惰性**（首个命中才扫描） | 低 |
| DOC-4 | `src/main/ai/utils/tokenEstimator.ts` + `agentPromptBuilder.ts` | `estimateTokensCached` 加**单条长度上限**后接线到 `estimateContentTokens`；`truncateBlockWithMarker` 保留二分（实测 O(n) 摊销，非热点） | 低 |

**新增文件**：`scripts/perf/bench-ai-core.perf.ts`（性能基准，沿用 `scripts/perf/bench-editor.perf.ts`
既有约定与 `perf-export-editor-outline.req.md`（已归档，见 git 历史） Q6 裁定）。
理由：skill Phase 4/8 硬性要求「修改前后执行速度数据对比表格」，无基准无法出数据。

## 明确不改（防止越界）

- `closeMemory` 单条路径（三处调用方语义依赖「返回是否命中」）
- `memorySimilarityScore` 导出签名（`memorySimilarMerge.test.ts` 直接断言）
- `toolsForIntent` 返回内容与顺序（`agentContext.test.ts:1541` `toEqual(ctx.tools)`）
- `PdfLayoutResult` 全字段（`pdfLayout.test.ts` 逐字断言）
- 线程模型（Worker 化）、DAO 异步化 —— 见瓶颈报告 §四「未纳入本轮」

## 验收标准

1. **速度有提升** —— 基准脚本输出修改前后对比表，P0 各项提升需有数字
2. **行为未变化** —— `npm run test` 全绿（exit 0）
3. **白名单内修改** —— `git status` 无清单外文件
4. **门禁全过** —— `npm run typecheck` + `npm run lint` + `npm run test`

## 执行顺序（高优先级先行）

MEM-4 → MEM-1 → MEM-2 → MEM-3 → DOC-1 → TOOL-1 → INT-1 → QUE-1 → QUE-2 → DOC-3 → DOC-2 → INT-2 → DOC-4

（MEM-4 先行：`SELECT *` 读 `vector` BLOB 是 `runMemoryPolicy` 四连扫的**乘数**，先摘掉它，
后续 MEM-1/2 的收益才可归因。）

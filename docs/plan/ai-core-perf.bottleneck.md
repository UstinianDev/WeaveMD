# ai-core-perf — 瓶颈扫描报告（Phase 0.2）

> 生成：2026-10-03 | 工具：devflow-perf | 扫描范围：
> `src/main/ai/agent/`（多意图识别与执行 / 自动记忆 / 任务队列）、`src/main/ai/tools/`（内置工具）、
> `src/main/ai/files/`（文档解析处理）、`src/main/ai/toolRegistry.ts`、`src/main/db/agentMemory.ts`、
> `src/main/db/agentTaskDao.ts`、`src/main/ai/utils/tokenEstimator.ts`

## 一、任务分级

| 维度 | 判定 | 依据 |
|------|------|------|
| 类型 | 优化类 | 不改功能，只改执行路径（不走 Bug 短路径） |
| 影响面 | **跨模块** | agent 编排 / 记忆 / 队列 / 工具装配 / 文档解析 五处；`runMemoryPolicy` 一条链跨 `tools/memoryWrite` → `agent/memoryPolicy` → `db/agentMemory` → `knowledge/vectorBackfill` |
| 工时 | 多天 | 涉及 ~12 个文件、含跨模块调用链与缓存一致性 |
| **档位** | **L** | 全阶段 + 强制技术调研 + 并行执行 |

**技术栈识别**：Node.js / Electron 主进程（单线程）+ TypeScript strict + better-sqlite3（同步 API）+ FTS5。
规则库加载：`perf-rules-core`（G01–G10）+ `perf-rules-backend`（B01–B11）。前端规则不适用（本批不改渲染层）。

**既有优化基线**：S1–S16（`agent-perf-optimize.req.md`（已归档，见 git 历史））已完成，
本轮报告仅列**本轮新发现**，与 S1–S16 无重叠。

---

## 二、瓶颈清单（按严重程度排序）

### P0 — 主线程同步阻塞 / 复杂度放大

#### MEM-1 · `runMemoryPolicy` 单次调用 = 4 次全量扫描 + N 次单条 UPDATE
- **位置**：`src/main/ai/agent/memoryPolicy.ts:510-528`（编排）、`:125`、`:288`、`:290`、`:89`、`:464`、`:475`
- **规则**：B01（N+1）+ G07（批量操作）+ B05（同步阻塞）
- **触发点**：`src/main/ai/tools/memoryWrite.ts:228` —— **每次 `memory_write` 工具调用同步执行一次**
- **实测结构**：
  - `mergeConflicts` → `queryActiveMemories`（全量 active 行）
  - `mergeSimilarMemories` → `findSimilarMergeGroups` → `queryActiveMemories`（全量）+ `listMergeSkipFlags`（`agentMemory.ts:576` 全表无 WHERE 收窄）
  - `evictStale` → `queryActiveMemories`（全量）
  - `enforceMemoryCapacity` → `listActiveMemoryAccess`（全量）
  - 关闭动作 `closeMemory`（`agentMemory.ts:149`）逐行一次 UPDATE
- **放大因子**：active 行数 N。N=500（`MAX_ACTIVE_MEMORIES` 上限）时 = 4×500 行映射 + 最多 N 次 SQL，
  **全部同步跑在 Electron 主进程**，期间 IPC / 窗口事件排队。
- **方向**：四阶段共享同一份 active 快照；关闭动作合并为单条 `UPDATE ... WHERE id IN (...)`；
  `listMergeSkipFlags` 增 `WHERE merge_skip IS NOT NULL`。
- **风险**：中（策略计数口径 `{evicted, merged}` 必须逐字不变）

#### MEM-2 · `findSimilarMergeGroups` 每行一次 FTS 查询 + trigram Set 反复重建
- **位置**：`src/main/ai/agent/memoryPolicy.ts:316-333`（N+1）、`:200-210`（打分）、`:213-222`、`:225-243`
- **规则**：B01 + G06
- **实测结构**：
  - `for (const row of eligible)` 内 `querySimilarMemoryCandidates`（`agentMemory.ts:545` FTS5 MATCH）→ **N 次 FTS 查询**
  - `memorySimilarityScore(a,b)` 每次调用重建**双方** `memoryTrigrams`（`agentMemory.ts:495`，O(len) 切片 + Set）
  - `maxPairScore` 组内 O(n²) 次比较、`isSimilarGroup` 再次 O(n²) → 同一行的 trigram Set 被重建数十次
- **放大因子**：N × limit(32) 次候选比对 × 每次 O(len) 重建
- **方向**：per-row trigram Set 记忆化（单次扫描内 Map<id, Set>）；候选召回按 subject 分桶去重
- **风险**：低（纯计算，输出集合不变）

#### DOC-1 · `clusterLines` 行聚类 O(n·rows·rowLen) + 每轮临时数组分配
- **位置**：`src/main/ai/files/pdfLayout.ts:166-179`
- **规则**：G03（重排重绘同源：重复计算而非缓存）+ G04（主线程同步计算）
- **实测结构**：
  ```ts
  const placed = rows.find((row) => {
    const r0 = Math.min(...row.map((r) => r.y));        // 每次 find 迭代重建数组
    const r1 = Math.max(...row.map((r) => r.y + r.height));
    ...
  });
  ```
  对每个 item 扫描全部 `rows`，每个候选行内部再 `map` 两次求 min/max。
- **放大因子**：n（页内 textItems 数）。一页版面密集的 PDF 实测 textItems 可达数千 →
  排序后逐项聚类，最坏 O(n²) 级别的 `map` 调用 + 数组分配，**主进程同步阻塞**（无 Worker）。
- **方向**：行 y 区间随 push 增量维护（`r0 = min(r0, it.y)`），`rows.find` 保持语义等价
- **风险**：低（`toLine` 仍按最终 items 计算，结果逐字一致）

#### TOOL-1 · `toolsForIntent` 每轮重建全部工具定义（含 localeCompare 排序 + 30 次对象分配）
- **位置**：`src/main/ai/agent/agentToolSelector.ts:74`（`defineCoreTools()`）、`:119`、`:167`（`buildToolListForPrompt`）
  → `src/main/ai/toolRegistry.ts:465-468`（`[...CORE_TOOLS].sort(localeCompare)`）、`:453-460`、`:433-445`（`getToolStub` 每次新建对象）
- **规则**：G06（缓存策略）
- **调用点**：`agentContext.ts:699`（每次 `prepareAgentContext`）、
  `subtaskOrchestrator.ts:465`（**每次子任务切换**）、`agentLoop.ts:1120`（每个并行分支）
- **放大因子**：单任务 = 1（prepare）+ 轮数（≤6）× 子任务数（≤5）+ 分支数。
  每次调用：30 元素 `localeCompare` 排序（ICU collation，比 `<` 慢一个量级）+ 新数组 + 25 个新 stub 对象。
- **方向**：`CORE_TOOLS` 排序结果与 stub 表模块级预构建；`toolsForIntent` 结果按入参键做 LRU/Map 记忆化（返回冻结副本）
- **风险**：中（返回值若被下游原地修改会污染缓存，需先核验调用方）

---

### P1 — 轮询/忙等与重复 IO

#### INT-1 · `BranchInteractionGate.wait` 2ms 忙轮询
- **位置**：`src/main/ai/agent/subtaskOrchestrator.ts:986-988`
- **规则**：G01（应事件驱动）
- **实测结构**：
  ```ts
  while (!this.stopped && [...this.states.values()].some((s) => s === 'active')) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  ```
  每次迭代还重建 `states.values()` 数组。
- **放大因子**：并行链每遇交互，等待在飞分支收敛的整段时间内每 2ms 唤醒一次主进程事件循环。
- **方向**：改事件驱动（`leave()` 时检查并 resolve 挂起的栅栏 Promise）
- **风险**：中（并发栅栏语义，需边界测试：parked/done/cancelled 三态）

#### QUE-1 · 队列轮询空转 + `SELECT *`
- **位置**：`src/main/db/agentTaskDao.ts:75-107`（`dequeueNext` 3 条语句/次）、`:110-133`（`updateTaskStatus` 额外 `SELECT *`）、`:147-160`
- **规则**：B03（精确查询）+ B09
- **实测结构**：`AgentTaskWorker`（`agentTaskWorker.ts:154`）`setInterval` 1000ms 恒跑；
  每次 `poll()` → `dequeueNext` = SELECT(pending) + UPDATE(running) + SELECT(*)，
  **空闲时同样每秒 3 条语句**。
- **方向**：`SELECT` 明确列名（去掉 `content` 之外的大字段）；空队列短路（先 `EXISTS` 轻查询）
- **风险**：低

#### DOC-3 · `searchDocument` 每次调用全文重扫标题
- **位置**：`src/main/ai/tools/searchDocument.ts:216`（`collectHeadingMarks`）、`:213`（`content.toLowerCase()`）
- **规则**：G06 + G08（惰性）
- **实测结构**：`collectHeadingMarks`（`:126-151`）对全文 `split('\n')` + 逐行正则 + `stack.map()`；
  **无论是否命中都先全量扫描**；且 `content.toLowerCase()` 额外复制一份全文。
  同一附件被多次检索（LLM 常常连查）时重复付出。
- **放大因子**：正文长度（解析后 PDF 可达数十万字符）× 单轮内检索次数
- **方向**：命中为空时跳过 titles 扫描（惰性）；按 `(attachmentId, parseVersion)` 缓存 marks
- **风险**：低（惰性化）/ 中（缓存需失效键）

#### DOC-4 · `estimateTokensCached` 已实现但**零生产调用点**
- **位置**：定义 `src/main/ai/utils/tokenEstimator.ts:107-125`（LRU 1000）；调用点：**无**
- **规则**：G06
- **实测结构**：全仓 `grep estimateTokensCached` 仅命中定义行。
  所有生产路径走 `estimateTokens`（`:79-101`，逐字符 `charCodeAt` 循环）。
  重灾区 `agentPromptBuilder.ts:41-55` `truncateBlockWithMarker`：二分截断对每个 mid 调用 `estimateTokens`，
  每次都是**新字符串**（缓存天然 miss）→ O(n log n) 字符扫描 + 切片分配。
- **方向**：接线 `estimateTokensCached` 到 `agentLoop` / `contextManager` 的整串估算点；
  `truncateBlockWithMarker` 改为「按字符比例预估 + 常数轮校正」替代纯二分
- **风险**：低（数值等价）

#### MEM-3 · `buildMemoryMatchQuery` 重复构造 trigram
- **位置**：`src/main/db/agentMemory.ts:506-527`
- **规则**：G06
- **实测结构**：调用方 `querySimilarMemoryCandidates`（`:552`）与 `queryMemoryFtsChannel`（`:721`）
  对同一文本各调一次；函数内部对原文与小写各切一遍 trigram（Set 去重后取前 48）。
- **方向**：单次扫描内按文本记忆化
- **风险**：低

---

### P2 — 低收益但零风险

| # | 位置 | 规则 | 说明 |
|---|------|------|------|
| INT-2 | `src/main/ai/intentTiering.ts:51-53` | G06 | `cacheKey` 每次调用 sha256（同步 CPU）；输入多为短句，可直接用 `hasHistory + '\u0000' + text` 作键 |
| QUE-2 | `src/main/ai/agent/agentTaskQueue.ts:95-99`、`src/main/ai/agent/memoryWriter.ts:209-211` | G07 | `hasPending` 判定拉全量任务再 `.some()`；DAO 可下沉 `EXISTS ... LIMIT 1` |
| MEM-4 | `src/main/db/agentMemory.ts:245-256` | B03 | `listActiveMemoryAccess` 走 `SELECT *` 但只用 5 列 |
| DOC-2 | `src/main/ai/files/parseLimiter.ts:17-20` | G01 | `wakeAll` 每次完成唤醒全体等待者 → 批量 N 文件 O(N²) Promise 轮转；可由 `wakeOne` 替代 |

---

## 三、跨模块调用链（Phase 5.5 连通性验证预登记）

优化若引入缓存/批量/事件驱动，以下链路须逐条复验契约：

| # | 链路 | 涉及瓶颈 | 契约要点 |
|---|------|---------|---------|
| L1 | `tools/memoryWrite` → `agent/memoryPolicy.runMemoryPolicy` → `db/agentMemory` | MEM-1/2/3/4 | 返回 `{evicted, merged}` 计数口径逐字不变；`manual` 三处豁免不掉 |
| L2 | `agent/memoryWriter.runMemoryExtractionJob` → 同上 + `knowledge/vectorBackfill` | MEM-1/2 | 失败仍落 `failed` 不重试；向量异步补写不阻塞终态 |
| L3 | `agent/agentContext.prepareAgentContext` → `agentToolSelector.toolsForIntent` → `toolRegistry` | TOOL-1 | 返回 `ToolDef[]` 内容与顺序不变；下游不得原地修改 |
| L4 | `subtaskOrchestrator.applySubtaskContext` → `toolsForIntent`（每子任务） | TOOL-1 | 子任务工具集按 intent 隔离，不串味 |
| L5 | `subtaskOrchestrator.BranchInteractionGate` → `agentTaskWorker.pendingInteractions` | INT-1 | `waiting_interaction` 状态机与取消语义不变 |
| L6 | `files/documentParser.parsePdf` → `files/pdfLayout.analyzePdfLayout` → `files/multimodalParse.runDRoute` | DOC-1 | `PdfLayoutResult` 全字段（text/headings/sections/tables/pageOffsets/metadata/analysis）逐字一致；D 路线触发信号不变 |
| L7 | `ipc/kbHandlers` / `db/attachments` → `files/parseLimiter.parseWithLimit` → `parseDocument` | DOC-2 | 并发上限 3、FIFO 补位语义不变 |
| L8 | `tools/searchDocument` → `db/attachments.getParsedAttachment` | DOC-3 | 命中片段/页码/章节路径输出逐字一致 |
| L9 | `agent/agentPromptBuilder` → `utils/tokenEstimator` | DOC-4 | 截断结果 `estimateTokens(结果) <= limit` 不变式保持 |

---

## 四、未纳入本轮（范围外，需用户裁定）

- **文档解析 CPU 卸载到 Worker**（G04）：`pdfLayout` 全量计算移出主线程属架构级改动，
  远超「仅作性能优化」的安全边界（涉及 Electron worker_threads 生命周期、打包路径）。
  本轮只做算法常数优化，不动线程模型。
- **`better-sqlite3` → 异步 API**：全仓同步 DAO 契约，改动面覆盖 20+ 模块，不在本轮。
- **`pdfLayout` 表格检测 `detectTable`** 内部复杂度：需先补大样例基准，本轮未取得实测数据，
  暂不列为瓶颈。

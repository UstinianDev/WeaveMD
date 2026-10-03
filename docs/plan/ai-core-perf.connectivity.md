# ai-core-perf — 模块连通性验证（Phase 5.5）

> 生成：2026-10-03 | 触发条件：L 级变更含跨模块调用链
> 方法：对本次优化涉及的每条跨模块链路，逐项核对①接口契约 ②数据格式 ③错误传播 ④缓存/异步路径。

## 调用链清单与结论

| # | 链路 | 涉及瓶颈 | 契约核对点 | 状态 |
|---|------|---------|-----------|------|
| L1 | `tools/memoryWrite` → `agent/memoryPolicy.runMemoryPolicy` → `db/agentMemory` | MEM-1/2/3/4 | 返回 `{evicted, merged}` 形状与计数口径逐字不变；`db` 首参注入签名不变；`closeMemory` 单条路径未改 | ✅ 通畅 |
| L2 | `agent/memoryWriter.runMemoryExtractionJob` → 同上 + `knowledge/vectorBackfill` | MEM-1/2/3/4 | 失败仍落 `failed` 不重试；`writeMemoryVectorAsync` 仍不 await（提前返回不阻塞终态） | ✅ 通畅 |
| L3 | `agent/agentContext.prepareAgentContext` → `agentToolSelector.toolsForIntent` → `toolRegistry` | TOOL-1 | 返回 `ToolDef[]` 内容/顺序不变（`agentContext.test.ts` 的 `toEqual(ctx.tools)` 未改且通过）；返回**新数组实例**，保护记忆化条目 | ✅ 通畅 |
| L4 | `subtaskOrchestrator.applySubtaskContext`（每子任务）→ `toolsForIntent` | TOOL-1 | 7 元组入参经 `ctx.toolSelectionArgs` 单一口径传参；记忆化键含全部 7 维 → 子任务意图不串味（`subtaskSequence`/`subtaskParallel` 33 例通过） | ✅ 通畅 |
| L5 | `subtaskOrchestrator.BranchInteractionGate` → `agentTaskWorker.pendingInteractions` | INT-1 | 栅栏三态（active/parked/done）+ dispose 唤醒语义由新增 4 例边界用例钉死；`cancelled` 标记与 reject 传播路径不变 | ✅ 通畅 |
| L6 | `files/documentParser.parsePdf` → `files/pdfLayout.analyzePdfLayout` → `files/multimodalParse.runDRoute` | DOC-1 | `PdfLayoutResult` 全字段（text/headings/sections/tables/pageOffsets/metadata/analysis）由 `pdfLayout.test.ts` 逐字断言通过；D 路线触发信号 `shouldUseDRoute(analysis)` 不变 | ✅ 通畅 |
| L7 | `ipc/kbHandlers` / `db/attachments` → `files/parseLimiter.parseWithLimit` → `parseDocument` | （DOC-2 未实施） | 文件未改动，契约原样 | ✅ 未触及 |
| L8 | `tools/searchDocument` → `db/attachments.getParsedAttachment` | DOC-3 | 输出 JSON 形状（`matchCount`/`matches[].offset/snippet/page/sectionPath`）不变；零命中路径返回空 `matches` 而非报错（`docTools`/`docPipelineEval` 61 例通过） | ✅ 通畅 |
| L9 | `agent/agentPromptBuilder` / `agentLoop` / `agentContext` / `subtaskOrchestrator` → `utils/tokenEstimator` | DOC-4 | `estimateContentTokens` 签名不变；11 个消费点全部走同一入口；数值逐字不变（guard 用例对 6 类文本断言缓存/非缓存同值） | ✅ 通畅 |
| L10 | `agent/agentTaskQueue.hasPendingForConversation` → `db/agentTaskDao.hasPendingTask` | QUE-2 | **新增依赖边**：队列由「读全量后 `.some()`」改为委托 DAO 的 `EXISTS ... LIMIT 1`；语义等价性由 `subtaskSequence.test.ts` 4 个既有断言（含 supersede 后转 false）验证通过 | ✅ 通畅（见风险 R1） |
| L11 | `agent/agentTaskWorker` → `agent/memoryWriter.maybeEnqueueMemoryExtraction` → `AgentTaskQueue` | QUE-2 | **新增可选钩子**：`MemoryTaskQueueLike.hasPendingForConversation?` —— 名字必须与 `AgentTaskQueue` 方法名一致，否则生产静默回落慢路径。已由 `aiCorePerfGuards.test.ts` 显式断言名字对齐 + 语句形态 | ✅ 通畅（见风险 R2） |

## 缓存 / 异步路径专项

| 新增缓存 | 作用域 | 失效面 | 结论 |
|---------|--------|--------|------|
| `TOOL_SUBSET_CACHE`（agentToolSelector） | 模块级，键空间封闭（6 意图 × 2⁶ 开关 = ≤384） | 输入全为每轮不变的会话配置；返回浅拷贝，调用方原地改写不回流 | 无失效问题 |
| `TrigramMemo`（memoryPolicy） | **函数调用级局部变量** | 每次调用新建，不跨调用 | 无失效问题 |
| `matchQueryCache`（agentMemory.buildMemoryMatchQuery） | 模块级，上限 256 条 FIFO | **纯函数**（文本 + maxTerms → 查询串），无外部状态 | 无失效问题 |
| `tokenCache`（tokenEstimator） | 模块级 LRU 1000，单条 ≤ 8K 字符 | **纯函数**（文本 → token 数）；超长文本不入缓存 | 无失效问题，内存上界 ≈ 8 MB |

异步路径：本次唯一涉及的异步写入是 `writeMemoryVectorAsync`（L2），**未改动**。INT-1 把忙轮询改为事件驱动，未新增任何 timer / listener / 订阅，无泄漏面。

## 风险

| # | 风险 | 等级 | 处置 |
|---|------|------|------|
| R1 | `AgentTaskQueue` 新增对 `taskDao.hasPendingTask` 的硬依赖 → 任何 `vi.mock('@main/db/agentTaskDao')` 的部分 mock 必须同步补该导出，否则运行期 TypeError | 中 | 已在本轮修复 `subtaskSequence.test.ts`（该 mock 本就声明为服务此用例）。**后续新增该 DAO mock 的文件需同步**，属已知维护面 |
| R2 | `MemoryTaskQueueLike.hasPendingForConversation` 是**可选**钩子 → 名字写错会静默回落慢路径（无编译错误） | 中 | 已由 guard 用例断言「`AgentTaskQueue.hasPendingForConversation` 存在且只发 1 条 `LIMIT 1` 语句」；若契约漂移即变红 |
| R3 | `agent_memory` 窄投影与 `mapRow` 的列一致性靠人工维护（少列 → 字段静默 `undefined`） | 中 | 已由 guard 用例逐字段断言 `AgentMemoryRow` 11 个字段；已在 `ACTIVE_ROW_COLUMNS` 注释写明「改 `mapRow` 时同步改这里」 |
| R4 | `skillDistiller.ts:208` 存在与 QUE-2 **同款**的「全量拉取后 `.some()`」写法，本轮**未改**（在变更白名单外） | 低 | 作为未优化项记入交付报告 |

## 结论

11 条链路全部 ✅ 通畅，无断裂。4 项风险均已有对应守卫（R1 本轮已修 + 记录维护面；R2/R3 有断言；R4 记为未优化项）。

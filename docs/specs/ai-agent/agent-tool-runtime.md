# Agent 工具运行时 — 执行、并发与外发闸（Tool Runtime）

> 规范编号：SPEC-AGENT-TOOL | 版本：v1.1（已实施，任务 11 增 §14 确认档位契约）| 状态：生效 | 更新：2026-10-02
> 关联需求：[agent-perf-optimize.req.md](../../requirements/archive/agent-perf-optimize.req.md)（S1~S5 / 硬性约束）、[doc-pipeline.req.md](../../requirements/doc-pipeline/doc-pipeline.req.md)（六-1 工具与引用 / 八-1 外发闸）、[agent-cost-optimize.req.md](../../requirements/archive/agent-cost-optimize.req.md)（B3 结果预算）、[REQUIREMENTS.md](../../REQUIREMENTS.md) §3.7 / §3.9 / §3.12
> 关联模块：[11-AI代理面板-Agent.md](../../modules/11-AI代理面板-Agent.md)
> 关联架构：[ai-agent.md](../../architecture/ai-agent.md)、[backend.md](../../architecture/backend.md)、[security.md](../../architecture/security.md)
> 关联规范：[agent-message-storage.md](./agent-message-storage.md)（消息写读契约）
> 关联测试：[agent-multi-intent.tdd](../../testing/agent-multi-intent/agent-multi-intent.tdd.md)（§13-§15 多意图链路 TDD 证据，分册 `testing/agent-multi-intent/agent-multi-intent.tdd/`）

> 本文只写长期有效的实现级行为契约。需求动机、验收与红线见关联 req，两边重复的只在 req 保留，本文引用不复述。
> 来源标注中的 `../../plan/*` 为过程计划文档，已随计划退役（历史见 git），仅留溯源线索；已与现码逐条核对（2026-10-01）。

---

## 1. 适用范围

`src/main/ai/agent/` 下工具执行链（`StreamingToolExecutor` / `agentLoop` / `agentToolExecutor` / `concurrencyDefs`）、注册与选择（`toolRegistry` / `agentToolSelector`）、结果与缓存（`toolResultStorage` / `searchCache` / `hashUtil`）、外发同意闸（`consent` / `kbSearch` / `searchDocument`）。

## 2. 流式推测执行 `StreamingToolExecutor`

- 状态机：`queued → executing → completed → yielded`；安全工具（并发安全）在流式接收期间推测并行执行，非安全工具排队串行。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.1、现码 `StreamingToolExecutor.ts:11/39`）
- 核心 API：`onToolCall(tc, assistantMessage)`（流中注册）、`getCompletedResults()`（Generator 顺序产出已完成结果）、`getRemainingResults()`（AsyncGenerator 等待未完成）、`waitForAll(skipToolNames?)`、`abortAll(reason)`（级联取消）。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.1）
- **编译时常量开关**：现码为 `STREAMING_TOOL_EXEC_ENABLED`（计划文档写作 `USE_STREAMING_EXEC`，**以现码为准**）；置 `false` 时与旧行为完全一致，原 `executeToolRound` 保留为兜底路径。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.1、现码 `StreamingToolExecutor.ts:32`）

## 3. 确认工具安全契约（`waitForAll` skip-set）

- **`FORCE_CONFIRM_TOOLS`（`deleteFile` / `deleteLocalFile`）必须由 skip-set 留给调用方的确认流程，禁止在流式路径预执行。** `waitForAll()` 逐个执行 queued 工具，若不跳过确认类工具，其确认对话框分支将成为死代码——属安全回退。（来源：`docs/plan/agent-perf-optimize.connectivity.md` Chain 1）
- 已按 Option A 落地：`waitForAll(skipToolNames?: Set<string>)` 跳过集合内工具（保持 `queued`），调用方把跳过后剩余的确认工具交给 `processStreamingToolRound` 的 force_confirm 循环。（来源：`docs/plan/agent-perf-optimize.connectivity.md` Chain 1）
- 现码锚点：`StreamingToolExecutor.ts:139`（`waitForAll` 定义）；skip-set 实际取值自
  agent-multi-intent 任务 11 起**由确认矩阵派生** `confirmSkipSet(intent, inChain, toolNames)`
  —— 按本轮实际工具名逐个 `confirmTierFor` 判档（不按 `WRITE_TOOLS` 枚举）：已登记
  `force` 恒入 ∪ 链态 `batch`（非链态与原 `FORCE_CONFIRM_TOOLS` 行为等价），
  **未登记名恒入**（fail-closed → `batch`，连通性报告 §6 补全：流式路径不再绕过
  `checkForceConfirmTools` 直通执行）；延迟工具重发轮 skip-set = 矩阵派生集 ∪ 本轮延迟工具（见 §14）。
  （来源：`docs/plan/agent-perf-optimize.connectivity.md` Chain 1、agent-multi-intent 任务 11 现码核对）

## 4. 并发安全判定（按调用、fail-closed）

- 执行器分区由静态 `READ_ONLY_TOOLS` / `WRITE_TOOLS` 二分改为**按调用判定** `isToolConcurrencySafe(name, safeParseArgs(args))`，定义集中在 `concurrencyDefs.ts` 全量注册表；`READ_ONLY_TOOLS` 仍作为集合保留于 `agentToolSelector.ts` 供既有调用方使用，不再承担执行分区。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.2、`docs/plan/agent-perf-optimize.connectivity.md` Chain 2）
- **未登记 / 未知工具默认 `false`（fail-closed 串行）**；`safeParseArgs` 解析失败返回 `{}`，对未登记工具同样落到串行。注册表提供「已登记为串行」与「根本没登记」的可分辨入口，避免新工具漏入表而测不出来。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.2、现码 `concurrencyDefs.ts`）
- 并发安全（`defaultSafe: true`）仅限只读或 proposal-only 工具：TOP10 高频（`listFiles` / `readFile` / `searchKB` / `editBlocks` / `list_skills` / `get_skill_details` / `analyze_folder` / `check_links` / `get_task_activity` / `readLocalFile`）+ 文档四工具（`searchDocument` / `readPage` / `extractTable` / `analyzeChart`）+ `memory_read`。写工具与 `memory_write`、`ask_question_card` 等显式 `false`。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.2、`docs/plan/doc-pipeline.plan/01-batch-changes.md` B8、现码 `concurrencyDefs.ts`）
- 只读工具漏入 fail-closed 会退化为串行，是性能陷阱——新增只读工具须显式入表。（来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` B8）

## 5. 工具 schema 延迟加载（defer）

- **核心 5 个**始终发完整 JSON Schema：`listFiles` / `readFile` / `searchKB` / `editBlocks` / `ask_question_card`；**其余 25 个**只发名称 stub + `defer_loading: true`（不发 parameters schema）。（来源：`docs/plan/agent-perf-optimize.phase2.plan.md` §S5、现码 `toolRegistry.ts` 头注）
- 触发路径：LLM 选中延迟工具 → **拦截 → 加载完整 schema → 重发请求**，**重发上限 3 次**防死循环；同一工具只升级一次（`upgradedDeferredTools`）。（来源：`docs/plan/agent-perf-optimize.phase2.plan.md` §S5、现码 `agentLoop.ts:407-500`）
- **不新增 ToolSearchTool**（工具数少，不需要搜索层），改用拦截重发。（来源：`docs/plan/agent-perf-optimize.phase2.plan.md` §S5）
- 重发轮须保留已执行的非延迟工具结果：通过 `waitForAll(skipSet)` 收集（skip-set = 确认类 ∪ 本轮延迟工具），已执行结果注入上下文后再重发，不丢弃。（来源：`docs/plan/agent-perf-optimize.phase2.plan.md` §S5、现码 `agentLoop.ts:434-441`）
- prompt 前缀缓存约定：工具定义按 `function.name` **字母序**排序；defer schema 升级会使其余该轮起已建前缀失效一次，升级后按前缀自动重匹配恢复稳定。（来源：[perf phase2 plan §S5/S7](./agent-prompt-context.md)、`docs/plan/doc-pipeline.plan/01-batch-changes.md` B8）

## 6. 结果预算（超限落盘，不丢弃）

- 已落地常量（**现状口径**）：`MAX_SINGLE_RESULT_CHARS = 10_000`、`MAX_AGGREGATE_RESULTS_CHARS = 40_000`、`PREVIEW_LENGTH = 500`。（来源：`docs/plan/agent-cost-optimize.plan.md` §2.5 B3、现码 `toolResultStorage.ts:22/25/31`）
- **设计期数值以现状为准**：`docs/plan/agent-perf-optimize.phase2.plan.md` §S6 的 40K 单结果 / 150K 聚合是设计期取值，已被 cost 批 10K/40K 取代，不得按 40K/150K 实现或校验。
- 行为契约：超单结果阈值的内容**写入文件而非丢弃**，返回 `PREVIEW_LENGTH` 预览并带恢复路径；聚合超预算时从最大结果开始持久化；同一工具结果在后续所有 API 调用中使用**相同替换内容**（确定性）。（来源：`docs/plan/agent-cost-optimize.plan.md` §2.5 B3、`docs/plan/agent-perf-optimize.phase2.plan.md` §S6）
- 质量护栏（产物 payload、澄清问题、出处、错误警告等不削减）见 [agent-cost-optimize.req.md](../../requirements/archive/agent-cost-optimize.req.md) §质量护栏，本文不复述。

## 7. 哈希统一 xxHash64

- `src/shared/utils/hashUtil.ts`：`xxHash64()` 异步（WASM 懒加载）、`xxHash64Sync()` 同步（djb2 降级）。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.4、现码 `hashUtil.ts`）
- 替换范围 = staleness 三处（`editBlocksHandler` / `previewFileRevision` / `previewPatchFilesHandler`）+ 渲染两处（`rewriteStore` / `DiffSummaryCard`）。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.4、现码核对）
- **`agentLoopGuard.ts` 的 MD5 明确不动**（死循环检测数据量小，风险 > 收益）。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.4、[perf req 硬性约束](../../requirements/archive/agent-perf-optimize.req.md)）

## 8. 搜索缓存键与失效

- `getSearchCacheKey` 缓存键**含 `searchMode`**（`fts5` / `vector` / `hybrid` 各自独立缓存）。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.3、现码 `searchCache.ts:116-123`）
- `invalidateKbSearchCache` 支持**三级失效 `all` / `user` / `chunk`**，维护 `chunkId → cacheKey` 关联索引，chunk 级精确清除关联条目。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.3、现码 `searchCache.ts:84-180`）

## 9. 文档四工具只读区注册契约

- `searchDocument` / `readPage` / `extractTable` / `analyzeChart` 对齐 `readLocalFile` 只读范式；`description` 必须静态，**严禁动态内容破坏 prompt 前缀缓存**。（来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` B8）
- **注册点须同批同步**（任务书原述「五处」、实列 6 项 **[待校准]**）：① `READ_ONLY_TOOLS`（`agentToolSelector.ts`）② `concurrencyDefs` 并发表 ③ `handlerMap` + `executeTool` 调度（`toolRegistry.ts`）④ defer 标记（`CORE_TOOLS` 的 `defer_loading`）⑤ `toolsForIntent` 意图分区 ⑥ 提示词路由（`agentPromptBuilder.ts` 检索指引/工具清单段）。漏任一处表现为工具不可达、fail-closed 串行或提示词无指引。（来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` B8、现码核对）
- 陈旧工具名 `readFileRevision` / `listFileRevisions` / `getFileInfo` 已清理，**不得回流**（表内缺席即 fail-closed 串行，语义不变）。（来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` B8、现码 `concurrencyDefs.ts:32` 注释）

## 10. 引用与出处（citation → refsJson）

- 链路：`collectCitations(toolName, content)`（按工具形状收集）→ `mergeCitations`（按 `sourceRef` 缺省 `fileName` 去重、**总数封顶 `MAX_CITATIONS = 10`**）→ `citationRefsJson` → 落库 `appendMessage.refsJson` + `AI_STREAM_DONE.refsJson` 事件携带 → 渲染层点击回跳原文位置。（来源：[doc-pipeline connectivity 链路4](../knowledge/kb-indexing-egress.md)、[doc-pipeline B8](../knowledge/kb-indexing-egress.md)、现码 `agentToolExecutor.ts:330-398`）
- 向后兼容：`refsJson` 为 JSON 级可选，历史消息 `null`/缺字段正常渲染；空引用不写（保持 `null`）。（来源：[doc-pipeline connectivity 链路4](../knowledge/kb-indexing-egress.md)）
- 索引侧页码回链（`source_ref` 承接）与渲染侧跳转的完整契约见 [SPEC-KB-IDX §5](../knowledge/kb-indexing-egress.md)，本文只保留工具执行侧的收集与投递。

## 11. 外发同意闸

> 索引/检索参数侧（笔记 SQL、`searchMode`、不碰清单）见 [SPEC-KB-IDX §7-§9](../knowledge/kb-indexing-egress.md)；本文只写工具执行链上的闸门契约。

### 11.1 KB 检索外发链（唯一出口）

- 链路：`needsKbSendConsent = !allowSend`（`ai_config` 缺行默认 `allowSend:false`）→ `agentContext` 算 `kbEgressAuthorized` → `toolsForIntent` 第 7 参 `kbAttachmentEgressGranted`（`kbSearchAllowed = kbEgressAuthorized || kbAttachmentEgressGranted`）→ `searchKb` 闭包（**LLM 外发唯一出口**）→ `filterKbEgressResults`。（来源：[doc-pipeline connectivity 链路5](../knowledge/kb-indexing-egress.md)）
- `filterKbEgressResults`：`allowSend=true` 原样返回；`false` 仅放行 `consent_granted=1` 且 `source_type='attachment'` 的勾选授权附件命中，**笔记永不入列**，`best` 同步收敛；白名单查询异常用**空集合兜底**（fail-closed，不放宽 `allowSend`）。（来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` B11、[doc-pipeline connectivity 链路5](../knowledge/kb-indexing-egress.md)、现码 `agentTaskWorker.ts:594-602`）
- **硬规则：`allowSend` 语义不得放宽**；勾选授权 = 该文档显式授权，**不追溯放宽其他笔记**。（来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` B11）

### 11.2 附件正文外发闸（四工具共闸）

- `ToolCtx.attachmentEgressAllowed = kbEgressAuthorized || kbAttachmentEgressGranted`，**缺字段视为非 `true` 即 fail-closed**。（来源：`docs/plan/doc-pipeline.status.md` R3、现码 `agentContext.ts:625`）
- `checkAttachmentEgress` / `resolveAttachmentTarget` 双检顺序：**① 会话边界——本会话附件豁免外发闸恒放行；跨会话附件恒拒**（`attachmentEgressAllowed` 仅为 `true` 时改拒为「附件不属于当前会话」文案，放行条件不变）；**② 外发闸**——非本会话且 `attachmentEgressAllowed !== true` 拒「附件外发未授权」。`searchDocument` / `readPage` / `extractTable` / `analyzeChart` **四工具共用同一闸**。（来源：`docs/plan/doc-pipeline.remedial.diagnosis.md` R3、`docs/plan/doc-pipeline.status.md` R3 裁定、现码 `searchDocument.ts:44-55`）
- 8 格矩阵裁定：**跨会话 4 格恒拒、本会话 4 格恒放行**（轴 = 会话边界 × `allowSend` × 勾选授权）。（来源：`docs/plan/doc-pipeline.status.md` 遗留修复批次）

### 11.3 入库与过滤取舍（B11 Q1）

- **附件照常入 KB**（保住本地检索价值），`allowSend=false` 时在检索出口按 `source_type='attachment'` 过滤，而非不入 KB；入库时记录勾选授权标记供白名单过滤。（来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` B11、[doc-pipeline req §2 Q1](../../requirements/doc-pipeline/doc-pipeline.req.md)）

### 11.4 已知限制（生产不可达，不得写成承诺）

- **`useKnowledgeBase` 硬编码 `false`、`setUseKnowledgeBase` 全仓零调用方** → `toolsForIntent` 的 kbQa/rewrite/create/tech 四分支恒不注入 `searchKB`，11.1 的注入矩阵与检索 citation 分支**生产不触发**（已标注为 Module 10 移除后的废弃开关，**不恢复**）。（来源：`docs/plan/doc-pipeline.connectivity.md` §2 R1）
- **`allowSend` 无可达 UI 入口**（DB 默认 0，`ConsentOverlay` 触发条件依赖已死的 KB 开关）→ `filterKbEgressResults` **生产不执行**。（来源：`docs/plan/doc-pipeline.connectivity.md` §2 R2）
- 即：11.1 目前是**结构正确但生产不执行**的闸；11.2 是附件正文出口的**在用闸**。

## 12. 需求侧交叉引用

各优化项的需求动机、验收指标与硬性约束（工具行为不变、上下文不瘦身、`agentLoopGuard` MD5 不替换等）见 [agent-perf-optimize.req.md](../../requirements/archive/agent-perf-optimize.req.md)；工具与引用的任务级验收见 [doc-pipeline.req.md](../../requirements/doc-pipeline/doc-pipeline.req.md) §1 模块六/八；结果预算与质量豁免清单见 [agent-cost-optimize.req.md](../../requirements/archive/agent-cost-optimize.req.md)。本文不重复这些需求级结论。

## 13. 子任务链执行契约（agent-multi-intent 任务 5）

> 需求裁定：[agent-multi-intent.req.md](../../requirements/agent-multi-intent/agent-multi-intent.req.md) Q9/Q11/Q12。
> 实现：`subtaskOrchestrator.ts`（链状态机）+ `agentLoop.ts`（轮次循环接线）+
> `agentTaskWorker.ts`（中断判定注入）+ `agentTaskQueue.hasPendingForConversation`。
> 验收：`tests/main/ai/subtaskSequence.test.ts`（11 例）。

### 13.1 轮次双预算（Q9）

- **per-subtask**：每进入一个子任务（含失败重试）新建
  `DeadLoopDetector({ maxRounds: getRoundsForIntent(sub.intent) })`，轮次计数以
  `chain.subtaskStartRound` 为起点（`subtaskRound = round - subtaskStartRound`），
  检测器状态（same-result / consecutive-failure 历史）**子任务间不串味**。
- **链总封顶**：`subtaskTotalRoundsCap(primaryIntent) = 2 * getRoundsForIntent(primaryIntent)`。
  两道闸：① 子任务边界（`advanceChain` / `runChainClarification`）`round + 1 >= cap`
  → 不再下达下一子任务；② 轮首硬闸 `round >= cap` → 当前子任务截断。
  触顶即 `stopChain` 写「链已停止：…——链总轮次封顶」明示，剩余子任务标 skipped，
  **单次 `AI_STREAM_DONE` 正常收口（非失败，intent = primaryIntent）**。
- 子任务自身轮次预算耗尽（未收敛）同走 `stopChain`（明示「轮次预算耗尽未收敛」），
  与单意图轮次上限停跑语义对齐；`confidence` 不参与轮次分配（Q10，追问不计轮次）。

### 13.2 上下文重建与摘要注入（Q12）

- 链启动时快照 `chain.baseMessages`（system 提示 + `ctx.baseHistoryMessages` 历史 +
  当前 user 消息 + 锚点，**先于拆分段注入**）。
- 每个子任务边界重建 `ctx.llmMessages = baseMessages + 拆分段 +
  Σ已完成子任务（指令 system 行 + 执行摘要 assistant 行）+ 下一条子任务指令`：
  - 执行摘要 = 子任务收敛产出截断 `SUBTASK_SUMMARY_MAX_CHARS = 500` 字符 + `…`；
  - **丢弃当前子任务工作集**（含工具轮），后续子任务 prompt 不堆积原始全量对话；
  - 同步重建 `ctx.intent` / `ctx.tools`（`ctx.toolSelectionArgs` 复制换 intent 后过
    `toolsForIntent`，与 `agentContext` 同一口径）与 `ctx.totalTokens`。
- DB 落库口径不变：链中产出全量进 `chain.buffer`，链末单条 assistant =
  `buffer + 末子任务产出`（`finalizeChainContent(chain, '')`，last 恒空防重复）。
- 1..n-1 子任务完成发 `ai:stream:subtask_done`（`IAgentStreamSubtaskDoneEvent`），
  渲染侧把已积累流式文本落为 assistant 气泡并清空累积器（订阅不断）；
  末子任务仍走 `AI_STREAM_DONE`。

### 13.3 中断安全点（Q11）

- `AgentLoopDeps.isChainInterrupted?: () => boolean`，worker 注入闭包
  `queue.isSuperseded(task.id) || queue.hasPendingForConversation(task.conversationId)`
  （只读查询，不动表结构；查询失败 fail-safe 返回 false = 退化为跑完当前链）。
- **只在子任务边界调用**（`advanceChain` / `runChainClarification` 下达下一条指令前）：
  当前子任务跑完不截断，其后子任务不再启动，写「检测到同会话新消息」明示后正常收口。
  supersede 语义不变（只作废 pending，running 任务照常收口，Q11）。

### 13.4 失败重试与 waiting_interaction（Q12）

- **范围**：链路径下 LLM 流调用失败（网络/API）进入 `handleSubtaskFailure`；
  非链 / AbortError / consent 异常直接上抛（单意图路径与取消语义逐字节不变）。
- 重试 1 次（`SUBTASK_FAILURE_MAX_RETRIES = 1`）：重建当前子任务（保留指令、新预算、
  `subtaskStartRound = round + 1`），失败轮次仍计入链总封顶。
- 重试仍失败 → `onInteractionRequired(variant='subtask_failed')`（问题 id
  `subtask_failed`，confirm）→ worker 会话进 `waiting_interaction`：
  - 答 `yes`/空 → 跳过该子任务（明示进 buffer）→ 边界检查后推进下一子任务；
  - 答 `no` → `stopChain('用户选择停止执行')` → 正常收口；
  - 无交互支持 → 按跳过处理（fail-safe，不等待不死锁）；
  - `waitForInteraction` reject（取消/任务结束）→ 异常上抛，外层统一
    `AI_STREAM_ERROR` 收口，**不会锁死在 waiting_interaction**。
- 渲染侧 `variant='subtask_failed'` 落默认 `QuestionCard`（AIPanelSession 兜底分派，
  零 UI 改动）。

### 13.5 tool_result 回填完整性不变式（plan §6.3）

- 子任务边界**只能落在 assistant/user 轮次之间**：边界仅发生于本轮无工具调用的
  收敛点（或轮首闸），当轮全部 `tool_use` 已在紧随 user/tool 行一次性回填；
  上下文重建后的消息栈由「配对修复过的 base + 纯文本摘要」构成，天然无悬空配对。
- 测试层面按**调用时刻快照**断言：每个 `assistant(tool_calls)` 的全部 id 必须出现在
  其紧随的连续 `tool` 行集合内（`expectToolPairing`），且新子任务 prompt 无
  `assistant(tool_calls)`、无上一子任务工具结果。

### 13.6 与 §3-4 确认/并发契约的关系

- 链路径**不改变** `StreamingToolExecutor.waitForAll(skip-set)` 与
  `checkForceConfirmTools` 的确认契约（§3-§4）：FORCE_CONFIRM 工具在链内仍逐个
  强确认，确认交互取消按既有语义返回「用户取消」错误结果（非子任务失败，不进重试）。
- 工具死循环检测（same-result / consecutive-failure）触发时链走 `stopChain` 收口
  （保留 buffer、DONE intent = primaryIntent），非链路径保持原 `finalizeAgentRun`。
- 子任务不入 `agent_task_queue`（内存编排）；会话仍一任务一 session，
  `waiting_interaction` 复用既有 12 态状态机转移。

## 14. 确认档位契约（intent × tool 确认矩阵，agent-multi-intent 任务 11）

> 需求裁定：[agent-multi-intent.req.md](../../requirements/agent-multi-intent/agent-multi-intent.req.md) Q13/Q14。
> 实现：`confirmMatrix.ts`（`confirmTierFor` / `writeToolsByTier` / `confirmSkipSet` 纯函数）+
> `agentToolExecutor.checkForceConfirmTools`（按档分派）/ `confirmWriteBatch`（链末汇总）+
> `BatchConfirmCard`（渲染侧逐项勾选）。
> 验收：`tests/main/ai/confirmMatrix.test.ts`（91 例：6 intent × 7 写工具全组合 + fail-closed
> + skip-set 派生）+ `tests/main/ai/agentToolExecutor.test.ts`「确认矩阵」（8 例）。

### 14.1 三档判定与 fail-closed

- `confirmTierFor(intent, tool)` 档位：`force` = `deleteFile`/`deleteLocalFile`（任何 intent）；
  `batch` = `WRITE_TOOLS` 其余 5 项（**任何 intent 不得返回 `none`**，铁律一不削弱）；
  `none` = 已登记只读/非写 23 项（`memory_write` 维持现口径不进强制档，见
  [ai-agent.md](../../architecture/ai-agent.md) 写控制）。
- **fail-closed（与 §4 并列的第二道兜底）**：未知 intent、未登记工具名 → `'batch'`
  （**只向确认方向兜底**）；删除类即使 intent 未知仍恒 `'force'`（拦截强度只强不弱）。
- **无交互环境 `'force'`/`'batch'` 一律拒绝执行**：`checkForceConfirmTools` 在分派入口
  统一拒绝（原 §3 时代「无交互拒删除」语义泛化到全部写档，只扩不缩）。
  生产 `agentTaskWorker.buildAgentDeps` 恒带交互回调，此闸仅覆盖无回调直连/测试环境。

### 14.2 三档执行语义

| 档位 | 单意图 | 多写子任务链（`ctx.writeBatch` 收集器在场） |
|------|------|------|
| `force` | 强制卡（`delete_confirm`），yes 才执行 | 同左（逐项强确认，不进汇总） |
| `batch` | 保持现状：直接执行 + `handleToolResult` preview 通知（不打断） | 执行并收集 `WriteBatchItem` → **链末一次汇总确认**（见 14.3） |
| `none` | 常规执行路径 | 同左 |

- 链态判定 = `Array.isArray(ctx.writeBatch)`：`startSubtaskChain` 置 `[]`，
  `confirmWriteBatch` 消化后清空——与 `subtaskChain` 生命周期一致。
- **未登记工具**（`confirmTierFor` fail-closed → `batch`）：单意图拒绝执行、不静默直通
  （有/无交互均拒绝）；链态归入批次走链末汇总确认——连通性报告 §6 fail-closed 补全。
- §3 的 `waitForAll` skip-set 由 `confirmSkipSet(intent, inChain, toolNames)` 按本轮
  工具名逐档派生：`force` 恒入、链态下 `batch` 入（确保写批次经 `checkForceConfirmTools`
  收集）、**未登记名恒入**（交 `checkForceConfirmTools` 分派）；已登记非链态取值
  ≡ `FORCE_CONFIRM_TOOLS`（原行为零变化）。`FORCE_CONFIRM_TOOLS` / `WRITE_TOOLS` 常量保留。

### 14.3 链末汇总确认与快照回滚（Q13）

- 收口顺序：链各收口点统一走 `finalizeChainRun` → 恢复主意图 → `confirmWriteBatch` →
  `finalizeRun`（单次 DONE）。写批次为空时零交互，与改动前收口逐字一致。
- `confirmWriteBatch`：一次 `write_batch` 交互（id = `toolCallId`，`'yes'` 保留 / `'no'` 拒绝），
  **打断次数恒 1**；存在拒绝项 → `rollbackToSnapshot(db, sessionId, userId)` 回滚会话内容
  快照，已接受的 `editLocalFile` 回滚后重新执行（保留确认变更）。
- **粒度限制（如实记录）**：快照回滚为 .md 内容级整批回滚，新建/重命名/移动类操作不在
  覆盖范围，拒绝这些项无法经快照回滚撤销；错误/取消收口路径（AI_STREAM_ERROR）不触发汇总
  确认，写入保持执行原状（= 改动前基线，非回退）。**任务 12 交叉引用**：链写批次的
  staleness 按项检测与部分拒绝级联口径见
  [`modules/11-AI代理面板-Agent/02-diff-cards.md` §7.6](../../modules/11-AI代理面板-Agent/02-diff-cards.md)
  （回滚粒度限制原样保留，不扩大承诺）。
- **任务 12（Q22）按项 staleness**：收集时记写前 `xxHash64Sync`（`originalContentHash`），
  确认时逐项复检现哈希，不一致 → 该项 question `text` 加「⚠️ 目标在执行后被外部修改。」前缀
  并进 `staleIds`；用户仍逐项决定（不自动拒绝、不自动回滚）。
- **任务 12（Q22）部分拒绝级联**：拒项归属子任务经 `cascadeSkipDependents` 求 deps 传递闭包——
  链中跳过 → 未执行后继 `skipped_dependency`（剪出执行序列，不再下达）；链末批次拒绝 →
  已执行后继 `dependency_rejected`（入报告标注，**不自动回滚后继产物**）。结构化结果经
  `confirmWriteBatch` 第三参 sink 传出（返回值仍为 `string`，既有断言零改动）。
- `waitForInteraction` reject（取消/任务结束）向上传播，由外层统一 `AI_STREAM_ERROR` 收口
  （与 §13.4 同款语义，不锁死 `waiting_interaction`；`finalizeChainRun` 各调用点为
  `return await`，保证 reject 落进外层 catch 发 ERROR）。
- 渲染侧 `variant='write_batch'` 分派 `BatchConfirmCard`（AIPanelSession 兜底链：
  `intent_split` → `write_batch` → 默认 `QuestionCard`）；i18n 键 `ai.batchConfirm.*` 三语齐备。

### 14.4 提示词一致性（Q14 防分叉）

- **代码矩阵为准**：`buildAgentSystemPrompt` 本体 sha256 钉死不改（任务 2/3 同款先例），
  「## 写入规则」现有文字与矩阵的对应关系（删除行点名 = `force` 集合、`editLocalFile`
  preview 行 = `batch` 单意图现状）由 `agentToolExecutor.test.ts` 一致性用例断言。
- 链特有口径走独立段：`buildWriteBatchNoticeSegment(writeToolsByTier())` 拼入链拆分指令段
  （随 `chain.directive` 重建持续在场），工具名单由矩阵注入，结构上不可能分叉。

### 14.5 write_mode 消费与逐写确认（Q23，agent-multi-intent 任务 13）

- **注入链路**：`ai_config.write_mode`（`mapConfigRow` NULL→`manual`）→ `toIAIConfig`
  透传（`writeMode != null` 才下发；`DEFAULT_AI_CONFIG` 不含该字段）→
  `IAIConfig.writeMode?: WriteMode` → `prepareAgentContext` 注入
  `ctx.writeMode = config.writeMode ?? 'auto'`。**缺省 `?? 'auto'` = P0 现行为**——
  既有测试零 fixture 改动全绿（回归钉 `writeModeConsumption.test.ts` ③）。
- **batch 档按 `ctx.writeMode` 分派**（`checkForceConfirmTools`）：
  | 模式 | 单意图（非链） | 多写子任务链 |
  |------|------|------|
  | `auto`（缺省） | 执行 + preview 通知，不打断（= P0） | 执行并收集 `writeBatch` → 链末一次 `write_batch` 汇总确认（§14.3） |
  | `manual` | 逐写执行前确认：`confirm` 卡（id=`toolCallId`、含目标路径），yes→`executeOneTool`，no/reject→取消结果 | 逐写执行前确认（与单意图一致），**`writeBatch` 不收集** → 链末批次零交互 |
  - 两种模式**无交互环境一律 fail-closed 拒写**（`写入操作需要用户确认…已拒绝执行`，只强不弱）。
  - `force` 档（deleteFile/deleteLocalFile）与 `none` 档不随 writeMode 变化（§14.1/§14.2 恒定）。
- **skip-set caller 侧补强**（`agentLoop.computeRoundSkipSet`，流式路径与延迟重发路径共用）：
  在 `confirmSkipSet` 矩阵派生之上，满足任一条件即把本轮 `confirmTierFor ≠ 'none'` 的
  工具补进 skip → 汇入 `checkForceConfirmTools` 分派：
  1. **无交互 deps**（缺 `onInteractionRequired` / `waitForInteraction`）→ batch 档落入
     「无交互拒写」——修复 P0 遗留问题 3（非链流式路径原「写工具直通执行」不可达该闸）；
  2. `ctx.writeMode === 'manual'` → 写档入 skip → 逐写确认。
  - `auto` + 有交互 + 非链 → 补强不触发，skip 输出与 `confirmSkipSet` 原值逐字节一致（P0 现行为）。
  - **`confirmSkipSet` 函数本体与输出逐字节不变**（`confirmMatrix.test.ts` 103-129 契约钉死）。
- **写工具清单唯一权威收敛（Q23 末句）**：`confirmMatrix.ts` 导出
  `CONFIRM_FORCE_TOOLS` / `CONFIRM_BATCH_TOOLS` 权威常量，`confirmTierFor` / `writeToolsByTier`
  / `isRegisteredConfirmTool` 读自身常量；**import 方向倒置**（confirmMatrix 不再依赖
  agentToolSelector），`agentToolSelector.WRITE_TOOLS / FORCE_CONFIRM_TOOLS` 改为从
  confirmMatrix 派生再导出（成员逐一不变，7 项 / 2 项）。`agentPromptBuilder.FILE_OP_WRITE_TOOLS`
  字面量与顺序不动（sha256 输入）。交叉断言三连钉死（`writeModeConsumption.test.ts` ⑤）：
  matrix batch∪force ⊆ concurrency 表 `defaultSafe=false` 集 / `FILE_OP_WRITE_TOOLS`
  写子集 ⊇ matrix batch∪force / selector 派生成员 == 原常量成员。
- **生产行为变化如实记录（Q23 锁定）**：`mapConfigRow` 恒显式产出 writeMode（DB 默认
  `manual`）→ 生产默认逐写执行前确认（链内亦逐写）；用户显式切 `auto` 后为链式执行 +
  链末汇总确认。铁律一不削弱：两模式确认必经。

## 15. 子任务并行调度契约（agent-multi-intent 任务 8，Q24）

> 实现：`src/main/ai/agent/subtaskScheduler.ts`（纯调度器 + 波次驱动）+
> `subtaskOrchestrator.ts`（runParallelChain / runParallelClarification / BranchInteractionGate）+
> `agentLoop.ts`（runSubtaskSegment 分支轮次段）。测试：`tests/main/ai/subtaskParallel.test.ts`（13 例）。
> 零 DB 改动（不加 `parent_id`、`agentTaskDao` 出队与 `maxConcurrent=1` 维持原状）；
> 并行**仅限链内子任务**，依赖表达走 `intent_json.deps`（Q18 同口径）。

### 15.1 启用与回滚

- **启用信号**：`AgentLoopDeps.subtaskParallel`（生产 worker 注入 `true`）。缺省 = 串行链，
  gate 关路径与既有链路径零行为变化——该信号为计划外新增（守住「既有链测试零改动」红线），
  已在 status.md 记录偏离。
- **回滚旋钮**：`SUBTASK_PARALLEL_LIMIT = 2 → 1` 即调度器 dormant（每波仅派发一支，
  走分支上下文但行为与串行等价：工具轮 id、subtask_done 次数、最终内容、intent_json 态全等，
  `subtaskParallel.test.ts` ④ 等价用例钉死）。`deps.subtaskParallelLimit` 为测试/回滚缝。

### 15.2 出队（dispatch）条件 —— 四道闸任一不满足即拒绝，降级安全

1. **依赖满足**：`deps[s] ⊆ done(s)`（`buildDepsMap(plan)` 的 `serial_after` 归一，与任务 6/12 同源）；
2. **R/W 无交集**：`SubtaskDef.rw` + `object` 归一路径（反斜杠、`./` 前缀、末尾斜杠、大小写）
   比较——两写同对象、一写一读同对象 → `rw_conflict` 串行；只读恒不冲突；
   **fail-closed**：任一写方对象归一后为空 → 视为与所有在飞支冲突；
3. **在飞上限**：在飞数 < `SUBTASK_PARALLEL_LIMIT`（2），否则 `at_limit`；
4. **幂等键**：`sessionId|runId|taskId|subtaskId|tool|规范化入参 hash`（FNV-1a，键序无关）——
   dispatch 键 = `subtask_dispatch`，Set 进程内占位；重复占位 → `duplicate`；
   失败重试经 `retryPending` 释放键后重占（同轮同参不可重复执行）。

### 15.3 乐观锁（epoch）与结果聚合

- 链纪元 `chain.epoch`：每次重试 `retryPending` 前移；dispatch 记录当时 epoch。
- 收敛 CAS：`complete/fail(id, epoch, …)` 要求「状态 running ∧ epoch == dispatchEpoch」，
  否则判 `stale` **不覆盖**（旧尝试晚到、双推进一律丢弃）。
- 结果按 **taskId 显式聚合进结果数组**（`results(): BranchResultRecord[]`，entry 携带 taskId，
  禁对象覆盖语义——映射 LangGraph 并行合并裁定）。

### 15.4 分支执行与共享态

- `BranchContext` = 子任务 + 独立消息栈（base 快照 + directive + 已完成归档 + 本支指令，
  与串行 rebuild 同构）+ 独立 `DeadLoopDetector`（Q9 预算不串味）+ 轮次基址 `roundBase`。
- **轮次基址**：`已消耗轮次 + 波内序号 × SUBTASK_ROUND_STRIDE(1000)` —— 单支在飞时基址 =
  已消耗轮次 → `call_${round}_${index}` 与串行逐字一致（worker E2E 交互答案键不失配）；
  并发支错开 1000 防碰撞（链封顶 ≤ 24 轮，跨波不重叠）。
- **共享可变态只在主线程串行段修改**：`writeBatch`（push 时按分支克隆 `currentSubtaskId`
  落标）/ `toolCallsHistory` / `replacementState` 以引用共享、同步 push；
  `llmMessages` / `detector` / `intent` / `tools` / `toolCtx` 逐支克隆。
- 分支**不推 `ai:stream:chunk`**（多支交叉会污染渲染累积器）：波次空闲 flush 按队列序
  以单段 chunk 补发各 done 支全文，`subtask_done` 按「仍有余量全发、无余量除末支外发」
  镜像串行 n-1；渲染侧 `appendAssistant` 口径不变。
- 分支不做上下文压缩与 checkpoint（波次聚合后统一收口）；延迟工具 schema 预升级
  （分支无流内重发）；工具轮 assistant(tool_calls) + tool 行同一次 push 落栈，
  **§6.3 回填完整性逐支成立**（配对断言钉死）。

### 15.5 失败策略（Q19 合并 + Temporal retry 口径）

- **失败支不取消兄弟**：在飞支一律跑到终点；停链信号（中断/封顶/截断/致命）只阻止
  新派发，等在飞支收敛后统一 `stopChain`。
- **错误分类**（`classifyBranchError`）：参数/权限/MD5 陈旧/用户拒绝 → 立即失败**零退避**；
  其余（网络/超时/SQLite busy/乐观锁冲突等，缺省对齐 Q12「任何错误重试 1 次」）→
  退避 `1s × 2ⁿ` 封顶 8s（`computeBackoffMs`）。
- **重试单点**：`runScheduledLoop`（分支不私自循环），总闸复用 `SUBTASK_FAILURE_MAX_RETRIES=1`；
  重试前 `retryPending`（释放幂等键 + epoch 前移）。不可重试错误 LLM 恰一次调用。
- **终局聚合**（主线程串行段 flush）：done → buffer + completed 归档 + `markDone`；
  failed → `markFailed` + `cascadeSkipDependents` 级联（后继 `skipped_dependency` 出队）+
  跳过明示（与串行文案同口径）——**并行分支失败不弹 subtask_failed 卡**，失败并入
  链末执行报告（Q19「报告复用现有卡片」；串行链该交互保持不变）。
- **致命错误**（AbortError / consent_required / 交互取消）：原样上抛 → 外层统一
  `ai:stream:error` 收口（镜像串行）。
- **报告**：复用任务 7 `buildChainReport`（record 态 + chain.completed 链序），单次 DONE。

### 15.6 交互串行化（红线 6）

分支内确认/提问经 `BranchInteractionGate`：先挂起该支（parked），等**全部在飞支到达
子任务边界**（安全点），再按 FIFO 主线程逐个走真实 `onInteractionRequired` +
`waitForInteraction`（复用 waiting_interaction 原语），处理完放行该支续跑。
deps 无交互回调时不建闸——写档按「无交互拒写」fail-closed（铁律一不削弱）；
链末 `confirmWriteBatch` 汇总确认恒在主线程（波次收敛后）执行。

### 15.7 预算与边界

- `totalRoundsCap`（2×主意图）按**完成时累加** Σrounds（含失败半截轮）校验，
  触顶 → 安全点停链（现语义）；分支本地轮次由独立 detector 截断 → `truncated` →
  `stopChain(reason, truncatedCurrent)` 标当前 skipped + 余量 skipped。
- 低置信追问走 `runParallelClarification`（主线程串行交互；追问段追加进 directive，
  回答入队后同步进调度器）；依赖永远不可满足的残留标 `skipped_dependency` 入报告。

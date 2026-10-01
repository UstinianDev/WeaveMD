# Agent 工具运行时 — 执行、并发与外发闸（Tool Runtime）

> 规范编号：SPEC-AGENT-TOOL | 版本：v1.0（已实施）| 状态：生效 | 更新：2026-10-01
> 关联需求：[agent-perf-optimize.req.md](../../requirements/agent-perf-optimize.req.md)（S1~S5 / 硬性约束）、[doc-pipeline.req.md](../../requirements/doc-pipeline.req.md)（六-1 工具与引用 / 八-1 外发闸）、[agent-cost-optimize.req.md](../../requirements/agent-cost-optimize.req.md)（B3 结果预算）、[REQUIREMENTS.md](../../REQUIREMENTS.md) §3.7 / §3.9 / §3.12
> 关联模块：[11-AI代理面板-Agent.md](../../modules/11-AI代理面板-Agent.md)
> 关联架构：[ai-agent.md](../../architecture/ai-agent.md)、[backend.md](../../architecture/backend.md)、[security.md](../../architecture/security.md)
> 关联规范：[agent-message-storage.md](./agent-message-storage.md)（消息写读契约）

> 本文只写长期有效的实现级行为契约。需求动机、验收与红线见关联 req，两边重复的只在 req 保留，本文引用不复述。
> 来源标注中的 `../../plan/*` 为过程计划文档，将随计划归档删除，仅留溯源线索；已与现码逐条核对（2026-10-01）。

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
- 现码锚点：`StreamingToolExecutor.ts:139`（`waitForAll` 定义）、`agentLoop.ts:691`（`waitForAll(FORCE_CONFIRM_TOOLS)`）、`agentLoop.ts:439`（延迟工具重发轮 skip-set = `FORCE_CONFIRM_TOOLS ∪ 本轮延迟工具`）。（来源：`docs/plan/agent-perf-optimize.connectivity.md` Chain 1、现码核对）

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
- 质量护栏（产物 payload、澄清问题、出处、错误警告等不削减）见 [agent-cost-optimize.req.md](../../requirements/agent-cost-optimize.req.md) §质量护栏，本文不复述。

## 7. 哈希统一 xxHash64

- `src/shared/utils/hashUtil.ts`：`xxHash64()` 异步（WASM 懒加载）、`xxHash64Sync()` 同步（djb2 降级）。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.4、现码 `hashUtil.ts`）
- 替换范围 = staleness 三处（`editBlocksHandler` / `previewFileRevision` / `previewPatchFilesHandler`）+ 渲染两处（`rewriteStore` / `DiffSummaryCard`）。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.4、现码核对）
- **`agentLoopGuard.ts` 的 MD5 明确不动**（死循环检测数据量小，风险 > 收益）。（来源：`docs/plan/agent-perf-optimize.plan.md` §2.4、[perf req 硬性约束](../../requirements/agent-perf-optimize.req.md)）

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

- **附件照常入 KB**（保住本地检索价值），`allowSend=false` 时在检索出口按 `source_type='attachment'` 过滤，而非不入 KB；入库时记录勾选授权标记供白名单过滤。（来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` B11、[doc-pipeline req §2 Q1](../../requirements/doc-pipeline.req.md)）

### 11.4 已知限制（生产不可达，不得写成承诺）

- **`useKnowledgeBase` 硬编码 `false`、`setUseKnowledgeBase` 全仓零调用方** → `toolsForIntent` 的 kbQa/rewrite/create/tech 四分支恒不注入 `searchKB`，11.1 的注入矩阵与检索 citation 分支**生产不触发**（已标注为 Module 10 移除后的废弃开关，**不恢复**）。（来源：`docs/plan/doc-pipeline.connectivity.md` §2 R1）
- **`allowSend` 无可达 UI 入口**（DB 默认 0，`ConsentOverlay` 触发条件依赖已死的 KB 开关）→ `filterKbEgressResults` **生产不执行**。（来源：`docs/plan/doc-pipeline.connectivity.md` §2 R2）
- 即：11.1 目前是**结构正确但生产不执行**的闸；11.2 是附件正文出口的**在用闸**。

## 12. 需求侧交叉引用

各优化项的需求动机、验收指标与硬性约束（工具行为不变、上下文不瘦身、`agentLoopGuard` MD5 不替换等）见 [agent-perf-optimize.req.md](../../requirements/agent-perf-optimize.req.md)；工具与引用的任务级验收见 [doc-pipeline.req.md](../../requirements/doc-pipeline.req.md) §1 模块六/八；结果预算与质量豁免清单见 [agent-cost-optimize.req.md](../../requirements/agent-cost-optimize.req.md)。本文不重复这些需求级结论。

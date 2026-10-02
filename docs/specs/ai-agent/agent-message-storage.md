# Agent 会话消息写读契约（Message Storage）

> 规范编号：SPEC-AGENT-MSG | 版本：v1.1（已实施）| 状态：生效 | 更新：2026-10-02
> 关联需求：[agent-memory-optimize.req.md](../../requirements/agent-memory-optimize.req.md)（P0-4 / P0-5 / 红线 1 / Q14~Q17）、[agent-memory-optimize-3.req.md](../../requirements/agent-memory-optimize-3.req.md)（D3 轨迹源）、[REQUIREMENTS.md](../../REQUIREMENTS.md) §3.7
> 关联模块：[11-AI代理面板-Agent.md](../../modules/11-AI代理面板-Agent.md)
> 关联架构：[backend.md](../../architecture/backend.md)、[database.md](../../architecture/database.md)
> 关联规范：[agent-tool-runtime.md](./agent-tool-runtime.md)（工具执行、并发与外发闸）

> 本文只写长期有效的实现级行为契约。需求动机、验收标准与红线见关联 req，两边重复的只在 req 保留，本文引用不复述。
> 来源标注中的 `../../plan/*` 为过程计划文档，已随计划退役（历史见 git），仅留溯源线索；已与现码逐条核对（2026-10-01）。

---

## 1. 适用范围

`ai_messages` 表在 Agent 会话链上的写入与回读契约，覆盖 `src/main/db/ai.ts`（DAO）、`src/main/ai/agent/agentContext.ts`（读取与回读修复）、`agentToolExecutor.ts` / `agentLoop.ts`（工具轮写入）。

非目标：渲染层显示规则（空 assistant 气泡与工作流卡片的排布）属模块文档范畴；工具执行语义见 [agent-tool-runtime.md](./agent-tool-runtime.md)。

## 2. 写入：一个工具轮 = 一个事务

### 2.1 事务边界

- **事务边界 = 一个工具轮的 assistant 行 + 本轮 N 条 tool 行**，由 `appendToolTurnWithAssistant` 在 `db.transaction()` 内单次完成：先 upsert assistant（带 `tool_calls`），再 `INSERT OR IGNORE` 本轮全部 tool 行，原子提交。事务内任一语句抛出即整体回滚，不产生半截轮。（来源：`docs/plan/agent-memory-optimize.plan.md` §5）
- **IPC 发送留在事务外**（避免同步 IPC 阻塞持有事务）；用户行与最终 assistant 行是既有事务外写，保持不变。（来源：`docs/plan/agent-memory-optimize.plan.md` §5、`docs/plan/agent-memory-optimize.connectivity.md` §2 L9 / §4）
- 写入按 `PendingToolWrite` 收集、循环后单次落库：`handleToolResult` 不再逐条 `appendMessage`。流式路径（`processStreamingToolRound`）与兜底路径（`executeToolRound`）同规则。（来源：`docs/plan/agent-memory-optimize.plan.md` §2.1 B-b）

### 2.2 幂等 id 与运行级盐 `runId`

- assistant id = `aturn_${convId}_${runId}_${round}`，tool id = `t_${convId}_${runId}_${round}_${index}`；assistant 用 `ON CONFLICT(id) DO UPDATE`（不改 `created_at` 以保持行序），tool 用 `INSERT OR IGNORE`，同轮重试不产生重复行。（来源：`docs/plan/agent-memory-optimize.plan.md` §5、[req §六 Q16](../../requirements/agent-memory-optimize.req.md)）
- **`runId` 为运行级盐，不可省略**：`round` 每次运行从 0 重计，缺 `runId` 时同会话第二条消息的 round 0 会撞第一次的 id——assistant 行被覆盖、tool 行 `INSERT OR IGNORE` 保留旧内容，导致该轮工具结果整体丢失、历史 assistant/tool 错配。`runId` 由 `prepareAgentContext` 每运行 `randomUUID()` 生成一次，挂 `AgentContext.runId`，整轮运行内稳定。（来源：`docs/plan/agent-memory-optimize.plan.md` §5（Q16 修正）、`docs/plan/agent-memory-optimize.status.md` Q16 裁定、[req §六 Q16](../../requirements/agent-memory-optimize.req.md)）

### 2.3 `tool_calls` 唯一写入点

- `appendToolTurnWithAssistant` 是 `tool_calls` 的唯一写入点；渲染侧回写链 `updateLatestAssistantToolCalls`（原 6 处：store → preload → chatHandlers → db → bridge → test mock）已整体拆除，通道常量保留。按 messageId 的 `updateMessageToolCalls` 入口保留。（来源：`docs/plan/agent-memory-optimize.plan.md` §5 回写链拆除、`docs/plan/agent-memory-optimize.connectivity.md` §2 L5）

## 3. 回读：轮窗口 → 形状转换 → 配对修复

回读链固定顺序：`getRecentMessagesByRounds` → map（`tool_calls` 形状转换）→ 图片注入 → 空 content 过滤 → `cleanupIncompleteMessages` → `repairToolTurnPairing`。（来源：`docs/plan/agent-memory-optimize.plan.md` §5 回读路径）

### 3.1 轮次窗口 `getRecentMessagesByRounds`

- SQL：`ORDER BY created_at DESC, rowid DESC` + `stmt.iterate()` 流式累加；**超预算在轮边界停，但至少保留最近 1 轮**；末尾 `reverse()` 返回时间正序；**不设行数硬上限**。（来源：`docs/plan/agent-memory-optimize.plan.md` §2.1 B-a / §5、`docs/plan/agent-memory-optimize.connectivity.md` §2 L2）
- 窗口语义 = `max(最近 3 轮全量, 20 行水位线)`：**轮数保下界、20 由上限降为水位线、字节闸管上界**。（来源：`docs/plan/agent-memory-optimize.plan.md` §7-4、[req §六 Q15](../../requirements/agent-memory-optimize.req.md)）
- 调用参数：`KEEP_RECENT_ROUNDS = 3`、字节预算 `HISTORY_BYTE_BUDGET = 45_000`（UTF-8 字节，初值 **[待按 `CONTEXT_WINDOW = 64_000` 实测调优]**）。（来源：`docs/plan/agent-memory-optimize.plan.md` §7-3、现码 `agentContext.ts:110`）
- 行序兜底：`getMessagesByConversation` 排序补 `rowid ASC`，防同毫秒批写（同轮 assistant + tool 行）并列乱序。（来源：`docs/plan/agent-memory-optimize.plan.md` §2.1 B-a、现码 `db/ai.ts:929-933`）
- 意图轮数走 `getRoundsForIntent` / `KEEP_RECENT_ROUNDS`，历史长度最终交给 `buildCompressed`（阈值 0.85/0.65）三闸控上界。（来源：`docs/plan/agent-memory-optimize.plan.md` §5）

### 3.2 DB → LLM 形状（Q17）

- DB `tool_calls` 列存 `IAgentToolCall[]`，provider 要 `assembleToolTurn` 的 `{id, type:'function', function:{name, arguments}}`。**回读必须经 `toLlmToolCalls` 转换，原样透传必然 400。**（来源：`docs/plan/agent-memory-optimize.status.md` Q17、`docs/plan/agent-memory-optimize.connectivity.md` §2 L3）
- 转换后整条回读链统一 LLM 形状；`tool_call_id` 与 `attachments` 条件透传。（来源：`docs/plan/agent-memory-optimize.connectivity.md` §2 L2/L3）
- **空 content 过滤**：仅当「无 `tool_calls` 且无 `tool_call_id` 且正文全空白」才丢弃；`assistant(content:'', tool_calls)` 行必须放行，否则整轮工具调用在重载后消失。（来源：`docs/plan/agent-memory-optimize.plan.md` §2.1 B-c、现码 `agentContext.ts:504-511`）

### 3.3 配对修复 `repairToolTurnPairing`

- **只读、纯内存、永不写库**；必须在 `cleanupIncompleteMessages` **之后**调用；**不复用** `cleanupIncompleteMessages`（后者只按最后一条 assistant 截断、不校验 id 配对）。（来源：`docs/plan/agent-memory-optimize.plan.md` §5 / §2.1 B-c、[req Q14](../../requirements/agent-memory-optimize.req.md)）
- 三规则：
  1. assistant 有 `tool_calls` 缺配对 tool → **合成占位 tool 行**，文案锁定 `'[工具结果缺失：会话在该工具完成前中断，结果不可恢复]'`，**不剥 `tool_calls`**（避免丢失该轮；属信息损失但优于整体 400）；
  2. 孤儿 tool 行（前置无含该 id 的 `assistant.tool_calls`）→ **丢弃**（无法重建 `function.name`，provider 必拒）；
  3. 老数据中纯文本 assistant 行 → **原样保留**。
  （来源：`docs/plan/agent-memory-optimize.plan.md` §5）
- 配对键：`tc.id` ↔ `tool_call_id`，列值 `call_${round}_${index}`，与 `assembleToolTurn` 产的 id 一致。（来源：`docs/plan/agent-memory-optimize.status.md` Q17）
- 延迟重试路径维持「只改内存不写库」，不制造新孤儿；历史孤儿由配对修复兜住。（来源：`docs/plan/agent-memory-optimize.plan.md` §5）

### 3.4 迭代器关闭约定

- 分页/流式读取用**裸 `for...of` + `break`，禁止手动 `try/finally` 调 `return()`**：ES 规范中 break 与抛错都走 IteratorClose；better-sqlite3 `Next()` 收到 `SQLITE_DONE` 已自行 Cleanup，finally 手动 `return()` 会把 close 打成 2 次 Cleanup。（来源：`docs/plan/agent-memory-optimize.status.md` §批B「迭代器关闭定稿」）

### 3.5 轨迹分页 `getConversationMessagesPage`

- 执行轨迹导出（skill 提炼）走**隐式 rowid 数字游标**：`ai_messages.id` 是 TEXT 主键不可作数字游标，分页条件为 `WHERE conversation_id = ? AND user_id = ? AND rowid < ?`；返回 `nextCursor = 本页最旧一行的 rowId`。（来源：[memory-3 plan §6 D3](./agent-memory/03-recall-and-injection.md)、现码 `db/ai.ts:1004-1015`）
- **`getRecentMessagesByRounds` 与调用点零改动**（分页是纯新增查询，两条路径互不耦合）。（来源：[memory-3 plan §6 D3](./agent-memory/03-recall-and-injection.md)）

## 4. 事件时序（flush 与 IPC 的相对顺序）

- **tool / error 事件发送在 flush 之前；done 在 flush 之后**；flush 位于 `deadLoopBreak` 提前返回**之前**（流式与兜底两条路径同规则）；最终 assistant 行与用户行不入事务。（来源：`docs/plan/agent-memory-optimize.connectivity.md` §2 L9 / §4）
- 事务抛错不吞：上抛至 `runAgentFlow` catch → 发 `AI_STREAM_ERROR` → `agentTaskWorker.handleTaskError` 记 failed。（来源：`docs/plan/agent-memory-optimize.connectivity.md` §2 L1）

## 5. 兼容与迁移

- **无 DDL、无数据迁移**：`tool_calls` 列已在既有迁移中存在，老库直接读写。（来源：`docs/plan/agent-memory-optimize.plan.md` §5、`docs/plan/agent-memory-optimize.connectivity.md` §2 L1）
- 新读路径对存量三种形态（完整配对 / 孤儿 tool / 缺 `tool_calls` 的历史行）均产出合法序列。（来源：`docs/plan/agent-memory-optimize.plan.md` §5）

## 6. 已知限制 / 另立未修

- **`AI_CHAT` 不透传 `tool_calls`（潜伏）**：该 handler 只取 `user/assistant` 行、map 不带 `tool_calls`，会把新形状变成 `content:''` 的 assistant 序列发给 provider；渲染层全仓无 `.ai.chat(` 调用，**生产不可达**，`ipc.test.ts` 仍在测该 handler。（来源：`docs/plan/agent-memory-optimize.connectivity.md` §3 R3）
- **`anthropicClient` 静默丢 tool 行（另立未修）**：`anthropicClient.ts` 只识别 `system/user/assistant`，丢弃 `tool` 行与 `tool_calls`，重载后 Anthropic 会收到连续 `assistant('')`；未向真实 Anthropic API 实测返回码。（来源：`docs/plan/agent-memory-optimize.connectivity.md` §3 R4、`docs/plan/agent-memory-optimize.plan.md` §2.2 明确不动）
- **fake DB 盲区**：真实 `db.transaction()` 回滚与 `stmt.iterate()` 提前停机语义目前由自包含 fake 断言 + 源码取证覆盖，未跑 Electron smoke。（来源：`docs/plan/agent-memory-optimize.connectivity.md` §5、`docs/plan/agent-memory-optimize.status.md` 剩余风险）

## 7. 需求侧交叉引用

写入/读取的根因分析、验收断言、红线（不减少历史轮次、不截断工具结果、删能力需批准）见 [agent-memory-optimize.req.md](../../requirements/agent-memory-optimize.req.md) §二 P0-4/P0-5 与 §五；轨迹提炼的需求见 [agent-memory-optimize-3.req.md](../../requirements/agent-memory-optimize-3.req.md) D3。本文不重复这些需求级结论。

## 8. 多子任务执行报告与部分失败口径（agent-multi-intent 任务 7，Q19）

多意图链收口时的执行报告与部分失败策略契约（需求裁定：[agent-multi-intent.req.md](../../requirements/agent-multi-intent.req.md) §6 Q19；实现：`src/main/ai/agent/chainReport.ts` + `agentLoop.finalizeChainRun`）。

### 8.1 数据源三分

| 数据源 | 形态 | 写点 | 消费点 |
| --- | --- | --- | --- |
| 链 buffer 文本段 | assistant 正文**新增段** | `finalizeChainRun` 经 `appendChainNote(renderReportSegment(report))` 追加（条件渲染见 8.4） | 落库正文 + 渲染气泡（复用现有卡片，不新建卡片类型） |
| `intent_json.report` | 结构化对象（`ChainReport`） | 收口前 `tracker.setReport(report)` → `finalizeChainRecord` 随最终快照落盘 | `get_task_activity` 透出给 LLM 复查 |
| `intent_json.subtasks` | 追踪条目（任务 6 七态） | 链启动/推进/失败/收口四点推送 | `get_task_activity` 加法式字段 |

### 8.2 报告三态与形状

- `ChainReport = { v: 1, tasks[], artifacts[], batch: { accepted, rejected } }`；per-task `{ taskId, status: ok|failed|skipped, error, artifacts }`。
- 三态由 `SubtaskRunStatus` 归一：`done→ok`、`failed→failed`、其余（`pending/running/skipped/skipped_dependency/dependency_rejected`）→`skipped`。
- `tasks` 按**链执行序**输出：`chain.completed` 归档序在前，未归档剩余项（停链/低置信丢弃的 skipped）按 plan 序补尾。
- artifacts 归属：写批次条目 `WriteBatchItem.subtaskId` 由 orchestrator 在**子任务边界推进前**（`advanceChain` 入口）与**收口确认前**（`finalizeChainRun`）标注；仅确认后接受项入 artifacts，`target` 空串剔除。

### 8.3 部分失败：不全量回滚（Q19）

- 已完成写**保留**（`rollbackToSnapshot` 仅由用户逐项拒绝触发，失败本身不回滚）；失败子任务 `status=failed + error` 原文进 report，跳过明示与报告段双标注正文。
- **唯一例外——force/删除类**：用户确认 yes 后执行报错（非用户取消、非无交互拒执行）→ `checkForceConfirmTools` 上报 `chainForceFailure` → `handleSubtaskFailure({ skipRetry: true })` 直达 `subtask_failed` 交互，session 停 `waiting_interaction` 等人工：**不自动重试、不继续推进**；resume 答非 `no` → 跳过续链，答 `no` → 停链且 `outcome='failed'`（任务 6 预留产点，覆盖 `stopChain` 的 `stopped`）。
- LLM 调用失败仍走任务 5 原路径（重试 1 次 → `subtask_failed`），本章不改其语义。

### 8.4 同文件写链序与条件渲染

- main 侧只保证 `report.artifacts` 与 `chain.completed` **链序输出**（同文件不去重不排序）；同名合并归渲染端 `mergeProposalsByFile`（[02-diff-cards.md](../../modules/11-AI代理面板-Agent/02-diff-cards.md) §7.4），**报告 = assistant 文本段 + 既有 diff/activity 卡，不改 `ExecutionSegments` 分组维度**（Q19 裁剪）。
- 报告段条件渲染 `shouldRenderReport`：存在非 ok 子任务或存在保留产物才追加——**全成功且零产物的链不追加**，既有链正文全文断言（agentLoopSplit / subtaskSequence / clarificationMatrix 的 `toBe` 锚点）保持逐字节等价（红线 3/5）。追加只增不改写既有段。

### 8.5 兼容与已知限制交叉引用

- 向后兼容沿用本文 §5：无 DDL、无迁移；`get_task_activity` 为**加法式可选字段**（`subtasks?`/`report?`），坏 JSON / `intent_json` 为 null 一律降级「无追踪数据」不阻断查询。
- 已知限制沿用本文 §6 与 `agent-tool-runtime.md` §14.3：`rollbackToSnapshot` 为会话级 .md 内容回滚，非内容型写（createFile/renameFile 等）拒绝后无法逐项撤销；`confirmWriteBatch` 返回值保持 `string`（结构化结果经第三参 sink 传出，既有调用零改动）。

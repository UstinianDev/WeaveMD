# agent-multi-intent P1 连通性报告（e6d06df..87e9c63，只读核对）

> 阶段 6.5 产出，2026-10-02。区间含 9 提交（a5bff32→87e9c63）；`03d60b3` 为区间前基线，其 fail-closed 语义由 `1587976` 继承扩展为 `computeRoundSkipSet`。

## 1. intent_json 追踪链 — ✅

- `subtaskOrchestrator.ts:693 / :602,607,611,614 / :827`：启动、边界推进（4 处）、失败停链四点推送齐备；并行版 `:1144/:1235/:1250`、澄清版 `:1328-1339` 同口径。
- `chainTracking.ts:162-170` emitChainRecord 回调可选 + try/catch 吞错；`:176 finalizeChainRecord` 只补缺省 outcome。
- `agentTaskWorker.ts:649-655` → `agentSessionDao.ts:242 saveIntentJson / :261 getIntentJson 坏 JSON→null`：链路闭合。
- 读端 `getTaskActivity.ts:95-127(parseIntentTracking) / :186,197-198`：降级 + 加法透出 subtasks/report。
- 形状核对：写端 `chainTracking.ts:87-99` 与 `src/shared/ai/intentRecord.ts:51-66` 字段逐一一致。
- 观察：串行澄清 markSkipped（:340）无即时 emit，靠下一 advanceChain/收口补齐（收口必达）。

## 2. 报告管线 — ✅

- `agentLoop.ts:386-423 finalizeChainRun`：stamp → confirmWriteBatch(sink) → 级联标注 → buildChainReport → 条件 renderReportSegment → setReport → finalizeChainRecord → 单次 DONE。
- `agentToolExecutor.ts:459-476` 第三参 sink；`:418 chainForceFailure` → `agentLoop.ts:926` → handleSubtaskFailure({skipRetry}) → subtask_failed 停等。
- 并行分支 force 失败走 failed+noRetry 不弹卡 = TDD `:1368` 裁定（设计口径，非缺陷）。

## 3. 三层意图链 — ✅

- 预取 `agentLoop.ts:294-317`（外层 try + lazy decrypt 内层 try）+ `intentTiering.ts:190-199` 兜底 fail-closed。
- 三调用点：`agentContext.ts:559` 主分类、`:437` 技能推断、`kbSearch.ts:397` 只读——均 try/catch 回落 `classifyIntent`（行号较计划偏移因区间增行，身份一致）。
- 缓存 `intentTiering.ts:94-106 只读 / :157-189 仅 tier2 成功才 cacheSet`；prefetch 缺省写双键，kbSearch hasHistory=false 命中。

## 4. KB 透传链 — ✅（1 诊断面观察）

- 注入 `agentContext.ts:670` → 切换 `subtaskOrchestrator.ts:476`（串行）/ `agentLoop.ts:1124`（分支克隆）→ `searchKBHandler.ts:133` → `kbSearch.ts:405` diagnostics。
- 预载闸 `subtaskOrchestrator.ts:477-487`（kbQa && deps.searchKb && args[1]）；分支同款 `agentLoop.ts:1125-1131`；恰一次兜底 `agentKbPreloader.ts:188-196`。
- 观察：预载调用不带 agentIntent（`:158`），命中时 diagnostics 缺该字段——已测知（kbIntentBridge.test:546），仅诊断面。

## 5. writeMode 配置链 — ✅

- `db/index.ts:256`（write_mode 列 DEFAULT 'manual'，幂等补列属 schema 内建口径）→ `db/ai.ts:187` → `ipc/shared.ts:32` → `agentTaskWorker.ts:315` → `agentContext.ts:876 ?? 'auto'`。
- 消费 `agentToolExecutor.ts:302`（manual 逐写）+ `agentLoop.ts:982-994 computeRoundSkipSet` 两消费点 `:705/:1032`。
- 权威倒置 `confirmMatrix.ts:28,34,77` ← `agentToolSelector.ts:37-40 派生再导出`，成员 7 项一致 + 交叉测试。

## 6. 并行链 — ✅

- 出队四闸 `subtaskScheduler.ts:323-333`（deps/at_limit/rw_conflict/duplicate）+ 收敛 epoch CAS `:344-347`。
- 分支构建 `subtaskOrchestrator.ts:909-937` → 派发 `:1147-1163` → `agentLoop.ts:1108 runSubtaskSegment`；波次归档 `:1089-1145`；单次 DONE `agentLoop.ts:455-465`。
- 交互串行化 `subtaskOrchestrator.ts:954-1021 BranchInteractionGate` + `:1065-1068`（仅在有交互回调时创建）。
- 开关 `agentTaskWorker.ts:658 subtaskParallel:true` → `agentLoop.ts:156` → `subtaskOrchestrator.ts:659,666`；回滚旋钮 LIMIT=1。
- subtask_done：`sendSubtaskDoneFor :1030` → `preload.ts:533-547` → `agentStore.ts:525` → `AgentTab.tsx:201`。
- 观察：`gate.cancelled`（:960,1010）只写不读，死字段（rethrow 已足够传播）。

## 7. 级联链 — ✅

- deps 同源：`subtaskOrchestrator.ts:237` 与 `chainTracking.ts:71` 同一 `buildDepsMap` → 与落盘 `intent_json.deps` 等价；闭包 `:246-270`。
- 状态跃迁 `chainTracking.ts:131-143`；三处标注（链中跳过 `:834-849`、并行 flush `:1120-1131`、链末拒绝 `agentLoop.ts:401-417`）。
- 报告级联行 `chainReport.ts:89-98/:139-144` → intent_json.report → `getTaskActivity.ts:198`。

## 8. 错误收口 — ⚠️（1 处条件性死锁，必修）

- 并行 reject/取消 fatal → `subtaskScheduler.ts:506-518` → `subtaskOrchestrator.ts:1220` → `agentTaskWorker.ts:342-353 AI_STREAM_ERROR` ✅；分支 Abort/consent 上抛 `agentLoop.ts:1201-1204` ✅。
- 追问取消（串行 `:327-333`/并行 `:1304-1309`）丢弃明示收口 ✅；manual 确认取消 `agentToolExecutor.ts:305-330` catch → 下一轮 aborted 上抛 ✅；prefetch 双层 fail-closed ✅。
- **⚠️ 条件性死锁（必修）**：`BranchInteractionGate.wait` 先过栅栏、**后**注册 pending（`subtaskOrchestrator.ts:983-1008` vs `agentTaskWorker.ts:631-634`）。`cancelTask`（`agentTaskWorker.ts:181-194`，先 reject 已注册者再 abort）若恰在分支 parked 于栅栏时执行，该分支随后注册的 `waitForInteraction` 无任何 reject 源（二次 cancel 因 `if (controller)` 失效，worker finally 需 runAgentFlow 返回才可达）→ runAgentFlow 挂死：session 卡 waiting_interaction、conversationTaskMap 残留致后续 cancelByConversationId 失效。串行路径无此窗口（调用即登记）。用户答卡可自愈，否则永久挂起。

## 汇总

| # | 链 | 结论 |
|---|----|------|
| 1 | intent_json 追踪 | ✅ |
| 2 | 报告管线 | ✅ |
| 3 | 三层意图 | ✅ |
| 4 | KB 透传 | ✅ |
| 5 | writeMode 配置 | ✅ |
| 6 | 并行链 | ✅ |
| 7 | 级联链 | ✅ |
| 8 | 错误收口 | ✅ 已修复（原 ⚠️ 条件性挂死，fix 提交见 TDD「连通性修复」章） |

**必修项（已修复，2026-10-03）**：采用方案「`waitForInteraction` 注册时校验 `abortController.signal.aborted` 立即 reject + abort 事件兜底监听」（`buildAgentDeps` 增参传入 controller），覆盖取消在注册前/中/后全部交错；`branch gate` 串行队列语义不变。RED 实测 2 例 `Test timed out in 3000ms`（挂死实锤）→ GREEN 9/9，见 `docs/testing/agent-multi-intent.tdd.md`「连通性修复」章。原计划的 `subtaskParallel.test.ts` 取消用例改落 `subtaskConfirmResume.test.ts`（复用既有 worker E2E harness，避开全文件 mock 重建）。

**非必修观察**：`gate.cancelled` 死字段；预载命中 diagnostics 缺 agentIntent（已测知）；串行澄清 markSkipped 无即时 emit（收口必达）；并行 force 失败不弹卡（TDD:1368 裁定）。

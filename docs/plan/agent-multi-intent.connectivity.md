# agent-multi-intent 模块间契约连通性报告（e739016..4422ac9，只读核对）

> 阶段 6.5 产出，2026-10-02。核对方式：变更文件清单 + 逐链读码核对接口契约（通道名、variant、answers key、字段类型、错误收口）。

## 1. 拆分交互链 — ✅ 通畅

- 主进程发起：`src/main/ai/agent/subtaskOrchestrator.ts:120-128` `onInteractionRequired(questions,'intent_split',undefined,undefined,plan)` → `waitForInteraction` → `parseSplitAnswers` 读 `answers.split_plan`（:89-98）。
- gate 前置：`src/main/ai/agent/agentContext.ts:537-541` `detectMultiIntentGate` try/catch fail-closed 关闸；`src/main/ai/agent/agentLoop.ts:331-355` 消费 → `startSubtaskChain`。
- payload 组装：`src/main/ai/agent/agentTaskWorker.ts:610-632` `{sessionId,conversationId,questions,variant,round,totalRounds,plan}` → `IPC_CHANNELS.AGENT_INTERACTION_QUESTION`；`waitForInteraction` 同步注册（:629-632）。
- 类型两端一致：`src/shared/ai/agent.ts:64-73`（`AgentInteractionPayload.plan?: AgentTaskPlan`）与 :90-100（流事件 `plan`）；worker 实现签名第 5 参 `plan?: AgentTaskPlan` 与 `agentLoop.ts:108-116` deps 声明一致。
- 桥接：`src/main/preload.ts:519-531` 透传 `variant/round/totalRounds/plan`；`src/render/stores/agentStore.ts:513-522` → `:1046-1057` 写入 `pendingInteraction.plan`。
- 分派：`src/render/components/AIAgent/panel/AIPanelSession.tsx:119-123` `variant==='intent_split' && plan` → `SplitConfirmCard`。
- 回传：`SplitConfirmCard.tsx:61-66` `{split_plan: JSON}` → `agentStore.ts:1880-1898` → `preload.ts:440-441` AGENT_RESUME_INTERACTION → `src/main/ai/ipc/agentHandlers.ts:351-369` → `agentTaskWorker.ts:216-225` resolve。variant、`plan` 类型、`split_plan` key 三者两端完全一致。
- 边缘风险（非断裂）：① `AIPanelSession.tsx:120` 无 `plan` 时回退 QuestionCard，回传 `{intent_split:'yes'}` → `parseSplitAnswers` 返 null 静默降级单意图；② `agentStore.ts:1939-1996` replayEvents 无 `interaction` 分支，刷新页面即丢卡片（主进程仍等，直到 supersede/取消）——均为既有 R3/replay 行为，新链复用。

## 2. 追问链（任务3） — ⚠️ 风险

- 发起：`subtaskOrchestrator.ts:212-217` variant `'subtask_clarify'` + `round/totalRounds`（每轮 ≤2，:204-210）；渲染走 `AIPanelSession.tsx:124-131` 默认 QuestionCard（round/totalRounds 透传）。
- 回答合并：`subtaskOrchestrator.ts:219-230` `answers?.[subtask.id]` → `params.clarification`；消费在 `agentPromptBuilder.ts:559-560`（`参数：{...JSON}` 进子任务指令）→ `issueNextSubtask` 续链（:247-267）。variant 与 answers key（子任务 id）两端一致 ✅。
- 风险：`QuestionCard.tsx:154-164` 强制非空提交且无取消/跳过按钮，主进程「空回答 → 未能澄清丢弃」分支（`subtaskOrchestrator.ts:227-229`）UI 不可达，用户不想答时只能发新消息（supersede）触发取消；取消路径 `:231-237` 本身有收口。

## 3. 写批次确认链（任务11） — ✅ 通畅

- 发起：`src/main/ai/agent/agentToolExecutor.ts:315-358` `onInteractionRequired(questions,'write_batch')`（:332），questions id = `toolCallId`（:324-331），与收集时 id 生成 `call_${round}_${tc.index}`（:219、:237-242）同源。
- 收口：`agentLoop.ts:324-329` `finalizeChainRun` → `confirmWriteBatch` → `appendChainNote` → 单次 DONE；链全部 9 个出口均走 `finalizeChainRun`；`ctx.writeBatch=[]` 在 `subtaskOrchestrator.ts:479` 链启动置位。
- 渲染：`AIPanelSession.tsx:122-123` → `BatchConfirmCard`；`BatchConfirmCard.tsx:39-45` `answers[q.id]='yes'|'no'`。
- 拒绝处理：`agentToolExecutor.ts:335-358` `answers[toolCallId]==='no'` → `rollbackToSnapshot`（:342）→ 仅重放已接受的 `editLocalFile`（:349-357）；新建/重命名/移动不在内容快照粒度内（:309-311 文档如实记录）。无交互环境 batch 档拒执行 fail-closed（:225-231）。

## 4. 失败等待链（任务5） — ✅ 通畅（附文案 nit）

- 发起：`subtaskOrchestrator.ts:609-619` variant `'subtask_failed'`，问题 id `SUBTASK_FAILED_QUESTION_ID='subtask_failed'`（:55）；`answers['no']` → `stopChain` + `'finalize'`（:615-617）。
- 消费：`agentLoop.ts:507-525` `handleSubtaskFailure` 返回值 → `'finalize'` 落 `finalizeChainRun('')`；其余 → 跳过/重试/续链（:513-522）。
- 渲染：`AIPanelSession.tsx:124-131` 默认 QuestionCard，confirm 按钮产出 `'yes'/'no'`（`QuestionCard.tsx:372-404`）→ key/值两端一致 ✅。
- nit：问题 `options:['跳过并继续','停止执行']`（`subtaskOrchestrator.ts:577`）被 QuestionCard confirm 分支忽略，按钮显示「是/否」——与题干语义一致，纯文案损耗，非契约断裂。

## 5. 流事件链（subtask_done） — ✅ 通畅

- 通道：`src/shared/constants.ts:215` `AI_SUBTASK_DONE:'ai:stream:subtask_done'`；发射 `subtaskOrchestrator.ts:372-381`（`issueNextSubtask` :411 调用，1..n-1 口径）。
- 类型联合：`src/shared/ai/agent.ts:103-112` 并入 `IAgentStreamEvent`；preload 契约 `preload.ts:190` 显式含该类型。
- 桥接：`preload.ts:533-547` 订阅同通道映射为 `type:'subtask_done'`（字段三端同名）。
- 消费：`agentStore.ts:525-528` → `flushAccumulatedSubtask`（:804-825）；`AgentTab.tsx:203-210` `onStreamFlush` 清 buffer（注册/反注册齐全 :211-214）。chunk 先于 subtask_done 发送，顺序无竞态。

## 6. skip-set 派生链（任务11） — ✅ 已修复（原 ⚠️，fix `03d60b3`）

> 2026-10-02 修复复核：`confirmSkipSet(intent, inChain, toolNames)` 改为逐名判档——未登记名恒入 skip（fail-closed）、
> 已登记档位与 inChain 现语义零变化；`checkForceConfirmTools` 单意图未登记工具由直通改为拒绝；两消费点传本轮实际工具名。
> 下文为原始发现记录。

- 消费点恰两处：`agentLoop.ts:589-594`（延迟重发）与 `:859-861`（常规轮 `waitForAll`）。
- 第三处核对：基线 e739016 全仓仅 3 个 `FORCE_CONFIRM_TOOLS` 消费者，现全部改造为 `confirmSkipSet` / `confirmTierFor`，无遗漏；`StreamingToolExecutor.ts:137` 为过期注释（建议顺手改）。
- 正确性前提：7 个 `WRITE_TOOLS` 全部 `defaultSafe:false`，`waitForAll` 只按 skip 集过滤 **queued** 工具——当前无「skip 集含并发安全工具」情形。
- **风险**：`confirmSkipSet` 只遍历 `WRITE_TOOLS`（`confirmMatrix.ts:72-79`），而 `confirmTierFor` 对未登记工具 fail-closed 到 `'batch'`（:46-51）——未登记的写类工具在流式主路径会被 `waitForAll` 直接执行、永远到不了 `checkForceConfirmTools`，矩阵 fail-closed 声明仅在兜底路径 `executeToolRound` 成立。**建议修复**：`confirmSkipSet` 对未登记名同样入 skip（fail-closed 方向）。

## 7. 错误处理 — ✅ 通畅（收口齐全，附 2 条残留风险）

- `isChainInterrupted` fail-safe：`agentTaskWorker.ts:635-644` try/catch 查询失败返 `false`；调用点可选链（`subtaskOrchestrator.ts:256/448`）。
- reject/cancel 收口：拆分 → null 降级；追问 → 丢弃明示；subtask 失败 reject → 外层 catch 发 `AI_STREAM_ERROR`（`subtaskSequence.test.ts:731` 钉死）；`confirmWriteBatch` reject → worker `handleTaskError` 兜底；`cancelTask` :185-190 与 finally :356-362 双保险 reject，无残留 waiter。
- 风险①：mainWindow 销毁时不发卡片但 `waitForInteraction` 无超时 → 需 supersede/取消才解（既有 R3 模式，被 4 个新交互复用）。
- 风险②：任务取消时渲染侧 error/cancel 分支不清 `pendingInteraction`（`agentStore.ts:537-555`），卡片残留到用户提交或发新消息；`resumeInteraction` 无 pending 也返 `resumed:true`，不死锁。

## 汇总

| # | 链 | 状态 |
|---|----|------|
| 1 | 拆分交互（intent_split / plan / split_plan） | ✅ |
| 2 | 低置信追问（subtask_clarify / 子任务 id） | ⚠️ 追问卡无跳过出口，空答丢弃分支 UI 不可达 |
| 3 | 写批次确认（write_batch / toolCallId / rollback） | ✅ |
| 4 | 失败等待（subtask_failed / yes-no） | ✅（options 文案 nit） |
| 5 | 流事件 subtask_done（通道/类型/flush 三端） | ✅ |
| 6 | skip-set 派生（confirmSkipSet） | ⚠️ 未登记工具在流式路径绕过矩阵 fail-closed |
| 7 | 错误收口 / isChainInterrupted fail-safe | ✅（残留：无超时等待 + 取消后卡片残留） |

**结论：无 ❌ 断裂**；3 处 ⚠️ 处置：⑥ 列入本轮必修（fail-closed 补全）；②③ 为既有模式复用（非本批回归），记入遗留问题清单。

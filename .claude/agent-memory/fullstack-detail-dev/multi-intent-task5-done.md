---
name: multi-intent-task5-done
description: agent-multi-intent P0 任务 5（子任务链加固）已交付于 d9c4682；链重建语义钉死口径、轮次预算实现方式、失败重试边界与 RED 归因法
metadata:
  type: project
---

agent-multi-intent P0 任务 5 已完成并提交（本地 main `d9c4682`，未推送）：per-subtask
detector + `subtaskTotalRoundsCap = 2×getRoundsForIntent(primaryIntent)` 双闸 /
`baseMessages` 快照重建 + `SUBTASK_SUMMARY_MAX_CHARS=500` 摘要注入 /
`isChainInterrupted` 边界安全点 / LLM 失败重试 1 次 → `subtask_failed` 交互 /
`subtask_done` 流事件通路 / `hasPendingForConversation`；新建
`tests/main/ai/subtaskSequence.test.ts` 11 例；基线 4587 例。接续 [[multi-intent-task3-done]]。

**Why:** 任务 11（确认矩阵）要继续改 agentLoop/agentToolExecutor；下面是任务 5 实施中
「按直觉会改错」的钉死口径与坑。

**How to apply:**
1. **链重建语义（既有测试钉死）**：边界重建 = `baseMessages 快照 + 拆分段 + Σ已完成
   (指令 system 行 + 摘要 assistant 行) + 当前指令`——`agentLoopSplit` round2 断言
   「拆分段 + 子任务 1 指令 + 其产出 assistant 行」必须在场，**摘要行用 assistant 角色**
   才不破旧断言；DB 仍链末单条 append（buffer 全量），`subtask_done` 只做渲染侧
   live 分泡（内容等价、reload 后合回一条，属既定取舍）。
2. **轮次实现**：`subtaskRound = round - chain.subtaskStartRound`（边界/失败时设
   `start = round + 1`）；**绝不回绕 `round`**——`roundsUsed = round + 1` 是全局口径，
   既有测试断言 roundsUsed=2/3/9。预算检查在轮首：链路径 `checkRoundLimit(subtaskRound)`
   + `round >= totalRoundsCap` 硬闸；非链路径保持 `checkRoundLimit(round)` 原样。
3. **失败范围**：只包 for-await（LLM 流失败）；AbortError/consent/非链直接 rethrow；
   `waitForInteraction` reject **上抛**（外层 AI_STREAM_ERROR 收口，worker 按
   aborted 判 cancelled）——不要在编排层吞 reject 写 DONE（会把 cancelled 覆盖成 completed）。
   工具确认/追问取消沿用既有语义不进重试。
4. **两个易错点（已踩过/避开）**：① `applySubtaskContext` **不能重置 retryCount**
   （重试第二次会变无限重试），归零放 `issueNextSubtask`；② `runChainClarification`
   签名多了 `round`（全低置信链首预追问传 `-1`，下一条指令 start=0）；
   `finalizeRun` 闭包必须定义在 gate 块**之前**（预追问早退用它，否则 TDZ）。
5. **RED 归因法**：新符号（IPC 通道/常量）**不要 import 进测试**（模块级 export 缺失会让
   整文件收集失败，丢掉逐条归因）——用字面量 + 行为断言，11 例全部收集、10 红 1 钉。
   逐子任务 intent 的直接证据 = spy `getCostTracker().recordUsage` 的 `intent` 序列
   （chunk 需 yield usage）；预算控制用 mock intentRouter（classify/gate 可控）。
6. playwright 基线 31 例（零新增）：drag-selection 5（当前 RED）、editor-table 7、
   feedback 5、ai-agent-panel 4（A4/A2/A3/① 改写链）、exit-behavior 2、thematic-break 2、
   floating-toolbar 2、editor/image-resize/recent-history-restore/welcome-doc 各 1。

---
name: multi-intent-task3-done
description: agent-multi-intent P0 任务 3（置信度追问）已交付于 850d615；含链状态机新不变式、live-array mock 快照坑、追问测试独立选址、sha256 提示词红线二次验证
metadata:
  type: project
---

agent-multi-intent P0 任务 3 已完成并提交（本地 main `850d615`，未推送）：
`subtaskOrchestrator.ts` 0.7 分流（queue / clarifyPending）+ 链末 `runChainClarification`
（每轮 ≤2 题、variant `subtask_clarify`、回答合并 `params.clarification`、丢弃明示进 buffer）
+ `agentPromptBuilder.buildSubtaskClarificationSegment`（独立 system 消息）+
agentLoop `clarify` 结果接线 + 新建 `tests/main/ai/clarificationMatrix.test.ts`（6 例）。
接续 [[multi-intent-task2-done]]；测试基线 4576 例全绿。

**Why:** 任务 5（链加固）与任务 11（确认矩阵）都要继续改 `subtaskOrchestrator.ts` /
`agentLoop.ts` 同一批函数，下面几条是「按直觉会改错」的约束与坑。

**How to apply:**
1. **链状态机不变式（任务 5 改链必读）**：`SubtaskChain` 现为 `queue`（立即执行序列）+
   `clarifyPending` + `index`（queue 内最近下达指令的下标，**空队列起始为 -1**）；
   `advanceSubtaskChain` 返回三态 `continue | clarify | finished`。两处易错：
   返回 `clarify` 时本轮产出**必须先进 buffer**（追问后还有产出接续），随后
   `runChainClarification` 若返回 `finished`（全丢弃），收口须 `finalizeChainContent(chain, '')`
   —— 用 `assistantContent` 会把本轮文本重复拼接一次。
2. **全低置信链在进主循环前追问**（agentLoop `startSubtaskChain` 后 `queue.length === 0` 分支），
   否则首轮无子任务指令空跑；该分支全丢弃时链退化为空队列，跑一轮正常收口。
3. **sha256 红线二次验证**：`clarificationPrefix`（:396-401，clarify 变体钉死）与
   「分轮澄清策略」正文本轮**确认不可动**——任务 3 的提示词条款全部走新段
   （`buildSubtaskClarificationSegment`），同任务 2 的独立 system 消息先例。任务 5/11 动提示词同理。
4. **mock 的 messages 是实时数组**：`ctx.llmMessages` 按引用传给 LLM，
   `streamChatCompletion.mock.calls[n][0].messages` 在断言时已含后续轮次。
   负向断言（如「首轮不含某指令」）必须按调用时刻做快照
   （`clarificationMatrix.test.ts` 的 `roundSnapshots`）；`agentLoopSplit.test.ts`
   的存在性断言碰巧不受影响。
5. **追问矩阵测试选址裁定**：不挂 `agentContext.test.ts`（链级用例需在其顶层加
   taskPlanner/llmClient/guard mock，vi.mock 注册在文件顶层、影响其 80 例，
   触「既有测试零改动」红线），新建独立 `clarificationMatrix.test.ts` 且
   **intentRouter 用真实实现**（candidates/gate 语义须实测）。任务 5 的
   `subtaskSequence.test.ts` 计划本就是独立文件，mock 基座可直接复制该文件。
6. `variant: 'subtask_clarify'` 通路零 UI 改动：AIPanelSession 对非
   `intent_split`/`delete_confirm` variant 落默认 QuestionCard，
   `agentTaskWorker` 泛化转发 variant/round/totalRounds → playwright 本任务口径可跳。

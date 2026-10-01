---
name: multi-intent-task2-done
description: agent-multi-intent P0 任务 2（多意图预检门+结构化拆分+拆分确认卡）已交付于 a6b2348；含 mock 缺导出 fail-closed、提示词 sha256 红线、E2E 基线比对法三条硬约束
metadata:
  type: project
---

agent-multi-intent P0 任务 2 已完成并提交（本地 main `a6b2348`，未推送）：`intentRouter.detectMultiIntentGate`
+ `taskPlanner.ts`（buildTaskSplitMessages/runTaskSplit）+ `subtaskOrchestrator.ts`（确认编排 + 链 v1）+
agentContext gate/快照 + agentLoop 接线 + SplitConfirmCard/i18n×3 + 41 例新测试。接续 [[multi-intent-task1-done]]。

**Why:** 任务 3（追问矩阵）、任务 5（链加固）、任务 11（确认矩阵）都要改同一批文件，下面三条是「按直觉会改错」的约束。

**How to apply:**
1. **intentRouter 的 mock 缺导出会抛错**：vitest factory mock 访问未声明导出直接 throw（`tests/_probe.test.ts` 实测）。
   `agentLoop.test.ts` 的旧 mock 只有 `classifyIntent`，所以 `agentContext` 走 `import * as intentRouter` +
   **try/catch fail-closed** 调 gate。今后凡从 `intentRouter` 新增导出并在 `prepareAgentContext` 消费，
   必须同样兜底，否则旧 31 例全炸；新增 gate 消费点测试放 `agentLoopSplit.test.ts`（自建 mock 基座），
   **不要改 agentLoop.test.ts / agentContext.test.ts 的旧断言**（红线 1）。
2. **单意图提示词不可改**：`buildAgentSystemPrompt` 被 `agentPromptBuilder.test.ts` sha256 基线 +
   `agentContext.test.ts` 若干 `toBe(buildAgentSystemPrompt(...))` 全文断言钉死（且「请帮我写一篇关于 SQLite…」
   这类用例 gate 是开的，条件分支也躲不掉）。计划 §2 要求的 :428/:479 原地改写因此**改为独立 system 消息注入**
   （`buildSplitDirectiveSegment` / `buildSubtaskInstruction` 在链启动时 push）。任务 3 若要动提示词同理。
3. **E2E 31 例失败是 HEAD 既有**（104 passed/1 skipped；含 drag-selection 5 例自带「当前 RED」标注）。
   比对法：`git stash push -- <src 改动文件>` → 全量 `npx playwright test` → 恢复后逐条 diff 失败用例名
   （仅 thematic-break 的随机 `data-block-id` 有差异）。别再把这 31 例当本任务回归。
4. 口径复用：`normalizeTaskPlan` 串行标注 = 首条写不标、后续写 `serial_after:<前一写 id>`（只读不计入）；
   链落显 = DB 只落 1 条 assistant（`buffer + 末子任务产出`，与渲染累积一致），中间产出只进 llmMessages，
   `subtask_done` 事件属任务 5。

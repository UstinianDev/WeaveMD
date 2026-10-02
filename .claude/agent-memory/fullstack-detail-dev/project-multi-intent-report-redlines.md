---
name: multi-intent-report-redlines
description: 任务 7 两处「计划字面 vs 既有测试」红线裁定 + 链正文 toBe 锚点清单 + Q7 同对象写合并陷阱（任务 12 改 confirmWriteBatch 时必读）
metadata:
  type: project
---

agent-multi-intent P1 任务 7（提交 `4fcd6a2`）两处红线优先裁定，**任务 12 再改 `confirmWriteBatch` 时会撞同一条**：

1. **`confirmWriteBatch` 返回值必须保持 `string`**——既有 `agentToolExecutor.test.ts` 确认矩阵钉死 `expect(note).toBe('')`（全保留）与 `toContain('回滚')`（有拒绝）。计划要求的「返回值扩展 `{rejectedIds,...}`」以**可选第三参 sink**（`WriteBatchConfirmResult`，现文件已导出）实现；任务 12 计划里的 `返回 { rejectedIds, cascadeSkippedIds, staleIds }` 同样应走 sink/新增字段进 sink，不许改返回类型。
2. **链末报告段条件渲染**——`shouldRenderReport`（chainReport.ts）= 存在非 ok 子任务或存在保留产物才追加进 buffer。全成功零产物链必须不追加，否则破坏 6 处既有链正文 `toBe` 全文锚点：agentLoopSplit.test 431/465、subtaskSequence.test 476/531/570/684、clarificationMatrix.test 384。改 buffer 追加逻辑前先 grep 这些锚点。

**Why:** 红线「既有测试零改动全绿」优先于计划 §2 变更清单的字面表述（同任务 2/3/11 的 sha256 先例）；两处均已在 TDD 报告 §5 如实记录。

**How to apply:**
- 动 `agentToolExecutor.ts` / `agentLoop.finalizeChainRun` / 链 buffer 追加前，先核对上述锚点与 sink 模式。
- 链编排类测试的计划里 **`object` 必须互异**：`parseSplitAnswers → normalizeTaskPlan` 的 Q7 `mergeSameObjectWrites` 会把同对象写合并成一条（任务 7 RED 中间轮踩过）；要测「同文件写链序」用不同 object + 相同 tool args `file_path` 构造。
- force 档失败信号走返回值管线（`checkForceConfirmTools` → `ToolRoundResult.chainForceFailure` → agentLoop 工具轮后消费），未加 AgentContext 字段——任务 12 加 `currentSubtaskId` 时注意别与该信号路径混淆。
- 相关提交纪律见 [[multi-intent-p1-commit-discipline]]。

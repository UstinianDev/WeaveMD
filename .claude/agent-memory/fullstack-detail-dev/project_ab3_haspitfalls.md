---
name: project-ab3-haspitfalls
description: A-b-3 classifyIntent 接线完成；intentRouter chat 兜底分支返回显式 needsClarification:false（非省略），断言须用 not.toBe(true)
metadata:
  type: project
---

devflow 阶段 3 批 A 步骤 A-b-3（`agentContext.ts` 接线 `classifyIntent(message, { hasHistory })`）已按 TDD strict 完成，测试 22 绿。

**非显然细节**：`intentRouter.ts` 的零命中 chat 兜底分支（`scores.size === 0`）**直接返回对象字面量** `needsClarification: lengthGateEnabled && text.length < 10`，因此 `hasHistory:true` 时拿到的是**显式 `false`**，不是字段缺失；只有主分支用 `...(needsClarification ? {…} : {})` 条件展开。

**Why:** GREEN 阶段我按「字段被省略」写 `toBeUndefined()` 直接红，属断言形态预期错误而非行为错误。

**How to apply:** 断言澄清位是否置起一律用 `expect(ctx.intent.needsClarification).not.toBe(true)`（或 `toBe(false)`），不要用 `toBeUndefined()`。

**判定口径**：`hasHistory` = 上提后的**原始读取行** `dbRows`（`getMessagesByConversationPaginated` 结果）中存在 `role==='assistant'`；不读 `cleanupIncompleteMessages` 之后的数组；仅 user 孤立行 → false。相关 [[project_devflow_parallel_subagents]]。

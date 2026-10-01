---
name: multi-intent-p0-audit
description: agent-multi-intent P0 五提交（e739016..4422ac9）合规审查结论与三处遗留偏差
metadata:
  type: project
---

2026-10-02 对 agent-multi-intent P0 五提交（38edc57/a6b2348/850d615/d9c4682/4422ac9）做只读合规审查，结论 PASS（无必须修正项）。门禁实测：typecheck 0 错、vitest 196 文件 4686 全绿、eslint 0 error（108 warning 均既有）、vite build 过、playwright 104 passed/1 skipped。

**Why:** 后续任务（P1 4/6/7/9/12/13）会继续在 subtaskOrchestrator / confirmMatrix 上施工，三处偏差是已知起点。

**How to apply:**
1. `docs/plan/agent-multi-intent.*.md`（plan/status/connectivity）与 `docs/requirements/agent-multi-intent.req.md` 至今 **untracked 未入库**——计划 §3 要求每提交勾选 status，无法在 git 中核对；审查/提交时提醒补交。
2. 追问矩阵测试落在新文件 `tests/main/ai/clarificationMatrix.test.ts`（6 例①~⑥），偏离计划「挂 agentContext.test.ts、不新建文件」——内容齐全，视为已接受偏差，别再要求搬回。
3. **fail-closed 可达性缺口**：非链态流路径 skipSet 不含 batch（`confirmSkipSet(intent, false)`），写工具由 `StreamingToolExecutor.waitForAll` 直接执行，不经 `checkForceConfirmTools`——计划 §1.6「无交互拒全部写档」只在链态 + 兜底 `executeToolRound` 路径生效。相对基线无回退（单意图写本就不拦），但若 P1 要兑现全量 fail-closed，需在 skipSet 或 executor 侧补拦截。
4. `confirmWriteBatch` 无交互时 `return ''` 静默跳过——靠上游 batch 分支先拒执行兜底，属防御死分支。
5. AI Agent 卡片用 `text-red-400` 等 Tailwind 默认色是既有既成事实（QuestionCard/AgentWorkflowCard 同款），审查新卡片时按「与既有卡片一致」判定，不按禁默认色字面判 FAIL。

相关：[[MEMORY]]（索引）

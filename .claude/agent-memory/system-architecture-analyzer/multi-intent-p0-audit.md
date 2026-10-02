---
name: multi-intent-p0-audit
description: agent-multi-intent P1 八提交合规审查结论（2026-10-02，HEAD 87e9c63）与复审要点
metadata:
  type: project
---

agent-multi-intent P1 八提交（1bb52b5/4fcd6a2/d2b3168/7d1f8f4/7fa9eb5/1587976/cd61099/87e9c63）合规审查：**PASS（附 2 项必须修正）**。

**Why:** 交付核对阶段需要基线证据；下列事实复审时不必重查。
**How to apply:** 再审 P1/P2 增量时从本条出发，只复核增量。

- 门禁实测（2026-10-02）：typecheck 0 错 / vitest 205 文件 4781 例全绿 / lint 0 error 108 warning（=基线）/ vite build exit 0。
- 红线事实：`src/main/db/index.ts` 在八提交内 diff 为空；`write_mode` 幂等列（index.ts:256，ai_config 表）由 b55bd58 在审查范围**之前**引入，P1 只消费不加列；agent_sessions 仅写既有 `intent_json` 列（agentSessionDao.saveIntentJson 参数化）。
- 既有测试零改动（tests/ 全部为新增 A，无 M/D）；唯一 P1 内部改动 = `tests/main/ai/chainReport.test.ts` 一例（任务7③ → Q22 级联语义取代），status.md:220 / tdd.md:1185 已如实声明。
- 必须修正 2 项：① `src/main/ai/agent/subtaskScheduler.ts:495` 裸 `.then`（CONVENTIONS 禁止）；② `docs/requirements/agent-multi-intent.req.md` §6 Q17~Q24、`docs/plan/agent-multi-intent.status.md` 阶段勾选、`docs/plan/agent-multi-intent-p1.plan.md`（untracked）均未随八提交入库——代码注释引用的裁定不在 git 历史。
- 复审快捷证据点：fail-closed 收敛在 `agentLoop.computeRoundSkipSet`（caller 侧补 skip，confirmSkipSet 本体不动）；confirmMatrix 权威倒置 + `writeModeConsumption.test.ts` ⑤ 交叉断言；无交互拒写入口 `agentToolExecutor.ts` batch 档首闸。
- playwright：任务 4/9/12/13/8/10 均按「不触 src/render」先例跳过（tdd.md 各章有记录），交付阶段建议补跑全量 E2E。

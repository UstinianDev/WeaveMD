---
name: multi-intent-p1-commit-discipline
description: agent-multi-intent P1 八任务的提交纪律——status/req/plan 三个 docs 文件永不入库，只按任务白名单 git add
metadata:
  type: project
---

P1 多意图八任务（顺序 6→7→4→9→12→13→8→10，裁定见 `docs/requirements/agent-multi-intent.req.md` §6）每任务一个提交，**严禁 `git add -A/.`**。

**Why:** 工作区常年保有三个不入库文件：`docs/plan/agent-multi-intent.status.md`（任务记录本地同步、不提交）、`docs/requirements/agent-multi-intent.req.md`、`docs/plan/agent-multi-intent-p1.plan.md`（未跟踪）。整体 add 会把它们混进任务提交。

**How to apply:** 每任务提交前按计划 §3 变更清单表显式列出路径 add；status.md 只在本地更新任务记录（含提交哈希）。任务 6 已按此交付 `1bb52b5`、任务 7 已按此交付 `4fcd6a2`、任务 4 已按此交付 `d2b3168`、任务 9 已按此交付 `7d1f8f4`（均 2026-10-02）。红线核对点：`git diff src/main/db/index.ts` 必须为空（全程零加列）、`onChainRecordUpdate` 回调可选（未注入既有测试零改动全绿）、TDD 证据追加 `docs/testing/agent-multi-intent.tdd.md`。相关红线裁定见 [[multi-intent-report-redlines]]。

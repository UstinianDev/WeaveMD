---
name: multi-intent-task1-done
description: agent-multi-intent P0 任务 1（结构化任务 Schema）已交付于 38edc57；围栏/前后缀两层语义裁定与 4530 例测试基线
metadata:
  type: project
---

agent-multi-intent P0 任务 1 已完成并提交（本地 main `38edc57`，未推送）：`taskPlan.ts` 类型 +
`structuredJson.ts` 骨架 + `taskPlannerSchema.ts`（Schema/parseTaskPlan/normalizeTaskPlan）+
memoryWriter 委托 + 22 例新测试 + spec §10 与 `docs/testing/agent-multi-intent.tdd.md`。

**Why:** 计划 §4.2 把「围栏/前后缀」列进非法 7 类，而 §6.2 要求「解析端剥围栏 + 截取 {..} 兜底」——两者表面冲突。
裁定为两层语义：`parseStructuredJson`/`parseTaskPlan` **容错**（围栏+合法内容可通过），非法测试用
「围栏包裹拒绝文本 / 前后缀+残缺 JSON」验证坏内容抛 `task_plan: LLM 输出不是合法 JSON`；依据是 §6.2 标为
实施约束、骨架需真实消费方（brace 截取为对象型出参服务）、避免三份重复解析逻辑。

**How to apply:**
- 任务 2 `runTaskSplit` 直接 `parseTaskPlan` → 围栏包裹的**合法**计划会通过（重试只留给真坏内容）；
  若编排方预期严格拒绝围栏本身，需在 validate 前加边界检查，一处可改。
- `normalizeTaskPlan` 串行标注格式 `serial_after:<前序写id>`、合并保留首条 id/intent/action、
  截断按 confidence 稳定排序保持原始相对序——任务 2/3/5 的测试需沿用这些钉死口径。
- 全量测试基线 4530 例；`tests/benchmarks/ab-test.test.ts` djb2 性能断言为既知 flaky（单跑复核即可）。
- `npm run build` = vite + electron-builder 全量打包，本机可通过（size gate PASSED），约 1~2 分钟。

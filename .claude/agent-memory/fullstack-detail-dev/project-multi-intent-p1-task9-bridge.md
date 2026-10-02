---
name: multi-intent-p1-task9-bridge
description: 任务 9（KB 意图透传，7d1f8f4）交付记录与两个复发坑——闭包重建 opts 丢参、链测试部分构造 ctx
metadata:
  type: project
---

任务 9「Agent 意图透传 KB 检索」已交付 `7d1f8f4`（2026-10-02，本地 main 未推送）。透传链：`ToolCtx.agentIntent`（agentContext 主 intent 注入 + `applySubtaskContext` 子任务切换覆写）→ searchKBHandler → `KbSearchOptions.agentIntent` → `diagnostics.queryUnderstanding.agentIntent`（可选键，不改检索参数）；kbQa 子任务在 `applySubtaskContext` 按 object 预载 `createPreloadedSearchKb` 单槽。

**Why:** 两个坑在本任务各踩一次、且在本项目反复出现（D1 hadPronounRef 是前例）：
1. **闭包重建 opts 必丢参**——`agentTaskWorker` 构造 `deps.searchKb` 时逐键挑字段重建 opts，新增 opts 字段必须同步补透传，否则测试注入面全绿而生产链路静默丢弃；
2. **部分构造的 AgentContext**——`chainTracking.test` 等链测试用无 `toolCtx` 的 ctx 直调 `startSubtaskChain`，对 `ctx.toolCtx` 硬写属性即抛 TypeError（全量测试才暴露）。

**How to apply:** 任务 12/13/8/10 若给 SearchKbFn/KbSearchOptions/ToolCtx 加字段，先 grep `agentTaskWorker.ts` 的 searchKb 闭包与 `agentKbPreloader` 预载路径确认透传完整；改 `subtaskOrchestrator.ts` 写 ctx 属性处一律判空。预载与工具首访存在竞态（已在 `agentKbPreloader` 用 `await preloadPromise` 兜底），断言「检索恰一次」时 payload.message 须取核心词为空的短词（如「嗯」）以跳过 payload 级预载。红线与门禁口径见 [[multi-intent-report-redlines]]、[[multi-intent-p1-commit-discipline]]。

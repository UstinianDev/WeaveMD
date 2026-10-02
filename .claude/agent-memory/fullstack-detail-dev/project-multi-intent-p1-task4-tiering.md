---
name: multi-intent-p1-task4-tiering
description: 任务 4 三层意图路由已交付 d2b3168；缓存只写 tier2 成功值/shared 只读、protocol==='openai' 门、双键写入三处关键口径
metadata:
  type: project
---

任务 4（三层意图路由）已于 2026-10-02 交付，提交 `d2b3168`（本地 main 未推送）。文件：`src/main/ai/intentTiering.ts` + `tests/main/ai/intentRouterTiered.test.ts`（19 例）+ agentLoop/agentContext/kbSearch 三处接线。

**Why:** 计划未明写的三处实现口径是踩过断言后裁定的，后续任务（尤其任务 9 KB 意图透传要动 kbSearch）复用该层时必须沿用，否则回归。

**How to apply:**
- **缓存只写 tier2 成功结果，`classifyIntentShared` 只读、miss 即规则**——规则值入缓存会破坏 `agentContext.test:568` 的 `classifyIntent toHaveBeenCalledTimes(1)` 断言（mockClear 后同键二次调用吃掉 spy 计数）。任务 9 改 kbSearch 时 `isFallthrough` 已走 shared 只读，勿再引 direct `classifyIntent`。
- **tier2 仅 `protocol === 'openai'` 触发**：anthropic 打 OpenAI 端点必败直接回规则；这同时是既有 runAgentFlow 测试（makeConfig 不带 protocol 字段）零 tier2 污染的护栏——新增测试若想触发 tier2 必须显式带 `protocol: 'openai'`。
- **prefetch 缺省写 `false|input` + `true|input` 双键**（agentLoop 预取时 hasHistory 未算出）；显式传第三参才写单键。触发判定用 false 超集口径（长度门只影响 needsClarification，confidence 计算不含）。
- `console.log` 会加 lint warning（no-console allow 仅 warn/error），主进程日志一律 `console.warn`。
- 全量 test 偶发 1 failed 未复现即既有 flaky（见 [[agent-memory-optimize-pitfalls]] 同类记录），连续两轮全绿可判过。

相关：[[multi-intent-p1-commit-discipline]]、[[multi-intent-report-redlines]]。

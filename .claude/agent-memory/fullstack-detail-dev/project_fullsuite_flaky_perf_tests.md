---
name: fullsuite-flaky-perf-tests
description: cacheMonitor / ab-test 耗时断言并行跑必红单跑必绿；覆盖率 run 有失败用例时不落报告，需 --exclude 单 glob
metadata:
  type: project
---

`tests/main/ai/cacheMonitor.test.ts > performance > getStats 10 万次调用 < 50ms` 只要与其他测试文件并行就会红（实测 `tests/main/`、`tests/main/ai/ + tests/benchmarks/`、全量均红，实测 54~56ms vs 阈值 50ms）；`npx vitest run tests/main/ai/cacheMonitor.test.ts` 单跑 37 例全绿。2026-09-29 复验仍如此。

**同类第二个**：`tests/benchmarks/ab-test.test.ts > Suite 4 (HashComparison): djb2 should be faster than simulated MD5`（2026-09-29 B-c 覆盖率 run 实测红，单跑/低负载绿）——同为纯耗时比较断言。

**Why:** 纯耗时断言，并行负载挤压计时，与被测代码无关（该文件只 import cacheMonitor + llmClient，不依赖 db/ai、agentContext、agentToolExecutor）。

**How to apply:**
- Gate 判「测试全绿」时：并行红 → 单跑该文件复验，单跑绿即通过；不要判定为回归、不要改被测代码。
- 需要覆盖率数字时，用 `--exclude`（测试失败时 v8 报告不落盘，只有 `.tmp/coverage-N.json`，拿不到数值）；vitest 的 `--exclude` 只接受**单个 glob**，重复传会报 "Expected a single value" → 排除多个文件用大括号：`--exclude='**/{cacheMonitor,ab-test}.test.ts'`。
- 其他 `xxx < Nms` 形态用例同理，先复跑再下结论。

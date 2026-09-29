---
name: fullsuite-flaky-perf-tests
description: 全量 vitest 下 tests/main/ai/cacheMonitor.test.ts 的耗时断言会偶发失败，单独跑必过，非回归
metadata:
  type: project
---

`npm run test` 全量跑（162 文件并行）时 `tests/main/ai/cacheMonitor.test.ts > performance > getStats 10 万次调用 < 50ms` 会偶发红；`npx vitest run tests/main/ai/cacheMonitor.test.ts` 单跑 37 例全绿。

**Why:** 该用例是纯耗时断言（<50ms），并行负载下计时被挤压，与被测代码无关。

**How to apply:** Gate 判定「测试全绿」时先单跑该文件复验，单跑绿即视为通过，不要据此判定为回归或去改被测代码。同理其他 `xxx < Nms` 形态的用例（如 agent-perf-benchmark）都需复跑确认。

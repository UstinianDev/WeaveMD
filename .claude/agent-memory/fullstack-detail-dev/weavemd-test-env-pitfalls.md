---
name: weavemd-test-env-pitfalls
description: WeaveMD 测试环境六个坑：better-sqlite3 原生模块、coverage.include 传参、coverage 报告需全绿、提示词 sha256 基线与「画像」护栏、两处既知 flaky、E2E renderer-only 下加载主进程纯函数
metadata:
  type: project
---

六个在 WeaveMD 跑门禁时反复踩的环境坑：

1. **better-sqlite3 在 vitest（Node）下加载失败** `ERR_DLOPEN_FAILED`（为 Electron ABI 构建）。
   任何被测模块 import `@main/db/index` 的链路，测试文件必须
   `vi.mock('better-sqlite3', () => ({ default: class FakeDatabase {} }))` +
   `vi.mock('@main/db/index', () => ({ getDatabase: ... })`（先例：`tests/main/ai/consent.test.ts:7-8`）。
   只用 `import type` 的模块（如 `src/main/db/agentMemory.ts`）不受影响，可以安全引入。
   **How to apply:** 新增 src 侧依赖前先看它会不会把 `db/index` 拉进现有测试的 import 图。

2. **`--coverage.include=a,b` 会被当成一个 glob → 覆盖率全 0**。
   必须重复传参：`--coverage.include=src/x.ts --coverage.include=src/y.ts`；再配
   `--coverage.reportsDirectory=.tmp-xxx --coverage.reporter=text --coverage.reporter=json`，
   用 `coverage-final.json` 精确算「改动行覆盖」（与 `git diff -U0` 的行号求交），用完 `rm -rf`。

3. **既知 flaky（并行跑必现、单跑必绿，勿改被测代码）**：
   `tests/benchmarks/ab-test.test.ts` 的 `djb2 should be faster than simulated MD5`、
   `tests/main/ai/cacheMonitor.test.ts` 的 `getStats 10 万次调用 < 50ms`。
   全量 `npx vitest run` 见红先单跑复核。

**Why:** 三者都会让人误判「门禁没过」或「覆盖率 0」，浪费整轮时间。
**How to apply:** 任何 WeaveMD 门禁报告前按此三项自查，再贴数字。

4. **只要本轮有一个测试失败，v8 覆盖率报告就不生成**（只剩 `reportsDirectory/.tmp/coverage-*.json` 分片，
   没有 text 表也没有 `coverage-final.json`）。全量跑撞上 flaky 时拿不到数字。
   **How to apply:** 覆盖率改走「引用这几个 src 文件的测试子集」（Gate A 先例：12 个测试文件 / 373 例），
   或先把 flaky 单跑修绿再跑全量；别反复跑 5 分钟的全量。

5. **改 `agentPromptBuilder` 的提示词文案会同时撞两处测试**：`BASELINE_SHA256`（plain/clarify/withSnapshots
   三个 sha256 基线，chat 基线不含工具规则不受影响）必须按新文案重测；以及 B4 护栏
   `expect(prompt).not.toContain('画像')`（`agentPromptBuilder.test.ts` + `agentContext.test.ts`）——
   提示词里新加的行只要含「画像」二字就红。
   **How to apply:** 改提示词前先 grep `not.toContain`，措辞避开被锁字面量；基线哈希用临时
   `console.log(sha256(...))` 探针跑一次取值后删掉探针，不要凭截断输出手抄。

6. **E2E 是 renderer-only，但 playwright 测试进程可以直接 import `src/main/` 的纯函数**：
   `contextManager.ts` / `agentHelpers.ts`（含 `@shared/constants` 别名）在 `npx playwright test`
   里加载成功、无 electron 依赖（已实测；临时探针 spec 跑完即删）。`tsconfig.json` 的 `include`
   不含 `e2e/`、vitest 只拾 `tests/**/*.test.*`、eslint 只跑 `src/` —— 所以 e2e 里 import 主进程
   纯函数不会影响 typecheck / vitest / lint 三道门禁。
   **How to apply:** 要在 E2E 里断言主进程行为（如上下文压缩），用「Node 段跑真实纯函数 +
   渲染段走既有 mock」两段式，别去改 playwright.config 起 Electron，也别调阈值常量。
   另：`AgentTab` 的工具轨迹按 i18n 摘要渲染（`查询: "..."`），不是原始 JSON，
   断言工具参数别照抄 mock 里的 `JSON.stringify(args)`。

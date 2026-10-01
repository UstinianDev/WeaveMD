# agent-multi-intent — TDD 测试报告（P0 主线）

> 日期：2026-10-01 | 档位 **L** | TDD 强度 **strict**
> 需求 `docs/requirements/agent-multi-intent.req.md`（Q1~Q14）｜计划 `docs/plan/agent-multi-intent.plan.md`（§2 任务清单、§4.2 测试要点）
> 本报告按任务分章追加；本文件仅记录**实际执行的命令与输出摘要**（截取自终端，不虚构）。

## 任务 1 — 结构化任务 Schema

**范围**：新建 `src/shared/ai/taskPlan.ts`（SubtaskDef / AgentTaskPlan）+ `src/shared/ai.ts` barrel 增行 +
`src/main/ai/llm/structuredJson.ts`（parseStructuredJson 骨架）+ `src/main/ai/agent/taskPlannerSchema.ts`
（TASK_PLAN_JSON_SCHEMA / parseTaskPlan / normalizeTaskPlan）+ `memoryWriter.parseExtractionItems` 委托重构 +
`tests/main/ai/taskPlannerSchema.test.ts`（22 例）+ 本文档与 spec 文档同步。

### 1. RED

命令：

```bash
npx vitest run tests/main/ai/taskPlannerSchema.test.ts
```

输出（首跑，实现文件尚不存在）：

```text
❯ tests/main/ai/taskPlannerSchema.test.ts (0 test)

⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯
 FAIL  tests/main/ai/taskPlannerSchema.test.ts[ tests/main/ai/taskPlannerSchema.test.ts ]
Error: Failed to resolve import "@main/ai/llm/structuredJson" from "tests/main/ai/taskPlannerSchema.test.ts". Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
  Duration  14.63s
```

RED 判定：22 例全部未收集（模块未实现）→ 红。

### 2. GREEN

命令（新用例 + memory 既有回归同跑）：

```bash
npx vitest run tests/main/ai/taskPlannerSchema.test.ts tests/main/ai/memoryWriter.test.ts
```

输出：

```text
 ✓ tests/main/ai/memoryWriter.test.ts (29 tests) 86ms

 Test Files  2 passed (2)
      Tests  51 passed (51)
  Duration  5.82s
```

- `taskPlannerSchema.test.ts` **22 例全绿**（合法 3 / 非法 7 / 降级 5 / Schema 取舍 3 / 骨架 4）；
- `memoryWriter.test.ts` **29 例零改动全绿** = memory 行为不变证据（该文件断言一行未动）。

### 3. 门禁（全量）

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | `tsc --noEmit` **0 错误** |
| test | `npm run test` | `Test Files 1 failed \| 189 passed (190)`；`Tests 1 failed \| 4529 passed (4530)` |
| test（既知 flaky 单跑复核） | `npx vitest run tests/benchmarks/ab-test.test.ts` | `22 passed`（绿） |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（0 error，warning 数与基线 108 一致） |
| build | `npm run build` | `size gate PASSED`，退出码 0（vite build + electron-builder） |

**flaky 说明（未改被测代码）**：全量 test 的唯一失败为既知性能断言
`tests/benchmarks/ab-test.test.ts > djb2 should be faster than simulated MD5`
（agent-memory-optimize 批次已记录的时序 flaky，与本任务无关），单跑复核 22 例全绿。
测试规模：上一批收口 4508 例 → 本任务 +22 例 = **4530 例**。

### 4. 本任务测试用例对账（plan §4.2）

| 分组 | 例数 | 覆盖点 |
|---|---|---|
| 合法出参 | 3 | 全字段 / 可选缺省 / nullable 视为缺省 |
| 非法出参（整批拒绝） | 7 | 缺字段（根+子任务）/ 类型错带序号 / confidence 越界 / intent 枚举外 / 非数组 / ```json 围栏坏内容 / 前后缀残缺 JSON |
| 降级与规范化 | 5 | 空 subtasks 直通 / >5 按 confidence 截断+omittedCount（同测断言 parse 阶段不截断）/ 同对象写合并 / 不同对象写串行标注 / normalize 越界复检 |
| Schema 取舍守卫（§6.1） | 3 | 禁用键零出现 / required 全字段+additionalProperties:false / intent·rw 枚举钉死 |
| parseStructuredJson 骨架 | 4 | 围栏剥离（数组不被破坏）/ 首 { 至末 } 截取 / `${label}: LLM 输出不是合法 JSON` 文案 / validate 错误透传 |

### 5. 口径说明（围栏 / 前后缀的两层语义）

- 骨架层（`parseStructuredJson`）**容错**：剥围栏 + 截取 `{..}` 兜底（plan §6.2「解析端仍兜底」）——
  骨架 describe 用合法内容验证容错路径；
- 计划层非法类测试：围栏包裹**拒绝文本**、前后缀包裹**残缺 JSON** → 均抛
  `task_plan: LLM 输出不是合法 JSON`，坏内容零放行（提示词仍显式禁止围栏/解说文字，见 spec §10.1）。

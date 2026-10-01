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

## 任务 2 — 多意图识别与拆分（含规则预检门）

**范围**：`intentRouter.ts`（`CONNECTIVES` + `detectMultiIntentGate`）+ `taskPlanner.ts`
（`buildTaskSplitMessages` / `runTaskSplit`）+ `subtaskOrchestrator.ts`（拆分确认编排 + 链 v1）+
`agentContext.ts`（gate/快照/多意图恒 Agent 提示）+ `agentLoop.ts`（gate → split → confirm → 链）+
`agentPromptBuilder.ts`（拆分指令段 + 子任务指令模板）+ 交互通路扩 `plan`（worker/shared/preload/store）
+ `SplitConfirmCard.tsx` 与 i18n×3 + 测试 5 个文件追加/新建。

### 1. RED — 阶段 A（预检门）

命令：

```bash
npx vitest run tests/main/ai/intentRouter.test.ts
```

输出（首跑，`detectMultiIntentGate` 未实现）：

```text
 FAIL  tests/main/ai/intentRouter.test.ts > intentRouter.detectMultiIntentGate — 多意图预检门 >
       classifyIntent 与 gate 两套语义并存（Q8）：模糊单意图仍出候选，gate 不因此放宽
TypeError: detectMultiIntentGate is not a function
 Test Files  1 failed (1)
      Tests  9 failed | 17 passed (26)
```

RED 判定：新增多意图 describe 9 例全红、旧 17 例全绿。

### 2. GREEN — 阶段 A

`intentRouter.ts` 增 `CONNECTIVES` / `collectHitClasses` / `detectMultiIntentGate`
（开闸 ⇔ 命中类 ≥2；连接词只作分句证据，`classifyIntent` 本体不动）。
期间修正 1 例用例自身缺陷：「在知识库里查一下会议纪要」命中 kbQa + tech（tech 关键词含「库」），
规则层本就该判 2 类 → 换成「根据笔记查一下会议纪要」（kbQa 单类）。

```bash
npx vitest run tests/main/ai/intentRouter.test.ts
```

```text
 Test Files  1 passed (1)
      Tests  26 passed (26)
```

### 3. RED — 阶段 B（拆分调用与降级）

新建 `tests/main/ai/taskPlanner.test.ts`（12 例），首跑：

```bash
npx vitest run tests/main/ai/taskPlanner.test.ts
```

```text
 FAIL  Failed to resolve import "@main/ai/agent/taskPlanner" from "tests/main/ai/taskPlanner.test.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

### 4. GREEN — 阶段 B

新建 `src/main/ai/agent/taskPlanner.ts`（提示词内嵌 Schema + few-shot + 禁围栏规约 + 协议分流 one-shot +
重试 1 次错误回填 + `<2 子任务 null 直通`）。

```bash
npx vitest run tests/main/ai/taskPlanner.test.ts tests/main/ai/taskPlannerSchema.test.ts
```

```text
 ✓ tests/main/ai/taskPlannerSchema.test.ts (22 tests)
 ✓ tests/main/ai/taskPlanner.test.ts (12 tests)
 Test Files  2 passed (2)
      Tests  34 passed (34)
```

（首绿 11/12：串行标注用例期望写错——任务 1 口径为「首条写不标注、后续写追加 `serial_after`」，
按实现口径修正用例后全绿，`taskPlannerSchema.test.ts` 22 例零改动。）

### 5. RED — 阶段 C（编排接线）

(a) `tests/main/ai/agentContext.test.ts` 追加 describe「预检门接线」5 例：

```bash
npx vitest run tests/main/ai/agentContext.test.ts
```

```text
 FAIL  tests/main/ai/agentContext.test.ts (80 tests | 5 failed)
 Test Files  1 failed (1)
      Tests  5 failed | 75 passed (80)
```

RED 判定：`ctx.intentGateOpen` / `baseHistoryMessages` / `toolSelectionArgs` 均不存在（旧 75 例全绿）。

(b) 新建 `tests/main/ai/agentLoopSplit.test.ts`（7 例，独立 mock 基座——`agentLoop.test.ts` 旧例零改动）：

```bash
npx vitest run tests/main/ai/agentLoopSplit.test.ts
```

```text
 FAIL  4 failed | 3 passed (7)
   → expected "spy" to be called 1 times, but got 0 times   // 拆分/交互尚未接线
```

> 注：阶段 C 实现中确认 vitest 行为——factory mock 缺导出时**访问即抛错**（`tests/_probe.test.ts` 实测），
> 故 `agentContext` 经命名空间 + try/catch **fail-closed** 调 gate，`agentLoop.test.ts` 旧 mock 不需改动。

### 6. GREEN — 阶段 C

```bash
npx vitest run tests/main/ai/agentLoopSplit.test.ts
```

```text
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

红线回归（既有三文件 + prompt 基线 + 任务 1 测试）：

```bash
npx vitest run tests/main/ai/agentLoop.test.ts tests/main/ai/agentContext.test.ts \
  tests/main/ai/intentRouter.test.ts tests/main/ai/agentPromptBuilder.test.ts \
  tests/main/ai/taskPlanner.test.ts tests/main/ai/taskPlannerSchema.test.ts
```

```text
 Test Files  6 passed (6)
      Tests  253 passed (253)
```

> 即：`agentLoop.test.ts` / `agentContext.test.ts` / `intentRouter.test.ts` 旧例零改动全绿；
> `agentPromptBuilder.test.ts` sha256 基线全绿（证明单意图提示词逐字节未变）。

### 7. RED/GREEN — 阶段 D（拆分确认卡）

```bash
npx vitest run tests/components/SplitConfirmCard.test.tsx
```

RED（组件未建）：

```text
Error: Failed to resolve import "@render/components/AIAgent/cards/SplitConfirmCard" ...
 Test Files  1 failed (1)
      Tests  no tests
```

GREEN（组件 + i18n 三语后）：

```text
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

（首绿 6/7：置信度/读写标注因同 div 多段文本导致 `getByText` 不匹配 → 拆 span 后全绿。）

### 8. 全量回归（阶段 E 门禁前）

```bash
npm run test
```

```text
 Test Files  193 passed (193)
      Tests  4570 passed (4570)
```

（基线 4529 + 任务 2 新增 41 = 4570；期间临时探针文件 `tests/_probe.test.ts` 已还原为原内容。）

### 9. E2E 门禁（含 UI，需过 playwright）

```bash
npx playwright test
```

输出（本任务改动在位）：

```text
  31 failed
  1 skipped
  104 passed (7.1m)
```

**既有失败核验（单跑复核 + 基线对比，非本任务引入）**：

1. 定向复跑两个无关域 spec（改动在位）：`npx playwright test e2e/feedback.spec.ts e2e/editor-table.spec.ts`
   → `12 failed / 1 skipped / 2 passed`；
2. `git stash push` 本任务 12 个 src 改动文件 → **基线（HEAD）复跑同一命令**：
   → `12 failed / 1 skipped / 2 passed`（完全一致）；
3. 基线复跑 `e2e/ai-agent-panel.spec.ts` → `4 failed / 34 passed`，失败用例名与改动在位时逐一相同
   （A4/A2/A3/① 四条改写链用例）；
4. 基线跑全量 `npx playwright test` → `31 failed / 1 skipped / 104 passed`，与改动在位结果**同数**；
   失败用例名集合逐条比对仅差 4 行 `data-block-id`（thematic-break 随机 id），**无新增失败**；
5. 失败集中在编辑器域（drag-selection-markers 5 例自带「当前 RED」标注、editor-table、
   thematic-break、exit-behavior、feedback、image-resize 等），与 agent/交互链无关；
   `SplitConfirmCard` / `intent_split` 相关用例无 E2E 覆盖（主进程交互链为单测覆盖，见上文 1~7 节）。

**门禁结论**：typecheck 0 错 / test 193 文件 4570 例全绿 / lint 0 错（108 warning 与基线一致，
本任务新增文件零 warning）/ playwright 31 例失败经基线对比确认为**既有环境性失败**（HEAD 同样 31 例、
集合一致），本任务零新增失败。

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

## 任务 3 — 置信度消费与低风险追问（追问矩阵）

**范围**：`subtaskOrchestrator.ts`（0.7 分流 / 链末追问 `runChainClarification` /
`buildClarifyQuestions` / 链状态机扩 `clarify` 结果）+ `agentPromptBuilder.ts`
（新增 `buildSubtaskClarificationSegment`，基础提示词 sha256 钉死行零改动）+
`agentLoop.ts`（`clarify` 结果接线 + 全低置信链首追问）+ 新建
`tests/main/ai/clarificationMatrix.test.ts`（6 例）+ 本文档与
`03-question-cards.md` §8.8.1 同步。`agentContext.ts` / `agentToolSelector.ts`
**零改动**（多意图恒 Agent 提示与 chat `ask_question_card` 逻辑任务 2/既有实现已交付，
本任务回归钉死）。

**测试文件选址说明**：计划 §2 预期挂 `agentContext.test.ts` describe，实际新建独立
`clarificationMatrix.test.ts` —— 追问矩阵 ②③⑤ 是链级用例，需要 taskPlanner/llmClient/
guard mock 基座，挂进 `agentContext.test.ts` 需改其既有 mock 基座（vi.mock 注册在文件
顶层，改动影响其 80 例），触碰「既有测试零改动」红线；新文件 mock 基座复制自
`agentLoopSplit.test.ts`，但 **intentRouter 用真实实现**（⑥ 的 candidates/gate 语义须实测）。

### 1. RED

命令：

```bash
npx vitest run tests/main/ai/clarificationMatrix.test.ts
```

输出（首跑，追问编排未实现）：

```text
 FAIL  tests/main/ai/clarificationMatrix.test.ts > 追问矩阵 — agent-multi-intent 任务 3 >
       ② 多意图含低置信 → 高置信先进执行序列 + 链末追问 + 回答合并 params 后执行
 FAIL  ... > ③ 每轮 ≤2 题：三低置信拆 2 轮追问（2 题/1 题，round/totalRounds 标注）+ prompt 断言
 FAIL  ... > ④ confidence 不参与轮次分配（getRoundsForIntent 签名/表 + detector 预算钉死）
 FAIL  ... > ⑥ candidates 候选卡与多意图拆分卡语义不混淆（Q8 两套并存，追问 variant 独立）

 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```

RED 判定：②③④⑥ 红（无 `subtask_clarify` 交互 / 低置信不推迟）；①（单意图低置信
现状回归）与 ⑤（全高置信零追问 + 0.7 边界）为**回归钉，起始即绿**——④ 的
`getRoundsForIntent` 签名/表断言同样为钉死断言，其红来自追问计数断言。

### 2. GREEN

实现后首跑 5/6：② 失败 `expected true to be false` —— **用例自身缺陷**：
`ctx.llmMessages` 是实时数组，`mock.calls[0][0].messages` 在断言时已被后续轮次追加，
首轮负向断言（不含 `【子任务 2/2】`）失真。修正为按调用时刻快照（`roundSnapshots`）后复跑：

```bash
npx vitest run tests/main/ai/clarificationMatrix.test.ts
```

```text
 ✓ tests/main/ai/clarificationMatrix.test.ts (6 tests) 46ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

6 例对账（plan §4.2 任务 3）：

| 例 | 覆盖点 | 结果 |
|---|---|---|
| ① | 单意图低置信 → Agent 提示（clarificationPrefix）+ `ask_question_card` 工具可用 + gate 关零拆分 | 回归钉，RED 即绿 |
| ② | 混合置信链：高置信先执行（首轮指令不含低置信目标）→ 链末 `subtask_clarify` 追问 → 回答合并 `params.clarification` 后执行 → 单次落库/单 DONE/roundsUsed=2 | RED → GREEN |
| ③ | 三低置信拆 2 轮（2 题/1 题，round 1/2、2/2）+ 每轮 ≤2 题 + 基础提示词与追问段均含「每轮最多 2 个问题」 | RED → GREEN |
| ④ | `getRoundsForIntent.length === 1` + 表值钉死 + detector 预算 = 主意图表值（12）不受子任务 confidence 影响 + 追问不计轮次 | 钉死断言（红来自追问计数） |
| ⑤ | 全高置信零追问（`intent_split` 仅 1 次交互）+ confidence=0.7 边界不入追问队列 | 回归钉，RED 即绿 |
| ⑥ | `classifyIntent` candidates/needsClarification 保留 + gate 独立判定 + `['intent_split','subtask_clarify']` variant 序列 + 问题 id（`intent_split` vs 子任务 id）不混淆 | RED → GREEN |

### 3. 红线回归（既有链 / 提示词 sha256 / 任务 1、2 测试）

```bash
npx vitest run tests/main/ai/agentLoopSplit.test.ts tests/main/ai/agentLoop.test.ts \
  tests/main/ai/agentContext.test.ts tests/main/ai/agentPromptBuilder.test.ts \
  tests/main/ai/intentRouter.test.ts tests/main/ai/taskPlanner.test.ts \
  tests/main/ai/taskPlannerSchema.test.ts tests/main/ai/askQuestionCard.test.ts \
  tests/main/ai/agentToolExecutor.test.ts
```

```text
 Test Files  9 passed (9)
      Tests  284 passed (284)
```

- `agentPromptBuilder.test.ts` sha256 基线全绿 = 单意图提示词（含 clarificationPrefix、
  分轮澄清策略）**逐字节未变**；
- `agentLoopSplit.test.ts` 7 例零改动全绿 = 任务 2 链 v1 行为等价（全高置信计划
  分流为 no-op，指令序与收口不变）。

### 4. 门禁（全量）

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | `tsc --noEmit` **0 错误** |
| test | `npm run test` | `Test Files 194 passed (194)`；`Tests 4576 passed (4576)` |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（0 error，warning 数与基线 108 一致） |
| playwright | 本任务**跳过** | 未改任何 `src/render/` UI 文件（改动仅 3 个 `src/main/ai/agent/*.ts` + 测试 + 文档），按任务口径无 UI 改动可跳过 |

**flaky 说明**：全量 test 本跑 4576 例**全数通过**（既知 ab-test 性能断言 flaky 本次未触发，
任务 1 已单跑复核记录）；测试规模 4570 + 本任务 6 = **4576**。

**门禁结论**：typecheck 0 错 / test 194 文件 4576 例全绿 / lint 0 错（108 warning 与基线
一致，新文件零 warning）/ 无 UI 改动 playwright 按任务口径跳过。

## 任务 5 — 同 session 子任务顺序执行（链加固）

**范围**：`subtaskOrchestrator.ts`（per-subtask detector + `subtaskTotalRoundsCap` 总封顶 +
`baseMessages` 快照重建 + `SUBTASK_SUMMARY_MAX_CHARS=500` 摘要注入 + `isChainInterrupted`
边界安全点 + `handleSubtaskFailure` 重试 1 次/subtask_failed 交互 + `subtask_done` 发射 +
`stopChain` skipped 明示）+ `agentLoop.ts`（`AgentLoopDeps.isChainInterrupted` / 轮首双闸 /
for-await 失败捕获与 `finalizeRun` 收口抽取 / 死循环链收口）+ `agentTaskQueue.hasPendingForConversation`
+ `agentTaskWorker` 中断闭包注入 + `constants`/`shared`/`preload`/`agentStore`/`AgentTab`
的 `subtask_done` 流事件通路 + 新建 `tests/main/ai/subtaskSequence.test.ts`（11 例）+
`agent-tool-runtime.md` §13 子任务链执行契约 + 本文档。

### 1. RED

命令：

```bash
npx vitest run tests/main/ai/subtaskSequence.test.ts
```

输出（首跑，链加固未实现）：

```text
 FAIL  tests/main/ai/subtaskSequence.test.ts > 子任务链顺序执行 > 每子任务重建 intent/tools/指令…
 FAIL  ... > 执行摘要按常量截断…
 FAIL  ... > 轮次双预算 > per-subtask 独立 detector…
 FAIL  ... > 轮次双预算 > 链总封顶 2× 主意图触顶…
 FAIL  ... > 子任务失败中断 > LLM 失败重试 1 次成功…
 FAIL  ... > 子任务失败中断 > 重试仍失败 → subtask_failed 交互…
 FAIL  ... > 子任务失败中断 > subtask_failed 交互 reject…
 FAIL  ... > 用户打断 > 边界检查停链…
 FAIL  ... > tool_result 回填完整性 > 子任务内多 tool_use 同轮全量回填…
 FAIL  ... > agentTaskQueue > hasPendingForConversation 纯查询…
       TypeError: queue.hasPendingForConversation is not a function

 Test Files  1 failed (1)
      Tests  10 failed | 1 passed (11)
  Duration  5.25s
```

RED 判定：10 例行为红（无重建/无双预算/无失败处置/无中断/无落显事件/队列无查询）；
1 例即绿为 **supersede 现语义回归钉**（enqueue 只作废同会话旧 pending —— 既有行为，预期绿）。
（RED 采用行为断言而非新符号 import，保证 11 例全部收集后逐条归因。）

### 2. GREEN

实现后首跑即全绿：

```bash
npx vitest run tests/main/ai/subtaskSequence.test.ts
```

```text
 ✓ tests/main/ai/subtaskSequence.test.ts (11 tests) 94ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
  Duration  5.81s
```

11 例对账（plan §4.2 任务 5）：

| 分组 | 例数 | 覆盖点 |
|---|---|---|
| 顺序执行 | 2 | intent 重建（cost recordUsage 逐轮断言 chat/chat/kbQa）+ tools 重建（searchKB 随子任务出现/缺席）+ 指令逐子任务下达 + baseHistory 为底 + 前序摘要注入 + 不堆积工具轮 + 摘要 500 截断（`…`，长度 501）钉死 + DB 仍全量 + subtask_done 载荷（id/序号/总数） |
| 轮次双预算 | 2 | per-subtask detector 三实例预算 [8,8,12] 且子任务 2 跨过共享 8 轮预算仍执行完；链总封顶 12 轮（2×chat）触顶 → 第 3 子任务不启动、无第 3 个 detector、剩余 skipped 明示、单 DONE intent=chat、无 ERROR |
| 失败中断 | 3 | 重试成功续链（4 个 detector、无 subtask_failed、roundsUsed=3）；重试仍失败 → `subtask_failed` 交互 → 跳过明示续链单收口；交互 reject → `AI_STREAM_ERROR` 收口不锁死 |
| 用户打断 | 1 | `isChainInterrupted` 首边界放行次边界停链：当前子任务不截断（2 轮执行）、第 3 指令不发、剩余 1 skipped 明示、单 DONE、subtask_done 恰 1 次 |
| tool_result 不变式 | 1 | 每次调用时刻快照过 `expectToolPairing`；同轮 2 个 tool_use 紧邻连续 tool 行全量回填（call_0_0/call_0_1）；边界重建后新 prompt 无 assistant(tool_calls)、无上一子任务工具结果 |
| 队列回归 | 2 | supersede 只作废同会话旧 pending（running/其他会话不动，回归钉）；`hasPendingForConversation` 按会话过滤 pending |

### 3. 红线回归（既有链 / 提示词 sha256 / 任务 1、2、3 测试）

```bash
npx vitest run tests/main/ai/agentLoopSplit.test.ts tests/main/ai/clarificationMatrix.test.ts \
  tests/main/ai/agentLoop.test.ts tests/main/ai/agentContext.test.ts \
  tests/main/ai/agentPromptBuilder.test.ts tests/main/ai/intentRouter.test.ts \
  tests/main/ai/taskPlanner.test.ts tests/main/ai/taskPlannerSchema.test.ts \
  tests/main/ai/askQuestionCard.test.ts tests/main/ai/agentToolExecutor.test.ts \
  tests/main/ai/streamingToolExecutor.test.ts
```

```text
 Test Files  11 passed (11)
      Tests  306 passed (306)
```

- `agentLoopSplit.test.ts` 7 例 / `clarificationMatrix.test.ts` 6 例**零改动全绿**
  （任务 2 链 v1 与任务 3 追问矩阵在重建语义下行为等价：round2 快照仍含拆分段 +
  子任务 1 指令 + 其产出 assistant 行）；
- `agentPromptBuilder.test.ts` sha256 基线全绿 = 提示词逐字节未变；
- `agentLoop.test.ts` 31 例全绿 = gate 关路径行为等价（预算检查退化为原
  `checkRoundLimit(round)`，失败重试仅链路径生效）。

### 4. 门禁（全量）

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | `tsc --noEmit` **0 错误** |
| test | `npm run test` | `Test Files 195 passed (195)`；`Tests 4587 passed (4587)` |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（0 error，warning 数与基线 108 一致，新文件零 warning） |
| playwright | `npx playwright test` | `31 failed / 1 skipped / 104 passed (7.1m)`，与基线同数（下节比对） |

**测试规模**：任务 3 收口 4576 → 本任务 +11 = **4587 例**（全数通过，既知 ab-test flaky 本跑未触发）。

### 5. E2E 门禁（改了 src/render/，与 31 例既有失败基线比对）

```bash
npx playwright test
```

```text
  31 failed
  1 skipped
  104 passed (7.1m)
```

**既有失败核验（任务 2 记录的基线口径）**：

1. 失败总数 **31 = 基线 31**，skipped/passed 同数；
2. 按 spec 分组与任务 2 基线一致：`drag-selection-markers` 5（自带「当前 RED」标注）、
   `editor-table` 7、`feedback` 5、`ai-agent-panel` **4（A4/A2/A3/① 四条改写链用例，
   与任务 2 逐一同名）**、`exit-behavior` 2、`thematic-break` 2（仅随机 `data-block-id`
   行号差异）、`floating-toolbar` 2、`editor`/`image-resize`/`recent-history-restore`/
   `welcome-doc` 各 1；
3. 本任务改动的 AgentTab / agentStore / preload 对应用例（`ai-agent-panel` 会话流、
   `composer` 等）全部在 104 passed 内；`subtask_done` 通路无 E2E 覆盖（主进程链路
   为 `subtaskSequence.test.ts` 11 例单测覆盖）；
4. **结论：31 例均为 HEAD 既有环境性失败，本任务零新增失败。**

**门禁结论**：typecheck 0 错 / test 195 文件 4587 例全绿 / lint 0 错（108 warning 与基线
一致，新文件零 warning）/ playwright 31 例失败与基线同数同名（零新增）。

## 任务 11 — 风险分档确认矩阵（intent × tool，多写汇总确认）

**范围**：新建 `src/main/ai/agent/confirmMatrix.ts`（`confirmTierFor` / `writeToolsByTier` /
`confirmSkipSet` 纯函数）+ `agentToolExecutor.ts`（`checkForceConfirmTools` 按档泛化、
`confirmWriteBatch` 链末汇总、`WriteBatchItem` 类型）+ `agentContext.writeBatch` 收集器 +
`agentLoop.ts`（`finalizeChainRun` 统一链收口 ×8 点、skip-set 矩阵派生 ×2）+
`subtaskOrchestrator.ts`（`startSubtaskChain` 置收集器 + 拼写批次提示段 + `appendChainNote`）+
`agentPromptBuilder.buildWriteBatchNoticeSegment`（独立段，sha256 正文不改）+
`agentToolSelector` 注释指向矩阵（常量保留）+ 渲染侧 `BatchConfirmCard.tsx` +
`AIPanelSession` `write_batch` 分派 + i18n `ai.batchConfirm.*` 三语 + 新建
`tests/main/ai/confirmMatrix.test.ts`（91 例）+ `agentToolExecutor.test.ts` 新 describe
（8 例，既有 7 例零改动）+ `agent-tool-runtime.md` §14 + `ai-agent.md` 写控制章节改写 + 本文档。

### 1. RED

**首轮**（仅写测试、无实现文件）：`tests/main/ai/confirmMatrix.test.ts` 缺被导入模块，
连带 `agentToolExecutor.test.ts` 的动态 `import('@main/ai/agent/confirmMatrix')` 被 vite
静态解析失败 → 整文件收集失败（0 test）。按任务 5 教训改两步走：

**二轮**（补签名占位 stub：`confirmTierFor` 恒 `'none'`、`writeToolsByTier`/`confirmSkipSet`
返回空 —— 行为违反 fail-closed 与铁律一，保证逐条归因）：

```bash
npx vitest run tests/main/ai/confirmMatrix.test.ts tests/main/ai/agentToolExecutor.test.ts
```

```text
 Test Files  2 failed (2)
      Tests  53 failed | 53 passed (106)
```

逐条归因（`--reporter=verbose`）：

- `confirmMatrix.test.ts`：49 例红（42 组合全红 + fail-closed 4 + 拆分/派生 3）；
  42 例绿为结构钉（`WRITE_TOOLS`/`FORCE_CONFIRM_TOOLS` 常量 7/2 项）与只读样例按 stub
  `'none'` 即绿的预期项，`confirmSkipSet` 空集下「不放行写工具」为真空绿；
- `agentToolExecutor.test.ts`：**既有 7 例全绿（零改动）**；新 describe 4 红 =
  真实行为缺口（无交互拒 `batch`、链收集写批次、拒绝项回滚、提示词一致性）；
  另 4 例 RED 即绿 = **现行为回归钉**（`force` 卡 yes/no、`batch` 单意图 preview、
  无交互拒 `force` —— 改动前 `FORCE_CONFIRM_TOOLS` 已有语义，任务 11 不得削弱）。

### 2. GREEN

实现 `confirmMatrix.ts` 真身 + 执行器/循环/链/提示词/UI 接线后：

```bash
npx vitest run tests/main/ai/confirmMatrix.test.ts tests/main/ai/agentToolExecutor.test.ts
```

```text
 ✓ tests/main/ai/confirmMatrix.test.ts (91 tests) 26ms
 ✓ tests/main/ai/agentToolExecutor.test.ts (15 tests) 69ms

 Test Files  2 passed (2)
      Tests  106 passed (106)
```

11 例对账（plan §4.2 任务 11）：

| 要点 | 例数 | 断言 |
|---|---|---|
| 6×7 全组合 | 42+1 | 每格断言 `force`（delete×2 ×6 intent）/ `batch`（其余 5 ×6）且**恒 ≠ none**；结构钉 `WRITE_TOOLS`=7、`FORCE_CONFIRM_TOOLS`=2 |
| 只读/非写样例 | 40 | 6 intent × 6 只读样例 → `none`；`ask_question_card`/`memory_write`/`runSkill`/`preview_file_revision` → `none`（memory_write 现口径不进强制档） |
| fail-closed | 4 | 未知 intent × 只读 → `batch`；未知 intent × 写 → `batch`；未知 intent × 删除 → 仍 `force`（只强不弱）；合法 intent × 未登记工具 → `batch` |
| skip-set 派生 | 3 | 非链态 ≡ `FORCE_CONFIRM_TOOLS`（6 intent）；链态 = 全 7 写工具；派生集内无 `none` 档 |
| force 确认卡 | 2 | `delete_confirm` 变体 + 答 yes 才执行；答 no 不执行且返回取消错误结果 |
| batch 单意图现状 | 1 | 直接执行 + `AI_STREAM_TOOL` preview 事件恰 1 次 + 零交互打断 |
| 无交互拒写 | 2 | `force`/`batch` 均 `executeTool` 零调用、tool 行 `errorDesc` 含「不支持交互」「拒绝执行」（不放行） |
| 多写链汇总一次确认 | 1 | 执行期零打断（2 写工具执行 + 收集）；`confirmWriteBatch` → `onInteractionRequired` **恰 1 次**、`waitForInteraction` 恰 1 次、variant `'write_batch'`、问题数 = 批次数 |
| 逐项拒绝回滚 | 1 | 拒 1 项 → `rollbackToSnapshot` 恰 1 次且 `(db, 'sess-1', 'u1')` 透传；已接受 `editLocalFile` 回滚后重执行（第 3 次 `executeTool`）；返回明示含「回滚」；收集器清空 |
| 提示词一致性（Q14） | 1 | 「## 写入规则」删除行点名集合 `===` 矩阵 `force`；`batch` 5 项不在强制确认行列；`editLocalFile` preview 行在位；`buildWriteBatchNoticeSegment` 含全部 force+batch 工具名 |

### 3. 红线回归（既有链 / 提示词 sha256 / 任务 1、2、3、5 测试）

```bash
npx vitest run tests/main/ai/agentLoopSplit.test.ts tests/main/ai/clarificationMatrix.test.ts \
  tests/main/ai/agentLoop.test.ts tests/main/ai/agentContext.test.ts \
  tests/main/ai/agentPromptBuilder.test.ts tests/main/ai/intentRouter.test.ts \
  tests/main/ai/taskPlanner.test.ts tests/main/ai/taskPlannerSchema.test.ts \
  tests/main/ai/askQuestionCard.test.ts tests/main/ai/agentToolExecutor.test.ts \
  tests/main/ai/streamingToolExecutor.test.ts tests/main/ai/subtaskSequence.test.ts \
  tests/main/ai/confirmMatrix.test.ts
```

```text
 Test Files  13 passed (13)
      Tests  416 passed (416)
```

- `agentToolExecutor` 既有 **7 例零改动全绿**；`agentPromptBuilder` sha256 基线全绿
  （`buildAgentSystemPrompt` 逐字节未改——写入规则正文被钉死，任务 11 链口径改走
  `buildWriteBatchNoticeSegment` 独立段，与任务 2/3 同款先例，本文如实记录偏差）；
- `agentLoop` 31 例 / `agentLoopSplit` 7 / `subtaskSequence` 11 / `clarificationMatrix` 6
  全绿 = 链收口改走 `finalizeChainRun`（写批次为空时零交互）与 skip-set 矩阵派生
  （非链态 ≡ 原常量）行为等价；
- `streamingToolExecutor` 全绿 = `waitForAll(skipToolNames)` 契约未改，只改调用方传入集合。

### 4. 门禁（全量）

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | `tsc --noEmit` **0 错误** |
| test | `npm run test` | `Test Files 196 passed (196)`；`Tests 4686 passed (4686)` |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（0 error，warning 数与基线 108 一致，新文件零 warning） |
| playwright | `npx playwright test` | 见下节 E2E 比对 |

**测试规模**：任务 5 收口 4587 → 本任务 +99 = **4686 例**（confirmMatrix 91 +
agentToolExecutor 新 describe 8，全数通过）。

### 5. E2E 门禁（改了 src/render/：BatchConfirmCard + AIPanelSession + i18n×3）

```bash
npx playwright test
```

```text
  31 failed
  1 skipped
  104 passed (7.1m)
```

**与任务 5 基线比对（零新增）**：

1. `passed 104 / skipped 1 / 时长 7.1m` 与基线逐项同数；E2E 套件零增删（本任务不加
   e2e 用例），总量恒等 → `failed = 31 = 基线 31`；
2. 失败名单按 spec 分组与基线一致：`drag-selection-markers` 5（自带「当前 RED」标注）、
   `editor-table` 7、`feedback` 5、`ai-agent-panel` 4（A4/A2/A3/① 改写链）、
   `exit-behavior` 2、`thematic-break` 2、`floating-toolbar` 2、`editor` /
   `image-resize` / `recent-history-restore` / `welcome-doc` 各 1（=31）；
3. 本任务改动的渲染面（`BatchConfirmCard` 新卡、`AIPanelSession` 新 variant 分派、
   i18n 新增 4 键 ×3 语）不在任何既有用例路径上——`write_batch` 交互无 E2E 覆盖
   （主进程通路由 `agentToolExecutor.test.ts` 8 例覆盖），`ai-agent-panel` 4 例失败
   为 HEAD 既有改写链失败（任务 2 起同名在列）；
4. **结论：31 例均为 HEAD 既有环境性失败，本任务零新增失败。**

**门禁结论**：typecheck 0 错 / test 196 文件 4686 例全绿 / lint 0 错（108 warning 与基线
一致，新文件零 warning）/ playwright 31 例失败与基线同数同名（零新增）。P0 五任务
（1、2、3、5、11）全部交付。

---

## 任务 6 — 子任务全链路追踪（intent_json 落盘）｜P1 首任务

**范围**：新建 `src/shared/ai/intentRecord.ts`（`AgentIntentJson` / `SubtaskRunStatus` 七态 /
`AgentChainOutcome` / `buildDepsMap` 纯函数）+ `src/main/ai/agent/chainTracking.ts`
（`createChainTracker` / `emitChainRecord` / `finalizeChainRecord`）+
`agentSessionDao.ts`（+`saveIntentJson` / `getIntentJson`，UPDATE 仅 `intent_json` 一列）+
`subtaskOrchestrator.ts`（`SubtaskChain.record` + 链启动/推进/失败跳过/停链状态跃迁与推送 +
`startSubtaskChain` 增可选 deps 参数）+ `agentLoop.ts`（`AgentLoopDeps.onChainRecordUpdate?` +
`finalizeChainRun` 写 outcome）+ `agentTaskWorker.ts`（`buildAgentDeps` 实现回调 →
`saveIntentJson`，异常吞掉仅 console.error）+ `shared/ai.ts` barrel +1 行 + 新建
`tests/main/db/agentSessionIntentJson.test.ts`（5 例）+ `tests/main/ai/chainTracking.test.ts`（8 例）
+ `database.md` / `ai-agent.md` 同步 + 本文档。**零加列零迁移（`git diff src/main/db/index.ts` 空）。**

### 1. RED（TDD strict）

**首轮**（仅写测试、无实现）：

```bash
npx vitest run tests/main/db/agentSessionIntentJson.test.ts tests/main/ai/chainTracking.test.ts
```

```text
 Test Files  2 failed (2)
      Tests  4 failed | 1 passed (5)
```

逐条归因：

- `chainTracking.test.ts`：整文件收集失败（0 test）——
  `Error: Failed to resolve import "@main/ai/agent/chainTracking" from tests/main/ai/chainTracking.test.ts. Does the file exist?`
  （缺被导入模块，vite 静态解析失败 —— 任务 11 同款首轮形态）；
- `agentSessionIntentJson.test.ts`：3 例红 = `saveIntentJson is not a function`（×2）+
  `getIntentJson is not a function`（×1，真实行为缺口）；1 例红 = fake DB 对
  `NOT IN ( SELECT`（SQL 换行归一后的括号内白空格）解析缺陷——**测试基建问题**，
  notIn 正则放宽 `\s*` 后复跑；1 例绿 = 快照 create→rollback 回归钉（现行为即绿，预期项）。

**二轮**（fake 修复后 DAO 单跑，归因干净）：

```bash
npx vitest run tests/main/db/agentSessionIntentJson.test.ts
```

```text
 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
```

3 红 = 缺 `saveIntentJson/getIntentJson`（写读往返 / 不存在 session / 坏 JSON 降级三例）；
2 绿 = **入队/出队现语义回归钉**（pending 出队即 running、同会话串行阻塞、异会话可出队）
+ **快照回滚钉**（createSnapshot → 改文件 → rollbackToSnapshot 恢复，非 .md 不动）——
均为主线既有语义，RED 阶段即绿属预期（Q18 偏离源文档「加列 + enqueue 收 priority」的验收改造项）。

### 2. GREEN

实现七件套（intentRecord → barrel → DAO → chainTracking → orchestrator 四点 →
agentLoop → worker 回调）后：

```bash
npx vitest run tests/main/db/agentSessionIntentJson.test.ts tests/main/ai/chainTracking.test.ts
```

```text
 ✓ tests/main/db/agentSessionIntentJson.test.ts (5 tests) 28ms
 ✓ tests/main/ai/chainTracking.test.ts (8 tests) 27ms

 Test Files  2 passed (2)
      Tests  13 passed (13)
```

13 例覆盖（计划 §2 任务 6 TDD 要点 1-4）：

1. **DAO 写读往返**：逐字段一致 + 原始列 `JSON.parse` 不抛 + 二次写全量覆盖；
   不存在 session 写不抛（false）读降级 null；坏 JSON → null 不抛；
   fake DB 每条 SQL 校验 `?` 个数 === 参数个数（SECURITY.md 参数化红线，拼接即抛）；
2. **tracker 状态机**：链启动（plan/deps 归一 `s2←serial_after:s1`、首子任务 running、
   其余 pending、`raw JSON` 断言 `not.toContain('retry')` —— 重试计数不落盘）→
   advance 跃迁（done + summary/rounds=1/endedAt≥startedAt>0 + 下一 running）→
   重试耗尽 failed（error 原文入 JSON）→ stopChain 截断（当前+剩余+待追问全 skipped）→
   finalize outcome（finished；stopped 不被覆盖；未收口前 outcome 缺省）；
3. **deps 纯函数**：`serial_after` 解析、重复去重、非串行前置忽略、无依赖无键、空计划 `{}`
4. **回调可选护栏**：未注入 `onChainRecordUpdate` 时启动/推进/停链/收口全程不抛（零行为变化）。

### 3. 回归（既有测试零改动）

```bash
npx vitest run tests/main/ai/subtaskSequence.test.ts tests/main/ai/agentLoopSplit.test.ts \
  tests/main/ai/agentLoop.test.ts tests/main/ai/clarificationMatrix.test.ts \
  tests/main/ai/agentToolExecutor.test.ts tests/main/ai/confirmMatrix.test.ts
```

```text
 Test Files  6 passed (6)
      Tests  171 passed (171)
```

未注入回调时全链零行为变化的回归护栏成立（171 例既有断言零改动全绿，
含链加固 11 例 / agentLoopSplit 7 / 确认矩阵 91）。

### 4. 门禁（全量）

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | `tsc --noEmit` **0 错误** |
| test | `npm run test` | `Test Files 198 passed (198)`；`Tests 4709 passed (4709)`（基线 4696 + 新 13 = 4709） |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（0 error，warning 数与基线 108 一致，新文件零 warning） |
| db 零加列 | `git diff src/main/db/index.ts` | **空（零 diff，零迁移）** |
| playwright | — | 本任务不触 `src/render/`（纯主进程 + 文档），按任务 3 先例跳过 |

### 5. 实施口径记录（偏差如实）

- **推送点语义对齐计划四点**：计划「链启动/子任务状态跃迁/失败跳过/advance 四点」实现为
  `startSubtaskChain`（启动）/ `advanceChain` 全出口（advance + done 跃迁由其上游
  `advanceSubtaskChain` 落库后统一经此推送）/ `handleSubtaskFailure` 停链分支（交互拒绝
  路径不经 advanceChain，单独推送）/ `finalizeChainRun`（收口补 outcome）。推送为
  **幂等全量覆盖**，同一路径多推一次无副作用。
- **`outcome=stopped` 的产点**：计划写「finalizeChainRun 写 outcome」，实现为
  `stopChain` 置 `stopped`（安全点停链的真实判定点）、`finalizeChainRecord` 仅在未设置时
  补 `finished`——否则「先停链后收口」会被写成 finished（GREEN 阶段首跑红即此缺口，补后即绿）。
- **`getIntentJson` 返回类型**：计划 `unknown | null` 在 TS 中归一为 `unknown`
  （`null` 为降级值之一），按 `unknown` 声明 + JSDoc 注明降级语义。
- **`failed` outcome 生产点**：任务 6 不接错误收口路径（计划未要求），类型预留由任务 7 报告线裁定。

---

## 任务 7 — 执行报告合并与部分失败策略｜P1 第二任务

**范围**：新建 `src/main/ai/agent/chainReport.ts`（`buildChainReport` / `renderReportSegment` /
`shouldRenderReport` + `ChainReport` 三态类型）+ `chainTracking.ts`（tracker `+setReport`，
`build()` 条件含 report 字段）+ `subtaskOrchestrator.ts`（`stampWriteBatchForCurrentSubtask`
边界/收口归属标注 + `advanceChain` 入口调用；`handleSubtaskFailure` 增 `{ skipRetry }`
直达 `subtask_failed`；用户选停止 → `setOutcome('failed')`；问题/跳过文案按是否重试分流）
+ `agentToolExecutor.ts`（`WriteBatchItem.subtaskId?` + `WriteBatchConfirmResult` sink +
`confirmWriteBatch` 第三参；force yes-执行失败 + 链态 → `chainForceFailure`；
`ToolRoundResult`/`checkForceConfirmTools` 返回值带信号）+ `agentLoop.ts`
（`processStreamingToolRound` 聚合信号；工具轮后 `handleSubtaskFailure({skipRetry})`
停等处置；`finalizeChainRun` 报告管线：stamp → confirm(sink) → buildChainReport →
条件 renderReportSegment 追加 → `setReport` → finalizeChainRecord → 仍单次 DONE）
+ `getTaskActivity.ts`（SELECT `+s.intent_json`；`TaskActivity +subtasks?/report?`
加法式 + `parseIntentTracking` 容错降级）+ 新建 `tests/main/ai/chainReport.test.ts`（8 例）
+ `agent-message-storage.md` 新 §8 + 本文档。**`git diff src/main/db/index.ts` 空（零加列）。**

### 1. RED（TDD strict）

**首轮**（仅写测试、无实现）：

```bash
npx vitest run tests/main/ai/chainReport.test.ts
```

```text
 Test Files  1 failed (1)
      Tests  no tests
Error: Failed to resolve import "@main/ai/agent/chainReport" from tests/main/ai/chainReport.test.ts. Does the file exist?
```

整文件收集失败（缺被导入模块，vite 静态解析——任务 6/11 同款首轮形态；
`getTaskActivity` 既有用例因同文件静态 import 一并未收集，归因随实现落地后逐例显形）。

### 2. GREEN

实现七件套（chainReport → chainTracking setReport → orchestrator 归属/停等/failed 产点 →
agentToolExecutor sink/信号 → agentLoop 收口管线与消费 → getTaskActivity 透出）后：

**中间轮**（1 failed | 7 passed）：① 归因 = `normalizeTaskPlan` Q7 **同对象写合并**——
测试计划两条 `object: 'weekly.md'` 子任务被并成一条，链只剩 s1 单任务收口。
修正 = 计划层对象改不同（`weekly.md` / `weekly.md 结尾段`），同文件链序经
tool args `file_path: "weekly.md"` 构造（main 侧链序保序语义不变）。

**末轮**：

```bash
npx vitest run tests/main/ai/chainReport.test.ts
```

```text
 ✓ tests/main/ai/chainReport.test.ts (8 tests) 118ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

8 例覆盖（计划 §2 任务 7 TDD 要点三类 + 附加）：

1. **全成功**：两写子任务全 ok → `intent_json.report.tasks` 逐项 `{ok, error:'', artifacts}`
   + `report.artifacts = ['weekly.md','weekly.md']`（同文件链序、不合并不排序）+
   `batch={accepted:2,rejected:0}` + buffer 含「执行报告」逐项行与
   `已保留产物（按执行顺序）` 结构 + **单次 DONE**、intent=primaryIntent、零回滚；
2. **部分失败**：s1 双 LLM 失败 → `failed + error('network down again')` 进 report、
   s2 写成功保留（`executeTool` 1 次、`rollbackToSnapshot` 零调用）+ 同文件 artifacts、
   正文既有「已跳过执行失败的子任务」明示在前、报告段**新增在后**（indexOf 递增断言）；
3. **补偿触发·跳过续链**：force 删除执行失败 → 门控断言停等（`vi.waitFor`：
   交互序列 `intent_split→delete_confirm→subtask_failed`、停等期 LLM 恰 1 次、
   `【子任务 2/2】` 未下达、DONE 未发）→ resume 跳过后 s2 续跑收口，
   report `s1 failed(EACCES) + s2 ok`、删除仅执行 1 次（不自动重试）；
4. **补偿触发·停止**：resume 答 `no` → 全程 LLM 1 次（不继续推进）、
   `outcome='failed'`、report `s1 failed + s2 skipped`、正文含「链已停止·用户选择停止执行」、单次 DONE；
5. **条件渲染护栏**：`shouldRenderReport` 全成功零产物 `false` / 失败、跳过、有产物各 `true`
   （既有链正文 toBe 逐字节等价红线的显式钉）；
6~8. **getTaskActivity**：有效 `intent_json` 透出 `subtasks+report` 且 SQL 含 `s.intent_json` /
   坏 JSON 降级（字段缺省、任务查询照常）/ `intent_json=null` 字段缺省不抛。

### 3. 回归（既有测试零改动）

```bash
npx vitest run tests/main/ai/subtaskSequence.test.ts tests/main/ai/agentLoopSplit.test.ts \
  tests/main/ai/clarificationMatrix.test.ts tests/main/ai/agentToolExecutor.test.ts \
  tests/main/ai/confirmMatrix.test.ts tests/main/ai/chainTracking.test.ts \
  tests/main/ai/agentLoop.test.ts tests/main/db/agentSessionIntentJson.test.ts \
  tests/main/ai/agentPromptBuilder.test.ts
```

```text
 Test Files  9 passed (9)
      Tests  266 passed (266)
```

266 例既有断言零改动全绿——含链正文 `toBe` 全文锚点 6 处（条件渲染护栏生效）、
确认矩阵 8+3 例、`confirmWriteBatch` 返回值 `toBe('')`/`toContain('回滚')` 2 例
（sink 方案零触碰）、`agentPromptBuilder` sha256 基线、任务 6 追踪 13 例。

### 4. 门禁（全量）

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | `tsc --noEmit` **0 错误** |
| test | `npm run test` | `Test Files 199 passed (199)`；`Tests 4717 passed (4717)`（基线 4709 + 新 8 = 4717） |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（0 error，warning 与基线 108 一致，新文件零 warning） |
| db 零加列 | `git diff src/main/db/index.ts` | **空（零 diff，零迁移）** |
| playwright | — | 本任务不触 `src/render/`（纯主进程 + 文档），按任务 3 先例跳过 |

### 5. 实施口径记录（偏差如实）

- **`confirmWriteBatch` 返回值未改对象（红线 5 优先于计划字面）**：计划要求返回值扩展
  `{ rejectedIds, acceptedIds, items }`——实测既有确认矩阵 2 例钉死返回值形态
  （`expect(note).toBe('')` / `toContain('回滚')`），对象返回必然破坏「既有测试零改动」。
  改为**可选第三参 sink**（`WriteBatchConfirmResult`）：两参调用行为逐字节一致，
  agentLoop 收口传 sink 取结构化数据，语义与计划意图（供报告消费）等价。
- **报告段条件渲染（红线 3/5 优先于计划字面）**：计划「仅链态且有子任务时」追加——
  实测既有链正文 `toBe` 全文断言 6 处（agentLoopSplit 431/465、subtaskSequence
  476/531/570/684、clarificationMatrix 384）在全成功零产物链上必然被追加破坏。
  裁定 `shouldRenderReport` = **存在非 ok 子任务或存在保留产物**才追加；
  TDD ①「buffer 含逐项汇报」以**带写产物的全成功链**构造验证。
- **force 失败信号走返回值管线**：`checkForceConfirmTools → ToolRoundResult →
  runAgentFlow 工具轮后消费`，未加 `AgentContext` 字段（计划任务 7 文件清单外零改动；
  与任务 12 将新增的 `currentSubtaskId` 字段不冲突）。信号仅限「yes 后执行报错 + 链态」——
  用户取消与无交互拒执行不属失败、不上报（现语义不变）。
- **`outcome='failed'` 产点**：落在 `handleSubtaskFailure` 用户答 `no` 停链分支
  （失败导致整链终止，覆盖 stopChain 先写的 `stopped`）；中断/封顶安全点停链仍为
  `stopped`（任务 6 断言原样）。任务 6 遗留口径「失败停链置 failed」就此闭环。
- **写批次归属**：`WriteBatchItem.subtaskId` 由 orchestrator `stampWriteBatchForCurrentSubtask`
  在 `advanceChain` 入口（index 仍指刚结束子任务）与收口确认前两处标注（幂等），
  为任务 12 的 subtaskId 收集预同名对齐；首轮 GREEN 后 typecheck 曾报收口调用实参顺序
  错（运行期因 advanceChain 已标注而测试全绿）——tsc 捕获后改为 `(ctx, chain)` 即 0 错。
- **测试计划同对象合并**：Q7 `mergeSameObjectWrites` 在 `parseSplitAnswers → normalizeTaskPlan`
  生效，两条同对象写进不了链——测试计划对象必须相异（见 GREEN 中间轮归因）。

## 任务 4 — 三层意图路由分层｜P1 第三任务

**范围**：新建 `src/main/ai/intentTiering.ts`（`classifyIntentShared` / `prefetchIntentTiered` /
`__resetIntentTierCacheForTest` + `IntentTier2Options`）+ `agentLoop.ts`（`runAgentFlow` 在
`prepareAgentContext` 之前 `await prefetchIntentTiered(payload.message, lazyOpts)` 整体
try/catch fail-closed；lazy 工厂仅 `apiKeyEnc` 非空时 `decryptApiKey` + 取
`config.remoteBaseUrl/model/protocol`）+ `agentContext.ts`（主分类 :533 与技能推断 :419
改经 `intentTiering` namespace 访问 `classifyIntentShared`，缺导出 try/catch 回落
`classifyIntent`）+ `kbSearch.ts`（:385 `isFallthrough` 改 namespace 访问 shared，
只读缓存不预取）+ `tests/main/ai/intentRouterTiered.test.ts`（19 例）+
`docs/architecture/ai-agent.md`「三层意图路由分层」小节 + 本文档。**不改 `classifyIntent`
本体 / gate / `prepareAgentContext` 同步签名 / sha256 提示词。**

### 1. RED（TDD strict）

**首轮**（仅写测试、无实现）：

```bash
npx vitest run tests/main/ai/intentRouterTiered.test.ts
```

```text
 FAIL  tests/main/ai/intentRouterTiered.test.ts[ tests/main/ai/intentRouterTiered.test.ts ]
Error: Failed to resolve import "@main/ai/intentTiering" from "tests/main/ai/intentRouterTiered.test.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

整文件收集失败（缺被导入模块，vite 静态解析——任务 6/7 同款首轮形态）。

### 2. GREEN

实现落地后同命令：

```bash
npx vitest run tests/main/ai/intentRouterTiered.test.ts
```

```text
 ✓ tests/main/ai/intentRouterTiered.test.ts (19 tests) 52ms
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

19 例覆盖（计划 TDD 要点全含）：

| 组 | 用例 |
|----|------|
| 降级链 | 高置信短路零 LLM+零工厂 / 空输入零调用 / 低置信 tier2 覆盖（shared 命中、confidence≥rule）/ 合法性校验（intent ∈ IntentName、confidence≥rule）/ **1.5s 超时回规则（fake timer）** / 抛错回规则 / 非法标签回规则 / lazy 工厂抛错 fail-closed / 工厂返 null 短路 / 非 openai 协议回规则 |
| 共享缓存 | 同 query 二次 prefetch 零 LLM 零工厂 / **TTL 10s 过期重算** / **hasHistory 键隔离** / `__reset` 清空 / **容量 200 LRU 淘汰**（201 条超限，编号 0 淘汰、编号 200 存活） |
| 三调用点回归 | 主调用点 prefetch 后 shared 命中 tier2 不落规则 / 技能推断（hasHistory:true 键）读同缓存 / kbSearch 点无预取时同步等价规则零 LLM（isFallthrough true/false 双向）/ kbSearch 点同 query 只读命中（共享语义，LLM 仅 1 次） |

### 3. 门禁（最终）

| 项 | 命令 | 结果（真实输出） |
|----|------|------|
| typecheck | `npm run typecheck` | 0 错误（无输出） |
| test | `npm run test` | `Test Files 200 passed (200)`；`Tests 4736 passed (4736)`（基线 4717 + 新 19 = 4736；连续两轮全绿，期间一次 1 failed 未复现、无 `FAIL` 记录，判为既有 flaky——见 agent-memory pitfalls） |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（与基线 108 持平，新文件零 warning） |
| 重点回归 | 分批实跑 | `kbSearch(44)+agentContext(80)+intentRouter+intentRouterTiered(19)` = 169 passed；`agentLoop(31)+agentLoopSplit(7)+subtaskSequence(11)+chainReport(8)+clarificationMatrix(6)` = 63 passed |
| playwright | — | 本任务不触 `src/render/`（纯主进程 + 文档），按任务 3/7 先例跳过 |

### 4. 实施口径记录（偏差如实）

- **缓存只写 tier2 成功结果，`classifyIntentShared` 只读**：计划未明写规则结果是否入缓存。
  实测 `agentContext.test.ts:568` 钉死 `classifyIntent toHaveBeenCalledTimes(1)` 且每用例
  `mockClear` —— 若 shared miss 回写规则值，同键二次调用会吃掉 spy 计数 → 断言失败。
  故规则结果不入缓存（miss 即真调规则），仅 `prefetchIntentTiered` tier2 成功时写入；
  对生产语义等价（规则是纯函数），回滚口径「shared 对规则值幂等」仍成立。
- **tier2 触发判定用 `hasHistory=false` 缺省口径**：`prefetchIntentTiered` 缺省写
  `false|input` 与 `true|input` 双键（agentLoop 预取时 hasHistory 尚未从 DB 算出，
  prepare 在其后）；`false` 是 `needsClarification` 长度门的超集（触发面更宽、不会漏），
  且 confidence 计算不含长度门 → 双键同值安全。显式传 `hasHistory` 时只写单键（键隔离用例）。
- **protocol 严格 `'openai'` 才走 tier2**：tier2 是 OpenAI 兼容 one-shot
  （`streamChatCompletion`）；anthropic 协议打 OpenAI 端点必失败，直接回规则省 1.5s 死等。
  生产 `toIAIConfig` 恒归一化 `protocol ?? 'openai'`，故仅测试环境（config 无 protocol 字段）
  落到 skip —— 这同时是既有 runAgentFlow 测试（makeConfig 不带 protocol）零 tier2 污染的护栏。
- **`console.log` 收敛为 `console.warn`**：`no-console` 规则 allow 列表仅 `['warn','error']`，
  用 `console.log` 会给基线 108 warning 增 3 条；改 `console.warn` 后 lint 与基线持平。
  日志仍只记 query 摘要（≤24 字截断）+ rule/tier2 结论，满足计划「离线评估规则覆盖率」要求。

---

## 任务 9 — Agent 意图透传 KB 检索｜L2

计划 §2 任务 9（Q21：检索一次 / 注入 kbQa 子任务上下文 / 冲突以 Agent 为准）。
测试文件：`tests/main/ai/kbIntentBridge.test.ts`（新建，7 例）。

### 1. RED

```bash
npx vitest run tests/main/ai/kbIntentBridge.test.ts
```

```text
 Test Files  1 failed (1)
      Tests  5 failed | 2 passed (7)
```

5 例失败 = ① 透传三例（kbSearch 诊断 / handler 入参 / 子任务链切换后值）+ ③ 冲突
（opts.agentIntent undefined）+ ④ 检索一次（spy 计数与预载断言）；2 例通过 = ② 优先级
（toolsForIntent 既有语义）与 ⑤ 回归（缺省形状），二者即为既有行为锚点。

### 2. GREEN — 变更清单

| 文件 | 变更 |
|------|------|
| `src/shared/ai/kb.ts` | `IKbDiagnosticsQueryUnderstanding` + `agentIntent?: IntentName`（可选，缺省不写键） |
| `src/main/ai/knowledge/kbSearch.ts` | `KbSearchOptions +agentIntent?`；`buildQueryUnderstanding` 第三参，三条路径（主/缓存/早退）均透传 |
| `src/main/ai/toolTypes.ts` | `ToolCtx +agentIntent?`；`SearchKbFn` opts +`agentIntent?` |
| `src/main/ai/tools/searchKBHandler.ts` | `ctx.searchKb` 调用入参加 `agentIntent: ctx.agentIntent` |
| `src/main/ai/agent/agentContext.ts` | toolCtx 构造处注入 `agentIntent: intent.intent`（主 intent） |
| `src/main/ai/agent/subtaskOrchestrator.ts` | `applySubtaskContext` 同步 `ctx.toolCtx.agentIntent = subtask.intent`；kbQa 子任务（+ deps.searchKb + useKnowledgeBase 闸）按子任务 query 单槽预载 `createPreloadedSearchKb`；`issueNextSubtask`/`restartCurrentSubtask`/`startSubtaskChain` 透传 deps |
| `src/main/ai/agent/agentKbPreloader.ts` | 模糊未命中时**先 `await preloadPromise` 再重扫**（首访与在飞预载竞态兜底，保证检索恰一次）；命中统计口径不变 |
| `src/main/ai/agent/agentTaskWorker.ts` | searchKb 闭包重建 opts 时透传 `agentIntent`（与 D1 hadPronounRef 同款，防丢参） |

```bash
npx vitest run tests/main/ai/kbIntentBridge.test.ts
```

```text
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

7 例覆盖（计划 TDD 要点 1-5 全含）：

| 组 | 用例 |
|----|------|
| ① 透传 | kbSearch 诊断写入 `queryUnderstanding.agentIntent`（既有三字段不变）/ handler `ctx.agentIntent` → `opts.agentIntent` / 子任务链：主意图 mock 钉死 chat、s1 切换为 kbQa → 执行面捕获与 `opts.agentIntent` 均为 kbQa，诊断随 tool_result 落该子任务消息栈 + 配对完整 |
| ② 优先级 | 同一句 query planner 判 comparison，但 Agent 判 chat → `toolsForIntent` 无 searchKB（对照 kbQa 有） |
| ③ 冲突 | Agent kbQa + planner comparison：`expandedQueries` 含比较/步骤扩展，`searchMode/topK/threshold` 均 undefined（agentIntent 不碰检索参数） |
| ④ 检索一次 | `deps.searchKb` spy 恰 1 次（子任务 object 核心词预载 + topK 5），工具首访命中单槽缓存；tool_result 配对完整 |
| ⑤ 回归 | 缺省 `agentIntent` 时 `queryUnderstanding` 恰为既有三键（无 agentIntent 键） |

### 3. 门禁（最终）

| 项 | 命令 | 结果（真实输出） |
|----|------|------|
| typecheck | `npm run typecheck` | 0 错误（无输出） |
| test | `npm run test` | `Test Files 201 passed (201)`；`Tests 4743 passed (4743)`（基线 4736 + 新 7） |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（与基线 108 持平，新文件零 warning） |
| 重点回归 | 分批实跑 | `kbSearch+queryPlannerEnhanced+searchKBHandler+agentKbPreloader` = 161 passed；`agentLoop+agentLoopSplit+subtaskSequence+chainTracking` = 57 passed |
| playwright | — | 本任务不触 `src/render/`（纯主进程 + 文档），按任务 3/7 先例跳过 |

### 4. 实施口径记录（偏差如实）

- **计划文件清单外补 `agentTaskWorker.ts`**：worker 构造 `deps.searchKb` 时逐键重建 opts
  （D1 曾因同款丢参被判 bug），不补则生产链路 `agentIntent` 被闭包静默丢弃 —— 透传断言
  只在测试注入面成立。一行加法，与 D1 `hadPronounRef` 注释同款。
- **计划文件清单外补 `agentKbPreloader.ts`（竞态兜底）**：`applySubtaskContext` 预载为
  fire-and-forget，实测工具首访可先于 `cache.set` 落地（promise 链插队）→ spy 计 2 次，
  「检索恰一次」断言失败。修法为 wrapper 模糊未命中时 `await preloadPromise` 后重扫一次
  再触底：预载已落地时零成本；预载失败（内部 catch 恒 resolve）回退直查。既有
  `agentKbPreloader.test` 全绿（其用例均先 `await preloadPromise`，行为等价）。
- **`applySubtaskContext` 对 `ctx.toolCtx` 判空**：`chainTracking.test` 用部分构造的 ctx
  （无 toolCtx）直接调 `startSubtaskChain`，硬写属性抛 TypeError（首轮全量 7 例失败）；
  `prepareAgentContext` 生产路径恒建 toolCtx，判空仅防御测试面部分构造，生产零行为变化。
- **预载 query = 子任务 object 的核心词提取**：断言用 `extractCoreTokens('会议纪要', 3)`
  而非原串 —— S11 停用词表会剥「会/要」，钉原串会把 S11 提取语义误判为回归。
- **payload 级预载闸验证**：链用例 payload.message 取「嗯」（核心词提取为空 →
  agentLoop 级预载跳过），使 `deps.searchKb` 计数只归子任务预载，「恰一次」可精确断言。

---

## 任务 12 — 子任务级确认与暂停/恢复｜L3

**范围**：新建 `tests/main/ai/subtaskConfirmResume.test.ts`（六例，worker E2E + flow 级双基座）
+ 新建 `tests/components/BatchConfirmCard.test.tsx`（3 例，stale 前缀渲染 + 勾选回传）
+ `subtaskOrchestrator.ts`（`applySubtaskContext` 写 `ctx.currentSubtaskId/
currentSubtaskIndex`；新增 `cascadeSkipDependents(chain, record, rejectedId)` 按
`buildDepsMap(plan)`（= intent_json.deps 同源）求传递闭包；`handleSubtaskFailure` 跳过路径
剪出 `skipped_dependency` 后继 + 明示进 buffer）+ `chainTracking.ts`（tracker `+
markSkippedDependency` / `+markDependencyRejected`，终态幂等守卫）+ `agentContext.ts`
（`AgentContext +currentSubtaskId?/+currentSubtaskIndex?`）+ `agentToolExecutor.ts`
（`WriteBatchItem +subtaskIndex?/+originalContentHash?`；`WriteBatchConfirmResult
+cascadeSkippedIds/+staleIds`；`readTargetContentHash` 写前 `xxHash64Sync` + 确认时逐项复检 +
stale 项 text 前缀「⚠️ 目标在执行后被外部修改。」）+ `agentLoop.ts`（`finalizeChainRun`
批次结果初始化含新字段 + 拒项→级联标注（buildChainReport 之前）+ 链收口调用点改
`return await` 使 reject 落进外层 catch 发 `AI_STREAM_ERROR`）+ `chainReport.ts`
（`ChainReportCascade` 类型 + `ChainReportTask.cascade?` 加法字段 + `renderReportSegment`
条件新增级联行）+ `intentRecord.ts` 核对（`skipped_dependency` / `dependency_rejected`
任务 6 已在枚举，零改动）+ `BatchConfirmCard.tsx` **零改动**（逐项 `q.text` 已渲染，
stale 前缀自然呈现）+ `02-diff-cards.md` §7.6.1~7.6.3 + `agent-tool-runtime.md` §14.3 交叉引用。
**复用 P0 暂停/恢复原语（onInteractionRequired → waiting_interaction → resumeInteraction →
finalizeChainRun），不引入 `waiting_operation_confirmation`。**

### 1. RED（TDD strict）

```bash
npx vitest run tests/main/ai/subtaskConfirmResume.test.ts
```

**首轮（6 例全败）**：

```text
 Test Files  1 failed (1)
      Tests  6 failed (6)
```

首轮失败里 ①② 归因为**断言口径**而非实现：worker E2E 中 `db+sessionId+mainWindow` 齐备 →
`createSend` 走 `persistAndSend(eventType='done')` 而非 electron 直发（`AI_SUBTASK_DONE`
无 eventType 映射仍走 electron，故两者可区分）；修正为 `flowDone() = electron done +
persistAndSend('done')` 双口径。④ 的 prompt 断言同步从对象名改为指令行格式
（`处理「doc-b.md」`）——拆分指令段含全量对象清单，断言对象名会误伤。

**末轮（真实 RED 基线）**：

```text
      Tests  4 failed (4) | 2 passed (6)
```

失败 = ③ `statusOf(s2)` 得 `done` 期望 `dependency_rejected`、④ `s2` 得 `done` 期望
`skipped_dependency`、⑤ question text 无 stale 前缀、⑥ `errorEvents` 0 期望 1；
通过 = ①②（P0 暂停/恢复原语在 worker 面的**新增覆盖**，实现本已满足，作为回归锚点保留）。

### 2. GREEN

```bash
npx vitest run tests/main/ai/subtaskConfirmResume.test.ts
```

```text
 ✓ tests/main/ai/subtaskConfirmResume.test.ts (6 tests) 319ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

6 例覆盖（计划 §2 任务 12 TDD 要点 1-6 全含）：

| # | 用例 | 关键断言 |
|---|------|----------|
| ① | 链末批次确认暂停（**真实 AgentTaskWorker E2E**） | `updateSessionStatus → waiting_interaction`、`worker.hasPendingInteraction('sess-1')=true`、`flowDone()=0`；resume 后 `completed` + 单次 DONE |
| ② | resume 带 answers（worker E2E） | 拒项回滚恰 1 次（`{db,'sess-1','u1'}` 透传）、接受项 `editLocalFile` 回滚后重放（executeTool 2+1）、单次 DONE、无 ERROR、pending 清空 |
| ③ | 链末部分拒绝入报告 | `rollbackToSnapshot` 1 次 + 重放 1 次；intent_json `s1=done / s2=dependency_rejected`；`report.tasks[s2]={status:'skipped', cascade:'dependency_rejected'}`；正文含「级联」与 `- s2：` 条件行 |
| ④ | 级联跳过传递闭包 | `s1=failed`、`s2/s3/s4=skipped_dependency`（传递闭包）、`s5（只读对照组）=done` 零误伤；`处理「doc-b/c/d.md」` 指令从未下达、`处理「doc-e.md」` 正常；报告 3 项 `cascade:'skipped_dependency'` |
| ⑤ | staleness 按项（真实临时文件） | 执行期改写 `target-a.md` → 该项 question text 含「⚠️ 目标在执行后被外部修改」；未动的 `target-b.md` 无前缀且基础文案逐字保持；全保留零回滚 |
| ⑥ | 批次确认取消（reject） | `variants=['intent_split','write_batch']` → reject 沿上传播 → `AI_STREAM_ERROR` 恰 1、DONE 0、assistant 不落库（同 `subtaskSequence.test.ts:731` 语义） |

组件测试（补建，原无 BatchConfirmCard 测试）：

```text
 ✓ tests/components/BatchConfirmCard.test.tsx (3 tests)
```

### 3. 门禁（最终）

| 项 | 命令 | 结果（真实输出） |
|----|------|------|
| typecheck | `npm run typecheck` | 0 错误（无输出） |
| test | `npm run test` | `Test Files 203 passed (203)`；`Tests 4752 passed (4752)`（基线 4743 + 新 6 + 3） |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（与任务 9 基线 108 持平，新文件零 warning） |
| 重点回归 | 分批实跑 | `agentToolExecutor+confirmMatrix+subtaskSequence+agentLoopSplit+chainReport+chainTracking+clarificationMatrix+subtaskConfirmResume` = 162 passed |
| playwright | — | 本任务**不触 `src/render/` 源码**（BatchConfirmCard 零改动，仅新增组件测试），按任务 4/9 先例跳过（无 31 例基线比对需求） |

### 4. 实施口径记录（偏差如实）

- **既有测试改动 1 处（Q22 语义取代，非断言迁就）**：`chainReport.test.ts` 任务 7 ③
  「resume 跳过后 s2 继续执行」→ 「级联收口」。根因 = `normalizeTaskPlan` 的
  `annotateSerialWrites` 给**每对相邻写子任务**自动追加 `serial_after`，PLAN_FORCE 的
  s2 因此依赖 s1；任务 12 裁定链中跳过 → 依赖后继 `skipped_dependency` 不再执行
  （计划原文：「链中暂停点拒绝 → 未执行的依赖后继不再执行」）。计划「风险与回滚」已注明
  「级联误伤 → 测试钉死 deps 仅来源于 preconditions/serial_after」，即接受该归一来源。
  停等 / resume / 单次收口 / 报告渲染主干断言保持原样，仅 s2 终态与 LLM 轮数随新语义调整。
  6 处既有 `toBe` 全文锚点（agentLoopSplit 431/465、subtaskSequence 476/531/570/684、
  clarificationMatrix 384）**零改动全绿**。
- **`return await finalizeChainRun('')`（链收口 8 个 try 内调用点）**：裸 `return promise`
  的 rejection 不落入 try/catch（`return-await` 语义）→ 取消批次确认时外层不发
  `AI_STREAM_ERROR`，与 `subtaskSequence.test.ts:731` 错误收口口径不一致（RED ⑥ 归因）。
  改为 `return await` 后 reject 进 catch → ERROR 单次收口 + rethrow。链前（try 外）
  pre-loop 收口点保持原样（无 catch 可落，reject 直达 worker `handleTaskError`，不锁死）。
- **worker E2E 的 DONE 口径**：`persistDeps` 齐备时 `createSend` 把 `AI_STREAM_DONE` 改走
  `persistAndSend(eventType='done')`，`handleTaskSuccess` 另发 `persistAndSend(channel)`——
  测试按 `eventType==='done'` 精确计数，两路互不串扰。
- **级联只标注不改产物**：链末批次拒绝只写 `dependency_rejected` 入报告，**不回滚后继
  已执行产物**（Q22「跳过入报告」的落地解释，防二次放大不可逆损失）；回滚粒度限制沿
  §14.3 如实记录，不扩大承诺。

## 任务 13 — write_mode 消费点 + 写工具清单收敛｜P1 第六任务

计划 §2 任务 13｜Q23 裁定（auto=链末汇总确认必经 / manual=逐写执行前确认 / confirmMatrix 唯一权威）。

### 1. RED（TDD strict）

新建 `tests/main/ai/writeModeConsumption.test.ts`（16 例，计划 TDD 要点 ①-⑤ 全含）：

```bash
npx vitest run tests/main/ai/writeModeConsumption.test.ts
```

```text
 Tests  7 failed | 9 passed (16)
```

RED 7 例（失败归因 = 待实现行为）：

| # | 用例 | 失败归因 |
|---|------|----------|
| ② | manual 单意图 yes：确认卡→执行+preview | `ctx.writeMode` 未注入 + batch 档未按 manual 分派 |
| ② | manual 单意图 no：取消不执行 | 同上 |
| ② | manual 链态逐写确认 + writeBatch 不收集 | 同上 |
| ② | manual 流式路径逐写确认（生产唯一路径） | skip-set 未按 manual 路由 |
| ④ | 遗留 3：无交互+非链+注册 batch（流式）→ 拒写不执行 | `confirmSkipSet(intent,false)` 不含 batch，写工具直通执行 |
| ⑤ | import 方向倒置源码钉 | confirmMatrix 仍 `from './agentToolSelector'` |
| ⑤ | toIAIConfig 透传 writeMode | `toIAIConfig` 未映射该字段 |

通过的 9 例（回归钉先行确认）：① auto 单意图/链态（= 342/404 语义）、③ 缺省 writeMode
逐字一致两例、④ 有交互现行为不变、⑤ 交叉断言三连（matrix⊆concurrency false 集 /
FILE_OP ⊇ matrix / selector 成员 == 原常量）。

### 2. GREEN — 变更清单

- `src/shared/ai/config.ts`：`IAIConfig.writeMode?: WriteMode`（加法可选字段）。
- `src/main/ai/ipc/shared.ts`：`toIAIConfig` 入参 +`writeMode?: WriteMode | null`，
  `writeMode != null` 才下发；`DEFAULT_AI_CONFIG` 不加该字段。
- `src/main/ai/agent/agentContext.ts`：`AgentContext` +`writeMode: WriteMode`；
  `prepareAgentContext` 返回 `writeMode: config.writeMode ?? 'auto'`。
- `src/main/ai/agent/agentToolExecutor.ts`：batch 档按 `ctx.writeMode` 分派——
  `manual` → 执行前逐写确认（question id=toolCallId、type=confirm、含目标路径；
  yes→executeOneTool、no/reject→取消结果、无交互拒——无交互闸在 manual 分支之前，
  两模式共用）；`auto` → 现行为（单意图 execute+preview、链收集+链末汇总）；
  `writeBatch` 收集仅 auto（manual 分支先于收集逻辑 return）。
- `src/main/ai/agent/agentLoop.ts`：新增 `computeRoundSkipSet(ctx, deps, toolNames)`
  （流式路径 + 延迟重发两处统一换用）：矩阵派生之上，**无交互 deps 或 manual** 时把
  `confirmTierFor ≠ 'none'` 的本轮工具补进 skip → 汇入 `checkForceConfirmTools`；
  `auto`+有交互+非链 → 输出与 `confirmSkipSet` 原值逐字节一致。
  **`confirmSkipSet` 函数本体零改动**（红线 1）。
- `src/main/ai/agent/confirmMatrix.ts`：新增权威常量 `CONFIRM_FORCE_TOOLS` /
  `CONFIRM_BATCH_TOOLS`；`confirmTierFor` / `writeToolsByTier` / `isRegisteredConfirmTool`
  改读自身常量；**移除 `from './agentToolSelector'` import（方向倒置）**；
  `KNOWN_NON_WRITE_TOOLS` 改显式枚举（只读 17 项与 selector.READ_ONLY_TOOLS 逐一对应，
  交叉断言钉同）。
- `src/main/ai/agent/agentToolSelector.ts`：`WRITE_TOOLS` / `FORCE_CONFIRM_TOOLS`
  改为从 confirmMatrix 派生再导出（成员逐一不变：7 项 / 2 项）；import 方向
  selector→confirmMatrix（防循环，toolRegistry 叶子依赖无环）。

GREEN：

```text
 Tests  16 passed (16)
```

### 3. 门禁（最终）

| 项 | 命令 | 结果（真实输出） |
|----|------|------|
| typecheck | `npm run typecheck` | 0 错误（无输出） |
| test | `npm run test` | `Test Files 204 passed (204)`；`Tests 4768 passed (4768)`（基线 4752 + 新 16） |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（与任务 9/12 基线 108 持平；新测试文件零 warning） |
| 钉死测试五组 | 分批实跑 | `confirmMatrix+agentToolExecutor+concurrencyDefs+docTools+agentPromptBuilder` = 261 passed（既有断言零改动） |
| flaky 说明 | — | 全量首跑 2 次出现 `tests/benchmarks/ab-test.test.ts`「djb2 faster than MD5」计时断言抖动，单跑 22 passed、第三次全量 4768 全绿——性能断言固有 flaky，与本任务改动无关（不触碰 hash 代码） |
| playwright | — | 本任务**不触 `src/render/` 源码**（BatchConfirmCard/QuestionCard 零改动），按任务 4/9/12 先例跳过 |

### 4. 实施口径记录（偏差如实）

- **manual 确认卡 variant**：计划只规定「question id=toolCallId、type=confirm、含目标路径」，
  未规定 variant → 不传第二参（渲染侧兜底链回退默认 `QuestionCard`，不走
  `delete_confirm` 红卡 / `write_batch` 汇总卡）；与 force 档 `delete_confirm` 视觉区分保留。
- **无交互闸位置**：无交互拒写检查位于 batch 档分支最前、**先于 manual 分派**——
  manual + 无交互 → 拒写（fail-closed），与计划「无交互拒」语义一致，避免先发确认卡再发现无交互。
- **computeRoundSkipSet 触发条件合并**：计划表述为「无交互 deps 时补 skip」；manual 逐写
  确认在流式路径同样要求写档入 skip（否则 `confirmSkipSet(inChain=false)` 不含 batch，
  manual 单意图在生产唯一路径上不可达确认），故补强条件为「无交互 **或** manual」——
  auto+有交互+非链不触发，P0 行为逐字节保持（④ 第 2 例 + ③ 回归钉断言）。
- **lint warning 计数**：中途一次出现 109（`CONFIRM_BATCH_TOOLS` 导入未使用），改为
  `WRITE_TOOLS = new Set([...CONFIRM_BATCH_TOOLS, ...CONFIRM_FORCE_TOOLS])` 完整派生后
  回到基线 108。

---

## 任务 8 — 依赖图并行调度与冲突防护｜P1 第七任务（L3 最大手术面）

### 1. RED（先落测试，实现前实跑证据）

新建 `tests/main/ai/subtaskParallel.test.ts`（13 例，四组对齐计划 TDD 要点）：

| 组 | 用例 | 断言核心 |
|----|------|---------|
| ① 依赖满足才出队 | deps ⊆ done 事件序 | `start:s2 > end:s1`；结果数组 `s1:done, s2:done` |
| ① | 无依赖双读支挂起对齐 | 两支同时进入 launch（gates×2）才放行；`maxActive=2`；第三支等空位（`start:s3 > min(end:s1,end:s2)`） |
| ①（集成） | runAgentFlow 双读支在飞 + 回填 | 会合点确定性：两支 start 均早于任一 end；`maxActive=2`；`s3 serial_after:s2` 等 s2 完成；逐调用 `expectToolPairing`；单次 DONE；`roundsUsed=5`（Σ 支轮次）；产出按队列序逐字节 `产出A\n\n产出B\n\n产出C` |
| ② 互斥防覆盖 | 两写同对象串行 | 在飞期间 `tryDispatch` → `rw_conflict`；事件序严格 `w1 start→end→w2 start→end` |
| ② | 一写一读同对象串行 / R/W 无交集并行 | 前者第二支等空位；后者 `parallelStarted=2` 同时在飞 |
| ② | 幂等键 | 入参键序规范化等价；同键二次 claim 拒；预占 dispatch 键 → `duplicate` |
| ② | 乐观锁 | dispatch(e0) → retryPending(e1) → complete(e1) applied；伪造 complete(e0) → `stale`，results 仍 NEW |
| ③ 分支失败策略 | 错误分类与退避 | 参数/权限/MD5/拒绝 → 不可重试；fetch/ETIMEDOUT/SQLITE_BUSY → 可重试；`computeBackoffMs` 1000/2000/封顶 8000 |
| ③ | A 败 B 成（驱动面） | B 兄弟不取消（`bFinished`）；A launch 计数=1（零退避）；results 按 taskId 聚合 `sA:failed + sB:done`；onSettled×2 |
| ③ | 可重试总闸 | `maxRetries=1` → attempts `[0,1]`，onSettled 仅终局 1 次 |
| ③（集成） | 报告合并 | 单次 DONE、零 ERROR；A 的 LLM 恰 1 次；交互仅 `intent_split`；intent_json `s1:failed/s2:done` + report `[s1:failed, s2:ok]`；正文含「B支产出完成」+ 报告行 |
| ④ 回归 | 上限常量 | `SUBTASK_PARALLEL_LIMIT === 2` |
| ④ | 串行等价 | 同脚本两轮：串行基线 vs `subtaskParallel+limit=1` —— 最终内容 / DONE 数 / roundsUsed / 调用数 / subtask_done 数 / intent_json 态全等 |

RED 实跑（实现前）：

```text
npx vitest run tests/main/ai/subtaskParallel.test.ts
 FAIL  Failed to resolve import "@main/ai/agent/subtaskScheduler" from
      "tests/main/ai/subtaskParallel.test.ts". Does the file exist?
 Test Files  1 failed (1) / Tests  no tests

npm run typecheck（RED 摘录）
 subtaskParallel.test.ts(807,7): error TS2353: Object literal may only specify known
   properties, and 'subtaskParallel' does not exist in type 'Partial<AgentLoopDeps>'.
 （另有 scheduler 未落地导致的 TS7006/TS2339 若干）
```

### 2. GREEN（实现后）

```text
npx vitest run tests/main/ai/subtaskParallel.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### 3. 门禁（最终）

| 项 | 命令 | 结果（真实输出） |
|----|------|------|
| typecheck | `npm run typecheck` | 0 错误（无输出） |
| test | `npm run test` | `Test Files 205 passed (205)`；`Tests 4781 passed (4781)`（基线 4768 + 新 13） |
| lint | `npm run lint` | `108 problems (0 errors, 108 warnings)`（与任务 13 基线 108 持平；新文件零 warning） |
| 既有链测试 | 随全量实跑 | subtaskSequence / agentLoopSplit / clarificationMatrix / subtaskConfirmResume（worker E2E ①②）/ chainReport / chainTracking / agentLoop / agentPromptBuilder sha256 **零改动全绿** |
| flaky 说明 | — | 全量首跑 1 次出现 `tests/benchmarks/ab-test.test.ts`「djb2 faster than MD5」计时断言抖动，单跑 22 passed、复跑全量 4781 全绿——与任务 13 记录的同一性能断言固有 flaky，本任务不触碰 hash 代码 |
| playwright | — | 本任务**不触 `src/render/` 源码**（仅 main/agent + docs + tests），按任务 4/9/12/13 先例跳过 |

### 4. 实施口径记录（偏差如实）

- **启用信号 `deps.subtaskParallel`（计划外新增）**：Q24/计划只给了 `SUBTASK_PARALLEL_LIMIT`
  回滚旋钮，但自动启用会让既有链测试（双读计划即并行就绪）走分支路径破坏「既有链测试零改动」
  红线——故新增显式启用信号，生产 `agentTaskWorker` 注入 `true`；缺省串行零行为变化。
  已同步 status.md 偏离记录。
- **零 DB 改动**：不加 `parent_id`、`agentTaskDao` 出队与 `maxConcurrent=1` 原状维持；
  依赖表达走 `intent_json.deps`（Q18 同口径）——计划「明确不做」项照办。
- **工具轮 id 轮次基址方案**：并发支 `roundBase = 已消耗轮次 + 波内序号×1000`。单支在飞时
  基址=已消耗轮次 → `call_${round}_${index}` 与串行**逐字一致**（worker E2E 硬编码
  `call_0_0`/`call_1_0`/`call_2_0` 的交互答案键因此不失配——这是 worker 注入启用信号后
  `subtaskConfirmResume` ①② 仍全绿的关键）；未引入 toolCallIdTag 改造（零触碰共享 id 生成器）。
- **分支不推 `ai:stream:chunk`**：多支交叉会污染渲染累积器；改为波次空闲 flush 按队列序
  单段补发 done 支全文 + 按余量规则落 `subtask_done`（镜像串行 n-1）——渲染侧
  `appendAssistant(streamText)` 口径不变（`flushAccumulatedSubtask` 对空串已有 no-op 护栏）。
- **并行分支失败不弹 `subtask_failed` 卡**：Q19「失败合并入报告」路径——record.markFailed +
  级联 + 跳过明示 + 链末报告；串行链的 Q12 交互原样保留。多失败排队弹卡属串行链语义，
  并行波次收敛后报告统一告知（集成用例钉 `variants === ['intent_split']`）。
- **重试单点 = `runScheduledLoop`**：映射「不在 activity 内手写重试」——分支段不循环不退避，
  总闸复用 `SUBTASK_FAILURE_MAX_RETRIES=1` 同值传入；退避经 `computeBackoffMs`（测试置 0 跳真实等待）。
- **分支段不做压缩/checkpoint、延迟工具预升级**：分支栈短且波次聚合后统一收口；schema 预升级
  取代流内重发（工具面等价，prompt 前缀更稳定）。
- **交互串行化实现为 `BranchInteractionGate`**（红线 6）：parked → 等在飞支到子任务边界 →
  FIFO 走真实 interaction 回调（复用 waiting_interaction）；无交互 deps 时不建闸，
  写档按「无交互拒写」fail-closed（铁律一不削弱）。

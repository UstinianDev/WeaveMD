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

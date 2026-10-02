# agent-multi-intent — P0 主线实施计划

> 需求（裁定锁定）：`docs/requirements/agent-multi-intent/agent-multi-intent.req.md`（Q1~Q14，2026-10-01 用户裁定「全部按推荐」）
> 源任务：`C:\Users\lenovo\Desktop\优化方向\智能创作Agent-多意图识别-优化方向.md` 任务 1、2、3、5、11
> 范围：仅 P0 五任务，顺序 任务1 → 任务2 → 任务3 → 任务5 → 任务11；P1（4/6/7/9/12/13）与 P2（8/10）挂起
> 行号核对基准：2026-10-01 工作区实况（源文档行号为交接快照，偏差见 §0）
> 档位 L，TDD strict；证据报告 `docs/testing/agent-multi-intent/agent-multi-intent.tdd.md`

## 0. 行号核对结果（源文档 vs 当前工作区）

| 源文档引用 | 当前实况 | 结论 |
| --- | --- | --- |
| `src/shared/ai/agent.ts:4-27`（工具 Schema 风格）、`30-39`（IntentName/IIntent） | 一致 | ✓ |
| `src/main/ai/agent/memoryWriter.ts:242-270, 321` | 函数体 **247-306**；提取提示词 **319-327** | **偏移 +5**（函数增长） |
| `agentPromptBuilder.ts:428,479 / 396-401 / 430-450 / 471-476 / 146` | 428✓、479✓、396-401✓、430-450✓、471-476✓、FILE_OP_WRITE_TOOLS 146✓ | ✓ |
| `anthropicClient.ts:241-258` | body 241-246 / system 247-254 / fetch 256-258 | ✓（但按 Q4 **本计划不改此文件**） |
| `intentRouter.ts:17-67 / 75-155 / 91 / 112-120 / 126-141 / 144-146` | 全部一致 | ✓ |
| `agentContext.ts:517 / 632-640 / 736-743 / 403 / 770-778` | 全部一致 | ✓ |
| `agentHelpers.ts:52-62`（getRoundsForIntent） | 一致 | ✓ |
| `agentLoop.ts:254-631 / 691 / 439 / 407-500` | 254-631✓、691✓、439✓；延迟重发块 **408-502** | 轻微（1 行级） |
| `agentToolExecutor.ts:161-236 / 188 / 206-208 / 224-235 / 127 / 170 / 516 / 519-529` | 全部一致 | ✓ |
| `agentSession.ts:17-39 / 78-90`、`src/shared/ai/task.ts:4-16` | 一致（12 态状态机、waiting_* 4 态） | ✓ |
| `agentTaskWorker.ts:138-141 / 279-297 / 636-680` | maxConcurrent 140✓、createSession 279-297✓、AI_STREAM_DONE 发在 **653**（段 639-680） | 轻微 |
| `agentTaskQueue.ts:35-48` | **35-50**；`supersedeOldTasks` 114-119 | 轻微 |
| `agentToolSelector.ts:18-27 / 30-33 / 36-39 / 105-111 / 112-116` | 全部一致 | ✓ |
| `IntentCard.tsx:19-52`、`AgentTab.tsx:262-269` | 19-21 `isAmbiguousIntent` + 组件 23-52；`handlePickIntent` 261-269 | ✓ |
| `src/main/db/index.ts:538-551 / 564 intent_json` | 一致（**P0 不动**） | ✓ |
| `docs/architecture/ai-agent.md` 意图 93-106 / 写控制 145-169 | 意图 93-106✓；`## 写控制` 标题在 **157**（145-156 为 B11 现状段） | 文档偏移 |
| `03-question-cards.md:75-86`、`agent-tool-runtime.md:30-35` | 一致 | ✓ |

> 口径偏差（非行号）：源文档技术栈陷阱②建议用 zod v4、任务 1 建议扩展 `output_config`/`tool_choice`——分别被 Q3、Q4 裁定否决。本计划**不引入 zod / @anthropic-ai/sdk、不改 anthropicClient、不加 DB 列、不改历史迁移**。

## 1. 总架构设计

### 1.1 拆分结果数据结构：放 `src/shared/ai/`

- **新建 `src/shared/ai/taskPlan.ts`**：
  - `SubtaskDef`：`{ id: string; intent: IntentName; action: string; object: string; params?: Record<string, string | number | boolean>; confidence: number; rw: 'read' | 'write'; preconditions?: string[]; needsClarification?: boolean }`
  - `AgentTaskPlan`：`{ subtasks: SubtaskDef[]; omittedCount?: number; primaryIntent?: IntentName }`
  - `src/shared/ai.ts` barrel 增 `export * from './ai/taskPlan';`
- **取舍依据**：拆分计划必须随 `AgentInteractionPayload`（`src/shared/ai/agent.ts:64-71`）跨 main→render 下发给拆分确认卡；渲染层不能 import `@main`，故类型必须在 `src/shared/ai/`。
- **不进 shared 的部分**：`TASK_PLAN_JSON_SCHEMA`（提示词内嵌的 draft-07 Schema 字面量，风格仿 `src/shared/ai/agent.ts:4-27` 的 `ToolParameter`）与严格校验器 `parseTaskPlan(raw): AgentTaskPlan`——只被主进程提示词构造与解析消费 → 放 `src/main/ai/agent/taskPlannerSchema.ts`。

### 1.2 `parseStructuredJson` 通用骨架（Q3，memory 侧行为不变）

- **新建 `src/main/ai/llm/structuredJson.ts**：`parseStructuredJson<T>(raw: string, opts: { label: string; validate: (v: unknown) => T }): T`
  抽取自 `memoryWriter.parseExtractionItems`（现 247-306）的通用骨架：trim → 剥 ```` ```json ```` 围栏 → `JSON.parse`（失败抛 `` `${label}: LLM 输出不是合法 JSON → …` ``）→ 交 `validate` 逐项严格校验（校验器负责带序号错误、整批拒绝）→ 返回 `T`。
- `memoryWriter.parseExtractionItems` 改为委托：`parseStructuredJson(raw, { label: 'memory_extract', validate: validateExtractionItems })`。**错误文案逐字保留**（`tests/main/ai/memoryWriter.test.ts:630-673` 已钉死 `第 N 项不是对象`、`kind 非法` 等文案），memory 侧行为不变。
- 不引入 zod；校验器手写、聚焦决策字段（`params` 宽松放行，其余字段严格）。

### 1.3 多意图在 agentContext / agentLoop 中的流转（内存编排，不动表）

```
prepareAgentContext (agentContext.ts:423，保持同步)
  └ :517 classifyIntent 之后：detectMultiIntentGate(message) → ctx.intentGateOpen（纯函数，零 LLM）
     并保存链所需快照：ctx.baseHistoryMessages（历史消息，去当前用户消息）、
     ctx.toolSelectionArgs（toolsForIntent 的 7 个入参，:632-640 局部变量上提）
runAgentFlow (agentLoop.ts:228)
  ├ gate 关 → 现有单意图轮次循环（:254-631 逐字节不变）
  └ gate 开 → taskPlanner.runTaskSplit(ctx)            // 一次 LLM 结构化出参调用
       ├ parseTaskPlan 失败 → 重试 1 次（附上次错误）→ 仍失败 → 降级单意图直通（Q5，拆分失败不阻断对话）
       ├ 结果 0/1 个子任务 → 直通
       └ ≥2 子任务 → normalizeTaskPlan（Q7：>5 按 confidence 截断 + omittedCount 明示、
            同文件写合并、不同对象写标串行序）
            → deps.onInteractionRequired(questions, 'intent_split') + plan 下发   // 拆分确认卡
            → deps.waitForInteraction() → 用户增删后确认
            → subtaskOrchestrator 按序执行子任务链（内存编排）：
                 每子任务：重建 ctx.intent/tools/system 提示/子任务指令
                           + 前序子任务执行摘要注入 + 独立轮次预算
                 边界检查：链中断（supersede/同会话新 pending）· 总轮次封顶 · 失败策略
            → 链末：低置信子任务 ask_question_card 追问（每轮 ≤2 题）
            → 单次 AI_STREAM_DONE 收口（intent = primaryIntent）
```

- **队列零改动**：子任务不入 `agent_task_queue`，只存活于本次 run 的内存；session 仍是「一任务一 session」（`agentTaskWorker.ts:279-297`）；`waiting_interaction` 复用现零调用态（`agentSession.ts:30`，状态表 17-39 不动）。
- **交互通道复用**：拆分确认/子任务失败/写批次确认全部走现有 `onInteractionRequired → AGENT_INTERACTION_QUESTION → preload 桥接 → store.pendingInteraction → resumeInteraction → waitForInteraction resolve` 通路，只扩 payload（`AgentInteractionPayload` 增 `plan?: AgentTaskPlan`），不开新 IPC invoke。
- **子任务间落显（DB 与 live 一致）**：新增轻量流事件 `IAgentStreamSubtaskDoneEvent`（`type: 'subtask_done'`，加在 `src/shared/ai/agent.ts` 的 `IAgentStreamEvent` 联合；`src/main/preload.ts` 订阅桥接）——子任务 1..n-1 完成、主进程 `appendMessage` 后推送，渲染侧把已积累 streamText 落为 assistant 气泡并清空累积器；末子任务仍走现有 `AI_STREAM_DONE`。
- **`AgentLoopDeps` 增可选字段**（`agentLoop.ts:77-105`）：`isChainInterrupted?: () => boolean`（worker 供给：`queue.isSuperseded(task.id) || 同会话存在 pending 新消息`）。

### 1.4 规则预检门（Q6 实现化）

- 位置：`src/main/ai/intentRouter.ts`（紧邻 RULES，纯函数、零 LLM 依赖）。
- `CONNECTIVES = ['并且', '然后', '顺便', '另外', '同时', '接着']`。
- `detectMultiIntentGate(input): boolean`：复用 RULES 关键词打分得命中意图类集合 `classes`；句中含连接词时按连接词分句累计各类命中（两子句各命中不同类必然 ≥2）。
- **开闸 ⇔ `classes.size() >= 2`**。「连接词」与「意图关键词并列」是两种并列证据形式，「≥2 类」是唯一开闸条件——连接词单独命中（如「然后？」）或仅一类意图命中（如「润色这篇文档」）一律不开闸，从而在规则层兑现**单意图零 LLM 调用**。
- `classifyIntent` 签名与返回结构不变（候选卡 `candidates` 语义保留，Q8 两套并存）。

### 1.5 轮次双预算（Q9，测试钉死）

- per-subtask：新建 `DeadLoopDetector({ maxRounds: getRoundsForIntent(sub.intent) })`（沿 `agentHelpers.ts:52-62` 现表：chat 6 / kbQa 8 / web·rewrite 10 / create·tech 12），子任务间检测器状态不串味。
- 链总量：`SUBTASK_TOTAL_ROUNDS_CAP = 2 * getRoundsForIntent(primaryIntent)`（主意图 = 拆分前 `classifyIntent` 结果），`Σ roundsUsed` 触顶即停链，剩余子任务标 `skipped` 并正常收口（不视为失败）。
- `confidence` 不参与轮次分配（Q10），仅驱动追问。

### 1.6 风险分档确认矩阵（Q13/Q14，任务 11）

- **新建 `src/main/ai/agent/confirmMatrix.ts`**（纯函数 + 矩阵表）：`type ConfirmTier = 'none' | 'batch' | 'force'`；`confirmTierFor(intent: IntentName, tool: string): ConfirmTier`
  - `deleteFile` / `deleteLocalFile` → `'force'`（任何 intent，等价现 `FORCE_CONFIRM_TOOLS` 语义）；
  - `WRITE_TOOLS` 其余 5 项（`agentToolSelector.ts:30-33`）→ `'batch'`（**任何 intent 不得返回 `'none'`，铁律一不削弱**）；
  - 只读工具 → `'none'`；`memory_write` 维持现口径（铁律一约束笔记/文件写入，doc 已注明不进 FORCE_CONFIRM）；
  - **fail-closed**：未知 intent 值、未登记工具名 → 按 `'batch'`（向确认方向兜底，不向放行方向）。
- **消费点**：
  - `agentToolExecutor.checkForceConfirmTools`（:161-236）泛化为按 `confirmTierFor(ctx.intent.intent, tc.name)` 分派：`'force'` 走现单工具强制卡（:188 delete_confirm、:206-208 yes 才执行保留）；`'batch'` 在单意图链保持现状（执行 + :519-529 preview、proposal 类恒确认），在**多写子任务链**收集为写批次，链末一次汇总确认（variant `'write_batch'`），逐项勾选拒绝走 `agentSnapshot.rollbackToSnapshot`（`agentSnapshot.ts:98`）；
  - **无交互环境**：`'force'`/`'batch'` 一律拒绝执行——把 :224-235 的「无交互拒删除」语义扩展到全部写档（fail-closed 只强不弱）；
  - `agentLoop.ts:691 waitForAll(FORCE_CONFIRM_TOOLS)` 与 `:439 skip-set` 改由矩阵派生集合（`'force'` ∪ 链态下的 `'batch'`）；`FORCE_CONFIRM_TOOLS` 常量保留供既有引用方（与 `READ_ONLY_TOOLS` 迁移先例同口径）。
- **禁止分叉（Q14）**：`agentPromptBuilder.ts:471-476` 写入规则文字与矩阵逐条一致性断言写进测试；矩阵代码为准。
- **确认不省略（Q13）**：auto 模式在 P0 不接（消费点属任务 13）；多写汇总确认只是**合并打断次数**，不省略确认动作；能 staged 的 proposal 类工具优先 staged，直接写盘工具按 Q13「执行 → 汇总确认 → 拒绝项快照回滚」。

### 1.7 拆分确认卡与 UI

- **新建 `src/render/components/AIAgent/cards/SplitConfirmCard.tsx`**：复用现有卡片模式（`IntentCard.tsx` / `QuestionCard.tsx` 的 `rounded-card border border-border bg-bg-tertiary/60` + `--accent` hover 体系，见 `tailwind.config.ts` 自定义色板），**不引入外部组件库**。功能：子任务列表逐项展示（intent 徽标 / action·object / confidence / R/W 标注）+ 行删除 + 底部「添加子任务」+「确认执行」；提交 `answers = { split_plan: JSON.stringify(confirmedPlan) }` 走现有 `resumeInteraction`。
- 接线：`AgentInteractionPayload.plan`（shared）→ `agentTaskWorker.buildAgentDeps` 的 `onInteractionRequired`（现 :604-627，payload 组装处）→ `src/main/preload.ts` 桥接 → `agentStore.pendingInteraction`（:225/:441/:490/:984）→ `AIPanelSession.tsx:114-121` 按 `variant === 'intent_split'` 分派新卡。
- i18n：`src/render/i18n/{zh-CN,zh-TW,en}.json` 增 `ai.split.*` 键（对齐现有 `ai.intent.*` 键位，:66 附近）。

### 1.8 任务 2 / 3 / 5 的执行链切割（避免重复建设）

| 阶段 | 交付的链能力 |
| --- | --- |
| 任务 2（链 v1） | 确认后**按序**对每个子任务复用现有轮次循环：共享 `ctx.llmMessages`（前序工具轮自然在链内累积）、单一总预算、串行执行、单次收口。先让「拆分 → 确认 → 顺序跑通」成立 |
| 任务 3 | 链上增加：低置信子任务标记 → 先执行高置信部分 → 链末 ask_question_card 追问（≤2 题/轮）→ 回答合并回 params 后执行/丢弃 |
| 任务 5（加固） | per-subtask 独立 detector 预算 + 总封顶 2×、每子任务上下文重建 + 前序**执行摘要**注入（不再依赖共享消息累积）、链中断安全点（`isChainInterrupted`）、失败重试 1 次 → `waiting_interaction`、`subtask_done` 落显事件 |

## 2. 逐任务变更清单

### 任务 1 — 结构化任务 Schema（L3，依赖：无）

**新建文件**
- `src/main/ai/llm/structuredJson.ts` — `parseStructuredJson` 通用骨架（§1.2）
- `src/main/ai/agent/taskPlannerSchema.ts` — `TASK_PLAN_JSON_SCHEMA` 常量 + `parseTaskPlan` 严格校验（数组/字段类型/`intent ∈ IntentName`/`confidence ∈ [0,1]`/任一项非法整批 throw）+ `normalizeTaskPlan`（上限 5 截断与 `omittedCount`、同文件写合并、串行标注——Q7 的纯函数部分）
- `src/shared/ai/taskPlan.ts` — `SubtaskDef` / `AgentTaskPlan` 类型

**修改文件**
- `src/main/ai/agent/memoryWriter.ts` — `parseExtractionItems`（现 :247-306）改为委托 `parseStructuredJson`，错误文案不变；:319-327 提示词不动
- `src/shared/ai.ts` — barrel 增一行 `export * from './ai/taskPlan';`

**新增测试文件**
- `tests/main/ai/taskPlannerSchema.test.ts` — 合法（全字段/可选字段缺省）/ 非法（缺字段、类型错、confidence 越界、intent 枚举外、非数组、代码围栏、前后缀文本）/ 降级（空 subtasks、>5 截断 + `omittedCount`、同文件写合并、不同对象写串行序）

**文档同步**
- `docs/specs/ai-agent/agent-prompt-context.md` — 新增「结构化任务拆分出参」章节（提示词内嵌 JSON Schema、本地严格解析、失败重试 1 次降级单意图直通、厂商无关口径）

**TDD strict**：先写 `taskPlannerSchema.test.ts` 全量用例（红）→ 实现骨架与校验器（绿）→ `memoryWriter.test.ts` 既有断言全程不改、全绿作为「memory 侧行为不变」证据。

### 任务 2 — 多意图识别与拆分（L3，依赖：任务 1）

**新建文件**
- `src/main/ai/agent/taskPlanner.ts` — `buildTaskSplitMessages()`（系统提示内嵌 `TASK_PLAN_JSON_SCHEMA` + 输出规约，Q4 厂商无关）+ `runTaskSplit(ctx)`：单次 LLM 调用（协议分流 stream 累积，仿 `contextManager.summarizeViaLlm` :196 的 one-shot 模式）→ `parseTaskPlan` → 失败重试 1 次（附上次错误）→ 仍失败返回 `null` 降级 → 成功交 `normalizeTaskPlan`
- `src/main/ai/agent/subtaskOrchestrator.ts` — 子任务链驱动 v1（§1.8）：拆分确认交互 → 按序执行 → 单次收口
- `src/render/components/AIAgent/cards/SplitConfirmCard.tsx` — 拆分确认卡（§1.7）

**修改文件（预期改动点，行号已核对）**
- `src/main/ai/intentRouter.ts` — 新增 `CONNECTIVES` + `detectMultiIntentGate`（RULES 表 :17-67、`classifyIntent` :75-155 本体不动）
- `src/main/ai/agent/agentContext.ts` — :517 之后计算 gate 写入 `ctx.intentGateOpen`；`AgentContext` 接口（:64-91）增 `intentGateOpen` / `baseHistoryMessages` / `toolSelectionArgs`；:632-640 的 `toolsForIntent` 入参上提为 `toolSelectionArgs`（为任务 5 子任务级工具重建铺垫）；:736-743 多意图恒用 Agent 提示
- `src/main/ai/agent/agentLoop.ts` — `runAgentFlow`（:228）在 `prepareAgentContext`（:237）后接 gate → split → confirm → orchestrator；轮次循环抽出为可复用函数供 orchestrator 调用（**gate 关路径行为逐字节不变**）
- `src/main/ai/agent/agentPromptBuilder.ts` — :428 / :479 的自然语言「拆分步骤」升级为结构化拆分指令段；新增子任务执行指令模板
- `src/main/ai/agent/agentTaskWorker.ts` — `buildAgentDeps.onInteractionRequired`（:604-627）payload 增 `plan` 透传
- `src/main/preload.ts` — `AGENT_INTERACTION_QUESTION` 桥接段（:513-526）透传 `plan`
- `src/render/stores/agentStore.ts` — `pendingInteraction` 类型（:225）与 `onInteraction`（:441/:490/:984）增 `plan`
- `src/render/components/AIAgent/panel/AIPanelSession.tsx` — :114-121 按 `variant === 'intent_split'` 渲染 `SplitConfirmCard`
- `src/render/i18n/zh-CN.json` / `zh-TW.json` / `en.json` — `ai.split.*` 键

**新增/修改测试**
- 修改 `tests/main/ai/intentRouter.test.ts` — **多意图 ≥6 例**：双意图（查笔记+写文件）、三意图、连接词触发、上限 5（截断 + `omittedCount`）、单意图零触发（含「然后？」反例）、低置信追问入口
- 新建 `tests/main/ai/taskPlanner.test.ts` — `runTaskSplit` mock LLM：一次成功 / 解析失败重试 1 次 / 两次失败降级 `null`（直通）/ 1 子任务直通 / 同文件写合并 / 不同对象写串行序
- （建议）新建 `tests/components/SplitConfirmCard.test.tsx` — 渲染、增删行、回传 `split_plan` JSON

**文档同步**
- `docs/architecture/ai-agent.md` — 「意图路由」章节（现 :93-106）扩展：预检门、拆分链路、降级路径、与 KB 侧多意图「桥接不合并」边界提醒
- `docs/specs/ai-agent/agent-prompt-context.md` — 拆分提示词接线细节（任务 1 已建章节则补充）

### 任务 3 — 置信度消费与低风险追问（L2，依赖：任务 2）

**新建文件**：无（挂既有 describe）

**修改文件**
- `src/main/ai/agent/subtaskOrchestrator.ts` — 子任务 `confidence < 0.7` → 标 `needsClarification` 且**不进立即执行序列**；先执行高置信子任务；链末对低置信子任务发 `ask_question_card`（每轮 ≤2 题、`round`/`totalRounds` 标注）；回答合并回 `params` 后执行，无法澄清则丢弃并明示（Q10）
- `src/main/ai/agent/agentContext.ts` — :736-743 提示词二选一扩展：多意图（gate 开且拆分 ≥2）恒 `useAgentPrompt`；单意图低置信路径行为不变
- `src/main/ai/agent/agentPromptBuilder.ts` — :396-401 `clarificationPrefix` 与 :430-450 分轮澄清策略补「多意图低置信子任务追问」条款；**断言 confidence 不参与轮次**
- `src/main/ai/agent/agentToolSelector.ts` — :105-111 chat 意图 `ask_question_card` 逻辑保持（低置信 chat 追问沿用）

**新增测试**
- 修改 `tests/main/ai/agentContext.test.ts` — 新 describe「追问矩阵」：① 单意图低置信 → Agent 提示 + `ask_question_card` 可用；② 多意图含低置信 → 高置信先执行 + 追问发生；③ 每轮 ≤2 题（prompt 断言）；④ `confidence` 不参与轮次（`getRoundsForIntent` 结果不变）；⑤ 高置信多意图零追问；⑥ `candidates` 候选卡与多意图拆分卡语义不混淆（Q8 两套并存）

**文档同步**
- `docs/modules/11-AI代理面板-Agent/03-question-cards.md` — §8.8（现 :75-86）扩展：多意图低置信子任务追问策略、与 `needsClarification` 单意图路径的关系

### 任务 5 — 同 session 子任务顺序执行（L3，依赖：任务 2）

**新建文件**
- `tests/main/ai/subtaskSequence.test.ts`

**修改文件（预期改动点）**
- `src/main/ai/agent/subtaskOrchestrator.ts` — 链加固（§1.8 任务 5 行）：per-subtask `DeadLoopDetector` 预算 + `SUBTASK_TOTAL_ROUNDS_CAP = 2 × getRoundsForIntent(primaryIntent)`；每子任务重建 intent/tools/system 提示/指令（复用 `ctx.toolSelectionArgs` 与 `toolsForIntent`，`agentContext.ts:632-640` 口径）+ `ctx.baseHistoryMessages` 为底 + 前序执行摘要注入；边界检查 `deps.isChainInterrupted` → 安全点停链（Q11）；子任务失败重试 1 次 → 仍失败 `onInteractionRequired(variant 'subtask_failed')` → session `waiting_interaction` 等用户（Q12，预登记任务 7 合并口径）；1..n-1 子任务完成发 `subtask_done`
- `src/main/ai/agent/agentLoop.ts` — `AgentLoopDeps` 增 `isChainInterrupted?`（:77-105）；轮次循环若任务 2 未抽尽则本处收口
- `src/main/ai/agent/agentTaskWorker.ts` — `buildAgentDeps` 注入 `isChainInterrupted`（闭包持 `task.id` / `task.conversationId`）
- `src/main/ai/agent/agentTaskQueue.ts` — 新增 `hasPendingForConversation(conversationId): boolean` 查询方法（**纯代码，不动表结构**，基于 `agentTaskDao.getTasksByConversation` :156 过滤或 DAO 加一条 SELECT）
- `src/shared/ai/agent.ts` — `IAgentStreamSubtaskDoneEvent`（若任务 2 已加类型则仅接线）
- `src/main/preload.ts` — 桥接 `subtask_done`
- `src/render/stores/agentStore.ts` — 收到 `subtask_done`：落显当前 streamText 为 assistant 气泡 + 清空累积器（保持订阅不断）

**新增测试**
- `tests/main/ai/subtaskSequence.test.ts` — 三类必测：**顺序执行**（前序摘要注入断言、intent/tools 逐子任务切换）/ **失败中断**（重试 1 次 → `waiting_interaction`、重试成功则链继续）/ **用户打断**（`isChainInterrupted` 在子任务边界停链、当前子任务跑完不截断）+ 轮次双预算钉死（per-subtask 与 2× 总封顶）+ 同会话 supersede 现语义回归

**文档同步**
- `docs/specs/ai-agent/agent-tool-runtime.md` — 新增「子任务链执行契约」章节：预算、上下文注入、中断安全点、失败重试与 waiting_interaction、与 §3-4 确认/并发契约的关系

### 任务 11 — 风险分档确认矩阵（L3，依赖：任务 2，链能力取自任务 5）

**新建文件**
- `src/main/ai/agent/confirmMatrix.ts` — `confirmTierFor` 矩阵（§1.6）
- `src/render/components/AIAgent/cards/BatchConfirmCard.tsx` — 多写汇总确认卡（复用 SplitConfirmCard 卡片模式与色板，逐项勾选；不引外部组件库）

**修改文件（预期改动点，行号已核对）**
- `src/main/ai/agent/agentToolExecutor.ts` — `checkForceConfirmTools`（:161-236）按矩阵分派：`'force'` 保留 :188/:206-208；`'batch'` 单意图保持现状（:519-529 preview 不动）、多写链收集写批次；**无交互 fail-closed 扩展**（:223-235 语义泛化到 `'batch'`）
- `src/main/ai/agent/agentLoop.ts` — :691 `waitForAll(FORCE_CONFIRM_TOOLS)`、:439 skip-set 改由矩阵派生
- `src/main/ai/agent/agentToolSelector.ts` — :30-39 注释指向矩阵（`WRITE_TOOLS`/`FORCE_CONFIRM_TOOLS` 常量保留）
- `src/main/ai/agent/agentPromptBuilder.ts` — :471-476 写入规则与矩阵同步改写（一致性断言防分叉）
- `src/main/ai/agent/agentSnapshot.ts` — 仅复用 `rollbackToSnapshot`（:98），语义不改
- `src/main/ai/agent/agentTaskWorker.ts` / `src/main/preload.ts` / `src/render/stores/agentStore.ts` / `AIPanelSession.tsx` / i18n×3 — `write_batch` 汇总确认 variant 通路（复用 interaction 通道）

**新增测试**
- 修改 `tests/main/ai/agentToolExecutor.test.ts` — 新 describe「确认矩阵」：**intent（6）× WRITE_TOOLS（7）全组合** + 只读样例 + fail-closed（未知 intent → `'batch'`、未知工具 → `'batch'`、无交互 → 拒绝执行且**不放行**）+ 多写子任务汇总一次确认（打断次数 = 1）+ 逐项拒绝走快照回滚 + 提示词与矩阵一致性断言；既有 7 例全绿（fixture 需注入 interaction deps，见风险 §5）
- （建议）新建 `tests/main/ai/confirmMatrix.test.ts` — 矩阵纯函数全组合枚举

**文档同步**
- `docs/architecture/ai-agent.md` — 「写控制」章节（`## 写控制` 现 :157）改写为 intent×tool 矩阵口径：三档定义、fail-closed、多写汇总、auto 模式仍无消费点（P1 任务 13）如实记录
- `docs/specs/ai-agent/agent-tool-runtime.md` — 确认档位契约（与 §3 skip-set、§4 fail-closed 交叉引用）

## 3. 任务间依赖与提交切分

依赖图：`任务1 → 任务2 →（任务3 → 任务5）→ 任务11`（req 表：3 依赖 2、5 依赖 2、11 依赖 2；实际施工按 1→2→3→5→11 顺序，11 的汇总确认能力取自 5）。**每任务独立提交、独立过门禁**（typecheck + test + lint + playwright）：

| 序 | 提交信息（`type(scope): message`） | 内容边界 |
| --- | --- | --- |
| 1 | `feat(agent): 结构化任务 Schema 与 parseStructuredJson 通用骨架` | 任务 1 全部（schema/解析/类型/memory 委托/测试/文档） |
| 2 | `feat(agent): 多意图预检门、结构化拆分与拆分确认卡` | 任务 2 全部（gate/split/确认卡/链 v1） |
| 3 | `feat(agent): 置信度消费与低置信子任务追问矩阵` | 任务 3 全部 |
| 4 | `feat(agent): 同 session 子任务顺序执行与中断安全点` | 任务 5 全部（预算/摘要/中断/失败重试/subtask_done） |
| 5 | `feat(agent): intent×tool 风险分档确认矩阵与多写汇总确认` | 任务 11 全部 |

- 每个提交同步勾选 `docs/plan/agent-multi-intent.status.md` 阶段进度并追加 TDD 证据到 `docs/testing/agent-multi-intent/agent-multi-intent.tdd.md`。
- 任一提交门禁红即在本提交内修复，不带病进入下一任务。

## 4. 验收标准

### 4.1 总验收（沿用 req §4）

- 新增/扩展测试：`taskPlannerSchema.test.ts`（合法/非法/降级）、`intentRouter.test.ts` 多意图 ≥6 例、追问矩阵（挂 `agentContext.test.ts`）、`subtaskSequence.test.ts`（顺序/失败/打断）、确认矩阵（挂 `agentToolExecutor.test.ts`，含 fail-closed）
- 门禁：`npm run typecheck` + `npm run test` + `npm run lint` + `npx playwright test` 全绿
- 文档同步：`docs/specs/ai-agent/agent-prompt-context.md`、`docs/architecture/ai-agent.md`、`docs/modules/11-AI代理面板-Agent/03-question-cards.md`、`docs/specs/ai-agent/agent-tool-runtime.md`
- TDD strict 证据报告：`docs/testing/agent-multi-intent/agent-multi-intent.tdd.md`

### 4.2 每任务测试用例要点

- **任务 1**：合法出参全字段/可选字段两形态；非法 7 类（缺字段/类型错/confidence 越界/枚举外/非数组/围栏/前后缀）；降级 3 类（空数组/超 5 截断+`omittedCount`/同文件合并）；`memoryWriter.test.ts` 既有断言零改动全绿（memory 行为不变证据）。
- **任务 2**：多意图 ≥6（双意图/三意图/连接词/上限 5/单意图零触发含「然后？」/低置信入口）；`runTaskSplit` 成功/重试 1 次/降级直通；拆分确认卡增删回传；gate 关路径与改动前逐字节等价（回归：既有 `agentLoop.test.ts`、`agentContext.test.ts` 全绿）。
- **任务 3**：追问矩阵 6 例（见任务 3 清单）；每轮 ≤2 题；confidence 不参与轮次；candidates 与拆分卡语义隔离。
- **任务 5**：顺序执行（摘要注入、工具集随子任务切换）/失败（重试 1 次 → `waiting_interaction`，重试成功继续）/打断（边界安全点，当前子任务不截断）+ 双预算钉死 + supersede 回归。
- **任务 11**：6×7 全组合 + fail-closed（未知归 `'batch'`、无交互拒执行）+ 多写汇总一次确认 + 拒绝项快照回滚 + 提示词与矩阵一致 + 既有 7 例全绿。

## 5. 风险与回滚（逐任务）

| 任务 | 主要风险 | 缓解 | 回滚方式 |
| --- | --- | --- | --- |
| 1 | 骨架抽取改变 memoryWriter 错误文案/边界行为；Schema 过严导致真实 LLM 出参频繁被拒 | 既有断言逐字锁定文案；校验只锁决策字段、`params` 放宽 | revert 提交 1；或仅回退 `memoryWriter.ts` 委托（骨架与 schema 文件可独立保留，无调用方即无影响） |
| 2 | **预检门误触发**（多花 LLM 调用/误拆分）；拆分确认交互无人应答卡住；LLM 出参不稳定 | gate 纯函数 + 反例测试；`waitForInteraction` 取消 reject → 降级单意图直通；重试 1 次 + 降级双保险 | `detectMultiIntentGate` 恒 `return false` 一行即回单意图路径（其余代码 dormant 零行为）；revert 提交 2 |
| 3 | 追问风暴/循环追问；追问不答阻塞 | 每轮 ≤2 题 + 轮次不因 confidence 扩张（测试钉死）；沿用 ask_question_card 暂停/取消语义 | 追问矩阵为独立纯逻辑，可退化为「低置信子任务直接跳过并明示」；revert 提交 3 |
| 5 | **子任务链卡死**（预算不重置、检测器串味）；中断漏判；失败重试后 `waiting_interaction` 无人恢复 | per-subtask detector + 2× 总封顶 + 现 `DeadLoopDetector` 三重闸；边界检查失败仅退化为「跑完当前链」（= 现状行为，不更糟）；interaction 取消可 reject | 独立提交可整体 revert（链 v1 仍在提交 2 中）；拆分失败降级直通兜底始终保留 |
| 11 | **确认矩阵削弱 fail-closed**（未知组合误放行）；「无交互拒写」扩展打破既有测试/直连路径；汇总确认与提示词分叉 | 未知一律 `'batch'` + 全组合测试；fixture 注入 interaction deps 后回归；一致性断言测试 | `confirmTierFor` 单点换回现 `FORCE_CONFIRM_TOOLS` 二值实现（函数签名不变，调用方零改动）；revert 提交 5 |

## 6. 技术调研结论（2026-10-01 外部调研，写入实施约束）

### 6.1 Schema 特性取舍（任务 1 `TASK_PLAN_JSON_SCHEMA` 设计依据）

即使走提示词内嵌（Q4 裁定），Schema 形状也应只用**双厂商稳定交集**，让两类后端模型都能稳定产出：

- **只用**：`type` / `properties` / `required`（全字段必填，可选用 nullable 模拟）/ 标量 `enum` / `const` / 嵌套 object（每层 `additionalProperties: false`）/ `array.items` / `description`。
- **禁用**：`oneOf`（两端均未列支持）、`pattern`、min/max/length 类数值约束、递归 `$ref`、根节点 `anyOf`、多层可选字段、依赖 `$schema`/`$id` 语义。
- 来源：Anthropic structured-outputs 文档（additionalProperties 必须 false、minItems 仅 0/1、复杂 pattern 400）、OpenAI strict 模式子集（全字段 required、无 pattern/min/max、嵌套 ≤5 层）——OpenAI 侧经 Azure 文档 + OpenAI blog 交叉印证，官方 guide 原文因地区阻断未取到。

### 6.2 提示词与解析可靠性（任务 1/2）

- few-shot 示例优于抽象 Schema 描述（Anthropic《increase consistency》：示例 "more effective than abstract instructions"）→ 拆分提示词至少带 1 个完整示例。
- 提示词显式追加：禁止 markdown 围栏/解说文字（Anthropic prompt library 模板惯例）；解析端仍兜底：剥围栏 + 截取第一个 `{` 到最后一个 `}`。
- 失败重试时**把校验错误回填进提示词**（通用工程做法，非官方策略）；enum 比较大小写不敏感。
- 已知失配来源：refusal、max_tokens 截断、enum 首字母漂移——重试 1 次 + 降级单意图（Q5）覆盖。

### 6.3 拆分-执行形态（任务 2/5）

- 定位为 prompt chaining + orchestrator 混合：拆分一次（结构化出参），执行期子任务只带「总目标 + 上游子任务产物摘要」，子任务间传结构化产物不传原始对话（Anthropic《Building effective agents》）。
- **tool_result 配对硬约束**：同一次 assistant 轮发出的全部 `tool_use` 必须在紧随的同一条 user 消息一次性回填全部 `tool_result`（`tool_use_id` 一一匹配、`tool_result` 为 content 首块）；某工具失败也须占位 `is_error: true`，否则 400。→ 实施约束：**子任务边界只能落在 assistant/user 轮次之间，禁止把一轮的 tool_result 拆到两个子任务或延到下一轮回填**；子任务链复用现轮次循环（每子任务内部完整走完自己的轮次）天然满足，但改造轮次循环抽取时必须保持「轮内回填完整性」不变式，写入任务 5 测试。
- 顺序执行是官方允许的执行策略（不强制并发），P0 不放开并发与本结论一致。

## 7. 全局红线（每提交核对）

1. 不引入 zod、不引入 `@anthropic-ai/sdk`；不加 DB 列、不改历史迁移（`agent_task_queue`/`agent_sessions` 结构零变更）。
2. 铁律一「AI 写入必经确认」与无交互 fail-closed 不削弱，只允许加强。
3. 单意图输入零 LLM 调用（gate 关路径逐字节等价）；拆分失败不阻断对话。
4. 子任务上限 5、同文件写合并、轮次 per-subtask + 2× 总封顶、supersede 只作废 pending、子任务失败重试 1 次 → `waiting_interaction`。
5. 确认矩阵代码为准、提示词同步且测试防分叉；多写汇总一次确认、拒绝项快照回滚。
6. agent 模块不在覆盖率白名单，验收不看覆盖率数值。

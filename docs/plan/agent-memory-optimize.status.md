# agent-memory-optimize — 状态与进度

> 日期：2026-09-29 | 档位：**L** | 状态：**✅ 全阶段完成（0~8）· 门禁通过、阻塞 0 · 改动行覆盖 100% · 2 条计划外改动待用户追认**
> 关联：[direction](./agent-memory-optimize.direction.md)（路线图） / [req](../requirements/agent-memory-optimize.req.md)（需求与已对齐问题）

## 分级（阶段 0）

| 维度 | 判断 |
|------|------|
| 请求类型 | 优化 / Bug 修复混合（Agent 上下文语义 + 消息存储 + 知识库检索） |
| 影响面 | **跨模块**：主进程 `agent/`（context·loop·toolExecutor）、`llm/`、`knowledge/`、`db/ai.ts`、`ipc/`、渲染 `agentStore`，同一持久化资源（`ai_messages`）**多写入入口** |
| 预估工时 | 多天（7 项任务、批 A/B 两轮、L/strict TDD） |
| **档位** | **L** → 全阶段执行，TDD strict（覆盖率 ≥80%），强制技术调研与规划 |

**裁剪理由**：涉 Agent 上下文语义与消息持久化双写入口，属 devflow-base 阶段 0「跨模块」第 1 条与 L 级定义；不裁剪任何阶段。

## 阶段进度

| 阶段 | 状态 | 产物 |
|------|:----:|------|
| 0 分级 | ✅ | 本文件（L 级 + 裁剪理由） |
| 1 需求对齐（grill-me 3 轮 / Q1~Q11） | ✅ | [req](../requirements/agent-memory-optimize.req.md) |
| 2 技术调研 + Plan 智能体 | ✅ | 2.0 调研结论（见下）+ [plan](./agent-memory-optimize.plan.md)（批 A/B、变更清单、验收标准、书面方案） |
| 3 并行执行（批 A → Gate → 批 B） | ✅ | 批 A 四步 + **Gate A 全绿**；批 B 六步 + E2E 场景①②（31f/103p/1s 零新增）；**Gate B（口径 A）全绿**（改动行覆盖 287/287 = 100%，0 未覆盖新增行） |
| 4 TDD 实现（strict） | ✅ | `../testing/agent-memory-optimize.tdd.md`（354 行，五段证据链 + 18 文件覆盖表 + 10 条偏差；目标 21 文件 570 tests 全绿） |
| 6 测试质量门禁 | ✅ | 7 维度 5 通过 / 2 缺口 → 四项已处置（只动 `tests/`），改后 85 文件 / 1464 tests 全绿 + typecheck 0 error |
| 6.5 连通性验证 | ✅ | `agent-memory-optimize.connectivity.md` — 12 链路 8✅/4⚠️/0❌，**无断裂**；R1/R2 已裁定本批修，R3/R4 留第二批 |
| 7 合规核对 | ✅ | `agent-memory-optimize.compliance.md` — 37 条 31 通过 / 2 ❌（均已改文档）/ 4 ⚠️；红线全过 |
| 8 交付核对 | ✅ | **门禁通过，阻塞 0**：五门禁全绿（vitest 168 文件 3986 例，1 flaky 隔离复核判过）+ E2E 135 三数与基线逐项相等 + 改动行覆盖 19 文件 589/589 = 100% |

## 决策记录（grilling 结论，与 req §六 同源）

| # | 决策 |
|---|------|
| Q1 | 仅 P0 七项；二.2 转「只补测试」；模块三/五/六留第二批 |
| Q2 | 双层验收：vitest 主进程（根因）+ E2E UI（现象，场景①②）；场景③留第二批 |
| Q3 | E2E 用 mock runAgent；真测用已存 `ai_config` |
| Q4 | **基线零新增**：实测 E2E 31 failed/101 passed/1 skipped、unexplained 0；四项门禁真全绿；21 条他模块既有问题另立 issue；10 条已知失败不恢复 |
| Q5 | chat 与其他意图**统一窗口** |
| Q6 | 批 A（P0-1/2/3）→ Gate → 批 B（P0-4/5/6/7） |
| Q7 | 一.4 方案 A：executor 落库 assistant(tool_calls) + 回读补字段 + **停用**渲染侧回写 |
| Q8 | 一.2 四处同批改写，防串题由「只回答最后一条」承担 |
| Q9 | 读取按轮次（3 轮），取消 20 行硬上限，长度交 `buildCompressed` |
| Q10 | `ToolCtx` 注入主流程既有 `ConversationMessage[]`，零额外 DB 读 |
| Q11 | `resolveReferences` 本批接入 searchKB 主管线 |
| Q12 | 改写回退收紧（取消 `extractRecentTopic` 硬拼主题词）+ 双路召回走既有 RRF；改写在 `sanitizeFtsQuery` 前并纳入 cacheKey |
| Q13 | 一.5 加 SQL 端流式字节预算 + 排序 `rowid DESC` 兜底 |
| Q14 | 一.4 单事务写入 + 读取侧配对修复（新建），不加中断主动合成 tool 结果 |
| Q15 | 一.5 取 `max(最近 3 轮全量, 20 行)`，20 由上限降为水位线，轮数保下界、字节闸管上界（解红线冲突） |
| Q16 | **实施期新增裁定（非 grill 轮次）**：P0-4 确定性 id 缺运行维度 → **加运行级 `runId` 盐**。`round` 每次运行从 0 重计（`agentLoop.ts:254`），原 `${conv}_${round}` 会让同会话第二条消息撞 id：assistant 行被 `ON CONFLICT DO UPDATE` 覆盖、tool 行 `INSERT OR IGNORE` 保留旧内容 → 第二次工具结果整体丢失、历史 assistant/tool 错配。`AgentContext.runId` 由 `prepareAgentContext` 每运行生成一次（`crypto.randomUUID()`），id 改 `aturn_${conv}_${runId}_${round}` / `t_${conv}_${runId}_${round}_${index}`。备选 B（改随机 UUID、放弃幂等）与 C（锚定用户消息行 id）已否决 |
| Q17 | **实施期新增裁定（非 grill 轮次）**：plan 的「透传 `tool_calls`」实为**形状转换** → **批准**。DB 列存 `IAgentToolCall[]`，provider 要 `assembleToolTurn` 的 `{id,type:'function',function:{name,arguments}}`，原样透传必然 400 → 在 DB→LLM map 处做 `toLlmToolCalls`，回读链统一 LLM 形状，`repairToolTurnPairing` 以 `tc.id` 对 `tool_call_id`（列值 `call_${round}_${index}` 与 `assembleToolTurn` id 一致）。**P0-4 唯一可行实现，不扩范围** |
| Q18 | **实施期新增裁定（Gate B 阻塞）**：覆盖率整文件 ≥80% 口径不可达 | **A**：改为**改动行覆盖 ≥80%**——删除行不计（无覆盖概念）、`preload.ts`（vitest 无加载路径）与 `toolTypes.ts`（纯类型无运行时语句）判不适用、未覆盖的新增行补测。根因：6 个未达标文件中 **5 个本任务只做了删除**，`preload.ts` 0% 是结构性的。plan §6 已同步改写 |

## 阶段 2.0 技术调研结论（2026-09-28）

**4 条已定决策全部被业界实现印证，无冲突**；带出 10 处落地修正，其中 3 处升格为 Q12/Q13/Q14，7 处直接纳入计划：

| 议题 | 结论 |
|------|------|
| 工具消息序列 | OpenAI/Anthropic 对 `assistant(tool_calls)`→`tool` 是 **400 级硬约束**（反向孤儿同样被拒）；`agentToolExecutor.ts:498` 现只写 tool 行，assistant(tool_calls) **从未落库**——③ 属从零补 |
| 按轮 vs 按行 | `trim_messages` / langmem `SummarizationNode` 均为「按轮取全量→修配对边界→再压缩」，与 ② 同形 |
| 指代改写 | Contextual Retrieval 解决的是 **chunk 侧**指代，不能替代 query 侧改写；`resolveReferences` 在 `queryPlanner.ts` 外**零引用**属实 |
| 短文本澄清 | 主流以「澄清成本」而非字数判定；`intentRouter.ts:141` 的 `length<6` 是无条件充分条件，与目标规则直接冲突 |

**纳入计划的 7 处修正（无需决策）**：③ 修 `agentContext.ts:368-370` 的 `content:''` 过滤（`assembleToolTurn` 正是 `content:''`）+ 回读 map 补 `tool_calls`；② 排序加 `rowid DESC`；④ 改写插在 `sanitizeFtsQuery` 前并入 cacheKey、`detectAmbiguities` 的 `length<2` 加上下文门、配对修复不复用 `cleanupIncompleteMessages`；③ assistant 行幂等 upsert。

> 调研证据源：本地 docs-cli 索引（langchain/letta/mem0/langmem）+ 官方源码（OpenHands classifier、dexto stream-processor、langchain `trim_messages`、langmem `summarization.py`）。本机 crw 不可用、WebSearch 后端该域无返回。

## 关键事实（核验结论，纠正方向文档）

- `tool_calls` 列**已存在**（`src/main/db/index.ts:250-251`）→ **本批无 DDL 迁移**
- chat 丢历史有**两处**：`agentContext.ts:417-420`（history）+ `:422`（summary）
- `resolveReferences`/`understandQuery` **在 searchKB 主管线从未被调用**
- `knowledgeClarify.ts` **不需改代码**（本体无 `history` 引用，门在 `queryPlanner.ts:432` 含 `history.length===0`，随 history 传入自动放行）
- `agentToolSelector` 对所有意图已授约 15 工具，**chat 并非只剩 `ask_question_card`**
- E2E 为 **renderer-only**（不启 Electron）→ 主进程行为只能在 vitest 断言

## 批 A 执行记录（2026-09-28）

| 步骤 | 改动文件 | RED → GREEN | 覆盖率 | 门禁 |
|------|----------|-------------|--------|------|
| A-a（P0-2 文案） | `agentPromptBuilder.ts`（核心规则 2/3、`CHAT_SYSTEM_PROMPT` 2/3/4）、`contextManager.ts`（新增导出 `SUMMARY_USAGE_NOTE`）、两份测试 | 7 failed → 68 passed | `contextManager` 93.91% / `agentPromptBuilder` 83.11% | typecheck 0 / lint 0 / `tests/main/ai/` 950 passed |
| A-b-2（P0-3 门控） | `intentRouter.ts`（`:74` 签名 + `:115` + `:140-142` 三处长度门挂 `lengthGateEnabled`）、`intentRouter.test.ts`（+5 例） | 3 failed → 17 passed | 96.12% Stmts / 82.05% Branch | typecheck 0 / lint 0 / 941 passed |
| A-b-1（P0-1 + 读取上提 + `:449`） | `agentContext.ts`（读取整块上提至 `classifyIntent` 前、`treatLastAsCurrent:false`、删 `slice(0,-1)`、删 `isChat` 双闸、`:449` 改写）、`agentContext.test.ts`（+4 例） | 3 failed → 18 passed | 81.26% Stmts | typecheck 0 / lint 0 / 941 passed |
| A-b-3（接线 `hasHistory`） | `agentContext.ts:246-254`（`hasHistory = dbRows.some(m => m.role==='assistant')`，基于原始读取行）+ `agentContext.test.ts`（+4 例 + `intentRouter` spy） | 4 failed → 22 passed | 82.19% Stmts | typecheck 0 / lint 0 / 954 passed |

### Gate A（2026-09-28 实测）

| 门禁 | 结果 |
|------|------|
| `npm run typecheck` | **0 error** ✅ |
| `npx vitest run` | **162 文件 / 3869 测试全通过**（exit 0）✅ |
| `npm run lint` | **0 error**（106 warning 全为既有）✅ |
| `npx vite build` | **exit 0** ✅ |
| `npx playwright test` | **31 failed / 101 passed / 1 skipped**，`test-results` 逐 spec 分组与基线完全一致 → **零新增** ✅ |

批 A 合计：4 源码文件 + 4 测试文件；新增测试 **22 例**（P0-2 **9 例**——`targets` 3 项 × 2 条措辞断言 + 3 条结构断言、P0-3 **5 例**、P0-1/读取上提 4例、A-b-3 4例）。
（2026-09-29 更正：原记「15 例 / P0-2 3例 / P0-3 4例」系按 `it(` 声明数人工点算，`for` 循环生成的用例未计；以 `git diff 968e056` 实测 `+5` it 声明与 vitest 运行期计数为准。）

**A-a 的判断取舍**：规则 3/4 未整条删除，改用 P0-2 边界（合法指代沿用历史）的正向表述填充，以维持条目编号与结构断言；摘要前缀（`contextManager`）**只含统一句、不含「必须且只能回答」**——防串题由主 system prompt 规则 1 承载，`buildCompressed` 的 history 不含 system prompt，验收按此口径解释。

**已知 flaky（与本批无关，Gate A 须单跑复核）**：`cacheMonitor.test.ts`「getStats 10万次调用 < 50ms」耗时断言、`documentParser` 夹具顺序 2 例——并行负载下偶发，单跑均绿。

## 批 B 执行记录（2026-09-28，第一波三路并行已回齐）

> 文件所有权互斥：B-a+B-e 独占 `db/ai.ts` + 6 处回写链；B-d 独占 `queryPlanner`/`searchKBHandler`/`toolTypes`/`agentTaskWorker`/`agentKbPreloader`；B-f 独占 `knowledgeClarify` 测试。

### B-a + B-e（DAO 新增 + 回写链拆除）✅

| 项 | 结果 |
|----|------|
| `db/ai.ts` 新增 | `utf8Length` / `RoundWindowBuilder` / `buildRoundWindow` / `getRecentMessagesByRounds`（`ORDER BY created_at DESC, rowid DESC` + `stmt.iterate()` 流式 + 轮边界字节闸 + `max(最近3轮, 20行)` 水位线 + 至少保留 1 轮 + 末尾 reverse 为时间正序 + **不设行数硬上限**）；`appendToolTurnWithAssistant`（`db.transaction()` 内 assistant upsert `aturn_${conv}_${round}` → N 条 `INSERT OR IGNORE` `t_${conv}_${round}_${i}` → 同事务刷 `ai_conversations.updated_at`，IPC 不进事务）；`getMessagesByConversation` 补 `rowid ASC`；**删 `updateLatestAssistantToolCalls`**、保留 `updateMessageToolCalls` |
| 迭代器关闭定稿 | **裸 `for...of` + `break`，不加手动 `try/finally`**——ES 规范 break/抛错均走 IteratorClose 调 `iterator.return()`；better-sqlite3 `Next()` 收到 `SQLITE_DONE` 已自行 Cleanup；此前 finally 手动 `return()` 实测把 close 打成 2（二次 Cleanup），已移除 |
| B-e 六处回写链拆除 | `agentStore.ts`、`preload.ts`（iface+impl）、`chatHandlers.ts`（import+handler）、`db/ai.ts`、`weaveMDBridge.ts`（noop 必删）、`tests/setup.ts`；`src/shared/constants.ts:192` 常量**未动** |
| 测试 | `aiMessagesRead.test.ts`（新建 18 例，含「提前停机 close=1 / 正常耗尽 close=0」）、`aiMessagesWrite.test.ts`（新建 11 例，含事务回滚 + 6 处静态验收）、`agentStore.test.ts`（+1：done 后不再回写、内存 toolCalls 保留）、`aiDao.test.ts`（+kb 三元分支夹具） |
| RED | `tests/main/db/` 24 例失败 + `agentStore` 1 例红（缺三个导出、`rowid` 断言红、6 处静态验收命中标识符） |
| GREEN | `tests/main/db/ + agentStore` → **189 passed (10 files)**；全量 `npx vitest run --coverage` → **166 文件 / 3942 测试全绿** |
| 覆盖率 | `src/main/db/ai.ts` → **87.45 stmts / 81.76 branch / 82.35 funcs / 87.45 lines**（≥80 达标） |
| 门禁 | typecheck **0 error** ✅ / lint **0 error**（106 warning 全既有）✅ |
| grep 验收 | `updateLatestAssistantToolCalls` 在 `src/` 计数 **0**；`AI_MESSAGE_UPDATE_TOOL_CALLS` 仅剩 `src/shared/constants.ts:192` |

**B-a 判断取舍（偏差记录）**：① 未按原描述给 `aiDao.test.ts` 的 FakeDatabase 补 `transaction()`/`iterate()`——两个新 DAO 测试各用自包含 fake，补进 aiDao 成死代码，改为扩展其 `kb_enable_*` 夹具抬升 `mapConfigRow` branch（76.62→81.76）；② `e2e/ai-agent-panel.spec.ts:371` 仍有 `updateMessageToolCalls` mock 残留（不在 6 处清单、不在 `src/` 验收范围、typecheck 通过），未改；③ better-sqlite3 `transaction`/`iterate` 真实语义仍只有 fake + 源码取证，**建议后续 Electron smoke 补**；④ 覆盖率口径按任务书走 CLI `--coverage.include`，**未改 `vitest.config.ts:17-22`**（禁改，仍是上一批 EDITOR-FT4 口径）。

### B-d（P0-6 searchKB 接入代词改写）✅

- 改动：`toolTypes.ts`（`ToolCtx.history?`、`SearchKbFn.opts.expandedQueries?`）、`searchKBHandler.ts`（改写置于 HyDE/`ctx.searchKb` 之前 + `expandedQueries:[原 query]` 双路召回 + `buildMinimalUnderstanding(effectiveQuery, res, ctx.history)`）、`queryPlanner.ts`（新增 `resolveReferencesDetailed(q, history?) → {query, resolved}`，`resolveReferences` 委托之；**删 `extractRecentTopic` 硬拼主题词**（`:243` / `:257-265`），函数本体保留给 `extractEntityFromHistory`）、`agentTaskWorker.ts`、`agentKbPreloader.ts`。
- RED **9 failed**（含 `'WeaveMD项目的架构是怎样的的的主要模块有哪些？'`，证明被删的硬拼是有害的）→ GREEN **58 passed**。
- 覆盖率：`queryPlanner.ts` 96.58 lines / 89.62 branch；`searchKBHandler.ts` 94.61 lines / 68.75 branch。
- 门禁：typecheck 0 / lint 0；`tests/main/ai/` 45 文件 / 996 测试绿。
- 六条必须保绿的断言均已核验：`queryPlannerEnhanced:107-110`（**改后行号**，对应 plan §4 所记改前 `:101-106`，同一组断言；按 Q12 改为断言恒等返回 + `resolved:false`）、`:112-124`、`toolRegistry` 33、`kbSearch` 24、`agentKbPreloader` 26。
- 备注：`ToolCtx.history` 在 B-c 接线前保持 `undefined`。

### B-f（P0-7 只补测试）✅

- 新建 `tests/main/ai/knowledgeClarify.test.ts`，**28 例一次全绿**——如实记录为「新增测试对既有实现的验证，无 RED 可造」。
- `knowledgeClarify.ts` 覆盖率 Stmts 95.88 / Branch 95.34 / Funcs 100；`git diff -- src/main/ai/knowledge/knowledgeClarify.ts` **两次为空** → P0-7 硬验收（不改代码）达标。
- `tests/main/ai/` 44 文件 / 982 测试绿（B-d 回归前口径）。

### B-b（P0-4 写路径切新 DAO）✅ + B-b-fix（id 补运行维度）🔵

**B-b 交付**：
- `agentToolExecutor.ts`：新增 `PendingToolWrite`（`:50-59`）/ `createPendingToolWrite`（`:65-74`）/ `flushPendingToolWrite`（`:80-83`）；`processToolResultsLoop` 返回带出 `pending`（`:261-279`）；`handleToolResult` 不再 `appendMessage({role:'tool'})`，改 push 进批次（`:539-547`，**content 取值规则逐字保留**，IPC `ctx.send` 与 `ctx.toolCallsHistory.push` 位置未动）；`executeToolRound` 循环后**单次** flush（`:654-656`，置于 `deadLoopBreak` 早返**之前**，保持「中断也已落库」语义）。
- `agentLoop.ts`：`processStreamingToolRound` 同样循环后单次 flush（`:724-727`）。`grep appendToolTurnWithAssistant src/` 仅 `agentToolExecutor.ts` import + 唯一调用点两处 —— **两条写路径共用同一批次出口**。
- 测试：新建 `tests/main/ai/agentToolExecutor.test.ts`（6 例）、`agentLoop.test.ts`（+4 例，含流式轮次 1 次 DAO 调用、tool 行零 `appendMessage`）、`tests/benchmarks/agent-perf-benchmark.test.ts`（补 mock key）。
- RED **8 failed**（`createPendingToolWrite is not a function` / `expected "spy" to be called 1 times, but got 0 times`）→ GREEN：`tests/main/ai/` **46 文件 / 1006 测试**、全量 **167 文件 / 3952 测试**全绿；typecheck 0；lint **0 error / 106 warning**（无新增）。
- 覆盖率（CLI include，未改 `vitest.config.ts`，临时目录已删）：`agentLoop.ts` **84.72** / `agentToolExecutor.ts` **85.82** Stmts，均 ≥80（首轮 `agentLoop` 仅 77.76，补用例后达标）。

**B-b 判断取舍（总指挥已裁定）**：① `assistantContent` 固定 `''` —— 与内存 `assembleToolTurn` 逐字一致，否则重载后上下文与在线时不一致（对应 req P0-4 第 3 条的论证前提）✅；② 本轮无 tool 行整体不落库 —— 与改动前「该场景零写入」一致，孤儿由 B-c 的 `repairToolTurnPairing` 兜 ✅；③ `handleInteractionPause` 注入的「用户答案」tool 消息仍不落库（行为保留）✅；④ `agentLoop.ts:594-630` 兜底分支为不可达死代码（`STREAMING_TOOL_EXEC_ENABLED === true` 字面量），改由 `agentToolExecutor.test.ts` 直接调 `executeToolRound` 覆盖 ✅；⑤ `agentLoop.test.ts` 为凑覆盖率新增 4 条与 P0-4 无关的分支用例（plan §4 已授权）。

**B-b 风险 1 → Q16（唯一未自行裁定项，已报用户选定方案 A）**：确定性 id 缺运行维度，正常路径即损坏历史。修复工已回齐 ✅：

- `agentContext.ts:5/:63/:190/:514` — `import { randomUUID } from 'crypto'`（与 `agentEventStore.ts` 同风格）、`AgentContext` 增 `runId: string`、`prepareAgentContext` 生成一次（**已确认它是 `AgentContext` 唯一构造点**，无需二次裁定）；`db/ai.ts:772/:779/:796-798/:804-806` — `ToolTurnWriteInput` 增 `runId`、id 改 `aturn_${conv}_${runId}_${round}` / `t_${conv}_${runId}_${round}_${index}`、JSDoc 同步；`agentToolExecutor.ts:53-54/:71` — `PendingToolWrite` 增 `runId`、`createPendingToolWrite` 取 `ctx.runId`。
- 测试 mock 补 key：`aiMessagesWrite`（+「不同 runId → 4 行」「同 runId 重跑 → 仍 2 行」+ 递归扫 `src/**/*.ts` 的旧拼接静态验收）、`agentToolExecutor`（+「落库入参带 `ctx.runId`」「同运行两轮 id 互不相同」「换 runId id 必变」）、`agentContext`（+「两次 prepare 得到不同 runId」）、`streamingToolExecutor` / `agentLoop` / benchmark 的测试替身。
- RED **9 failed / 12 passed**（`expected 3 to be 4`、`expected undefined to be 'run-x'`、静态验收命中 `db/ai.ts` 旧拼接）→ GREEN：`tests/main/` **64 文件 / 1287 测试**（唯一失败为 cacheMonitor 既有 flaky，排除后 63/1250 全绿，单跑 37/37 绿）；`tests/main/ai/ + benchmarks` 48/1041（排除 flaky 后 47/1004 全绿）；typecheck 0；lint **0 error / 106 warning**；`grep 'aturn_${input.conversationId}_${input.round}' src/` **0 命中**。
- 覆盖率（CLI include + `--exclude '**/cacheMonitor.test.ts'`，临时目录已删）：`db/ai.ts` **87.48** / `agentToolExecutor.ts` **85.88** / `agentContext.ts` **88.01** Stmts，均 ≥80（`agentContext` 由约 82 升至 88.01）。
- 说明：不带 `--exclude` 的覆盖率 run 因 flaky 红用例未落报告，故需排除才能取数；`--exclude` 只接受单个 glob。



### B-c（读取集成）✅

**交付**：
- `agentContext.ts`：`HISTORY_BYTE_BUDGET = 45_000`（`L101-105`，出处 plan §7 风险 3 + 「待按 64000 调优」）；`MISSING_TOOL_RESULT_PLACEHOLDER` 常量化（`L179-181`）；`toLlmToolCalls()`（`L183-194`）；`repairToolTurnPairing()`（`L196-235`，两遍：按出现顺序声明 id 并就地丢孤儿 tool → 为缺配对的 assistant 合成占位，纯文本 assistant 原样保留）；**P0-5 接线**（`L311-314`）`getRecentMessagesByRounds(convId, userId, KEEP_RECENT_ROUNDS, { byteBudget: HISTORY_BYTE_BUDGET })`，轮数引用常量无字面量，DAO 返回时间正序已核对 `RoundWindowBuilder.build()` → `groups.flat().reverse()`；map 补 `tool_calls`（`L321-329`）；空 content 过滤改「有 `tool_calls` 放行 / 有 `tool_call_id` 放行 / 否则 `contentToText().trim()` 非空才留」（`L331-336`）；`repairToolTurnPairing(cleanupIncompleteMessages(rawDbMessages))`（`L507`，严格在 cleanup 之后）；`toolCtx.history` 注入（`L592-598`）。
- `agentMedia.ts`：`L14` type-only import `AgentLlmMessage`（编译期擦除，无运行期环）、`L194-196` / `L213-220` 行类型与 `rows` 补 `tool_calls?`、`L236-237` `base` 展开（**无图早退分支也带上**）；`treatLastAsCurrent:false` 等既有语义未动。
- `QuestionCard.tsx:493` 加 `data-testid="question-card"`（1 行）。
- 测试：`agentContext.test.ts` 23→**38 例**（+15：按轮读取 3、回读 `tool_calls`/空 content 4、`toolCtx.history` 2、`repairToolTurnPairing` 6 含接线集成；mock 换 `getRecentMessagesByRounds`）、`agentMedia.test.ts` +3、**新建** `tests/render/components/AIAgent/QuestionCard.test.tsx`；`agentLoop.test.ts` 与 benchmark 各补 1 个 mock key（`vi.mock` 整模块替换的必然级联）。
- RED **12 failed / 36 passed（3 文件）**（`expected "spy" to be called 1 times, but got 0 times`、`expected [] to have a length of 25 but got +0`、`expected undefined to deeply equal [...]`、`expected null not to be null` 等）→ GREEN：`tests/main/` **64 文件 / 1305 例**（仅 cacheMonitor 既有 flaky，单跑 37/37 绿）、`tests/render/` **30 文件 / 276 例全绿**、`contextManager` 18 例绿、benchmarks 34 例绿；typecheck 0；lint **0 error / 106 warning**；全量 coverage run **167 文件 / 3939 例 exit 0**。
- 覆盖率（CLI include + `--exclude='**/{cacheMonitor,ab-test}.test.ts'`，临时目录已删）：`agentContext.ts` **89.77** / 89.56 branch（上一步 88.01，**未掉**）、`agentMedia.ts` **89.28** / 77.61 branch，均 ≥80。

**B-c 判断取舍（总指挥已裁定）**：
1. **【Q17·已裁定】「透传」实为形状转换** —— DB `tool_calls` 列存 `IAgentToolCall[]`，provider 要 `assembleToolTurn` 的 `{id,type:'function',function:{name,arguments}}`，原样透传必然 400。在 DB→LLM map 处做 `toLlmToolCalls` 转换，此后整条回读链统一 LLM 形状，`repairToolTurnPairing` 以 `tc.id` 对 `tool_call_id` 配对（列值 = `call_${round}_${index}`，与 `assembleToolTurn` id 一致）。**属 P0-4 唯一可行实现，不扩范围** ✅。
2. `toolCtx.history` 取「清理/修复之后 + `buildCompressed` 之后的 `llmMessages`」过滤 user/assistant：与模型实际看到的窗口同源（孤儿 tool、占位行不漏进 history；压缩前缀模型侧也读不到原文），零额外 DB 读（测试断言 `getRecentMessagesByRounds` 只调 1 次）✅。**取舍记下批**：history 含当前 user 消息，`queryPlanner.extractEntityFromHistory` 从末尾扫描，极端句式可能自匹配当前句——该函数在 B-d 文件内，本批不动。
3. `cleanupIncompleteMessages` 按最后一条 assistant 截断 → 崩溃中间轮尾部真实 tool 行先被切、随后 repair 补占位显示「结果不可恢复」，属 plan §5/风险 6 预期信息损失（优于整体 400），文案已锁测试 ✅。
4. 存量孤儿 tool 行今后被整体丢弃 —— 相对改动前「provider 必拒的非法序列」是改善，历史工具结果不再进上下文，属 plan 已批准规则 2 ✅。
5. `grep getMessagesByConversationPaginated src/` 现仅 `db/ai.ts:948` 定义、**0 调用方**，按指示保留未删（不属本批范围）✅。

### E2E 场景①② ✅

- 只改 `e2e/ai-agent-panel.spec.ts`（1948 → 2045 行，文件末尾追加），既有 35 条一条未动；局部 helper `sendAndWaitReply` + `RAG_QUESTION`/`FOLLOW_UP` 常量。
- **场景①**「短指代追问不自发弹提问卡」：两轮会话后发「它有什么优势」→ `panel.getByTestId('question-card')` `toHaveCount(0)`（挂载级断言）+ 第二轮回答落显 + 气泡计数下界 + `pageerror` 空。
- **场景②**「chat 意图下历史仍存在」：第一轮落显后先持有 locator（`getByText(RAG_QUESTION,{exact:true}).nth(1)` 跳过 session-title，与既有用例同口径），发第二轮后再断言**第一轮 user/assistant 两个 locator 仍 visible**（区分得出是第一轮那两条，非「有气泡」即可）。
- **口径（已如实写入用例注释）**：renderer-only，主进程 `intentRouter`/`agentContext` 不参与、`pendingInteraction` 由 mock 推送 → 两条是**现象层回归护栏，不是根因证明**（根因在 vitest）。**场景③ 未写**（Q2 裁定留第二批）。
- 定向跑 `npx playwright test e2e/ai-agent-panel.spec.ts`（7.1m）→ **33 passed / 4 failed**，新增 2 条均 passed，4 条失败全为该文件既有登记失败（A4/A2/A3/①整块高亮，「AI 改写」按钮已移除类）→ **无新增**。
- 全量跑（7.5m，135 条）→ **31 failed / 103 passed / 1 skipped** vs 基线 31/101/1：**failed 31=31 零新增**、passed 101+2、skipped 持平；`test-results/` 逐 spec 分组与基线**逐 spec 完全一致**（ai-agent-panel 4 / drag 5 / editor-table 7 / feedback 5 / floating 2 / thematic 2 / exit 2 / editor·image-resize·recent-history·welcome-doc 各 1 = 31）。
- `npm run typecheck` 0 error；`npm run lint` 0 error / 106 warning（核对 mtime，`--fix` 未改写任何 `src/` 文件）。
- **局限（如实记录）**：`toHaveCount(0)` 无法自证 locator 有效（testid 拼错同样为 0）→ locator 存在性由源码 `QuestionCard.tsx:493` 确认，正向渲染断言由 B-c 新建的 `tests/render/components/AIAgent/QuestionCard.test.tsx` 承担；「连续 3 次无 flaky」与「修复前红/修复后绿」的反证在 E2E 层**做不到**（根因逻辑不在该进程）。

### Gate B（第一轮 → 口径裁定 → 复跑中）

**第一轮实测（2026-09-29）：6 项里 5 项通过，覆盖率不通过。**

| 门禁 | 结果 |
|------|------|
| `npm run typecheck` | **0 error** ✅ |
| `npx vitest run` | **168 文件 / 3976 测试**，3975 passed + **1 failed**（`cacheMonitor`「getStats 10万次 < 50ms」107.14ms>50ms，单跑 37/37 绿，既知 flaky）→ 复跑判过 ✅ |
| `npx eslint src/ --ext .ts,.tsx`（不带 fix） | **0 error / 106 warning**；跑后 `git status --short src/` 自证无文件被改写 ✅ |
| `npx vite build` | 成功（renderer 13.51s，1292 modules，仅既有 chunk 警告）✅ |
| `npx playwright test` | **31 failed / 103 passed / 1 skipped**，`test-results/` 逐 spec 分组与基线**完全一致**，新增 2 条 passed → **基线零新增** ✅ |
| 覆盖率（整文件口径） | **6/17 未达标** ❌ → 触发 Q18 裁定 |

**未达标 6 文件的实质**（相对 `968e056` 的 diff）：`preload.ts` 0.00（**0 增 6 删**）、`agentTaskWorker.ts` 50.69（**1 行真实语句** + 类型/注释）、`QuestionCard.tsx` 54.68（**1 行 `data-testid`**）、`agentStore.ts` 56.41（**仅 1 行注释**，8 删）、`chatHandlers.ts` 74.31（**0 增 16 删**）、`weaveMDBridge.ts` 76.04（**0 增 1 删**）——**5 个只做删除**；`preload.ts` 是 Electron contextBridge、`tests/` 无引用，**vitest 结构性加载不到，0% 无法靠补测改变**。

**Q18（总指挥裁定，用户选定 A）**：改为**改动行覆盖 ≥80%** —— 删除行不计；`preload.ts` 与 `toolTypes.ts` 判不适用；未覆盖的新增行补测。保留 strict TDD 本意，不为本任务未写的代码造测。plan §6 已同步改写。

**按口径 A 复跑（2026-09-29 实测）：通过。**

| 门禁 | 结果 |
|------|------|
| `npm run typecheck` | **0 error** ✅（tsconfig `include` 含 `tests`，覆盖新增测试） |
| `npx vitest run`（×3 全量） | 168 文件 / 3977~3979 测试；3 次红项**恒且仅**为既知 flaky（`cacheMonitor` 耗时断言 / `ab-test` djb2 比较），隔离单跑 **37/37 ×3、59/59 ×2 全绿** → 复跑判过 ✅ |
| coverage run（`--exclude` 两个 flaky 文件） | **166 文件 / 3920 测试全绿 ×3**，`coverage-final.json` run #3 落盘 ✅ |
| `npx eslint src/ --ext .ts,.tsx`（不带 fix） | **0 error / 106 warning**；跑后 `git status --short src/` 仍是原有 6 个 M，无文件被改写 ✅ |
| `npx vite build` | 成功（renderer 13.62s + preload 50ms），仅既有 dynamic-import 分块提示 ✅ |
| `npx playwright test` | **31 failed / 103 passed / 1 skipped**，11 个 spec 逐组与基线**完全一致**，新增 2 条 passed ✅ |
| **改动行覆盖（Q18 口径）** | **287 / 287 = 100.00% ≥ 80%**，**0 个未覆盖新增行** ✅ |

**改动行覆盖 18 文件明细要点**（数据源 `coverage-gateb2/coverage-final.json` run #3 × `git diff -U0 968e056` 的 `@@ +start,count @@` 新增行集合）：
- 新增行合计 559，已覆盖 287，未覆盖 **0**，N/A 264（注释 48/空行/纯括号/纯类型/JSX 纯属性）→ **100%**。
- **双口径同结论**：窄口径（按不可执行类别剔 N/A）100%；字面口径（仅「无 statement 映射」算 N/A）287→551/551 同样 100%，**结论不随口径变化**。
- 判不适用直接过：`preload.ts`（0 新增行 + Electron contextBridge）、`toolTypes.ts`（8 新增行全为类型，v8 无 coverage 条目）；`chatHandlers.ts` / `weaveMDBridge.ts` 纯删除 0 新增行。
- 补测 2 处（只动 `tests/`，`src/` 一行未动）：`agentKbPreloader.test.ts` +32 行（2 条断言锁 `expandedQueries` 非空绕过预载缓存 / 空数组不绕过，覆盖口径先红后绿）；`ipc.test.ts` +10 行（`searchKb` 透传 `expandedQueries` 的判别性行为断言）。
- `agentTaskWorker.ts:398` 经逐行取值复核**基线即已覆盖**（s=5），是第一轮「行映射判定误差」，非真实缺口；新断言补的是行为验证（缺行透传则收到 `undefined` 必红）。

**临时产物已清理**：`coverage-gateb2/` 已 `rm -rf`，分析脚本在 `%TEMP%`，仓库内无残留；`vitest.config.ts` 全程未改。

## 批 B 第二波待办（按 plan §1 串行顺序）




| 步骤 | 内容 | 依赖 | 状态 |
|------|------|------|:----:|
| **B-b** | `agentToolExecutor.ts:498-506` → `PendingToolWrite`；`agentLoop.ts:668-728` 流式轮次；两处各调一次新 DAO（`appendToolTurnWithAssistant`） | 依赖 B-a ✅ | ✅ 已回齐 |
| **B-b-fix** | id 补运行维度：`AgentContext.runId` + `db/ai.ts` id 拼接 + `PendingToolWrite.runId` + 测试 mock 补 key（Q16 方案 A） | 依赖 B-b ✅ | ✅ 已回齐 |
| **B-c** | **含 P0-5 接线**（`getMessagesByConversationPaginated(...,20,0)` → `getRecentMessagesByRounds(convId, userId, KEEP_RECENT_ROUNDS, { byteBudget: 45_000 })`，原计划未显式列此项，按 plan §5「回读路径」首环归入 B-c）+ map 转 `tool_calls`（Q17 形状转换）+ 空 content 放行 + 新建 `repairToolTurnPairing` + `agentMedia.ts` 透传 + `toolCtx.history` 注入 + `QuestionCard.tsx` `data-testid` | 依赖 B-b-fix ✅ | ✅ 已回齐 |
| **E2E** | `e2e/ai-agent-panel.spec.ts` 加 2 条：场景①（短追问不弹 QuestionCard）+ 场景②（前序气泡仍在 DOM）。**口径**：renderer-only，两条是现象层回归护栏，根因证明在 vitest | 依赖 B-c ✅ | ✅ 已回齐（全量 31f/103p/1s，零新增，新增 2 条 passed） |
| **Gate B** | 五门禁（typecheck / vitest / eslint 不带 fix / vite build / E2E 基线零新增）+ **改动行覆盖 ≥80%（Q18 口径）** | 全部完成 | ✅ **通过**（改动行 287/287 = 100%，0 未覆盖新增行；五门禁全绿，flaky 隔离单跑复核判过） |



## 阶段 6 测试质量门禁（2026-09-29 实测）

审查对象：本批新增/改动的 18 个测试文件 + 2 个新文件（`git diff 968e056 --stat -- tests/ e2e/`）。实跑 4 组共 22 文件 → **582 passed / 0 failed**（未跑全量 vitest、未跑 playwright，Gate B 已有实测）。审查过程只读，未改任何文件。

| # | 维度 | 结论 | 要点 |
|---|------|:----:|------|
| 1 | 验收覆盖完整性 | ✅ 通过 | P0-1~P0-7 逐条有真实断言落点（明细见 tdd 报告 §3）。低缺口：Q12「改写纳入 cacheKey」靠 `expandedQueries` 存在即跳缓存的结构性保证，无直接断言 |
| 2 | 断言强度 | ⚠️ 有缺口 | 指定核对的 2 条判别性断言（`ipc.test.ts:1730` 透传、`agentKbPreloader.test.ts:279/:296` 正反双向）**经代码推演确认真判别**；弱断言 2 处（见下） |
| 3 | E2E 断言有效性 | ⚠️ 有缺口 | locator 三重确认可靠（源码 `data-testid` + RTL 单测锁 testid + aside 作用域一致）；`sendAndWaitReply` 等待 reply 可见 = 正向锚定已具备。**剩余缺口**：`AIPanelSession.tsx:115` 挂载路径无测试，挂载条件改坏时 `toHaveCount(0)` 假通过 |
| 4 | mock 滥用 | ✅ 通过 | mock 面均在真实边界；被测对象一律真实；`importOriginal` 透传包装非替换 |
| 5 | 缺测 | ⚠️ 有缺口 | 任务点名的 `repairToolTurnPairing` 三规则 / `RoundWindowBuilder` 字节闸 / 幂等 upsert **全部已覆盖**。新发现 1 中项：**流式死循环「先落库再 break」无断言**（见下） |
| 6 | 稳定性 | ✅ 通过 | 本批新增行无计时/性能断言（未引入同类 flaky）；`beforeEach mockReset` 齐；无顺序依赖 |
| 7 | 红线回归 | ✅ 通过 | 0.6 拒答 / 置顶 ×1.5 / searchMode 三模式 / 不减历史轮次 / 不截断工具结果 / 无迁移，六条全有锁（`kbSearch.test.ts` 与 `migrations.test.ts` diff 为空） |

**总指挥裁定（L2 测试补充，只动 `tests/`）**

| 项 | 裁定 | 理由 |
|---|------|------|
| 流式死循环落库缺测（中） | **本批必补** | plan §7 风险 2 明确要求 B-b 同时覆盖两条路径；`STREAMING_TOOL_EXEC_ENABLED=true` 下 `agentLoop.ts:725-727` 是唯一生产路径，现有断言只覆盖被常量关掉的 `executeToolRound` 兜底分支 |
| E2E 正向兜底（中） | **补 RTL 挂载测试，不动 e2e** | 同一风险点（`AIPanelSession` 挂载条件）；改 e2e 须重跑 8 分钟 E2E 基线，RTL 等价且成本低 |
| `agentLoop.test.ts:825` S16 弱断言（低） | **补 spy 优先，不可行则改名如实描述** | 不删测试；用例名与断言不符会误导后续读者 |
| `aiMessagesRead.test.ts:172` 恒真断言（低） | **改断言** | 夹具 `created_at` 全同值致 `<=` 恒真；不得削弱 `rowid DESC` 既有覆盖 |
| 覆盖率 100% 复核 | **接受转录，不重跑** | Gate B 复跑为本 session 实测（18 文件表 + 双口径对照）；重跑需 25 分钟全量，收益低于成本 |
| fake DB 真实 `transaction()`/`iterate()` 语义 | **维持 plan「本批不新增 cjs」**，留后续 Electron smoke | plan §4 fake 约束已声明盲区，SQL 文本断言已对冲 |
| `toLlmToolCalls` 空数组分支、cacheKey 直接断言 | **留第二批** | 低严重度，非本批新增逻辑的主干 |

**处置结果（2026-09-29，只动 `tests/` 3 个文件，4 项全部闭合）**

| 缺口 | 落点 | 断言要点 | 判别性自证 |
|---|---|---|---|
| 流式死循环先落库再 break | `tests/main/ai/agentLoop.test.ts:336-391`（+56 行）+ mock 注入口 `:106-122` | `streamChatCompletion` 只 1 轮 + `roundsUsed===1`（提前 break）；`appendToolTurnWithAssistant` 恰 1 次且 `pending.tools` 内容正确；`appendMessage` 的 `role:'tool'` 仍为 0；用 `invocationCallOrder` 锁工具事件与 `AI_STREAM_ERROR(loop_detected)` **先于** flush、`AI_STREAM_DONE` **后于** flush（plan §5「IPC 不在事务内」） | 探针 A（去 `forceSameResult`）→ 12 轮即红；探针 B（翻成 0）→ 实测 1 次即红 |
| QuestionCard 挂载正向兜底 | `tests/render/components/AIAgent/AIPanelSession.test.tsx:141-169`（**追加既有文件，未新建**） | 正向 `toHaveLength(1)` + 负向 `toHaveLength(0)` | 探针 C（`activeMode` 改 `'chat'` 模拟挂载条件写坏）→ 正向用例红 |
| S16 弱断言 → 真断言 | `tests/main/ai/agentLoop.test.ts:893-925`（**选真断言非改名**） | 读真实 `getCostTracker().getConversationStats('c1')`，快照差值 `+1` + `toMatchObject` 全字段（tokens/intent/model/roundCount） | 删 `if (roundUsage)` 分支 → 条目数不增即红 |
| `aiMessagesRead` 恒真断言 | `tests/main/db/aiMessagesRead.test.ts:162-188`（+18/-3） | 夹具改递减互异 `created_at`；断言 id 全序列 + 严格 `<`；`ORDER BY ... rowid` 的 SQL 断言 `:146-155`/`:251-258` 未动 | 不反转则 `msgs[0]` 变最新行 → id 序列与 `<` 同红 |

探针改动全部复原（`grep SENSITIVITY-PROBE tests/` 无命中）。**改后实跑**：`tests/main/ai/ + tests/main/db/ + tests/render/` → **85 文件 / 1464 tests 全绿**；`npm run typecheck` 0 error；改动的 3 个文件单独 eslint → 0 error / 0 warning。

**遗留（非本任务范围，不阻塞）**：`tests/main/ai/ipc.test.ts:582/1622/1624` 有 3 个 eslint error（`require-yield`、`no-var-requires`），属上一批未提交改动，仓库门禁只跑 `eslint src/` 故不挡 Gate——建议并入下一批 tests/ lint 清理。

## 阶段 6.5 模块连通性验证（2026-09-29）

产物 `agent-memory-optimize.connectivity.md`。**12 条链路：✅ 8 / ⚠️ 4 / ❌ 0 —— 无断裂链路**。实跑 typecheck 0 error、`npm run lint` 0 error、19 文件 499 tests 全绿。

| 链路 | 内容 | 状态 |
|---|---|:----:|
| L1 写路径 | `agentLoop` / `agentToolExecutor` → `PendingToolWrite`（含 `runId`）→ `appendToolTurnWithAssistant` 事务 | ✅ |
| L2 读路径 | `prepareAgentContext` → `getRecentMessagesByRounds` → `tool_calls` 透传 → 空 content 放行 → `repairToolTurnPairing` → `buildCompressed` / `toolCtx.history` | ✅ |
| L3 DB→LLM 形状（Q17） | `toLlmToolCalls` 三出口全覆盖 | ✅ |
| L5 回写链拆除（Q7） | `grep src/` 仅剩 `shared/constants.ts:192` 常量 1 处；IPC/preload/渲染三端同步删除 | ✅ |
| L6 意图兼容 | `classifyIntent(input, ctx?)` 可选 `ctx` 缺省等价旧行为 | ✅ |
| L7 提示语义（P0-2） | 四处措辞一致 | ✅ |
| L8 E2E/UI 接线 | `data-testid` ← `AIPanelSession` ← `pendingInteraction` ← `agentStore` ← IPC 事件，两端字段一致 | ✅ |
| L9 IPC 事务边界 | tool/error 事件在 flush 前、done 在 flush 后；flush 先于 `deadLoopBreak` 返回 | ✅ |
| L4 检索链 | **R1 自指风险**（见下） | ⚠️ |
| L10 会话重载显示链 | **R2 空气泡**（见下） | ⚠️ |
| L11 `AI_CHAT` 链 | 读到空 assistant 行；渲染层全仓无 `.ai.chat(` 调用点，**当前不可达** | ⚠️ |
| L12 Anthropic 出口 | `anthropicClient.ts:221-234` 静默丢 `tool` 行（plan §2.2 明确另立） | ⚠️ |

**总指挥裁定**：

| 项 | 裁定 | 依据 |
|---|---|---|
| **R2 重载态「N 卡片 + N 空气泡」**（L10） | **本批修**（渲染层最小修复） | 我已亲验：`AgentTab.tsx:118-121` 对 `assistant`+`toolCalls` 渲染卡片、`:123` 无条件渲染气泡，`AIMessageBubble.tsx:519-527` 对 `content=''` 出空容器；在线态仅 1 条 assistant（`agentStore.ts:704`），重载态 DB 中 N 条本批新增的 `assistant('')` 全部命中 → 与在线态不一致。属本批引入的用户可见回归，阶段 7 的 F1 独立发现同一问题 |
| **R1 指代改写自指**（L4） | **本批修**（调用点排除当前问题） | 我已亲验：`toolCtx.history` 含当前问题（`agentContext.test.ts:761` 断言），`queryPlanner.ts:131-134` `slice(-6)` 末位前扫 + `:178` 通用 `/(?:关于\|对于\|在\|讨论)/` 会把当前问题自身当实体。该链路由本批 P0-6 首次接入主管线 |
| R3 `AI_CHAT` 空 assistant 行（L11） | **留第二批** | 渲染层全仓无调用点，当前不可达；plan §2.2 列为「不动」 |
| R4 Anthropic 丢 `tool` 行（L12） | **留第二批（另立）** | plan §2.2 / req §四 已明确划出本批范围 |
| Electron smoke（`scripts/agent-smoke.cjs`） | **未验证，不硬跑** | 需 npx electron + 真实 key；plan §4「本批不新增 cjs」。status 剩余风险 4「fake DB 盲区」仍成立 |

## 阶段 7 合规核对（2026-09-29）

产物 `agent-memory-optimize.compliance.md`（148 行）。**37 条：通过 31 / ❌ 不一致 2 / ⚠️ 需关注 4**。diff 基线经 `git log` 确认为 `968e056`（`dd19c47 ← 968e056`），权威口径 `git diff 968e056` = 54 文件 / +4298 −190。

**红线全部通过**：无 hardcode 密钥、SQL 全参数化（`ASSISTANT_UPSERT_SQL` / `TOOL_INSERT_SQL` 模块级常量 + `?` 占位，`ORDER BY created_at DESC, rowid DESC` 为纯常量）、无 `dangerouslySetInnerHTML`、无 `any`、无裸 `.then()`、无新增内联 `style={{}}`、未删测试（`git grep` 用例数 2525 → 2656 净增）、未动迁移（`src/main/db/` diff 仅 `ai.ts`）、未改 DDL、`package.json` diff 为空、consent/allowSend/egress 零变更行。

**❌ 不一致 2 条（均文档，已修正）**：tdd 记 570 例 / 8 个测试文件 → 实测 **571 / 10**，已改 tdd 5 处；`SUMMARY.md` / `.claude/CLAUDE.md` / `docs/README.md` 的 `testing/` 篇数 20 → 21、`plan/` 23 → 25，已在 SUMMARY 挂上本批 tdd + connectivity + compliance 三份索引。

**⚠️ 需关注 4 条**：A7 IPC 面本批只减不增（删 `AI_MESSAGE_UPDATE_TOOL_CALLS` handler + preload 桥、0 新增），但既有 `AI_CONVERSATION_GET`（`chatHandlers.ts:73-83`）以渲染进程传入 `userId` 为权威、未校验 `event.sender` —— **非本批引入，留第二批**；C9 当前在 `main` 工作区开发 —— 经用户 memory `solo-dev-minimal-branching` **已豁免**；C10 覆盖率为转录口径 —— **留第二批留存脚本后复算**；D5 `vite build` 与 E2E 数字为转录 —— **阶段 8 复跑**。

**其他文档漂移（已按阶段 7 报告修正）**：`status.md:126` `buildMinimalUnderstanding` 参数名对齐代码；`req.md:67` `!history` 门行号改注实测 `:460`/`:476`；`docs/TODO.md` 最后更新 09-28 → 09-29。

**保留未改（有意）**：`getMessagesByConversationPaginated` 已无 `src/` 调用点（死代码，留第二批清理）；`shared/constants.ts:192` 通道常量按 plan §5 保留且有测试锁；`e2e/ai-agent-panel.spec.ts:371` 残留 `updateMessageToolCalls` mock（无行为影响，改动需重跑 E2E，留第二批）。

## 阶段 8 交付核对 / Gate（2026-09-29 实跑）

**结论：通过，阻塞项 0。** 全程只跑命令只读，`git status` 与开始快照逐项一致。

| # | 门禁 | 命令 | 关键数字 | 通过 |
|---|------|------|----------|:----:|
| 1 | typecheck | `npm run typecheck` | exit 0，**0 error** | ✅ |
| 2 | vitest 全量 | `npx vitest run` | **168 文件 / 3986 例**，3985 passed + **1 failed**（仅既知 flaky `cacheMonitor` 81.14ms≥50ms）；隔离单跑 `cacheMonitor` ×3 → **37/37 ×3**、`ab-test` → **22/22**，全绿 → 复跑判过；**无其他失败项** | ✅ |
| 3 | eslint（不带 fix） | `npx eslint src/ --ext .ts,.tsx` | **0 error / 106 warning**；跑后 `git status --short src/` 无新增/改写 | ✅ |
| 4 | vite build | `npx vite build` | renderer ✓ 13.17s + preload ✓ 51ms | ✅ |
| 5 | E2E | `npx playwright test` | **31 failed / 103 passed / 1 skipped = 135**，11 个 spec 逐组与基线**完全相等**，零新增；新增 2 条单跑复核 **2 passed（25.9s）** | ✅ |
| 6 | 改动行覆盖（Q18） | CLI `--coverage.include`（未改 `vitest.config.ts`） | **19 文件 / 597 新增行 → 589 覆盖 / 0 未覆盖 / 8 N/A = 100.00% ≥ 80%** | ✅ |

**覆盖率要点**：`597` = `git diff --stat` 的 insertions 总数，自洽；N/A 仅 `toolTypes.ts` 8 行纯类型，`preload.ts` 与 `chatHandlers.ts`/`weaveMDBridge.ts` 为 0 新增行。**双口径同结论**——字面口径 589/589=100%、窄口径（剔注释 172 / 空行 41 / 纯括号 50 共 263 行）326/326=100%。防宽松性：589 行**全部**由 `statementMap` 起始行直接命中，span 回退 0 次。**R1/R2 新增行已重点确认覆盖**：`queryPlanner.ts:144` `if (PRONOUN_RE.test(content)) continue;` s=27；`AgentTab.tsx:115/:125/:156` 三行 s=10。覆盖率 run 为 166 文件 / 3927 例全绿。

**分析脚本已留存** `%TEMP%\gate8_cov_analyze.js` + `%TEMP%\gate8_line_verify.js`（回应阶段 7 C10「留存脚本后复算」，未落仓库）；`coverage-gate8/` 已删除。

**未验证项**：`npm run build`（electron-builder 打包）按指令用 `npx vite build` 替代，打包链路本次不验证；E2E 31 条基线既有失败未修复（非本批引入，按 Q4 口径只核对零新增）。

## 环境与索引（阶段 2.0 记录）

| 检索源 | 状态 |
|--------|------|
| docs-cli 索引 | langchain **164** / letta **120** / mem0 **248** / langmem **42** 页（本会话建立） |
| fastcrw search | **不可用**（本地 backend 需 Docker，未装；5 个公共 SearXNG 均超时）→ **经用户裁定：②③ 改用内置 WebSearch** |
| 适用范围 | WebSearch 替代仅用于模块三/五/六（第二批）的外部检索 |

## E2E 基线（2026-09-28 实测，Q4 依据）

- `npx playwright test`：**31 failed / 101 passed / 1 skipped**，共 133，7.6m
- 逐 spec：editor-table 7 / feedback 5 / drag-selection-markers 5 / ai-agent-panel 4 / floating-toolbar 2 / exit-behavior 2 / thematic-break 2 / welcome-doc·recent-history·image-resize·editor 各 1
- **unexplained = 0**；failed 数与登记基线一致（passed 97→101 来自 `da7ceaa` 新增 4 条 composer 用例）
- 10 条为显式已知（4 选区改写保留证据 + 5「当前 RED」+ 1 G1），其余 21 条为他模块已登记既有问题

## 剩余风险

1. 批 A 改动系统提示语义，可能影响非 chat 意图的既有行为——需 `agentPromptBuilder.test.ts` 回归兜底。
2. Q7 停用渲染侧回写为**删既有能力**，若 executor 落库路径在流式/重试场景漏写，会出现 `tool_calls` 缺失——TDD 须覆盖流式轮次。
3. Q9 取消行数上限后长会话读取量上升，须由 `buildCompressed` 与 `CONTEXT_WINDOW=64_000` 双闸兜住，防 token 超限。
4. **fake DB 盲区未消**：真实 `transaction()` 回滚 / `stmt.iterate()` 提前停机语义只由自包含 fake 断言 + 源码取证，本批按 plan 未新增 `scripts/*.cjs` Electron smoke——建议后续用既有 cjs 脚本补真实语义验证。
5. **既知 flaky 未修**：`cacheMonitor`「getStats 10万次 < 50ms」与 `ab-test` djb2 比较，三次全量红、隔离单跑全绿，按「复跑判过」处置，**本轮 0 处改动其被测代码**；`coverage.reportOnFailure` 默认 false，覆盖率 run 必须 `--exclude` 这两个文件才能取数。
6. **覆盖率复算材料不复存**：`coverage-gateb2/coverage-final.json` 与分析脚本已按「临时产物用完删除」清理，「已覆盖 287 / N/A 264」及双口径对照数字为**转录**，仅「新增行合计 559」经 `git diff --numstat` 独立复算验证；日后复核需按 plan §6 命令重跑。
7. **`docs/testing/agent-memory-optimize.tdd.md` 354 行，超出 CONTRIBUTING「测试报告 ≤200 行」建议**：信息量受 L/strict 五段证据链 + 18 文件覆盖表 + 10 条偏差约束，**未拆分**（拆分需新建分册文件，待用户批准后再做）。

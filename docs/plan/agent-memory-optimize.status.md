# agent-memory-optimize — 状态与进度

> 日期：2026-09-28 | 档位：**L** | 状态：**🔵 进行中 · 批 A 完成（Gate A 五项全绿），批 B 三路并行已回齐（B-a+B-e / B-d / B-f），待派 B-b、B-c**
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
| 3 并行执行（批 A → Gate → 批 B） | 🔵 | 批 A 四步 ✅ + **Gate A 全绿**；批 B 第一波三路（B-a+B-e / B-d / B-f）**全部回齐 ✅**，第二波 B-b → B-c 待派 |
| 4 TDD 实现（strict） | ⬜ | `../testing/agent-memory-optimize.tdd.md` |
| 6 测试质量门禁 | ⬜ | — |
| 6.5 连通性验证 | ⬜ | `agent-memory-optimize.connectivity.md` |
| 7 合规核对 | ⬜ | `agent-memory-optimize.compliance.md` |
| 8 交付核对 | ⬜ | — |

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
| A-b-2（P0-3 门控） | `intentRouter.ts`（`:74` 签名 + `:115` + `:140-142` 三处长度门挂 `lengthGateEnabled`）、`intentRouter.test.ts`（+4 例） | 3 failed → 17 passed | 96.12% Stmts / 82.05% Branch | typecheck 0 / lint 0 / 941 passed |
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

批 A 合计：4 源码文件 + 4 测试文件；新增测试 15 例（P0-2 3例结构断言、P0-3 4例、P0-1/读取上提 4例、A-b-3 4例）。

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

- 改动：`toolTypes.ts`（`ToolCtx.history?`、`SearchKbFn.opts.expandedQueries?`）、`searchKBHandler.ts`（改写置于 HyDE/`ctx.searchKb` 之前 + `expandedQueries:[原 query]` 双路召回 + `buildMinimalUnderstanding(query, res, history)`）、`queryPlanner.ts`（新增 `resolveReferencesDetailed(q, history?) → {query, resolved}`，`resolveReferences` 委托之；**删 `extractRecentTopic` 硬拼主题词**（`:243` / `:257-265`），函数本体保留给 `extractEntityFromHistory`）、`agentTaskWorker.ts`、`agentKbPreloader.ts`。
- RED **9 failed**（含 `'WeaveMD项目的架构是怎样的的的主要模块有哪些？'`，证明被删的硬拼是有害的）→ GREEN **58 passed**。
- 覆盖率：`queryPlanner.ts` 96.58 lines / 89.62 branch；`searchKBHandler.ts` 94.61 lines / 68.75 branch。
- 门禁：typecheck 0 / lint 0；`tests/main/ai/` 45 文件 / 996 测试绿。
- 六条必须保绿的断言均已核验：`queryPlannerEnhanced:107-110`（按 Q12 改为断言恒等返回 + `resolved:false`）、`:112-124`、`toolRegistry` 33、`kbSearch` 24、`agentKbPreloader` 26。
- 备注：`ToolCtx.history` 在 B-c 接线前保持 `undefined`。

### B-f（P0-7 只补测试）✅

- 新建 `tests/main/ai/knowledgeClarify.test.ts`，**28 例一次全绿**——如实记录为「新增测试对既有实现的验证，无 RED 可造」。
- `knowledgeClarify.ts` 覆盖率 Stmts 95.88 / Branch 95.34 / Funcs 100；`git diff -- src/main/ai/knowledge/knowledgeClarify.ts` **两次为空** → P0-7 硬验收（不改代码）达标。
- `tests/main/ai/` 44 文件 / 982 测试绿（B-d 回归前口径）。

## 批 B 第二波待办（按 plan §1 串行顺序）

| 步骤 | 内容 | 依赖 |
|------|------|------|
| **B-b** | `agentToolExecutor.ts:498-506` → `PendingToolWrite`；`agentLoop.ts:668-728` 流式轮次；两处各调一次新 DAO（`appendToolTurnWithAssistant`） | 依赖 B-a ✅ |
| **B-c** | `agentContext.ts` map 透传 `tool_calls` + `:368-370` 空 content 放行 + 新建 `repairToolTurnPairing` + `agentMedia.ts` 透传 + `toolCtx.history` 注入；`QuestionCard.tsx` 加 `data-testid="question-card"` | 依赖 B-a ✅、B-b |
| **E2E** | `e2e/ai-agent-panel.spec.ts` 加 2 条：场景①（短追问不弹 QuestionCard）+ 场景②（前序气泡仍在 DOM） | 依赖 B-c |
| **Gate B** | 四门禁真全绿 + 改动文件 coverage ≥80（`vitest.config.ts:17-22` 的 `coverage.include` 口径，需临时 CLI 覆盖或按批 B 文件逐个跑）+ E2E 基线零新增 + 新增 2 条 E2E 全绿 | 全部完成 |



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

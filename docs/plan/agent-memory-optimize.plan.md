# agent-memory-optimize — 实施计划（第一批 P0）

> 输入：`docs/requirements/agent-memory-optimize.req.md` + `docs/plan/agent-memory-optimize.status.md` + `docs/plan/agent-memory-optimize.direction.md`（行号已按 2026-09-28 源码重新 grep 复核，direction 行号一律不引用）
> 档位 L / TDD strict。本文只写「怎么改、改哪里、怎么验」。不确定锚点标 **[待复核]**。
> 日期：2026-09-28 | 状态：**待用户确认 Gate 确认点（§7-4）后进入阶段 3**

## 1. 批次划分与执行顺序

### 批 A（语义层）→ Gate A → 批 B（存储与检索层）→ Gate B

**批 A 内部**（三项都改 `agentContext.ts`，故该文件为串行主干）：

| 步骤 | 内容 | 并行性 |
|---|---|---|
| A-a-1 | P0-2 文案：`agentPromptBuilder.ts` + `contextManager.ts`（不含 `agentContext.ts:449`） | **可并行**（A-a-2 前先落 RED） |
| A-a-2 | RED 用例：`agentPromptBuilder.test.ts` 追加、`contextManager.test.ts:72-75` 改写 | **可并行** |
| A-b-1 | `agentContext.ts`：历史读取上提 + P0-1 + `:449` 文案 | **必须串行**（同文件唯一改点） |
| A-b-2 | `intentRouter.ts` P0-3 签名与门控 | **可并行**于 A-a，但须在 A-b-3 前合入 |
| A-b-3 | `agentContext.ts` 接线 `classifyIntent(message, {hasHistory})` + 回归用例 | **必须串行**（依赖 A-b-1/A-b-2） |

**Gate A**：四门禁 + E2E 基线零新增；`agentContext.test.ts` / `intentRouter.test.ts` / `agentPromptBuilder.test.ts` / `contextManager.test.ts` 全绿。

**批 B 内部**：

| 步骤 | 内容 | 并行性 |
|---|---|---|
| B-a | `db/ai.ts` 新增 `getRecentMessagesByRounds` + `appendToolTurnWithAssistant` + `getMessagesByConversation` 排序兜底 | **可并行**（纯 DAO 层，无调用方） |
| B-d | P0-6 检索链：`toolTypes.ts` → `searchKBHandler.ts` → `queryPlanner.ts` → `agentTaskWorker.ts` → `agentKbPreloader.ts` | **可并行**（与 B-a 无交集） |
| B-e | 回写链拆除：`agentStore.ts` / `preload.ts` / `chatHandlers.ts` / `weaveMDBridge.ts` / `tests/setup.ts` | **可并行**（与 B-a/B-d 无交集） |
| B-f | P0-7 纯测试（`knowledgeClarify.test.ts`） | **可并行**（零代码改动） |
| B-b | `agentToolExecutor.ts` + `agentLoop.ts` 写路径切到新 DAO | **必须串行**，依赖 B-a |
| B-c | `agentContext.ts` 读取集成：`tool_calls` 回读 + 空 content 放行 + `repairToolTurnPairing` + `toolCtx.history` | **必须串行**，依赖 B-a 与 B-b |

**Gate B**：四门禁 + E2E 基线零新增 + 新增 2 条 E2E 全绿 + coverage ≥80%。

> 分派建议：A-a、A-b-2 一个子代理；A-b-1/3 一个子代理（独占 `agentContext.ts`）；批 B 按 B-a/B-d/B-e/B-f 四路并行，B-b、B-c 由主干串行合入。

## 2. 变更清单

### 2.1 计划内改动

| 批次 | 文件 | 函数/锚点 | 改什么 | 属于 | 风险 |
|---|---|---|---|---|---|
| A-b | `src/main/ai/agent/agentContext.ts` | `:355-370`（读取块） | 把 DB 读取上提到 `classifyIntent(:217)` 之前；`injectImagesIntoMessages` 改传 `treatLastAsCurrent:false`；去掉 `:412-414` 的 `slice(0,-1)` 分支，恒走 `cleanupIncompleteMessages` | P0-3 | L3 改执行顺序 |
| A-b | 同上 | `:417-424` | `history` 与 `llmMessages` 取数对 chat/非 chat 统一：删 `isChat ? [currentUserMsg]` 与 `!isChat && summary` 双闸 | P0-1 | L3 |
| A-b | 同上 | `:449` 反上下文行 | 改为「历史与摘要仅用于理解当前问题的指代与上下文，不要延续上一轮未完成的作答」；`:444` 分隔行保留 | P0-2 | L3 文案外溢 |
| A-b | 同上 | `:217` 调用点 | 改 `classifyIntent(message, { hasHistory })`，`hasHistory` = 上提读取结果中存在 `role==='assistant'` 行 | P0-3 | L3 |
| A-b | `src/main/ai/intentRouter.ts` | `:74` 签名 | `classifyIntent(input, ctx?: { hasHistory?: boolean })`，`ctx` 可选、缺省等价现状 | P0-3 | L2 向后兼容 |
| A-b | 同上 | `:140-141`、`:109-117` | `confidence < 0.7` 无条件保留；`text.length<6`、`confidence<0.85 && text.length<10`、`:115` 的 `text.length<10` 三处长度门仅在 `!ctx?.hasHistory` 时生效。指代词不豁免 | P0-3 | L3 误判反向 |
| A-a | `src/main/ai/agent/agentPromptBuilder.ts` | `:286-290` 核心规则 2/3/4 | 删「忽略之前的所有对话内容和历史摘要」「每条用户消息都是独立的新指令」，并入统一措辞；保留规则 1「必须且只能回答最后一条」 | P0-2 | L3 提示语义 |
| A-a | 同上 | `:369-379` `CHAT_SYSTEM_PROMPT` 2/3/4 | 同上统一措辞 | P0-2 | L3 |
| A-a | `src/main/ai/contextManager.ts` | `:135` | 摘要前缀改统一措辞（当前含「不要延续之前的问题回答」的反上下文表述） | P0-2 | L3 有硬断言 |
| B-a | `src/main/db/ai.ts` | 新增导出 | `RoundWindowBuilder`（纯函数）+ `getRecentMessagesByRounds(convId, userId, rounds, { byteBudget })`：`ORDER BY created_at DESC, rowid DESC`，`stmt.iterate()` 流式累加，超预算在轮边界停但**至少保留最近 1 轮**，末尾 `reverse()` | P0-5 | L3 SQL 语义 |
| B-a | 同上 | 新增导出 | `appendToolTurnWithAssistant(...)`：`db.transaction()` 内先 upsert assistant（确定性 id，`ON CONFLICT(id) DO UPDATE`）再 `INSERT OR IGNORE` 本轮 tool 行 | P0-4 | L3 事务 |
| B-a | 同上 | `:710-714` | `getMessagesByConversation` 排序补 `rowid ASC` 兜底（同毫秒批写） | P0-4 | L2 |
| B-a | 同上 | `:832-845` | 删除 `updateLatestAssistantToolCalls`（保留 `:817` 的 `updateMessageToolCalls`） | P0-4 | L3 删能力 |
| B-b | `src/main/ai/agent/agentToolExecutor.ts` | `:498-506` | `handleToolResult` 不再 `appendMessage`，改为产出 `PendingToolWrite`；`:223-240` 收集；`:550-619` 循环后单次调新 DAO；IPC 发送留在原处 | P0-4 | L3 写时序 |
| B-b | `src/main/ai/agent/agentLoop.ts` | `:668-728` | `processStreamingToolRound` 同样改为循环后单次调新 DAO | P0-4 | L3 流式漏写 |
| B-c | `src/main/ai/agent/agentContext.ts` | `:361-366` | map 透传 `tool_calls` | P0-4 | L3 |
| B-c | 同上 | `:368-370` | 空 content 过滤改为「无 `tool_calls` 且无 `tool_call_id` 且 content 空才丢」 | P0-4 | L3 放行 `content:''` |
| B-c | 同上 | 新增 `repairToolTurnPairing(messages)` | 在 `cleanupIncompleteMessages` 之后调用，纯内存、不写库、**不复用** `cleanupIncompleteMessages` | P0-4 | L3 |
| B-c | `src/main/ai/agent/agentMedia.ts` | `:210`、`:222-226` | 行类型与映射补 `tool_calls` 透传 | P0-4 | L2 |
| B-c | `src/main/ai/agent/agentContext.ts` | `:321-334` `toolCtx` | 注入 `history`（`contentToText` 后仅 user/assistant） | P0-6 | L2 |
| B-d | `src/main/ai/toolTypes.ts` | `:40-72` `ToolCtx` / `:19-37` `SearchKbFn` opts | 加 `history?: ConversationMessage[]`、`expandedQueries?: string[]` | P0-6 | L2 类型外溢 |
| B-d | `src/main/ai/tools/searchKBHandler.ts` | `:16-45`、`:81-92` | 调 `resolveReferencesDetailed(query, ctx.history)` **在 `ctx.searchKb` 之前**；改写发生时附 `expandedQueries:[原 query]`；`buildMinimalUnderstanding` 的 `:25` 传 history | P0-6 | L2 |
| B-d | `src/main/ai/knowledge/queryPlanner.ts` | `:224-266` | 新增导出 `resolveReferencesDetailed` 返回 `{query,resolved}`，`resolveReferences` 委托之；删 `:243`/`:257-265` 的 `extractRecentTopic` 硬拼回退 | P0-6 | L3 能力回退 |
| B-d | 同上 | `:447-449` | `too_short` 判定加 history 门；`:441` `missing_subject` **不动** | P0-6 | L2 |
| B-d | `src/main/ai/agent/agentTaskWorker.ts` | `:389-396` | 内联 `searchKb` 包装器 opts 类型放宽并转发 `expandedQueries` | P0-6 | L2 静默丢参 |
| B-d | `src/main/ai/agent/agentKbPreloader.ts` | `:165-177` | `opts.expandedQueries?.length` 存在时绕过模糊预载缓存，直调 `original` | P0-6 | L2 缓存错配 |
| B-e | `src/render/stores/agentStore.ts` | `:709-716` | 删 `window.weaveMD.ai.updateMessageToolCalls` 回写；`:704` 内存 `toolCalls` 保留 | P0-4 | L3 删能力 |
| B-e | `src/main/preload.ts` | `:165-168`、`:398-399` | 删该通道 iface 与 impl | P0-4 | L2 |
| B-e | `src/main/ai/ipc/chatHandlers.ts` | `:27` import、`:215-226` handler | 删 import 与 handler | P0-4 | L2 |
| B-e | `src/render/utils/weaveMDBridge.ts` | `:687` | 删该 noop（否则对象字面量对 `WeaveMDApi` 触发多余属性错） | P0-4 | L2 必删 |
| B-e | `tests/setup.ts` | `:71` | 删 mock 项 | P0-4 | L1 |
| B-c | `src/render/components/AIAgent/cards/QuestionCard.tsx` | 根节点 `:493` | 加 `data-testid="question-card"`（1 行测试钩子，E2E 需要） | P0-x 验收 | L1 |
| — | `vitest.config.ts` | `:17-22` `coverage.include` | 覆盖面换成本批改动文件 | 门禁 | L1 |

### 2.2 明确不动的文件（计划外改动一律不列）

- `src/main/ai/llm/anthropicClient.ts:217-234`、`src/main/ai/llm/anthropicCompat.ts:89-105` — 对 `tool` 角色的静默丢弃，另立。
- `src/main/ai/knowledge/knowledgeClarify.ts` **本体 170 行全文不动**（P0-7 只补测试）。
- `src/main/db/index.ts` 与**全部历史迁移文件** — 无 DDL（`tool_calls` 列已在 `:250-251`）。
- `src/main/ai/agent/agentToolSelector.ts:56-107`、`src/main/ai/knowledge/kbSearch.ts`、`searchCache.ts`、`src/main/ai/ipc/chatHandlers.ts:366` 非 Agent 聊天路径、`StreamingToolExecutor`、`agentEventStore.ts`。
- `queryPlanner.ts` 的 `classifyIntent` / `planQuery` / `understandQuery` 既有接线，及 `:441` `missing_subject`。

### 2.3 事实修正（以源码为准）

| 文档原述 | 复核结论 |
|---|---|
| `knowledgeClarify.ts:432` 含 `history.length===0` 门 | 该文件无任何 `history` 引用；门在 **`queryPlanner.ts:432`** |
| 空 content 过滤在 `agentContext.ts:372` | 实为 **`:368-370`** |
| `chatHandlers.ts:218-220` 回写 handler | 实为 **`:215-226`** |
| `anthropicClient` 丢弃循环 `:221-234` | 实为 **`:217-234`** |

## 3. 每条 P0 验收标准

- **P0-1** — `tests/main/ai/agentContext.test.ts`（扩）：mock 会话带 summary + 2 轮历史，断言意图 `chat` 时 `buildCompressed` 收到 `history.length > 1` 且 summary 非空（spy `contextManager`）。
- **P0-2** — `contextManager.test.ts`（改 `:72-75`）+ `agentPromptBuilder.test.ts`（追加）：四处文案均 `not.toContain('忽略之前的所有对话')`、`not.toContain('独立的新')`，且 `toContain('必须且只能回答')`。
- **P0-3** — `intentRouter.test.ts`（追加）：`classifyIntent('它有什么优势', { hasHistory:true })` → `needsClarification === false`；`hasHistory:false` / 缺省 → 与现状一致为 `true`。`agentContext.test.ts` 追加端到端：有历史时 `useAgentPrompt` 不因长度置位。
- **P0-4** — 新 `tests/main/db/aiMessagesWrite.test.ts`（或并入 `aiDao.test.ts`）：事务内先 assistant 后 tool、幂等 upsert 重跑不增行；`agentToolExecutor.test.ts` 断言 `appendMessage` 对 tool 行零调用；`agentLoop.test.ts` 断言流式轮次一次 DAO 调用；`agentContext.test.ts` 断言回读带 `tool_calls`、`content:''` 行不被滤、`repairToolTurnPairing` 双向规则；静态断言 `grep updateLatestAssistantToolCalls src/` = 0；`tests/render/stores/agentStore.test.ts` 断言 mock 未被调用。
- **P0-5** — 新 `tests/main/db/aiMessagesRead.test.ts`：多 tool 单轮 25 行仍完整取回（行数上限取消）；跨 3 轮 60 行取回 3 轮；字节预算触发时至少保留最近 1 轮；SQL 含 `rowid DESC`。`contextManager.test.ts` 全量回归绿（红线：不减少轮次、不截断工具结果）。
- **P0-6** — 新 `tests/main/ai/searchKBHandler.test.ts`：mock `searchKb` 断言改写后的 query 已含明确对象、`expandedQueries:[原句]`、history 已透传 `detectAmbiguities`；`queryPlannerEnhanced.test.ts:107-110` **必须保持不变且绿**；`toolRegistry.test.ts:139-170` 不变绿（无历史 → 恒等改写 → 无 `expandedQueries`）；`kbSearch.test.ts:203-261` 0.6 拒答 / 置顶 ×1.5 / searchMode 三模式回归绿。
- **P0-7** — 新 `tests/main/ai/knowledgeClarify.test.ts`：`needsClarification` 三分支、`questionsForAmbiguity` 模板断言含 `「` `」`、有历史不误触发；`knowledgeClarify.ts` 源文件 diff 为空。

## 4. 测试策略

L/strict：**RED 实测（记录红）→ 最小实现 GREEN → 重构 → coverage ≥80%**，证据落 `docs/testing/agent-memory-optimize.tdd.md`。

**必须改动的既有断言（4 处）**
1. `contextManager.test.ts:72-75` — 摘要前缀硬断言，P0-2 必改。
2. `queryPlannerEnhanced.test.ts:101-106` — 「它的」依赖 `extractRecentTopic` 硬拼，P0-6 删回退后必红，**改为断言恒等返回 + `resolved:false`**（能力回退已在 req Q12 明示）。
3. `tests/setup.ts:71`、`weaveMDBridge.ts:687` — 回写通道删除的连带。
4. mock 面：`agentContext.test.ts:24-28`、`tests/benchmarks/agent-perf-benchmark.test.ts:458-488`、`tests/main/ai/agentLoop.test.ts:19-22` 的 `@main/db/ai` mock **须补新增 DAO 导出**，否则 `vi.mock` 缺 key 报错。

**必须保持不变的既有断言**：`queryPlannerEnhanced.test.ts:107-110`（无历史恒等，`:225` 守护）、`:112-124`；`contextManager.test.ts:77-107` 轮/tool 切分；`toolRegistry.test.ts` 全部 searchKB 用例；`kbSearch.test.ts` 三红线；`agentPromptBuilder.test.ts` 36 例中不涉文案者；`intentRouter.test.ts` `:71-82` 兜底语义；`migrations.test.ts` 全量（本批无迁移）；`agentKbPreloader.test.ts` 预载缓存（无 `expandedQueries` 时行为不变）。

**新增测试及理由**
- `tests/main/ai/searchKBHandler.test.ts` — `handleSearchKB` 现无直接测试（仅 `toolRegistry.test.ts` 5 条间接），P0-6 改写/透传无法从别处断言。
- `tests/main/ai/knowledgeClarify.test.ts` — P0-7 明确要求（当前零测试）。
- `tests/main/db/aiMessagesRead.test.ts` — P0-5 按轮读 + 字节预算 + `rowid` 排序；`aiDao.test.ts` 的 fake 偏 ai_config 夹具。

**fake 约束**：真实 better-sqlite3 因 Electron ABI 无法在系统 Node 下加载，vitest 一律用 fake DB。`aiDao.test.ts` 的 `FakeDatabase` 需补 `transaction()` 与 `iterate()` 才能覆盖 B-a；真实事务/迭代语义只能由既有 `scripts/*.cjs`（Electron 下）smoke 承担——**本批不新增 cjs 脚本**，该盲区记入风险。

## 5. 书面方案 — 数据/写入路径变更

**现状写时序**（同一次工具轮）：`assembleToolTurn` 只在内存构造 assistant(tool_calls)，**从不落库** → `handleToolResult` 逐条 `appendMessage({role:'tool'})`（`agentToolExecutor.ts:498-506`，N 次独立 INSERT，无事务）→ assistant 正文在收敛/最终处另写（`agentLoop.ts:181`/`:529`）→ 渲染侧事后 `updateLatestAssistantToolCalls` 回写（只覆盖「最后一条 assistant」，并发/回放会写坏旧行）。
**结果**：DB 内常见 `user → tool → tool → assistant` 的非法行序，回读 `tool_calls` 丢失。

**目标写时序**：一轮工具 → 收集全部 `PendingToolWrite` → **单次** `appendToolTurnWithAssistant`：`db.transaction()`（better-sqlite3 同步事务，先 upsert assistant 带 `tool_calls`，再 `INSERT OR IGNORE` 本轮全部 tool 行）→ 原子提交。
- **事务边界** = 一个工具轮的 assistant + N 条 tool 行；任一语句抛出即整体回滚，内存态由上层重试/报错处理。
- **幂等**：assistant id 取 `aturn_${convId}_${round}`，tool id 取 `t_${convId}_${round}_${index}`，重试 `ON CONFLICT DO UPDATE` / `INSERT OR IGNORE` 不产生重复行。
- **IPC 发送留在原位置**，不在事务内（避免同步 IPC 阻塞持有事务）。
- **不在事务内**的既有写（用户行、最终 assistant 行）保持不变。

**回读路径**：`getRecentMessagesByRounds` → map 透传 `tool_calls` → `injectImagesIntoMessages` 透传 → 空 content 行放行 → `cleanupIncompleteMessages` → 新建 `repairToolTurnPairing`（只读，永不写库）：
- assistant 有 `tool_calls` 缺配对 tool → **合成占位 tool 行** `"[工具结果缺失：会话在该工具完成前中断，结果不可恢复]"`（不剥 `tool_calls`，避免丢失该轮）；
- 孤儿 tool 行（前置无含该 id 的 `assistant.tool_calls`）→ **丢弃**（无法重建 `function.name`，provider 必拒）；
- 老数据中纯文本 assistant 行（本就无 `tool_calls`）→ 原样保留。
- `agentLoop.ts:436-492` 延迟重试路径维持「只改内存不写库」，保证不制造新孤儿；历史孤儿由配对修复兜住。
- **无 DDL、无数据迁移**：新读路径对存量三种形态（完整配对 / 孤儿 tool / 缺 `tool_calls` 的历史行）均能产出合法序列。

**回写链拆除（6 处，Q7 已批准删能力）**：`agentStore.ts:709-716` → `preload.ts:165-168/:398-399` → `chatHandlers.ts:27/:215-226` → `db/ai.ts:832-845` → `weaveMDBridge.ts:687` → `tests/setup.ts:71`。`src/shared/constants.ts:192` 的通道常量**保留**（避免触碰共享常量）。验收：`grep -rn "updateLatestAssistantToolCalls\|AI_MESSAGE_UPDATE_TOOL_CALLS" src/` 仅剩常量定义 1 处。

## 6. 门禁与验收口径

四项**真全绿**，任一不过即 Gate 不通过：
1. `npm run typecheck` — 0 error。
2. `npm test`（`vitest run`）— 全绿。
3. `npx eslint src/ --ext .ts,.tsx`（**不带 `--fix`**）— 0 error。
4. `npx vite build` — 成功（不用 `npm run build`，其含 electron-builder）。

覆盖率：`npx vitest run --coverage`，先改 `vitest.config.ts:17-22` 的 `coverage.include` 为本批改动文件，逐文件 ≥80%。

E2E：`npx playwright test` 对 **基线零新增**（实测 31 failed / 101 passed / 1 skipped、unexplained=0，逐 spec 不新增失败）。新增 2 条在 `e2e/ai-agent-panel.spec.ts`：
- 场景①：两轮会话后发「它有什么优势」→ `data-testid="question-card"` 不可见 + assistant 气泡渲染 + `pageerror` 无异常。
- 场景②：追问后上一轮 user/assistant 气泡仍在 DOM。

须写明：E2E 是 **renderer-only 现象层**（mock `runAgent`），主进程根因断言只在 vitest；E2E 用例须全绿。

## 7. 风险与依赖

**req §七 既有 3 条**
1. 批 A 改系统提示语义，可能影响非 chat 意图 → `agentPromptBuilder.test.ts` 全量回归兜底，且文案改动**四处同批**。
2. 停用渲染侧回写是删能力，executor 落库若在流式/重试场景漏写则 `tool_calls` 缺失 → B-b 必须同时覆盖 `processStreamingToolRound`（`agentLoop.ts:668-728`）与 `executeToolRound` 两条路径，`agentLoop.test.ts` 断言调用次数。
3. 取消行数上限后长会话读取量上升 → 字节预算 + `buildCompressed`（阈值 0.85/0.65）+ `CONTEXT_WINDOW=64_000` 三闸；预算初值 **45_000** UTF-8 字符 **[待按 64000 实测调优]**。

**调研新出风险**
4. **[Gate确认点]** Q9「按 3 轮」对纯文本短会话可能**少于**现有 20 行，与红线「不减少历史轮次」张力 → 本批取 `max(最近 3 轮全量, 20 行)`：20 由上限降为水位线，上界交给软字节闸；若 Gate 否决则退回「3 轮 + 20 行下限」的等价表述。
5. 历史读取上提改变 `injectImagesIntoMessages` 的 `treatLastAsCurrent` 语义 → 显式传 `false`，图片条数上限用例回归。
6. `repairToolTurnPairing` 合成占位 tool 会让模型看到「结果不可恢复」→ 属信息损失，但优于整体 400；须在测试中锁文案。
7. `expandedQueries` 存在时 `kbSearch.ts:471` 跳过结果缓存 → 纯性能回退，无正确性影响，记录即可。
8. 预载模糊缓存可能返回未改写结果 → `agentKbPreloader.ts:165-177` 直调旁路，须有单测。
9. fake DB 无法证明真实 `transaction()`/`iterate()` 语义 → 记为盲区，依赖 `aiDao.test.ts` 扩展 + 人工 review；本批不新增 cjs。
10. `queryPlannerEnhanced.test.ts:101-106` 断言的能力被取消属**有意回退**（Q12），须在 TDD 报告中留证。
11. `hasHistory` 判定基于「存在 assistant 历史行」，新会话首轮恒为 false → 与现状一致，不构成回归。

**依赖**：B-b/B-c 依赖 B-a 的 DAO 导出；B-c 依赖 B-b 的写路径（否则读侧收不到新行形态）；B-e 独立但须与 B-c 同批合入（否则渲染层仍回写覆盖）；Gate A 不含任何 DB 改动，可独立放行。

### 关键文件

- `src/main/ai/agent/agentContext.ts`
- `src/main/db/ai.ts`
- `src/main/ai/agent/agentToolExecutor.ts`
- `src/main/ai/knowledge/queryPlanner.ts`
- `src/main/ai/intentRouter.ts`

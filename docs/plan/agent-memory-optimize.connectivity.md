# agent-memory-optimize — 阶段 6.5 模块连通性验证报告

> 日期：2026-09-29 | 任务：agent-memory-optimize P0 第一批（P0-1~P0-7 / Q1~Q18）| 档位：L
> 变更基线：`968e056`（`git diff 968e056 -- src/` 为唯一权威改动集合）
> 方法：**只读源码逐段核对签名/字段/事件名（主手段）** + `npm run typecheck` + `npx vitest run <本批 19 个相关测试文件>` + `npm run lint` + 静态 grep 断链检查。
> 约束：本阶段除本报告外未改动任何文件（`src/`、`tests/`、`e2e/`、`vitest.config.ts`、其他 `docs/` 均未动）。
> 与测试的关系：测试管单模块行为正确性，本阶段管**模块间契约一致性**；下列 ✅/⚠️/❌ 是契约维度结论，不等价于单测通过与否。

---

## 1. 调用链清单

| 链 | 起点 → 终点 | 跨模块边界 | 主要验证手段 |
|---|---|---|---|
| L1 | `agentLoop.processStreamingToolRound` / `executeToolRound` → `agentToolExecutor.handleToolResult` → `PendingToolWrite` → `db/ai.appendToolTurnWithAssistant` | agent 循环 ↔ 工具执行器 ↔ SQLite DAO | 源码签名核对 + `agentToolExecutor.test.ts` / `aiMessagesWrite.test.ts` |
| L2 | `agentContext.prepareAgentContext` → `db/ai.getRecentMessagesByRounds` → map 透传 → `injectImagesIntoMessages` → 空 content 过滤 → `cleanupIncompleteMessages` → `repairToolTurnPairing` → `buildCompressed` / `toolCtx.history` | agent 上下文 ↔ DAO ↔ 媒体注入 ↔ contextManager | 源码顺序核对 + `agentContext.test.ts` / `aiMessagesRead.test.ts` / `agentMedia.test.ts` |
| L3 | DB `tool_calls` 列 → `toLlmToolCalls` → 三处 provider 出口（`agentContext.llmMessages` / `agentMedia` 图片分支 / 在线 `assembleToolTurn`） | DB 形状 ↔ LLM 线上形状 | 源码核对 + `agentContext.test.ts`（Q17 组）+ `agentMedia.test.ts` |
| L4 | `agentContext.toolCtx.history` → `searchKBHandler.resolveReferencesDetailed` → `ctx.searchKb`（`agentTaskWorker` 内联包装）→ `agentKbPreloader` → `kbSearch.searchKB({expandedQueries})` | 上下文 ↔ 工具处理器 ↔ worker 依赖注入 ↔ 预载缓存 ↔ 检索内核 | 源码核对 + `searchKBHandler.test.ts` / `ipc.test.ts` / `agentKbPreloader.test.ts` |
| L5 | 回写链拆除：`agentStore → preload → chatHandlers → db` | 渲染 ↔ preload ↔ IPC ↔ DAO | 静态 grep 断链 + `aiMessagesWrite.test.ts` 源码取证 + `agentStore.test.ts` |
| L6 | `agentContext` → `intentRouter.classifyIntent(input, ctx?)` | 上下文 ↔ 意图路由 | 签名核对 + `intentRouter.test.ts`（17 例） |
| L7 | `agentPromptBuilder`（核心规则 + `CHAT_SYSTEM_PROMPT`）× `contextManager.SUMMARY_USAGE_NOTE` × `agentContext` 锚点行 | 提示构造 ↔ 上下文压缩 ↔ 注意力锚点 | 四处字符串逐字比对 + `agentPromptBuilder.test.ts` / `contextManager.test.ts` |
| L8 | `QuestionCard[data-testid]` ← `AIPanelSession` ← `pendingInteraction` ← `agentStore` ← preload 流订阅 ← `agentTaskWorker` 交互事件 | 主进程事件 ↔ preload 桥 ↔ Zustand ↔ React | 字段逐个比对 + `AIPanelSession.test.tsx` / `QuestionCard.test.tsx` |
| L9 | `handleToolResult`（IPC 发送）→ `flushPendingToolWrite`（事务）→ `deadLoopBreak` 提前返回 | 事件发送 ↔ DB 事务边界 | `invocationCallOrder` 断言 + 源码位置核对 |
| L10 | （补充）`AI_CONVERSATION_GET` → `agentStore.loadConversation` → `AgentTab` / `AIMessageBubble` | 主进程读 ↔ 渲染显示 | 源码核对（**本批未覆盖**） |
| L11 | （补充）`AI_CHAT` 处理器消费 `getMessagesByConversation` 新形状 | 非 Agent 聊天链 ↔ 消息表 | 源码核对（**本批未覆盖**） |
| L12 | （补充）`llmMessages` → `contextManager` 协议分流 → `streamAnthropicCompletion` | 消息序列 ↔ Anthropic provider | 源码核对（**本批明确划出范围，见 plan §2.2**） |

---

## 2. 逐链验证表

| 链 | 接口契约 | 数据格式 | 错误处理 | 版本兼容 | 状态 | 证据（`file:line`） |
|---|---|---|---|---|---|---|
| **L1 写路径** | `handleToolResult(..., pending: PendingToolWrite)` 形参为新增末位可选位之外的必填，两条调用路径（流式/兜底）均经 `processToolResultsLoop` 注入 | `PendingToolWrite` ⊇ `ToolTurnWriteInput` 全部必填字段（`conversationId/userId/runId/round/assistantContent/toolCalls/tools`）；`runId` 唯一来源 `ctx.runId` | `appendToolTurnWithAssistant` 抛错 → `flushPendingToolWrite` 不吞 → `runAgentFlow` catch 发 `AI_STREAM_ERROR` → `agentTaskWorker.handleTaskError` 记 failed | `tool_calls` 列已存在于历史迁移（无 DDL），老库可直接读写 | ✅ | `agentToolExecutor.ts:67/83/265/461/544/550/659`、`agentLoop.ts:726`、`db/ai.ts:768/788/791/802`、`agentTaskWorker.ts:472` |
| **L2 读路径** | `getRecentMessagesByRounds(convId,userId,rounds,{byteBudget})` 与调用方传参一致（`KEEP_RECENT_ROUNDS=3`、`45_000`） | DAO 返回时间正序（`created_at DESC, rowid DESC` 迭代 → `reverse()`）；`tool_calls` 在 map 处转换、`tool_call_id`/`attachments` 条件透传；空 content 过滤放行 `tool_calls`/`tool_call_id` 行 | 读取抛错上抛至 `runAgentFlow` catch；`repairToolTurnPairing` 纯内存无异常路径 | 存量三种形态（完整配对 / 孤儿 tool / 无 `tool_calls` 老行）均可产出合法序列 | ✅ | `agentContext.ts:311-336/507/513`、`db/ai.ts:735`、`contextManager.ts:129/149`、`agentContext.ts:207-239` |
| **L3 DB→LLM 形状（Q17）** | `toLlmToolCalls` 产出与 `assembleToolTurn`（`agentToolExecutor.ts:126-130`）同形 `{id,type:'function',function:{name,arguments}}` | `IAgentToolCall.toolCallId→id`、`name→function.name`、`args→function.arguments`；`tool_role` 缺失（`tool_call_id` 为空）的 tool 行在 `repairToolTurnPairing` 第一遍被判孤儿丢弃 | `toLlmToolCalls` 空/undefined 返回 undefined，不抛 | `AgentLlmMessage` 类型与 `llmClient`/`anthropicClient` 输入兼容（typecheck 0 error） | ✅ | `agentContext.ts:187-196/316-322`、`agentMedia.ts:236-237`（含 `images.length===0` 早退与 vision 不支持降级两条分支）、`agentToolExecutor.ts:126` |
| **L4 检索链（P0-6）** | `ToolCtx.history?: ConversationMessage[]`（`toolTypes.ts:79`）与 `agentContext` 注入形状 `{role:'user'\|'assistant', content:string}` 结构一致；`SearchKbFn` opts `expandedQueries?: string[]`（`toolTypes.ts:33`）与 worker 内联包装（`agentTaskWorker.ts:389`）、预载（`agentKbPreloader.ts:168`）、内核（`kbSearch.ts:78`）三端同名同型 | `resolveReferencesDetailed` 返回 `{query,resolved}`；`resolved` 才附 `expandedQueries:[原 query]`，未改写为 `undefined`（不污染缓存键） | `ctx.searchKb` 缺失有显式 guard 返回 error 结果；`detectAmbiguities(effectiveQuery, history)` 历史门控 | `resolveReferences` 保留旧签名并委托新函数，`queryPlanner.ts:499` 既有调用不受影响 | ⚠️ 见 §3-R1 | `searchKBHandler.ts:70/88/93`、`toolTypes.ts:33/79`、`agentTaskWorker.ts:389/398`、`agentKbPreloader.ts:168-171`、`kbSearch.ts:565-569` |
| **L5 回写链拆除（Q7）** | 通道常量 `AI_MESSAGE_UPDATE_TOOL_CALLS` 保留在 `src/shared/constants.ts:192`；preload API 字段、`WeaveMDApi` 形状、noop 桥三处同步删除（否则对象字面量多余属性错） | `src/` 内零残留调用；`tool_calls` 唯一写入点收敛为 `appendToolTurnWithAssistant` | 渲染侧不再回写即无回写失败日志；内存 `toolCalls` 快照仍在 `agentStore.ts:696/717` | 老数据已落库的 `tool_calls` 仍可读（`updateMessageToolCalls` 按 messageId 的入口保留于 `db/ai.ts:1041`） | ✅ | `grep -rn "updateLatestAssistantToolCalls\|AI_MESSAGE_UPDATE_TOOL_CALLS" src/` → 仅 `constants.ts:192`；`chatHandlers.ts` 已无该 import 与 handler；`preload.ts`、`weaveMDBridge.ts:684` 已删 |
| **L6 意图与历史** | `classifyIntent(input: string, ctx?: {hasHistory?: boolean})` 可选尾参，单参调用等价旧实现 | `hasHistory` 取自 `dbRows.some(role==='assistant')`（清理前的原始读取行），新会话首轮恒 false | 无异常路径 | 缺省 `ctx` 时 `lengthGateEnabled = !undefined = true`，与旧行为逐字等价 | ✅ | `intentRouter.ts:75/77/118/146`、`agentContext.ts:341/343`、`intentRouter.test.ts:92-116` |
| **L7 提示语义（P0-2）** | 四处措辞逐字一致（仅句末标点差异） | `SUMMARY_USAGE_NOTE` 单一常量被 `buildCompressed` 模板引用 | 无 | 保留规则 1「必须且只能回答最后一条」 | ✅ | `contextManager.ts:32-33/139`、`agentPromptBuilder.ts:288/374`、`agentContext.ts:538` |
| **L8 E2E/UI 接线** | `data-testid="question-card"` ↔ Playwright 默认 `testId` 属性；`AIPanelSession.tsx:115` 挂载条件 `isAgentMode && pendingInteraction` | 主进程 `agentTaskWorker.ts:423` payload `{sessionId,conversationId,questions,variant,round,totalRounds}` ↔ preload `preload.ts:487-499` 桥接字段 ↔ `agentStore.ts:435` 读取字段 ↔ `agentStore.ts:929-936` 写入 `pendingInteraction` —— 七字段两端同名同型 | 事件持久化 `persistOnly` 失败已 catch 不阻断 | 回放路径 `agentEventStore.ts:250-252` 硬编码通道串 `'agent:interaction:question'` 与 `constants.ts:127` 值一致 | ✅ | `QuestionCard.tsx:493`、`AIPanelSession.tsx:115-122`、`agentTaskWorker.ts:423-432`、`preload.ts:487`、`agentStore.ts:435/929`、`agentEventStore.ts:250` |
| **L9 IPC 与事务边界** | `ctx.send` 调用点全部位于 `flushPendingToolWrite` 之前（不在 `db.transaction()` 内） | flush 位于 `deadLoopBreak` 提前返回**之前**（两条路径同规则） | 事务内任一语句抛出整体回滚，不产生半截轮 | `ON CONFLICT DO UPDATE` + `INSERT OR IGNORE` 幂等；`runId` 防跨运行撞 id | ✅ | `agentLoop.ts:726`、`agentToolExecutor.ts:659`、`db/ai.ts:802`、断言 `tests/main/ai/agentLoop.test.ts:372-391`（`sendOrders[toolIdx] < flushOrder`、`sendOrders[errorIdx] < flushOrder`、`sendOrders[doneIdx] > flushOrder`） |
| **L10 会话重载显示链** | 渲染层已具备「assistant 消息自带 `toolCalls` → 工作流卡片」的读能力 | DB 新形状 = 每轮 `assistant(content:'', toolCalls)` + 终局 `assistant(正文, 无 toolCalls)`；`AgentTab.tsx:43` 只滤 `role==='tool'`，**不过滤空 content** | 无 | 存量老会话（无 assistant('') 行）显示不变 | ⚠️ 见 §3-R2 | `db/ai.ts:802`、`AgentTab.tsx:43/106-118`、`AIMessageBubble.tsx:506-527`、`agentStore.ts:696/717`、`chatHandlers.ts:79` |
| **L11 非 Agent 聊天链** | `AI_CHAT` 处理器 history 只取 `user/assistant`，**不透传 `tool_calls`** | 会送入 `content:''` 的 assistant 行（本批新形状）；tool 行被滤除，不会产生孤儿 `tool` | 有完整 try/catch | plan §2.2 明确「不动」 | ⚠️ 见 §3-R3 | `chatHandlers.ts:247/345-353`、`preload.ts:377`（渲染层全仓无 `.ai.chat(` 调用，属潜伏路径） |
| **L12 Anthropic 出口** | `streamAnthropicCompletion` 只识别 `system/user/assistant`，丢弃 `tool` 行与 `tool_calls` | 本批新增的 `assistant(content:'')` 行会原样转成 `{role:'assistant',content:''}`；`tool` 行被丢后出现**连续同角色消息** | 与 L1 同一上层 catch | plan §2.2 明确「`anthropicClient.ts:217-234` 另立」，本批不修 | ⚠️ 见 §3-R4 | `anthropicClient.ts:221-234`、`anthropicCompat.ts:54/83`、`contextManager.ts:255-256` |

**状态统计：链路 12 条 —— ✅ 8 / ⚠️ 4 / ❌ 0。无断裂链路。**

---

## 3. 断裂 / 风险清单（不自行改码，交总指挥处置）

### R1（链 L4，⚠️）`toolCtx.history` 含当前问题 → 指代改写可能自指

- 现象：`agentContext.ts:596-598` 把 `llmMessages`（**含当前 user 问题**，`agentContext.test.ts:762` 明确断言「当前问题也在内」）注入 `toolCtx.history`；而 `queryPlanner.ts:131-134` 的 `extractEntityFromHistory` 用 `messages.slice(-6)` 从**末尾**开始扫，末位即当前问题，且对 `它` 走到 `queryPlanner.ts:178` 的通用 `/(?:关于|对于|在|讨论)/` 分支。
- 触发例：query `它在知识库里的表现如何` → `PRONOUN_RE` 命中 `它` → 通用分支从当前 query 自身取到 entity `知识库里的表现如何` → `replaced = "知识库里的表现如何的在知识库里的表现如何"`，`isUsableRewrite`（`queryPlanner.ts:236`）判 residual 不以指代词开头 → 放行。
- 缓解（已存在，非消除）：`resolved:true` 时原 query 走 `expandedQueries` 双路 RRF（`kbSearch.ts:565`），坏改写不会独占召回。
- 建议处置：在 `resolveReferencesDetailed` 内对「末位 user 行」跳过实体提取（或 `agentContext` 注入 history 时显式区分 `含当前`/`不含当前`），并补一条「当前问题自指」的反例测试。

### R2（链 L10，⚠️）重载后出现空 assistant 气泡，工作流卡片与答案气泡分离

- 现象：本批把 `assistant(content:'', tool_calls)` 行首次写入 DB（`db/ai.ts:802`），同时 Q7 拆掉了渲染侧「把整轮 toolCalls 回写到最后一条 assistant」的快照（`agentStore.ts:717`）。于是：
  - **在线态**（`agentStore.ts:696`）：最终 assistant 消息带 `toolCalls` → `AgentTab.tsx:118` 在答案气泡上方渲染一张合并工作流卡片，无空气泡；
  - **重载态**（`chatHandlers.ts:79` → `agentStore.ts:1391` → `AgentTab.tsx:43/118`）：N 个 `assistant('')` 行各自带 `toolCalls` → **N 张卡片 + N 个空的 "AI" 气泡**，终局答案气泡反而没有卡片。
- 影响：同一会话存活态与重载态显示不一致；`AIMessageBubble.tsx:519-527` 对 `content=''` 且非流式会渲染一个空的圆角容器（`MarkdownMessage('')` 无输出）。
- 证据：`AgentTab.tsx:43`（只滤 `role !== 'tool'`）、`AIMessageBubble.tsx:506/519`、`db/ai.ts:802`、`agentStore.ts:696/717`。
- 建议处置：渲染层补一条「`role==='assistant'` 且 `content` 为空白且 `toolCalls.length>0` → 只渲染工作流卡片、跳过气泡」的规则（改 `AgentTab.tsx` 或 `AIMessageBubble.tsx`），并补 render 测试；或改由写路径决定终局 assistant 是否携带该轮 `toolCalls`。

### R3（链 L11，⚠️，潜伏）`AI_CHAT` 会读到空 assistant 行

- 现状：`chatHandlers.ts:345-353` 只 filter `user/assistant`、map 时不带 `tool_calls`，本批新形状会变成 `{role:'assistant', content:''}` 序列发给 provider。
- 暴露面：渲染层全仓无 `.ai.chat(` 调用（`grep` 仅 `preload.ts:377` 暴露），故当前不可达；但 `ipc.test.ts` 仍在测该 handler。
- 建议处置：在该 handler 的 map 处补一条「空 content 且非当前轮 → 丢弃」或「补 `tool_calls` + `tool_call_id`」，或与 R2 同批决定是否让 `AI_CHAT` 一并跳过 assistant('') 行。

### R4（链 L12，⚠️，本批范围外但被本批放大）Anthropic 协议出口

- 现状：`anthropicClient.ts:221-234` 静默丢弃 `tool` 行与 `tool_calls`；本批使 `assistant(content:'')` 从「仅在线内存」扩散到「DB 重载历史」，于是重载后 Anthropic 收到 `assistant('') → assistant('') → assistant(正文)` 的连续同角色序列（`contextManager.ts:255-256` 分流）。
- 范围裁定：plan §2.2 明确把 `anthropicClient.ts:217-234` 划为「另立」，本批不修。
- 未实测：未向真实 Anthropic API 发请求验证「空 content 串」与「连续同角色」的实际返回码。
- 建议处置：另立任务实现 Anthropic tool-use 块转换；在此之前对 `protocol==='anthropic'` 至少做一次「丢 `tool` 行时同步合并/跳过空 assistant 行」的兼容处理。

---

## 4. IPC 与事件契约（专段）

| 通道 | 发出方 | 接收方 | 载荷字段一致性 | 状态 |
|---|---|---|---|---|
| `ai:stream:tool` | `agentToolExecutor.ts:512`（`{conversationId, ...toolEvent}`）+ preview 覆盖行 `:520-530` | `preload.ts:460-485` 归一为 `{type:'tool', ...}` → `agentStore.ts:420` | `toolCallId/name/args/status/result?/errorDesc?/thinking?/loopIndex?` 逐字段对齐 | ✅ |
| `ai:stream:done` | `agentLoop.ts:190`、`:538`、`agentTaskWorker.ts:454-461` | `agentStore` `evt.type==='done'` → `finishAndPersist(evt.refsJson)` | `conversationId/usage/roundsUsed/intent/refsJson` | ✅ |
| `ai:stream:error` | `agentLoop.ts:607/612`（`code` 为 `AIErrorCode`） | `agentStore.ts:446` | `conversationId/code/message` | ✅ |
| `agent:interaction:question` | `agentTaskWorker.ts:423-432`（`persistOnly` + `webContents.send`） | `preload.ts:487-499` → `agentStore.ts:435` → `AIPanelSession.tsx:115` → `QuestionCard` | 七字段一致；回放路径 `agentEventStore.ts:250-252` 走同一通道字面量 | ✅ |
| `ai:conversation:get` | `chatHandlers.ts:74-84` | `agentStore.ts:1391` | 返回 `IAIMessage[]`，本批新增 `toolCalls` 有值的 assistant('') 行 → 显示层未适配（R2） | ⚠️ |
| `ai:message:updateToolCalls` | **已无发出方** | **已无 handler** | 常量保留于 `constants.ts:192`；preload/桥/渲染三端同步删除 | ✅ |
| `ai:chat` | 无渲染层调用 | `chatHandlers.ts:247` | 消费新 DB 形状未适配（R3） | ⚠️ |

事务边界（plan §5）逐条核对：

- 「IPC 发送不在事务内」——`ctx.send(AI_STREAM_TOOL)`（`agentToolExecutor.ts:512`）、`AI_STREAM_ERROR(loop_detected)`（`:561`）均在 `flushPendingToolWrite`（`:659` / `agentLoop.ts:726`）之前执行，事务体仅包住 SQL（`db/ai.ts:816-845`）。
- 「flush 在 `deadLoopBreak` 提前返回之前」——两处均为 `flushPendingToolWrite(...)` 紧跟 `if (loopResult.deadLoopBreak) return ...`（`agentToolExecutor.ts:659-660`、`agentLoop.ts:726-727`）。
- 「最终 assistant / 用户行不在事务内」——`appendMessage` 调用点未变（`agentLoop.ts:182/530`、`agentContext.ts` 当前 user 行）。
- 机械证据：`tests/main/ai/agentLoop.test.ts:388-391` 用 `invocationCallOrder` 断言 tool/error 事件在 flush 前、done 在 flush 后；本阶段实跑该文件 31 例全绿。

---

## 5. 未验证项与原因

| 项 | 未验证原因 |
|---|---|
| `scripts/agent-smoke.cjs`（真实 Electron + better-sqlite3 + 真实 DeepSeek key 的事务/迭代器语义冒烟） | 需 `npx electron scripts/agent-smoke.cjs` 且需 `DEEPSEEP_API_KEY` 或 `~/.weavemd-deepseek-key`；plan §4 明确「本批不新增 cjs」，脚本本批未改，故未硬跑、未改脚本。对应 status §剩余风险 4「fake DB 盲区未消」仍成立 |
| 真实 `db.transaction()` 回滚 / `stmt.iterate()` 提前停机语义 | 同上，仅由自包含 fake 断言（`aiMessagesWrite.test.ts` / `aiMessagesRead.test.ts`）+ 源码取证覆盖 |
| `npx playwright test` 全量 E2E | 本阶段未重跑；转录 Gate B 实测（`docs/plan/agent-memory-optimize.status.md` §237：31 failed / 103 passed / 1 skipped，基线零新增）。新增 2 条用例的 testid 链路已由源码核对（链 L8） |
| Anthropic 真实 API 对 `content:''` / 连续同角色消息的返回码 | 无 key、不在本批范围（plan §2.2 另立），见 R4 |
| R2（空 assistant 气泡）的视觉/交互影响 | 仅源码推演，未在真实 UI 复现；需总指挥裁定是否在本批内补渲染规则 |
| 全量 `npm test` | 本阶段只跑与本批相关的 19 个测试文件（499 例），全量由 Gate B 覆盖 |

---

## 6. 本阶段实跑证据

| 命令 | 结果 |
|---|---|
| `git diff 968e056 --stat` / `git diff 968e056 -- src/` | 54 文件 +4298/−190；`src/` 侧 20 文件（唯一权威改动集） |
| `grep -rn "updateLatestAssistantToolCalls\|AI_MESSAGE_UPDATE_TOOL_CALLS" src/` | 仅 `src/shared/constants.ts:192` 常量定义 1 处，零残留调用 |
| `grep -rn "updateMessageToolCalls" src/main/ai/ipc/ src/main/preload.ts src/render/` | 无匹配（IPC/preload/渲染三端已同步删除） |
| `npm run typecheck` | **0 error** |
| `npm run lint` | **0 error** / 106 warning（均为既有 console / hooks 警告，非本批引入） |
| `npx vitest run`（agent 组 9 文件） | **220 passed**（agentContext 38 / agentLoop 31 / agentMedia 15 / agentKbPreloader 28 / streamingToolExecutor 16 / agentToolExecutor 7 / intentRouter 17 / agentPromptBuilder 50 / contextManager 18） |
| `npx vitest run`（db + kb + ipc 组 7 文件） | **235 passed**（aiDao / aiMessagesRead / aiMessagesWrite / searchKBHandler / queryPlannerEnhanced / knowledgeClarify / ipc） |
| `npx vitest run`（renderer 组 3 文件） | **44 passed**（AIPanelSession 7 / QuestionCard 1 / agentStore 36） |
| 合计 | **19 文件 / 499 tests / 0 failed** |

---

## 7. 结论

**断裂链路：无（0 条 ❌）。** L1 写路径、L2 读路径、L3 形状转换、L5 回写链拆除、L6 意图兼容、L7 提示语义、L8 事件接线、L9 事务边界共 8 条链路 **✅ 通畅**，接口签名、字段名、事件名、事务时序两端一致，且有 `typecheck 0 error + 499 例针对性测试全绿` 的机械证据。

**需总指挥裁定的 4 条 ⚠️ 风险（均不属「断裂」，但影响交付判断）：**

1. **R2（优先级最高）** —— 重载态出现空 assistant 气泡、工作流卡片与答案气泡分离，存活态与重载态显示不一致。建议本批内补渲染层「空 content + 有 `toolCalls` → 只渲染卡片」规则并补 render 测试（`AgentTab.tsx:43/118`、`AIMessageBubble.tsx:506-527`）。
2. **R1** —— `toolCtx.history` 含当前问题导致指代改写可能自指（`agentContext.ts:596` + `queryPlanner.ts:131-178`），建议对末位 user 行豁免实体提取。
3. **R3** —— `AI_CHAT` 读到空 assistant 行，当前渲染层不可达，属潜伏契约缺口。
4. **R4** —— Anthropic 协议出口丢 `tool` 行 + 新增空 assistant 行，plan §2.2 已另立，本批放大了暴露面，建议另立任务前先做兼容降级。

**未验证项**（Electron smoke、真实事务回滚、全量 E2E、Anthropic 真实返回码、R2 视觉复现）已在 §5 逐条列明原因，不得视为已通过。

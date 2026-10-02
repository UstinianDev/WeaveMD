# agent-memory-optimize — 需求文档（第一批 / P0）

> 日期：2026-09-28 | 档位：L | 基于：`docs/plan/agent-memory-optimize.direction.md`（已随计划退役，见 git 历史）+ grill-me 三轮对齐 + P0 代码锚点核验
> 状态：**18 项全部对齐**（Q1~Q15 需求对齐 + Q16~Q18 实施期新增裁定）

## 一、目标

修复「指代追问被反问 *它指什么*」这一现象背后的 5 条根因，让 Agent 在会话内能真正记住并沿用上下文：

1. chat 意图丢失历史与摘要；
2. 系统提示与注入块里「忽略之前的所有对话」的反上下文指令；
3. 短文本被 `needsClarification` 误判为需要澄清，导致本可直接回答的问题弹出提问卡；
4. `tool_calls` 不落库、回读被丢弃，形成 assistant→tool 非法行序；
5. 知识库检索的代词消解从未拿到历史，且改写函数根本没接进检索主管线。

## 二、需求清单

### P0-1（方向 一.1）：chat 意图保留历史与摘要

- **根因**：`agentContext.ts:417-420` `const history = isChat ? [currentUserMsg] : allDbMessages;`，且 `:422` 连 summary 也跳过（`!isChat && summary`）。
- **范围**：`agentContext.ts:417-420` 与 `:422` 两处统一为同一取数路径；chat 与非 chat 共用窗口口径（见 Q5=A）。
- **风险**：L3（上下文语义）
- **验收**：vitest 断言 chat 意图下 `buildCompressed` 收到的 history 长度 >1 且 summary 非空。

### P0-2（方向 一.2）：移除「忽略之前所有对话」的反上下文指令

- **根因**：`agentContext.ts:444/:449`（`【重要】请只回答上面的用户问题。忽略之前的所有对话内容和历史摘要。`）、`agentPromptBuilder.ts:286-290` 核心规则、`agentPromptBuilder.ts:369-379` `CHAT_SYSTEM_PROMPT` 第 2/3/4 条、`contextManager.ts:135` 摘要前缀。
- **范围**：四处**同批**改为统一措辞——保留「必须且只能回答用户的最后一条消息」（承担防串题），删除「忽略之前的所有对话内容和历史摘要」「每条用户消息都是独立的新指令」，改为「历史与摘要仅用于理解当前问题的指代与上下文，不要延续上一轮未完成的作答」。
- **边界**：合法指代允许沿用历史；跨话题新问题由「只回答最后一条」兜住。
- **风险**：L3
- **验收**：vitest 快照/子串断言四处均不含「忽略之前的所有对话」类反上下文文案，且保留防串题条款。

### P0-3（方向 一.3）：`needsClarification` 不再被纯长度触发

- **根因**：`intentRouter.ts:140-141` `confidence < 0.7 || text.length < 6 || (confidence < 0.85 && text.length < 10)`，另有 `:109-117` 零命中 chat 兜底携带 `text.length < 10`。「它有什么优势」（6 字）走兜底即误判。下游 `agentContext.ts:471-478` `useAgentPrompt = !isChatIntent || needsClarification || hasAttachments` 触发 `agentPromptBuilder.ts:275-280` 的【注意】提问前缀。
- **范围**：短文本长度门与低置信度门解耦——有明确指代对象/有历史可依时不得仅凭字数判定需澄清；`agentToolSelector` 不改（核验：chat 并非只剩 `ask_question_card`，方向文档此处描述有误）。
- **风险**：L3
- **验收**：vitest 断言「它有什么优势」在有历史上下文时不置 `needsClarification`；纯空/无上下文场景仍可置位（不削弱澄清能力）。

### P0-4（方向 一.4）：`tool_calls` 落库与合法行序（方案 A）

- **根因（核验修正）**：`tool_calls` 列**已存在**（`src/main/db/index.ts:250-251`），**不需要 DDL 迁移**；渲染侧已有一条回写链 `agentStore.ts:708-715 → preload.ts → chatHandlers.ts:218-220 → db/ai.ts:832-845`。真正缺陷是①tool 行先写、assistant 后写造成非法 assistant→tool 行序，②回读 `agentContext.ts:360-366` 的 map 丢弃 `tool_calls`（`db/ai.ts:599-606 mapMessageRow` 已解析该字段），③`appendMessage` 的 `toolCalls` 形参全库无调用方。
- **范围（Q7=A / Q14=A）**：
  1. `agentToolExecutor` 写 tool 行的**同一轮**先把带 `tool_calls` 的 assistant 行落库，与本轮全部 tool 行**同一事务**提交；
  2. assistant 行**确定性 id 幂等 upsert**（防重试重复落库）；
  3. `agentContext.ts:360-366` 的 map 补回 `tool_calls`，并修 `:368-370` 的 `content.trim().length > 0` 过滤——`assembleToolTurn` 产出的正是 `content: ''`，**不修则 assistant(tool_calls) 行被直接滤掉**；
  4. 读取侧**配对修复**（缺 tool 的 id 补合成 tool 行，或整体剥离该 assistant 的 `tool_calls`）——**新建**，不复用不校验配对的 `cleanupIncompleteMessages`；
  5. **停用**渲染侧 `updateLatestAssistantToolCalls` 回写（消除双写；其只更新「最后一条 assistant」，并发/回放会覆盖旧行）；
  6. `anthropicClient.ts:221-234` / `anthropicCompat.ts:89-103` 对 `tool` 角色的静默丢弃**本批不动**（另立，避免混入）。
- **不新增**：中断/致命错时主动写合成 tool 结果的路径（Q14=B 已否决）。
- **风险**：L3（数据写入路径）
- **验收**：vitest 断言 DB 内 assistant(tool_calls) 行在对应 tool 行之前、回读结果携带 `tool_calls`、且不存在第二处写入点。

### P0-5（方向 一.5）：上下文读取按轮次统一（Q9=A）

- **根因**：`agentContext.ts:359` 硬编码 `limit=20` 与 `agentHelpers.ts:13-14` `KEEP_RECENT_ROUNDS=3` 是**两个独立截断**；多 tool 的 RAG 会话里 20 行不足 3 轮。
- **范围（Q9=A / Q13=A / Q15=A）**：读取取 **`max(最近 3 轮全量, 20 行)`**——轮数保证下界、20 由**上限降为水位线**、上界交软字节闸；**不设固定行数硬上限**；SQL 端**流式累加字节预算、超预算即停再反转**；排序加 **`rowid DESC`** 兜底（`created_at` 为毫秒 ISO 串，同轮批量写会并列，否则会切出半截轮）；长度最终交给既有 `buildCompressed`（`agentHelpers.ts:44-46` 阈值 0.85/0.65、`contextManager.ts:110-170`）。
- **红线**：不减少历史轮次、不截断工具结果。
- **风险**：L3
- **验收**：vitest 断言多 tool 轮次下读取行数能覆盖 3 轮，且现有 `contextManager.test.ts` 回归通过。

### P0-6（方向 二.1）：searchKB 拿到历史并真正接入代词改写（Q10=A / Q11=A）

- **根因**：`queryPlanner.ts:427 detectAmbiguities(query, history?)` 与 `:224 resolveReferences(query, history?)` 签名**早已带可选 history**，`searchKBHandler.ts:25` 未传；更根本的是 `resolveReferences`/`understandQuery` **在检索主管线从未被调用**（仅 `queryPlanner.ts:471` 内部与 `planQuery` 用），检索 query 至今未被改写。
- **范围（Q10=A / Q11=A / Q12=A）**：
  1. `agentContext.ts:321-334` 构建 `ToolCtx` 时注入主流程已读出的 `ConversationMessage[]`（`toolTypes.ts:40-72` 增加 `history` 字段）；
  2. `searchKBHandler` 把 history 传给 `detectAmbiguities`（`queryPlanner.ts` 的 `!history` 门 —— 行号随 B-d 实现漂移，实测在 `:460` / `:476`，不再是核验期的 `:432-434` —— 随之自然放行），并给 `detectAmbiguities` 内的 `length<2` 判定一并加上下文门（与 P0-3 口径一致）；
  3. 主管线在调 `detectAmbiguities` 前先 `resolveReferences(query, history)`，位置在 `sanitizeFtsQuery` **之前**且**纳入 cacheKey**；
  4. **回退收紧**：历史空恒等返回；解不出明确实体则原样返回并标 unresolved，**取消 `resolveReferences` 路径上的 `extractRecentTopic`「最近 3 条 user 文本硬拼 `${topic}的`」回退**（`extractRecentTopic` 函数本体保留给 `extractEntityFromHistory` 用，故该能力未从代码消失）；改写结果仍含指代词或长度 <2 则不启用。**（2026-09-29 追记）** 阶段 6.5 另修自指风险 R1：`extractEntityFromHistory` 跳过「自身以指代词开头」的消息，避免把当前问题当实体拼进改写结果；
  5. **双路召回**：原 query 与改写 query 走既有 `expandedQueries` + RRF 融合，不二选一。
- **不改**：`knowledgeClarify.ts` 本体（见 P0-7）。
- **风险**：L3
- **验收**：vitest 断言「它有什么优势」在有历史时检索 query 被改写为含明确对象；无历史时原样返回（`queryPlannerEnhanced.test.ts:107` 守护用例保持绿）。

### P0-7（方向 二.2）：只补测试、不改代码

- **核验结论**：`knowledgeClarify.ts` 本体**无任何 `history` 引用**，其门控在 `queryPlanner.ts:432`（含 `history.length===0`），P0-6 一接入便自然失效，**无需改动该文件**。
- **范围**：为 `knowledgeClarify.ts`（当前零测试）补 vitest 覆盖：有历史时不误触发澄清、无历史时行为与现状一致；模板占位符用 `「」`（非方向文档所写 `『』`）。
- **风险**：L1
- **验收**：新增用例通过，`searchKB` 拒答阈值 0.6 / 置顶 ×1.5 / searchMode 三模式降级行为不变。

## 三、执行顺序

**批 A（语义层，互为因果必须同批）**：P0-1 → P0-2 → P0-3 → **Gate（五门禁全量跑）**
**批 B（存储与检索层）**：P0-4 → P0-5 → P0-6 → P0-7 → **Gate**

TDD 强度：**L / strict**（RED 实测 → 最小实现 GREEN → 重构 → 覆盖率 ≥80% → checkpoint → 证据报告 `docs/testing/agent-memory-optimize.tdd.md`）。

## 四、不涉及范围

- ❌ 模块三 / 五 / 六（联网检索、记忆分层、长期画像）——第二批；其 ②③ 检索源经裁定**改用内置 WebSearch**（fastcrw search 后端在本机不可用）。
- ❌ 场景③「跨话题隔离回归」验收——留第二批。
- ❌ `anthropicClient` / `anthropicCompat` 丢弃 `tool` 角色——另立。
- ❌ 模块四 / 六 与 `classifyIntent` 接入 searchKB 主管线——TODO 已单列。
- ❌ 数据库 DDL 迁移——核验确认 `tool_calls` 列已存在，本批无 schema 变更；历史迁移文件不动。

## 五、红线

1. 不减少历史轮次、不截断工具结果（沿用 `docs/requirements/archive/agent-perf-optimize.req.md:11-17`）。
2. 铁律一仅约束**笔记内容写入**，不约束上下文拼装。
3. 知识库 0.6 拒答、置顶 ×1.5、searchMode 三模式降级行为不变。
4. 停用渲染侧 `tool_calls` 回写属**删既有能力**，已获 Q7 明确批准。
5. 迁移须空库 + 升级双路径（本批无迁移，仅作约束保留）。

## 六、已对齐问题清单

| # | 问题 | 结论 |
|---|------|------|
| Q1 | 本批范围 | **只做 P0 七项**；P0-7 转为「仅补测试、不改代码」；模块三/五/六留第二批 |
| Q2 | 验收标准 | **双层**：vitest 主进程断言（根因层）+ E2E UI 断言（现象层，场景①②）；场景③留第二批 |
| Q3 | E2E LLM 后端 | **mock**（E2E 本就 `installWeaveMDMock` 注入 mock runAgent）；必要真测用用户已存 `ai_config` |
| Q4 | E2E 门禁基线口径 | **A**：基线零新增（实测 31 failed/101 passed/1 skipped、unexplained 0，与登记基线逐 spec 一致）+ `tsc`/`vitest`/`eslint(0)`/`vite build` 四项真全绿；21 条他模块既有问题另立 issue；10 条已知失败按裁定维持（不恢复废弃能力） |
| Q5 | chat 窗口口径 | **A**：chat 与其他意图统一窗口 |
| Q6 | 交付节奏 | **分两小批**：批 A（P0-1/2/3）→ Gate → 批 B（P0-4/5/6/7） |
| Q7 | 一.4 方案 | **A**：executor 落库 assistant(tool_calls) + 回读补字段 + **停用**渲染侧回写（双写消除） |
| Q8 | 一.2 措辞边界 | **A**：四处（含 `contextManager.ts:135` 摘要前缀）同批改写，防串题由「只回答最后一条」承担 |
| Q9 | 一.5 窗口取值 | **A**：读取按轮次（3 轮）动态取，取消 20 行硬上限，长度交 `buildCompressed` |
| Q10 | 二.1 history 来源 | **A**：`ToolCtx` 注入主流程已有的 `ConversationMessage[]`，工具内零额外 DB 读 |
| Q11 | 二.1 是否接入改写 | **A**：本批把 `resolveReferences` 接进 searchKB 主管线（只传参不接入等于没修） |
| Q12 | 二.1 改写策略细化 | **A**：回退收紧（历史空恒等 / 解不出实体原样返回+unresolved，**取消 `extractRecentTopic` 最近主题词硬拼** / 含指代词或长度<2 不启用）+ **双路召回**走既有 `expandedQueries`+RRF；改写插在 `sanitizeFtsQuery` 之前并纳入 cacheKey |
| Q13 | 一.5 字节预算 | **A**：SQL 端流式累加字节预算、超预算即停再反转（无行数上限、有软字节闸）；排序加 `rowid DESC` 防同毫秒切半截轮 |
| Q14 | 一.4 孤儿兜底 | **A**：单事务写入（assistant(tool_calls)+本轮 tool 行）+ 读取侧配对修复；**不新增**中断主动合成 tool 结果路径；配对修复须新建，不得复用不校验配对的 `cleanupIncompleteMessages` |
| Q15 | 一.5 与红线的张力 | **A**：取 `max(最近 3 轮全量, 20 行)`——20 由上限降为**水位线（下限）**，轮数保下界、字节闸管上界；不新增魔数 |
| Q16 | **实施期新增**：P0-4 确定性 id 缺运行维度（`round` 每次运行从 0 重计，同会话第二条消息撞 id → 历史错配） | **A**：加运行级 `runId` 盐，`prepareAgentContext` 每运行 `randomUUID()` 一次；id 改 `aturn_${conv}_${runId}_${round}` / `t_${conv}_${runId}_${round}_${index}`。否决「改随机 UUID（丢幂等）」与「锚定用户消息行 id（拿不到就得多传参）」 |
| Q17 | **实施期新增**：plan 所述「透传 `tool_calls`」与实际形状不符 | **批准**：DB 存 `IAgentToolCall[]`、provider 要 `{id,type:'function',function:{...}}`，须在 DB→LLM map 处做 `toLlmToolCalls` 转换，否则必然 400。属 P0-4 唯一可行实现，不扩范围 |
| Q18 | **实施期新增**：Gate B 覆盖率口径（整文件 ≥80 导致 6 个文件未达标，其中 5 个本任务只做了删除、`preload.ts` vitest 结构性加载不到） | **A**：改为**改动行覆盖 ≥80%**——删除行不计、`preload.ts` 与 `toolTypes.ts` 判不适用、未覆盖的新增行补测。保留 strict TDD 本意（新代码必须有测），不为本任务未写的代码造测 |

## 七、事实核验修正（方向文档有误处，以本表为准）

| 方向文档原述 | 核验结论 |
|---|---|
| 一.3 chat 工具集只剩 `ask_question_card` | 不成立。`agentToolSelector.ts:75-98` 对所有意图已授予约 15 个工具，chat 只是不加 searchKB 与写文件工具 |
| 一.4 `tool_calls` 从不落库、需 DDL 迁移 | 列已存在（`db/index.ts:250-251`），渲染侧已有回写链；真缺陷是行序 + 回读丢字段 |
| 一.2 `agentToolSelector` 亦需改 | 不需改，见 Q8 范围 |
| 二.2 `knowledgeClarify` 需改模板门控 | 不需改代码（本体无 `history` 引用，门在 `queryPlanner.ts:432`，随 P0-6 自动放行），仅补测试 |
| 模板用 `『』` | 实为 `「」` |
| 一.4 `tool_calls` 已可经渲染侧回写落库 | 回写只更新「最后一条 assistant」，并发/回放会覆盖旧行；且 `agentToolExecutor.ts:498` 只写 tool 行——真正缺陷是写入时序而非字段 |

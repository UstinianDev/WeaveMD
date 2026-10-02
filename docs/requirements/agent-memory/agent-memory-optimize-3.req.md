# agent-memory-optimize-3 — 需求文档（第三批 / P2）

> 日期：2026-09-30（更新至 2026-10-01） | 档位：**L**（含 1 项 L4 迁移）| 基于：`docs/requirements/agent-memory/agent-memory-optimize-2.req.md`（第二批）+ `优化方向.md` 第三批路线图 + 两轮只读代码核查（2026-09-30）
> 状态：**Q1~Q9 全部对齐**（Q1~Q7 于 2026-09-30 裁定「全按推荐」；**Q8、Q9 于 2026-10-01 裁定 A**；D7 为 2026-09-30 批准的范围扩张项）

## 一、目标

第二批交付完 P1 主干（模块三/四/五 + 二.4 + 七.1~7.3），第三批交付方向文档 **P2 远期能力**共 6 项：`二.3` 指代触发率可观测、`三.3` 向量化经验库、`五.4` 遗忘/过期机制、`模块六` 经验沉淀与 Skill（六.1/六.2/六.3）。

分三个 Gate、按**调整后的顺序**执行（Q1+Q2）：

| Gate | 任务 | 档位 | 依赖 |
|---|---|---|---|
| **D** | 二.3 指代触发率接入 diagnostics（S）+ 五.4 遗忘/过期机制（M） | L2/L3（五.4 含 L4 迁移加列） | 二.3 依赖一.1/一.2（第一批已交付）；五.4 依赖三.2/五.2（第二批已交付） |
| **E** | 六.1 轨迹→Skill 提炼（L）→ 六.2 结构化存储 + 任务类型注入（M）→ 六.3 防膨胀三防线（M） | L3（六.1 含 L4 迁移） | 串行 |
| **F** | 三.3 向量化经验库（L） | L4 | **推迟到最后**，等六.1/六.2 定下经验形态再建库 |

**顺序调整说明（Q2，偏离方向文档原文）**：方向文档 §0.4 给的是「二.3 → 三.3 → 五.4 → 模块六」。但三.3 的经验库是给模块六存经验用的，而六.2 要求「结构化存储保持流程顺序」—— **经验存什么结构未定就先建向量库会建错重来**。故把三.3 挪到最后（Gate F），让模块六先定型。

## 二、需求清单

### Gate D

#### D1 = 二.3（方向 二.3）：`hadPronounRef` 指代触发率统计接入 diagnostics

- **现状（核查 2026-09-30）**：
  - 类型已声明**从未赋值**：`src/shared/ai/kb.ts:133-137` 的 `IKbDiagnosticsQueryUnderstanding { intentType, isFallthrough, hadPronounRef }` 全仓只有 1 处命中（声明本身）；`researchLoop`（`kb.ts:140-144`）同样未赋值。
  - 构造点 `kbSearch.ts:740-764` 只填 `timings`/`counts`/`cacheSnapshot`；缓存命中变体 `:479-494` 同样只填 3 项。
  - **两条早退路径不带 diagnostics**：`:463-469`（`cleaned` 空 → `emptyResponse`）、`:683`（`candidates.length===0` → `emptyResponse`）—— **恰是澄清最常触发的场景**。
  - **`searchKBHandler.ts` 全文无 `diagnostics` 引用**；`toolTypes.ts:20-40` 的 `SearchKbFn` 返回类型只写 `{refused, threshold, best, results}` → handler 静态取不到。
  - 唯一出口 `kbSearch.ts:766` `console.debug` —— **不可 SQL 查询**；`ai_messages.content` / `agent_run_events.payload_json` 两个既有 sink 都查不到。
  - 可复用标志**已在手**：`searchKBHandler.ts:83` 已解构 `const { query: effectiveQuery, resolved } = resolveReferencesDetailed(...)`，`ResolvedQuery.resolved`（`queryPlanner.ts:228-233`）语义即「发生了有效改写」。
  - ⚠️ `detectAmbiguities` 的 `pronoun_reference`（`queryPlanner.ts:523-525`）是**反向指标**（有指代词但无历史 = 未消解），**不可与 `hadPronounRef` 混用**。
  - 文档漂移：`docs/modules/11-AI代理面板-Agent.md:92` 写 `IKbSearchDiagnostics`，代码是 `IKbDiagnostics`。
- **范围（Q7 三步）**：
  1. `kbSearch.ts:740-764` 真实赋值 `queryUnderstanding`（`intentType` 用 `detectQueryIntent` 结果、`hadPronounRef` 由调用方传入的改写结果驱动、`isFallthrough` 按「意图规则零命中 → chat fallback」判定）；
  2. `toolTypes.ts` 的 `SearchKbFn` 契约补 `diagnostics?`，`searchKBHandler` 把它挂进工具 `content`（让两个既有 sink 立即可查）；
  3. 补两条早退路径的 diagnostics。
- **口径定义**：
  - **指代触发率** = `hadPronounRef:true` 的检索次数 / 有效检索次数；**有效** = 传入了 `history`（`resolveReferencesDetailed` 在 `queryPlanner.ts:260` 无 history 时恒返 `resolved:false`，这类**不计入分子但计入分母**，分母以「发起过 searchKB 调用」为准）。
  - **澄清触发率** = `clarificationContext != null` 次数 / 有效检索次数。
  - 缓存命中路径（`:479-494` 全 0）**计入分母**，`hadPronounRef` 取该次调用的实际改写结果。
- **不涉及**：不改 `resolveReferencesDetailed`/`detectAmbiguities` 的判定逻辑；不改检索分数、`threshold`、`searchMode`；不建 metrics 表（Q7 推荐落点是挂进 content 走既有 sink，**不新建表**）。
- **风险**：L2
- **验收**：vitest 断言 `queryUnderstanding` 三字段被正确赋值、两条早退路径带 diagnostics、工具 `content` 含 diagnostics 可从返回体读到；`hadPronounRef` 与 `detectAmbiguities.pronoun_reference` 方向相反的反例用例；文档接口名同步。

#### D2 = 五.4（方向 五.4）：遗忘 / 过期机制

- **现状（核查 2026-09-30）**：
  - `src/main/ai/agent/memoryPolicy.ts`（152 行）三函数已就绪：`evictStale :54-71` / `mergeConflicts :94-119` / `runMemoryPolicy :139-151`（先 merge 后 evict）；`MEMORY_EVICT_MAX_AGE_DAYS = 90`（`:35`，注释已标「无实测数据待校准」）；`source==='manual'` 在 `:66`（驱逐）与 `:114`（合并）双豁免。
  - **唯一生产调用点**：`memoryWriter.ts:393`，位于后台提取任务**成功完成**尾部 → 提取失败（`:409`）、被节流（`:201`）、被 pending 去重（`:211`）时**本会话完全不跑驱逐**。**无启动触发、无 C1 工具路径触发、无定时触发。**
  - **表级零容量上限**：全部是单次上限（`MAX_MEMORY_WRITE_PER_TURN=10`、`MAX_MEMORY_EXTRACT_ITEMS=10`、`PROFILE_MAX_ENTRIES=40` 仅注入侧）；`upsertMemory` 与 `runMemoryPolicy` 均无总条数/字节闸 → 90 天窗口内**只增不减**。
  - **索引缺口**：`db/index.ts:747-749` 三个索引无一覆盖 `written_at`；`evictStale`/`getRecentEntities` 把时间过滤放 TS 侧全量遍历。
  - **11 列无 `access_count`/`last_read_at`/`importance`**（`db/index.ts:734-746`）→ 不加列无法实现 LRU 式遗忘。
  - `closeMemory` 关闭的行永久留存（除 C3 物理删），**无归档/清理策略** → 表体积单调增长。
- **范围（Q6 三条）**：
  1. **触发扩展**：应用启动 + C1 `memory_write` 成功后 + 既有后台提取成功路径（**复用既有 1s 队列轮询，不新建定时器**）；
  2. **授权加列**（走 `addColumnIfMissing` 追加式范式，`db/index.ts:334-339`）：`access_count INTEGER DEFAULT 0`、`last_read_at TEXT`；
  3. **容量上限**：按 active 条数设（超限按 `access_count` 升序 → `written_at` 降序关闭），阈值标「无实测数据待校准」；
  4. 补 `written_at` 索引。
- **不涉及**：**不碰摘要层**（`ai_conversations.summary` 整体覆盖式，第二批已定其口径）与 `memory.md` 存储侧（注入侧已有 `GLOBAL_FILES_TOKEN_LIMIT` 截断）——二者**不纳入遗忘范围**；不动 `mergeConflicts` 的 manual 恒免与 Ledger 不删行红线。
- **风险**：**L4**（`addColumnIfMissing` 补列 + 索引）
- **验收**：迁移三态断言 + 真库 smoke 补态（补列后旧行取 DEFAULT）；`runMemoryPolicy` 触发时机三处均有测试；超上限按序关闭且 `manual` 恒不被关闭；既有 14 例 `memoryPolicy.test.ts` 零改动全绿。

### Gate E（模块六）

#### D3 = 六.1（方向 六.1）：执行轨迹 → 可复用 Skill 提炼

- **现状（核查 2026-09-30，三条链路全部不通）**：
  - `src/main/ai/skills/` 仅 3 文件（`skillLoader.ts` 237 行 / `skillManager.ts` 82 / `skillInstaller.ts` 147），**纯文件系统、无 DB 表**；内置 3 个 core skill 硬编码（`skillLoader.ts:40-79`）。
  - **`agentContext.ts:485` 与 `skillManager.ts:24/35/48` 均无参调用 `loadSkills()` → 只拿到内置 3 个 → `runSkill` 与 `list_skills` 完全看不到用户手写技能**；用户技能只出现在渲染侧 `agent:skills:list`（`agentHandlers.ts:391-401`，5 个用户目录）。
  - **`sendRoutes.ts:83-97` 的 `routeSlashSkill` 把 `/skillname` 前缀剥掉后只发剩余 instruction，技能名不进主进程**。
  - **prompt 中无任何技能段**（`agentPromptBuilder.ts` 全文 grep `skill|技能` 零命中）。
  - `runSkill` handler（`tools/runSkillHandler.ts:4-22`）从 `ctx.skills` 按 name find；**`argsSchema`/`params` 未使用**，**不检查 `skillManager.isSkillEnabled`**（`:57` 无人调用）。
  - 轨迹源 A `agent_run_events`：`db/index.ts:559-569`，实际只写 chunk/tool/done/error/interaction 5 类；**chunk 每 100ms 一条**（`agentLoop.ts:334`）≈ 30s 流式 300 行；工具结果被 S6 截到 500 字（`toolResultStorage.ts:33`）；`getEventsBySession`/`cleanupOldEvents` **全仓零调用点**，无按 conversation 的查询函数。
  - 轨迹源 B `ai_messages`：`db/index.ts:188-199`，含 `tool_calls`（`db/ai.ts:795` 事务写入），可还原有序 user/assistant/tool；**默认只读最近 3 轮/20 行**（`getRecentMessagesByRounds`，`agentContext.ts:415`），**无 intent**（`agent_sessions.intent_json` 列存在但全仓无写入点）、无耗时/thinking。
  - 「成功/失败」权威终态在 `agent_task_queue.status`（`agentTaskWorker.ts:573-579`）。
- **范围（Q4 半自动 + Q5 轨迹源与共存）**：
  1. **半自动**：LLM 提炼只写**草稿态**（`status='draft'`），设置页人工确认后才进技能库生效；**天然并入 D5 六.3 的人工审核防线**；
  2. **轨迹源 = `ai_messages`**（含 `tool_calls` 快照即成功路径），**新增按会话的分页查询函数**，不碰 chunk 噪声；
  3. **技能共存 = 新建 `userData/skills/_auto/` 子目录** + **修复 3 处无参 `loadSkills()` 调用**（`agentContext.ts:485`、`skillManager.ts:24/35/48`）—— **不修则提炼出的技能 `runSkill` 根本调不到，等于白做**；
  4. 轨迹筛选口径：取 `agent_task_queue.status === 'completed'` 的会话（成败判定不在轨迹内，必须联查）。
     > **实施期修正（2026-09-30，D3 实测）**：初稿写的 `'done'` 在 `AgentTaskStatus` 枚举中**不存在**；权威成功终态枚举值实为 `pending/running/`**`completed`**`/failed/cancelled/superseded`。已按 `completed` 实现（`hasCompletedAgentTask`），此处措辞同步。
- **风险**：**L3 + L4**（新表若采用；若纯文件系统则 L3）
- **验收**：构造 3 次同类任务轨迹 → 提炼草稿 → 人工确认 → 第 4 次任务经 `runSkill` 可调用且结果正确；失败轨迹提炼的避坑规则在后续任务被触发；未确认的草稿态**不进入任何 prompt**。

#### D4 = 六.2（方向 六.2）：经验结构化存储 + 任务类型识别注入

- **现状（核查 2026-09-30）**：
  - `agentContext.ts:353` 起 `prepareAgentContext` 的实际顺序：落库 → `repairToolTurnPairing` → `buildCompressed`（`[:617]` 摘要 system + 最近 3 轮）→ Attention Anchoring（`[:633-644]`）→ vision 降级（`[:647-649]`）→ 三文件块读取 `[:680]` → 画像块读取 `[:681]` → `buildAgentSystemPrompt`（`[:682-691]`）→ unshift system `[:692]` → 文档上下文再 unshift `[:696-702]`。
  - 注入点固定两处：`agentPromptBuilder.ts:364-365`（agent 分支，三文件块→画像块）与 `:480-481`（chat 分支）。**加新块需同时改两个签名（`:333-340` 6 参 / `:468-471` 2 参）与两处调用**。
  - 截断工具现成：`truncateBlockWithMarker`（`:41-55`，二分保证 `estimateTokens ≤ limit`）；现两块各 2000（`GLOBAL_FILES_TOKEN_LIMIT :32`、`PROFILE_TOKEN_LIMIT :72`），注释 `:69` 明写「两块合计 ≤4000」。
  - `ctx.intent` **已在 `agentContext.ts:664-671` 算好零成本**（`intentRouter.ts:75` 返回 6 值 `IntentName`），但：**`chat` 是无规则 fallback**（`intentRouter.ts:112-119`，`scores.size===0` → chat/0.7）→ **无法区分「闲聊」与「未知任务类型」**；`confidence` 的两次人为改写（`:130-141` 并列→0.5、单规则≥3→0.9）是为澄清门调的，作任务类型置信阈值未标定；**intent 不落库**。
  - ⚠️ **顺序保持与 `mergeConflicts` 冲突**：`agent_memory` 是 `subject+content` 平铺行、**无顺序列**（`db/index.ts:734-746`），分组键 `kind+subject`（`memoryPolicy.ts:102`）→ 有序流程存进去**会被第二批的合并规则破坏**。
- **范围**：
  1. 经验存储**不复用 `agent_memory`**（顺序语义无法表达且会被合并），**新建有序结构**（具体落法由 D3 六.1 的产出形态决定，本任务在其上追加）；
  2. 注入通道：`buildAgentSystemPrompt` 加第 7 参 / `buildChatSystemPrompt` 加第 3 参，块插在画像块**之后**（同属个性化层，核心规则→三文件→画像→经验→工作流）；
  3. 注入触发 = `ctx.intent` 命中**且**有对应经验；**未命中或无经验 → 空串零占位噪音**（与 A1/B4 同口径）；
  4. token 预算：经验块独立上限，**须在报告中给出三块（三文件/画像/经验）合计与 64000 窗口的实测占比表**；阈值按 `CONTEXT_WINDOW=64000` 实测调优，**不照抄外部资料数值**。
- **待 Q 补充项（不阻塞，实施期定）**：`chat` fallback 无法区分「闲聊/未知类型」—— 本任务**只在 5 个显式规则意图上注入**（`rewrite`/`kbQa`/`tech`/`web`/`create`），`chat` 一律不注入，绕开该歧义。
- **风险**：L3
- **验收**：vitest 断言注入位置正确、未命中零注入、空块与未传参逐字一致、五层/六层结构树 + `estimateTokens` 实测占比表。

#### D5 = 六.3（方向 六.3）：防膨胀三防线

- **现状（核查 2026-09-30）**：
  - **防线一（合并去重）**：仓内**没有**「两条文本相似度」设施 —— `fingerprint` 是 sha256 **精确相等**去重（`agentMemory.ts:349-355`，两份同口径实现 `memoryWrite.ts:100-103`/`memoryWriter.ts:309-312`），措辞不同即视为新事实；FTS5 表专属（`kb_*`），`agent_memory` 明确不建 FTS（`db/index.ts:727`）；向量是检索设施不是去重设施。
  - **防线二（人工审核）**：C3 的「列表 + 二次确认删除」链路**基本可直接复用** —— `memoryHandlers.ts:90-136`（两通道 + 鉴权四条）+ `AgentPersonalityPanel.tsx:163-257`；但**没有「确认/驳回/合并建议」三态交互**；仓内唯一三态确认是 `IClarifyQuestion {type:'confirm'}`（`agentToolExecutor.ts:181-185`），走 agent 会话内交互，与设置页面板是两条链路。
  - **防线三（过期复核）**：**周期基础设施为零** —— 全仓唯一 `setInterval` 是 `agentTaskWorker.ts:125-127` 的 1s 队列轮询，而队列**按会话驱动**（`agentTaskQueue.ts:46/:50`，`enqueue` 必须带 `conversationId`）→ **跨会话的全局复核任务没有入队入口**；`cleanupOldEvents`（保留期清理）写了从未调用。
  - 现成可复用：`FORCE_CONFIRM_TOOLS` + `checkForceConfirmTools`（`agentToolExecutor.ts:161-236`）的确认范式；`agent_memory.fingerprint`；第二批 C3 的 IPC 鉴权范式。
- **范围**：
  1. **防线一**：同 `kind+subject` 内去重已有（`mergeConflicts`），本任务补**跨 subject 的语义相似合并** —— 用 FTS5 关键词重合度起步（**有 `FTS5_MIGRATION_SQL` 范式可抄**，`db/index.ts:44-60`），阈值标「无实测数据待校准」，**不引入 embedding 依赖**（向量归 Gate F）；
  2. **防线二**：扩 C3 链路为三态（确认 / 驳回 / 采纳合并建议），**复用既有鉴权与二次确认范式**；
  3. **防线三**：过期复核**复用 D2 已扩展的触发时机**（启动 + 写入后），**不新建定时器**；复核淘汰后置 `valid_to`（Ledger 不删行）→ 确保**不再出现在任何 prompt**。
- **红线**：`manual` 恒免驱逐/合并（第二批已固化）；Ledger 不删行；铁律一三处测试零改动。
- **风险**：L3
- **验收**：注入 50 条相似经验后三防线生效、注入条数有上界；复核淘汰后的经验不再出现在任何提示词；人工审核三态交互可用且鉴权通过。

#### D7（**范围扩张，2026-09-30 用户批准纳入本批**）：知识库 FTS 删除/更新触发器失效修复

- **发现（D5 实施期，总指挥已独立复核实锤）**：`kb_chunks_fts` / `kb_documents_fts` 是**普通（非 contentless）fts5 表**，但 `AFTER DELETE` / `AFTER UPDATE` 触发器用了**仅限 contentless 表**的 `'delete'` 特殊命令 —— `src/main/db/index.ts:66-67`（`kb_chunks_fts_ad`）、`:705`（`kb_documents_fts_ad`）、`:714`（`kb_documents_fts_au`）。
- **实测后果**（`npx electron` + better-sqlite3 + SQLite 3.49.2，照抄同样建表/触发器形态）：
  ```
  插入后 FTS 行数 = 1
  DELETE kb_chunks = FAILED: SQL logic error
  删除后 基表=1 FTS=1
  ```
  **`AFTER DELETE` 抛错导致整条 DELETE 回滚 → 基表行根本没删掉**；FTS 索引同步残留。
- **影响面**：生产 `src/main/db/kb.ts` 有 **5 处删除调用全会命中** —— `:233` `deleteKbDocumentByFile`、`:267` `deleteKbDocumentByAttachment`、`:275` `deleteKbDocument`、`:294` 清空用户文档、`:405` 删文档 chunk → **知识库删除不生效 + FTS 索引残留 → 检索可命中已删文档**。
- **既有 bug，非第三批引入**；既有 `scripts/fts5-smoke.cjs` **只验插入与查询、未验删除**，故 `EXIT=0` 不能暴露该问题。
- **范围**：
  1. 把 3 处触发器改为 `DELETE FROM <fts> WHERE rowid = old.rowid`（D5 已在新建的 `agent_memory_fts` 用此范式并在 JSDoc 留实测结论）；
  2. **红线口径**：本项目无迁移文件、DDL 内联于 `db/index.ts` 且全部 `DROP TRIGGER IF EXISTS + CREATE TRIGGER` 幂等重放 → **改 3 处触发器 SQL 后，旧库下次启动自动重建修复**，不违反「历史迁移不得擅改」的实质（**不 DROP 表、不 DROP 索引、不改列结构**）；
  3. 补**删除路径**测试（现有 `fts5-smoke` 未覆盖）：删 `kb_chunks`/`kb_documents` 后基表行消失 + FTS 行同步消失 + 按内容检索不再命中；
  4. `scripts/fts5-smoke.cjs` **追加一态**（既有态代码不改）；`scripts/agent-memory-migration-smoke.cjs` 不涉及。
- **风险**：L3（改既有 DDL，但幂等重放 + 追加测试可控）
- **验收**：上述 5 处删除调用对应的行为实测「删除成功且 FTS 同步」；既有 `fts5-smoke` 原有断言零改动全绿；`kbSearch.test.ts` / `kbDao.test.ts` 等知识库既有测试零改动全绿；真库 smoke 六态仍全绿。

### Gate F

#### D6 = 三.3（方向 三.3）：向量化经验库

- **现状（核查 2026-09-30）**：
  - embedding 全链可复用：`embeddingClient.ts`（557 行，含 LRU+TTL 缓存）、`vectorBackfill.ts:36-49 resolveEmbedding`、`kbHandlers.ts:455-462 kbIndexOpts`、`kbIndexer.ts:440-498 writeChunks`（含向量批量写）、`db/kb.ts` DAO。
  - **未配置 embedding 的降级（A4 结论复核仍成立、行号未位移）**：`searchMode:'vector'` 无 `queryVector` → `kbSearch.ts:508` 模式门禁把 FTS5 挡掉 → `:548` 跳过向量 → 只剩标题 → `:683` 无候选 → 规范拒答，**不回退 FTS5**；默认 hybrid 路径才降级 FTS5+标题。
  - **既有冲突（本批只改文档）**：`docs/specs/knowledge/embedding-architecture.md:122` 验收「无 Embedding 配置时**任意模式**都降级到 FTS5 + 标题」与实现冲突；`:77-81` 的 `embeddingConfig.searchMode → agentTaskWorker → searchKb wrapper` 数据流**未实现**（`ai_embedding_config.search_mode` 字段已建全仓零消费）。**按红线三「searchMode 降级行为不变」→ 改文档不改代码。**
  - **代码层硬约束**：4 条 SQL 表名全硬编码字面量（`kbSearch.ts:515-517/:578-580/:620/:642-643`、`kbSearchFts.ts:106-109/:161-162`）无参数化通道；`kb_chunks` 无 `user_id` 列，隔离靠 `JOIN kb_documents` + `d.user_id = ?`（4 处）；拒答阈值是参数默认值（`kbSearch.ts:452` `opts.threshold ?? 0.6`）；外发过滤 `filterKbEgressResults`（`:427-435`）只放行 `grantedAttachmentDocIds`（仅 `source_type='attachment' AND consent_granted=1`）→ `allowSend=false` 时经验库结果会被整批滤掉，且 **`:434` 不改 `refused`**。
  - `sourceType` 枚举当前 `'db'|'disk'|'import'|'attachment'`（`shared/ai/kb.ts:179`）。
- **范围（Q2+Q3 裁定）**：
  1. **执行顺序最后**，等 D3/D4 定下经验的存储结构与顺序语义；
  2. **✅ 载体调整（Q8，2026-10-01 用户裁定，取代 Q3 的「新建 `exp_*` 表」）**：
     > **Q3 当时的隐含假设已被实施期事实推翻**：Q3 批「独立表 `exp_*`，不与笔记同表」时，记忆表尚不存在且三.3 按方向文档排在模块六之前。现已变：**D2 已建 `agent_memory`（13 列）+ D5 已建 `agent_memory_fts`**，而 **D3/D4 已把「经验」落成 `userData/skills/_auto/*.md` 技能文件**（纯文件系统）。再建 `exp_*` 会与两者重复且与技能体系对接不明。
     > **裁定 A：给 `agent_memory` 加向量能力** —— 走 `addColumnIfMissing` 加 `vector BLOB` + `embedding_model TEXT`（复用 `kb_chunks` 的 `vector BLOB` + `vec_distance_cosine` 范式），查询侧 FTS5（D5 已建）+ 向量余弦混合召回。**Q3 的实质「不与笔记同表」本来就满足**（`agent_memory` 即独立表）。
     - **不新建表、不新建 FTS 虚拟表**（D5 已建 `agent_memory_fts`）；**不改 4 条硬编码 SQL、不扩 `sourceType` 枚举**；
  3. **独立检索入口**（独立于笔记的 `threshold`/`topK`，不复用笔记的 0.6 与出处跳转）；
  4. **降级策略**：**未配置 embedding → 只走 D5 已有的 trigram FTS5 关键词召回**（无报错、行为可预期，向量列保持 `NULL`）；**不改 `searchMode` 三模式语义**（红线三，那属笔记侧）；
  5. **外发边界**：记忆/经验召回**完全不进** `filterKbEgressResults`（那是笔记白名单逻辑），且**不加入笔记检索候选** → 拒答 0.6、置顶 ×1.5、出处可跳转三项红线**零影响**（独立表 + 独立入口，天然隔离）；
  6. **写入接线**：`upsertMemory` 成功后**异步**生成向量（复用 `vectorBackfill.ts:36-49 resolveEmbedding` + `embeddingClient`，失败静默降级不阻塞、不留脏数据）；提供**回填函数**（覆盖存量 active 行），启动时机复用 D2 已有触发点；
  7. **下游消费**：`memory_read` 工具（第二批 C1）支持语义检索（有 `queryVector` 走混合，无则 FTS-only）；**D4 的经验注入不改**（它消费的是 skill 文件，与本任务载体无关）；
  8. **文档同步**：修 `embedding-architecture.md:122`（「任意模式都降级 FTS5+标题」与实现冲突）与 `:77-81`（`search_mode` 数据流未实现）—— **改文档不改代码**（红线三）。
- **风险**：**L4**（加列迁移）
- **验收**：加列三态断言 + 真库 smoke 补态（11→13→15 列，旧行 `vector IS NULL`）；未配置 embedding 环境**无报错、行为可预期**（走 FTS-only）；**配置 embedding 时混合召回优于 FTS-only**（构造语义相近但关键词不重合的用例）；**`kbSearch.test.ts` 等笔记侧既有用例零改动全绿**（拒答 0.6 / 置顶 ×1.5 / 出处可跳转不受影响）；`filterKbEgressResults` 与 `searchMode` 判定 diff 为空。

#### D6.1 = Q9（实施期追加授权，2026-10-01 用户裁定 A）：`memory_read` 语义通道生产可达

- **问题**：D6 按 req §二 D6 第 7 条字面交付（「有 `queryVector` 走混合，无则 FTS-only」），**未授权在工具内生成查询向量** → LLM 只会传 `query` → **永远走 trigram FTS-only，向量混合通道在生产是死代码**（仅测试可达）。D6 的向量写入/回填/检索能力已就位，**查询侧无人喂向量**。
- **范围（Q9=A）**：
  1. `src/main/ai/tools/memoryRead.ts` 加 **opt-in 参数**（命名对齐 `searchKB` 已有的 `hyde: true` 模式，或 `semantic?: boolean` —— 以对齐既有命名为准）；
  2. 工具内按需生成 `queryVector`：复用 `ctx.generateHydeVector`（若该能力在 `ToolCtx` 上可用）或 `vectorBackfill.ts` 的 `resolveEmbedding` + `embeddingClient.createEmbedding`；
  3. **不传该参数 → 零 embedding 成本、行为与 D6 交付逐字一致**；
  4. 生成失败 → **静默降级 FTS-only**（对齐 D6 三处接线的失败语义：`console.warn` 一条、不抛、不重试）；
  5. JSON Schema 向后兼容：新参数可选，既有调用与既有用例零变化。
- **风险**：L3
- **验收**：vitest 断言传参 → 走混合召回（构造语义相近但关键词不重合的用例能召回）、不传参 → 逐字走 FTS-only、生成失败 → 降级不抛且有 warn；`memoryRead` 既有用例零改动全绿。

## 三、执行顺序

```
Gate D:  D1(二.3, S) ┐ 并行 → 五门禁（D2 涉迁移，加真库 smoke）→ Gate D
         D2(五.4, M) ┘
Gate E:  D3(六.1, L) → D4(六.2, M) → D5(六.3, M) → 五门禁 + 真库 smoke → Gate E
Gate F:  D6(三.3, L) → 五门禁 + 真库 smoke → Gate F
```

TDD 强度：**L / strict**（RED 实测 → 最小实现 GREEN → 改动行覆盖 ≥80% → checkpoint → 证据报告 `docs/testing/agent-memory/agent-memory-optimize-3.tdd.md`）。

## 四、不涉及范围

- ❌ 摘要层（`ai_conversations.summary`）与 `memory.md` 存储侧的过期 —— 不纳入 D2 遗忘范围。
- ❌ 改 `searchMode` 三模式降级语义、改 `embedding-architecture.md:122` 对应的**代码** —— 红线三，只改文档。
- ❌ 消费 `ai_embedding_config.search_mode` 字段（`embedding-architecture.md:77-81` 未实现的数据流）—— 与本批无关，记 TODO。
- ❌ `agent_run_events` 轨迹源（Q5 已否决）与 `cleanupOldEvents` 接线 —— 记 TODO。
- ❌ 第一批 P0、第二批 P1 已交付内容的返工。
- ❌ 模块一/二/四/七的其余条目（已交付或非本批）。

## 五、红线

1. 不减少历史轮次、不截断工具结果。
2. 铁律一仅约束**笔记内容写入**；记忆/经验写入不经逐条确认，但**必须有可见可删/可审核入口**（D3 草稿态 + D5 三态审核）。
3. 知识库拒答 0.6 / 置顶 ×1.5 / searchMode 三模式降级行为不变（**D6 只改文档不改代码**）。
4. 迁移可从空库执行、也能从上一版本升级；**历史迁移文件不得擅改**，不 DROP/DELETE/UPDATE（D2 补列走 `addColumnIfMissing`，D6 新表走 `IF NOT EXISTS`）。
5. `vitest.config.ts` 全程禁改（走 CLI `--coverage.include` + 临时 `--coverage.reportsDirectory`）。
6. 不提交密钥/`.env`；不删测试；不削弱认证权限；SQL 全参数化。
7. 参数取值须按 `CONTEXT_WINDOW = 64000` 实测调优，**不得直接照抄外部资料数值**。

## 六、已对齐问题清单

| # | 问题 | 结论 |
|---|------|------|
| Q1 | Gate 切分 | **三段**：Gate D（二.3 + 五.4 并行）→ Gate E（模块六串行）→ Gate F（三.3） |
| Q2 | 三.3 执行顺序 | **从方向文档的第二位挪到最后**（Gate F）—— 经验结构未定就建向量库会建错重来 |
| Q3 | 三.3 存储选型 | **独立表 `exp_*`**；否决同表（要改 4 条硬编码 SQL + 扩 `sourceType` + 污染笔记拒答 0.6/出处跳转，红线代价不可控） |
| Q4 | 六.1 提炼档位 | **半自动** —— LLM 只写草稿态，设置页人工确认后生效；天然并入 D5 人工审核防线 |
| Q5 | 六.1 轨迹源与技能共存 | 轨迹源 **`ai_messages`**（含 `tool_calls` 快照，新增按会话分页查询）；共存 = **新建 `userData/skills/_auto/` + 修复 3 处无参 `loadSkills()`**（不修则 `runSkill` 调不到，白做） |
| Q6 | 五.4 触发与加列 | 触发扩展到**启动 + C1 写入后**（复用既有轮询）；**授权 `addColumnIfMissing` 加 `access_count`/`last_read_at`**；容量上限按 active 条数 + `access_count` 升序关闭 |
| Q7 | 二.3 可查询落点 | 三步：`kbSearch.ts:740-764` 赋值 → `toolTypes.ts` 契约补 `diagnostics` + `searchKBHandler` 挂进 content → 补两条早退路径；**不建 metrics 表**，走 `ai_messages`/`agent_run_events` 既有 sink |
| Q8 | **实施期新增**：三.3 的「经验库」载体（Q3 的「新建 `exp_*`」隐含假设被推翻 —— D2 已建 `agent_memory` + D5 已建 `agent_memory_fts`，D3/D4 已把经验落成 skill 文件，再建表会重复且对接不明） | **A：给 `agent_memory` 加向量能力** —— `addColumnIfMissing` 加 `vector BLOB` + `embedding_model TEXT`（复用 `kb_chunks` 范式）+ FTS5/向量混合召回；**不新建表**；Q3 的实质「不与笔记同表」本就满足。未配置 embedding → 走 D5 已有的 trigram FTS5 |
| Q9 | **实施期追加授权**：D6 的向量混合通道在生产不可达（LLM 只传 `query` → 恒 FTS-only，无人生成查询向量） | **A：加 opt-in 参数**（对齐 `searchKB` 的 `hyde: true` 命名），工具内按需生成 `queryVector`，**不传则零成本且行为与 D6 逐字一致**，生成失败静默降级 FTS-only |

## 七、事实核验修正（方向文档有误处，以本表为准）

| 方向文档原述 | 核验结论（2026-09-30 实测） |
|---|---|
| 二.3「hadPronounRef 接入 diagnostics」像是新增 | **类型早已声明但从未赋值**（`kb.ts:133-137` 全仓仅 1 处命中），实为**补赋值 + 补通路** |
| 二.3 重点文档 `modules/11:87-101` 的接口名 | 文档写 `IKbSearchDiagnostics`，**代码是 `IKbDiagnostics`**（`kb.ts:147`），`IKbSearchDiagnostics` 无一处在 `.ts` |
| 三.3「复用现有 kb 基础设施」暗示可同表复用 | **4 条 SQL 表名全硬编码、无参数化通道**；`kb_chunks` 无 `user_id` 列（隔离靠 JOIN）；外发过滤 `allowSend=false` 会整批滤掉经验库结果且**不改 `refused`** |
| 三.3 依赖 `embedding` 降级 | A4 结论复核**仍成立、行号未位移**：vector 模式无向量 → 规范拒答不回退；仅默认 hybrid 降级 FTS5+标题 |
| `embedding-architecture.md:122`「任意模式都降级」 | **与实现冲突**（红线三 → 改文档不改代码）；`:77-81` 数据流**未实现**（`search_mode` 字段零消费） |
| 五.4「依赖三.2、五.2」暗示 Policy 已在跑 | **唯一生产调用点是后台提取成功路径**（`memoryWriter.ts:393`），失败/节流时本会话完全不跑；**无启动、无定时、C1 工具路径不跑** |
| 五.4 遗忘 = 时间衰减 | 现状**只有时间维度且表级零容量上限**；11 列无 `access_count`/`last_read_at`，LRU 式遗忘**不加列无法实现** |
| 六.1「项目已有 skills/ 与 skillLoader」暗示可用 | **三条链路全不通**：`loadSkills()` 3 处无参 → 用户技能主进程不可达；`sendRoutes.ts:85-90` 丢弃技能名；prompt 无技能段；`isSkillEnabled` 无人调用 |
| 六.1 轨迹来源「`agent_run_events` 含 chunk 噪声 / `ai_messages` 缺工具细节」 | **`ai_messages` 实际含完整 `tool_calls`**（`db/ai.ts:795` 事务写入）；两侧工具结果**都被 S6 截到 500 字**（`toolResultStorage.ts:33`）；两者都无「成功/失败」列（权威终态在 `agent_task_queue.status`） |
| 六.2「intentRouter 任务类型识别可复用」 | 可复用 6 值枚举与 `confidence`，但 **`chat` 是无规则 fallback**（`intentRouter.ts:112-119`）→ 无法区分闲聊/未知类型；**intent 不落库**（`agent_sessions.intent_json` 零写入点） |
| 六.2「存储结构保持流程顺序」可存进 `agent_memory` | **冲突**：`agent_memory` 无顺序列，分组键 `kind+subject` → 有序流程**会被 `mergeConflicts` 合并破坏**；`kind` 加第四值还需改 5 处硬编码 |
| 六.3「合并去重」有现成设施 | 仓内**无语义相似度设施**；`fingerprint` 是 sha256 精确相等，措辞不同即新事实 |
| 六.3「过期复核周期」有基础设施 | **周期基础设施为零**：全仓唯一 `setInterval` 是 1s 队列轮询，队列**按会话驱动**（`enqueue` 必须带 `conversationId`）→ 无全局复核入口 |
| 七.1 验收要有可查询数字 | diagnostics **当前不进工具 content、不落库**，唯一出口 `console.debug`（`kbSearch.ts:766`）—— 现有流向**不满足** |

# agent-memory-optimize-2 — 需求文档（第二批 / P1）

> 日期：2026-09-29 | 档位：**L**（含 L4 迁移子项）| 基于：`docs/requirements/agent-memory/agent-memory-optimize.req.md`（第一批）+ `优化方向.md` 第二批路线图 + 两轮只读代码核查（2026-09-29 重定位行号）
> 状态：**Q1~Q14 全部对齐（2026-09-29 用户裁定：全部按推荐）**

## 一、目标

第一批修完「会话内记忆」五条根因后，Agent 仍**只存会话摘要、不存用户画像，跨会话记不住用户**。第二批交付方向文档的 P1 主干，分三个子批、三个 Gate：

1. **子批 A（提示词/检索层）**：让已存在的 `soul/memory/style` 三文件真正注入 system prompt；摘要 prompt 保留指代先行词；`classifyIntent` 第一次真正影响检索主管线；补齐知识库红线的行为级护栏。
2. **子批 B（存储层）**：从零建记忆事实表（本项目 17 个 db 文件 / 23 处 `CREATE TABLE` 逐一穷举确认**无任何画像/实体/记忆表、无双时间字段**）+ 双时间 + Ledger/Views/Policy + 迁移双路径；分层 Prompt 把画像接进组装。
3. **子批 C（读写工具层）**：Agent 主动读写记忆的慢思考回路 + 后台异步写入与冲突清洗 + 用户可见可删的入口 + 七.1 完整三场景与七.2 门禁。

## 二、需求清单

### 子批 A（提示词/检索层，无 DB 变更，L3）

#### A1（方向 四.1）：`soul/memory/style` 三文件注入 system prompt

- **现状（核查 2026-09-29）**：文件层/IPC/设置页三段全通，**唯注入缺失**。`globalAgentFiles.ts`（132 行）：三文件定义 `L15-20`、memory 默认内容 `L41-51`、读写 `L86-103`、导出 `L106-132`；`getGlobalAgentFilesDir`（`L125-127`）注释写「供 agentLoop system prompt 注入」但**全仓零调用方 = 死导出**。全仓 grep `globalAgentFiles` 仅命中 `index.ts:12/45-46`（初始化）、`agentHandlers.ts:411-447`（三个 IPC）、`preload.ts:248-252`、`agentStore.ts:137-141`、`AgentPersonalityPanel.tsx`（UI）。
- **范围（Q2/Q3/Q4）**：
  1. **三者同批注入**（不只 memory）——落点相同、成本相同，只注 memory 会留下「改了性格/风格却不生效」的缺口；
  2. 落点 = `agentPromptBuilder.buildAgentSystemPrompt`（`L269-366`，扁平数组 `L282-365`）**新增可选参数** `memoryBlock?: string`，缺省空串（既有 37 个护栏用例不传参即不红），块位置紧跟 `L286-290`【核心规则】之后；
  3. **不采用** `agentContext.ts:580` 独立 `system` 消息方案——它会落在文档上下文（`L584-590` unshift）之后，有 lost-in-the-middle 风险，且 `agentContext.ts:515` 注释表明该模块信奉 Attention Anchoring；
  4. **token 硬上限 2000**（走 `src/main/ai/utils/tokenEstimator.ts:68` `estimateTokens`），超限截断并在块尾标注「(已截断，完整内容见设置页)」；设置页 `AgentPersonalityPanel.tsx:30-59` 的 `recommendedChars`（soul 2000 / style 2000 / memory 4000）**本批不改**。
- **风险**：L3（系统提示词语义）
- **验收**：vitest 断言三文件内容出现在 `buildAgentSystemPrompt` 输出中且位于【核心规则】之后；未传参时输出与改动前逐字一致；超 2000 token 触发截断标注；既有 `agentPromptBuilder.test.ts` 37 例全绿。

#### A2（方向 四.3）：摘要 prompt 保留关键事实与指代先行词

- **现状（核查修正方向文档）**：`summarizeViaLlm`（`contextManager.ts:196-200`）**两条路径措辞不同**——
  - 路径 A cache-safe fork（`L203-233`，生产主路径：`agentLoop.ts:272` 第三参 `ctx.tools` 恒为真）压缩指令是末尾 user 消息 `L209-212`：「请将以上对话压缩为不超过150字的中文摘要，只保留主题和关键结论。」**不含**「不要包含具体的问题和答案」；
  - 路径 B 回退模式（`L238-252`，`tools` 空时）system prompt `L246` **仍含**「1) 只保留讨论的主题和关键结论，不要包含具体的问题和答案」——方向文档 `:242` 所指的「指代失败放大器」**只存在于回退路径**。
- **范围（Q5）**：**只改措辞、两处同改**，加入「保留已讨论实体与指代先行词、用户已确认的决策、关键结论」；**不动** `getCompressThreshold`（`agentHelpers.ts:41-46`，0.85/0.65，**全 tests 零锁定**）、不动 `KEEP_RECENT_ROUNDS=3`、不动 `buildCompressed`（`contextManager.ts:129-143`）结构。
- **风险**：L3
- **验收**：两处 prompt 断言含先行词保留条款；`contextManager.test.ts:177-196` / `:223-237`（现锁两处措辞）按新措辞更新后全绿；压缩阈值与轮次常量 diff 为空。

#### A3（方向 二.4）：`queryPlanner.classifyIntent` 接入 searchKB 主管线

- **现状（核查）**：`queryPlanner.classifyIntent`（`L93-120`，返回 `QueryIntentType[]`：`fact/summary/comparison/procedure/follow_up` + 复合）当前**仅 2 处生产调用**——`searchKBHandler.ts:30`（在 `buildMinimalUnderstanding` 内，**只在 `refused||空结果` 失败旁路才跑**）与 `queryPlanner.ts:501`（`understandQuery` → `planQuery` → 只服务 `researchSearchHandler.ts:12`）。**它从未参与主检索路径**。
- **与 `intentRouter.classifyIntent`（`L75-155`）的关系**：同名、不同文件、不同签名、不同返回（`IIntent{intent,confidence,...}` 6 类路由意图 vs `QueryIntentType[]` 5 类检索意图）、**零 import 关系、无优先级机制**。
- **范围（Q12）**：
  1. 接入点 = `searchKBHandler.ts:70`（代词改写）与 `:88`（`ctx.searchKb` 主管线调用）之间；
  2. `classifyIntent(effectiveQuery, ctx.history)` 的输出**只驱动查询扩展策略**（`comparison` → 双实体扩展、`follow_up` → 保留历史实体、`procedure` → 步骤词加权），产出进 `expandedQueries`；
  3. **不碰 `searchMode`**（`searchKBHandler.ts:64-66` LLM 入参决定）—— 红线「三模式降级行为不变」；不合并两套分类器，req 附分工表；
  4. 不改 `intentRouter`（第一批 P0-3 已交付其 `ctx.hasHistory`）。
- **风险**：L3（检索语义）
- **验收**：vitest 断言 `comparison`/`follow_up` 意图下 `ctx.searchKb` 收到的 `expandedQueries` 含对应扩展、`searchMode` 与改前逐值相等；`searchKBHandler.test.ts` 既有 3 个 describe（P0-6 代词改写 + 双路召回）全绿。

#### A4（方向 七.3 + Q14）：知识库红线行为级护栏补测

- **现状（核查）**：三条红线中两条**行为无测试**——
  - 置顶 ×1.5：`kbSearch.ts:173-175` `score *= opts.pinnedWeight ?? 1.5` **全 tests 零命中 `applyWeighting`**，`kbSearch.test.ts` 所有 `fakeRows.pinned` 均为 0（`L227/249/392/415`）；只有 `kb-settings-default.test.ts:14/29` 锁了配置默认值 1.5；
  - searchMode 三模式：全 `tests/` 中 `searchKB()` 只以 `'hybrid'` 调过（`kbSearch.test.ts:315/327`），**`fts5`（`kbSearch.ts:508-532`）与 `vector`（`:541-551`）分支判定、以及降级语义零测试**；`searchCache.test.ts:56-101` 只锁了缓存键不同；
  - 0.6 拒答：`kb-settings-default.test.ts:13` 硬锁配置 + `kbSearch.test.ts:218-239` 行为锁，但 `kbSearch.ts:452` 的 `?? 0.6` 默认值本身无直接断言。
- **范围**：**只动 `tests/`**（L2）——补 pinned=1 端到端 ×1.5 断言、`searchMode:'fts5'`/`'vector'` 分支断言、未传 `threshold` 时返回体 `threshold===0.6` 断言。**不改 `src/`**。
- **风险**：L1
- **验收**：新用例先红后绿（对 `src` 造变异应变红）；`src/` diff 为空。
- **（2026-09-29 实施期修正）降级语义实际情况与本条初稿所据文档不符**：`searchMode:'vector'` 但**不传 `queryVector`** 时，`kbSearch.ts:508` 的 FTS5 分支条件只认 `fts5|hybrid` → 候选为空 → `kbSearch.ts:683` 直接返回规范拒答空响应，**并不回退 FTS5/标题**。「降级 FTS5+标题」只在**默认 hybrid 路径**成立（`docs/architecture/knowledge.md:63-65` 亦只称「默认调用」降级）。故 `vector` 无向量用例**按实际行为锁定为拒答**，不按文档说法锁成回退；`kbSearch.ts:443` JSDoc「无 queryVector 时降级到纯 FTS5 + 标题匹配」对 `vector` 模式不成立，属文档漂移（记入已知问题，本批不改 `src/`）。

### 子批 B（存储层，L4 迁移）

#### B1（方向 三.1 + Q6）：单表 `agent_memory` + 双时间

- **选型（Q6=B）**：**不建三张表**，建**一张事实表** `agent_memory`，`kind` 分区承载画像/事实/实体三类；摘要层**继续复用** `ai_conversations.summary`（DAO `ai.ts:538-548 updateConversationSummary`，唯一消费点 `agentLoop.ts:274`）。
  - 否决 A（三表）理由：DAO/迁移/测试三处各写三遍同构代码，L4 迁移风险翻三倍；B 同样满足三.2 的 Ledger/Views/Policy（Views 即对该表的物化聚合）。
- **双时间落法**：`valid_from` / `valid_to`（业务有效时间，NULL = 当前有效）+ `written_at`（系统写入时间）。**不得复用 `created_at`**——核查确认 `ai_messages.created_at` 存在 `datetime('now')` 秒级默认与 `toISOString()` 毫秒双格式并存（`ai.ts:863/811` vs `index.ts:188-199` DDL 默认），字典序跨格式不可靠。
- **表结构（2026-09-29 总指挥裁定，B3 照此建表，实施期冻结）**：
  ```sql
  CREATE TABLE IF NOT EXISTS agent_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,            -- 'profile' | 'fact' | 'entity'
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto',   -- 'auto'(Agent 写) | 'manual'(用户手写)
    conversation_id TEXT,
    fingerprint TEXT NOT NULL,     -- content 归一化 hash，B2 语义去重依据
    valid_from TEXT NOT NULL DEFAULT (datetime('now')),
    valid_to TEXT,                 -- NULL = 当前有效；置值 = Ledger 关闭（不删行）
    written_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- + 3 个索引：(user_id,kind,valid_to) / (user_id,subject) / (user_id,fingerprint)
  ```
  不加 `created_at`、不建 FTS 虚拟表、不建 SQL VIEW（B2 Views 走 DAO 查询函数）、不预留未使用的 JSON 列（`addColumnIfMissing` 范式可在后续批次幂等补列）。
- **删除语义**：自动冲突清洗/时间驱逐 = 置 `valid_to` 关闭（Ledger 不删行）；**C3 用户在设置页显式单条删除 = 物理 `DELETE`**（用户意图优先，且「删除后新会话不再注入」要求确定性）。
- **风险**：**L4**（新表 + 迁移）
- **验收**：见 B3 双路径三条断言。

#### B2（方向 三.2）：Ledger / Views / Policy

- **Ledger** = `agent_memory` 只追加（更新走「旧行置 `valid_to` + 插新行」，**不 UPDATE 事实内容、不 DELETE**）；
- **Views** = 查询函数（DAO 层）：当前有效画像、近 N 天实体、活跃话题聚合；
- **Policy** = 驱逐/合并：时间衰减关闭（置 `valid_to`）、语义重复合并、`memory.md` 手写值豁免驱逐。
- **风险**：L3（读写路径）

#### B3（方向 三.4）：迁移双路径（**按本项目既有范式，不建迁移目录**）

- **核查结论**：本项目**没有迁移文件目录**，全部 DDL/迁移内联在 `src/main/db/index.ts`（715 行）`runMigrations`（`L117-291`），靠 `IF NOT EXISTS` + `addColumnIfMissing`（`L329-334`）+ `export` 函数收敛。方向文档若指「迁移文件目录」，与本项目机制不符——**按既有范式做**。
- **范围**：
  1. `index.ts` 追加私有 `addAgentMemoryTables(database)`（**必须 `export`**，供测试），在 `runMigrations` 内调用；**不改任何既有迁移函数、不 DROP、不 DELETE、不 UPDATE**；
  2. `tests/main/db/migrations.test.ts` 加一个 describe，三态断言（态1 空库首建 / 态2 旧库升级断言 `execs.every(/^CREATE TABLE|^ALTER TABLE/)` 且无 `DROP|DELETE|UPDATE` / 态3 重复执行零 DDL）；
  3. `scripts/agent-memory-migration-smoke.cjs`（**抄 `scripts/attachments-migration-smoke.cjs` 的「运行时从 `src/main/db/index.ts` 源码正则抽取 DDL」防漂移写法**，优于 `kb-migration-smoke.cjs` 的硬编码），四态：新库 / 既有库插数据 / 重复执行 / 真实读写闭环。
- **风险**：**L4**
- **验收**：空库 ✓、上一版本升级 ✓、重复执行 ✓ 三条路径实测记录；`git diff -- src/main/db/index.ts` 仅新增函数与一处调用，既有迁移零改动行。

#### B4（方向 四.2）：分层 Prompt 组装

- **现状**：最终 `llmMessages` 组装在 `agentContext.ts:503-598`，顺序为 `[文档上下文] → [主提示] → [历史摘要] → [历史 N 轮] → [分隔标记] → [当前 user] → [强调指令]`（`L580`/`L588` 两处 unshift）。
- **范围**：在主提示（A1 注入点同函数）内引入画像层 = 从 B1 Views 读出的当前有效画像，**未就绪时降级占位（空串，行为与 A1 未配置时一致）**；给出五层结构树与各层实测 token 占比（走 `estimateTokens`）。
- **风险**：L3
- **验收**：vitest 断言五层齐备顺序正确、画像层为空时无占位噪音；64000 窗口预算内（附实测占比表）。

### 子批 C（读写工具层）

#### C1（方向 五.1 + Q7/Q8）：`memory_read` / `memory_write` 两工具

- **范围**：
  1. **两工具**（`memory_read` 查询、`memory_write` 带 upsert 语义覆盖 update），`defer_loading: true`；
  2. 投放进 `agentToolSelector.ts:75-90` **基础区无条件给**（与 chat 现基线一致——核查确认 chat 实拿 15~18 个工具，方向文档「只剩 ask_question_card」不成立）；
  3. **`agentToolPolicy` 本批不接线**（Q8）——规则照常声明，上限在 handler 内自限（单轮写入去重 + 硬编码单轮上限）；「policy 声明未接线」记入 TODO 已知问题；
  4. **不进 `FORCE_CONFIRM_TOOLS`**（那是铁律一笔记写入确认，记忆写入不属其约束对象）。
- **新增工具成本清单（核查实测，必改 8 文件）**：`tools/memoryRead.ts`/`tools/memoryWrite.ts`（新建）、`toolRegistry.ts`（import + `handlerMap L62-92` + `CORE_TOOLS L99-388`）、`agentToolSelector.ts`、`concurrencyDefs.ts`（**不加则 fail-closed 串行**）、`agentPromptBuilder.ts`（工具规则段 `L321-329`）、`tests/main/ai/toolRegistry.test.ts`（**`L36/L38` 的 28 名字数组断言必炸**）、`tests/main/ai/deferredToolLoading.test.ts`（**`L57/61/68` 的 28/5/23 计数必炸**）、`tests/main/ai/concurrencyDefs.test.ts`。
  - 文档硬编码计数必须同步：`docs/architecture/ai-agent.md:12/109-152/96-103`、`docs/architecture/backend.md:59/93`、`docs/modules/11-AI代理面板-Agent.md:21/50/114-129`。
- **风险**：L3
- **验收**：Agent 一次多轮任务中主动存入并读回一条跨会话事实；参数预校验无 `any`；28→30 计数断言与文档同步。

#### C2（方向 五.2 + Q9/Q10）：后台异步写入 + 冲突清洗

- **现状（核查）**：`agentTaskWorker.ts` 轮询式后台 worker，`poll()` `L180-193` 用 `void processTask()` fire-and-forget 不阻塞主循环，会话内串行由队列保证（`agentTaskQueue.ts:51-53 dequeueNext`）；**全仓 grep `retry|attempt|timeout` 零命中 = 无重试、无任务级超时**（唯一超时是单工具 30s，`agentHelpers.ts:17`）。
- **范围（Q9/Q10）**：
  1. 复用 `AgentTaskQueue`（**不新建第二套队列**），失败落 `failed` 不重试——与现状一致，**不新建重试机制**；
  2. 触发时机 = `AI_STREAM_DONE` 事件后入队；
  3. 冲突清洗：**时间新者赢 + `memory.md` 手写值恒赢**；旧事实置 `valid_to` 关闭（配合 B2 Ledger 不删行）；
  4. 失败静默重试无（按 Q9），但**必须有日志且不阻塞用户下一轮提问**。
- **风险**：L3
- **验收**：vitest 断言后台写入不阻塞主循环、失败落 `failed` 且有日志、制造「用户搬家」式矛盾两次写入后保留正确版本（旧版 `valid_to` 非空）。

#### C3（方向 五.3 + Q11）：记忆可见性入口

- **范围**：设置页 `AgentPersonalityPanel.tsx` 的 `SegmentedTabs` 下加「自动记忆」一栏——**只读列表 + 单条删除**；复用现有三 tab 结构，**不做 AI 面板新视图、不做无关 UI 重构**。
- **边界（方向文档 已问）**：记忆自动后台写入**不逐条弹确认**（记忆≠笔记写入，铁律一仅约束笔记）；但必须有可见入口。
- **红线**：`toolRegistry.test.ts:70/194` 的铁律一 proposal 语义、`RewritePreviewCard.test.tsx:93`、`rewriteStore.test.ts:276/349/357/380` 全绿。
- **风险**：L3（新增 IPC + 渲染状态）
- **验收**：用户能查看自动写入的记忆并单条删除，删除后新会话不再注入；铁律一相关测试零改动全绿。

#### C4（方向 七.1 完整 + 七.2）：指代三场景 E2E + 全量门禁

- **范围**：
  1. 补场景③「压缩触发后指代仍成立」（第一批只交了①②）——触发方式用**注入大历史**而非调低阈值（阈值无测试锁定，调它会污染 A2 的「不动阈值」约束）；
  2. 七.2 全量门禁五件套 + 证据留存 ``（已归档，见 git 历史）；
  3. 七.3 已由 A4 承接（压缩/记忆单测与红线护栏合并交付）。
- **风险**：L2

## 三、执行顺序

**子批 A**：A4（纯测试，可并行）→ A1 → A2 → A3 → **Gate A（五门禁全量）**
**子批 B**：B3（迁移 + 双路径测试）→ B1 → B2 → B4 → **Gate B**
**子批 C**：C1 → C2 → C3 → C4 → **Gate C（全量门禁 + E2E）**

TDD 强度：**L / strict**（RED 实测 → 最小实现 GREEN → 重构 → 改动行覆盖 ≥80% → checkpoint → 证据报告 `agent-memory-optimize-2.tdd.md`）。

## 四、不涉及范围

- ❌ 模块六（经验沉淀 Skill）、方向 二.3、三.3、五.4 —— P2，第三批。
- ❌ `replayEvents` 的 `sessionId`/`conversationId` 口径 bug（`agentStore.ts:1629` 把会话 id 传进形参 `sessionId` → `WHERE session_id=会话id` 恒空，链路零测试）—— **Q13 裁定本批不修**，记忆轨迹改从 `ai_messages`/`agent_run_events` 直读，不复用 `replayFromSeq`；记入 TODO。
- ❌ `agentToolPolicy` 接线 —— **Q8 裁定本批不做**，避免 `searchKB≤10`/`web_search≤5` 历史空限制突然生效；记入 TODO。
- ❌ `KEEP_RECENT_ROUNDS`（=3）与 `getCompressThreshold`（0.85/0.65）调值 —— 前者被 `agentContext.test.ts:633/663` 硬锁，后者零测试锁定但与红线强耦合，无实测数据不动。
- ❌ `docs/architecture/ai-agent.md:98`「chat 无工具」与代码（15~18 个）不符 —— 属文档漂移，随 C1 同步时一并更正（C1 必改该文档）。
- ❌ 数据库 DDL 迁移之外的既有迁移改动、`created_at` 双格式修复。

## 五、红线

1. 不减少历史轮次、不截断工具结果（`agent-perf-optimize.req.md:11-17`（已归档，见 git 历史）；守护 `agentContext.test.ts:633/642/663`）。
2. 铁律一仅约束**笔记内容写入**；记忆写入不经逐条确认，但需可见可删入口（C3）。
3. 知识库拒答 0.6 / 置顶 ×1.5 / searchMode 三模式降级行为不变（本批 A4 补行为级护栏，不改 `src/` 行为）。
4. 迁移可从空库执行、也能从上一版本升级；**历史迁移文件不得擅改**，不 DROP/DELETE/UPDATE。
5. `vitest.config.ts` 全程禁改（第一批 Q18 口径：走 CLI `--coverage.include` + 临时 `--coverage.reportsDirectory`）。
6. 不提交密钥/`.env`；不删测试；不削弱认证权限；SQL 全参数化。

## 六、已对齐问题清单

| # | 问题 | 结论 |
|---|------|------|
| Q1 | 批次切分 | **三 Gate**：A 提示词/检索层（无 DB）→ B 存储层（L4 迁移单独 Gate）→ C 工具层 |
| Q2 | 四.1 注入范围 | **三文件同批**（落点相同、只注 memory 会留「改了性格不生效」缺口） |
| Q3 | 注入位置 | **并入 `buildAgentSystemPrompt`，加可选参数 `memoryBlock` 缺省空串**；否决 `agentContext:580` 独立 system 消息（lost-in-the-middle + Attention Anchoring） |
| Q4 | 超长截断 | **硬上限 2000 token**（`estimateTokens`），截断加标注；设置页 `recommendedChars` 不改 |
| Q5 | 四.3 范围 | **只改 prompt 措辞且两处同改**（`:211` 主路径 + `:246` 回退）；阈值/轮次不动（无实测数据 + 零测试锁定 = 盲调） |
| Q6 | 三.1 表选型 | **B 单表 `agent_memory`**（`kind` 分区 + `valid_from`/`valid_to`/`written_at`）+ 摘要复用 `ai_conversations.summary`；否决三表（DAO/迁移/测试三遍同构，L4 风险 ×3） |
| Q7 | 工具集与投放 | **两工具**（read + write/upsert），`defer_loading`，进 `agentToolSelector` 基础区无条件给 |
| Q8 | 调用上限落地 | **不接线 policy**（避免历史空限制突然生效），handler 内自限；policy 声明照写，记 TODO |
| Q9 | 后台写入范式 | **复用 `AgentTaskQueue`**，失败落 `failed` 不重试、**不新建重试机制** |
| Q10 | 冲突清洗 | **时间新者赢 + `memory.md` 手写恒赢**；旧事实置 `valid_to` 关闭，不物理删除 |
| Q11 | 可见性入口 | **设置页 `AgentPersonalityPanel` segmented 下加「自动记忆」栏**（只读列表 + 单条删除）；不做 AI 面板新视图 |
| Q12 | 二.4 接入范围 | **只驱动查询扩展策略、不碰 `searchMode`**；两套分类器不合并，附分工表；接入点 `searchKBHandler.ts:70~88` |
| Q13 | `replayEvents` 口径 bug | **本批不修**（L3 且与记忆无依赖），轨迹改直读 `ai_messages`/`agent_run_events`；记 TODO |
| Q14 | 红线测试缺口 | **补**（只动 `tests/`，L2）：置顶 ×1.5 行为、`fts5`/`vector` 分支与降级语义、未传 threshold 默认值 |
| Q15 | **实施期新增**：A1 落地后发现 `CHAT_SYSTEM_PROMPT` 是常量非函数 → chat 意图拿不到三文件注入，而 `intentRouter` 零命中即回落 chat（简单提问多走 chat），memory.md 在高频路径不生效，掏空四.1 验收「新会话首答即体现且跨会话生效」 | **改成函数，chat 也注入**：`CHAT_SYSTEM_PROMPT` 改为可接收 `globalFilesBlock` 的函数（原字符串逐字保留），`agentContext` 三元两分支共用 `readGlobalAgentFilesBlock()`；锁定常量的 4 条护栏断言按「改引用方式、内容不变」口径等价迁移，不删不削弱 |

## 七、事实核验修正（方向文档有误处，以本表为准）

| 方向文档原述 | 核验结论（2026-09-29 实测） |
|---|---|
| 问题 3 前提「chat 意图工具集收缩到只剩 `ask_question_card`」 | **不成立**。`agentToolSelector.ts:75-90` 无条件基础区 15 个在 switch 之前，chat 分支只额外加 `ask_question_card` 后 return；实拿 15~18 个 |
| `docs/architecture/ai-agent.md:98`「chat 无工具」 | 与代码不符（同上），随 C1 同步更正 |
| 四.3 `:242`「现 prompt 明令不要包含具体问题答案是指代失败放大器」 | **只在回退模式** `contextManager.ts:246`；生产主路径走 `:211` 短指令（`agentLoop.ts:272` 第三参恒真）。故必须两处同改 |
| 三.4「迁移文件」/迁移目录 | **本项目无迁移目录**，全部内联 `src/main/db/index.ts:117-291` + `export` 函数 + `migrations.test.ts` 三态断言 + `scripts/*-smoke.cjs` 真库脚本 |
| 「已有记忆表可扩展」 | **完全空白**：17 个 db 文件、23 处 `CREATE TABLE`、`memory/profile/entity/persona/preference` 与双时间字段全部零命中 → 从零建 |
| 二.1 `searchKBHandler.ts:25` 不传历史 | **第一批 P0-6 已修**：当前 `L29 detectAmbiguities(query, history)`、`L70 resolveReferencesDetailed`、`L88-94` 双路召回 |
| `queryPlanner.ts:510` classifyIntent 调用点 | 漂移 → **`L501`** |
| `agentToolExecutor.ts:103-113` 参数预校验 | **失效**（落在 `deduplicateAskQuestionCards`）；真预校验 = **`L145-155`**，确认流程 = **`L161-236`** |
| `agentToolPolicy:37-38` 上限生效 | **声明但全仓无生产调用方**，`maxCalls` 目前是空的（Q8 处置） |
| 五.2「`session_id` vs `conversationId` 口径疑似不一致，实施时先验证」 | **属实**：`agentStore.ts:1629` 传 `activeConversationId` 给形参 `sessionId` 的 `replayEvents`，SQL `WHERE session_id=会话id` 恒空；DAO 全部 `WHERE session_id=?`（`agentEventDao.ts:75/92/107/119`）；链路零测试（Q13 处置） |
| `api` 层红线「三不变」字面 | 全仓 grep「三不变」零命中 —— 属方向文档自造提法，实指「拒答 0.6 / 置顶 ×1.5 / searchMode 三模式」三项 |

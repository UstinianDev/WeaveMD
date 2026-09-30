# 模块一 / 模块二 / 模块三

> 拆分自 [agent-memory-optimize.direction.md](../agent-memory-optimize.direction.md)，原 §一 Agent 上下文与意图路由、§二 RAG 与查询理解、§三 记忆存储与数据层；2026-10-01 按渐进式披露拆分，正文未改动。
> 返回索引：[agent-memory-optimize.direction.md](../agent-memory-optimize.direction.md)

---

## 一、Agent 上下文与意图路由模块

> 本模块为 P0 根因区，全部任务优先实施。

### 1.【P0】修复 chat 意图整段丢弃对话历史（依赖：无）

**重点文档**：`docs/architecture/ai-agent.md:76-82`（保留最近 3 轮设计）、`docs/requirements/agent-perf-optimize.req.md:11-17`（不减历史轮次红线）、`docs/architecture/backend.md:122-131`（上下文组装流程）

**重点代码**：`src/main/ai/agent/agentContext.ts:417-420`（isChat 时 history 换成仅当前消息）、`src/main/ai/intentRouter.ts:109-117`（零命中回落 chat）

**执行前拷问**：
❓ 原注释称丢历史是"避免历史错误答案污染"，改为保留近 N 轮后，此风险靠什么消除（摘要过滤？只保留最近 N 轮原文？）
❓ 保留历史后与 chat 提示词"独立新问题"设定冲突，是否需同步修改 `src/main/ai/agent/agentPromptBuilder.ts:369-379`？
❓ 保留几轮？与任务 一.5 的历史窗口取值如何保持一致？

**验收拷问**：
❓ 复现实测：RAG 问答后追问「它有什么优势」，chat 意图下回答是否引用到先行词且不弹卡？
❓ `npm run test` + `npx playwright test` 是否全绿、历史轮次未被削减？

### 2.【P0】移除/改写「忽略之前所有对话」的 system 注入（依赖：无）

**重点文档**：`docs/architecture/ai-agent.md:84-90`（prompt 构建职责）、`docs/modules/11-AI代理面板-Agent.md:57,78-83`（压缩与上下文）

**重点代码**：`src/main/ai/agent/agentContext.ts:440-451`（尤其 447-450 的忽略指令）、`src/main/ai/agent/agentPromptBuilder.ts:286-290`（核心规则"每条消息都是独立新指令"）与 `:372-376`（CHAT_SYSTEM_PROMPT 忽略历史）、`src/main/ai/contextManager.ts:132-137`（摘要注入"不要延续之前的问题回答"）

**执行前拷问**：
❓ 该注入当初是为解决哪个历史 bug（防污染/防串题）？改成什么措辞既能保留防污染效果、又允许合法指代（如「它」指上一轮主题）？
❓ 摘要段 `contextManager.ts:135` 与提示词 `agentPromptBuilder.ts:286-290` 的"去上下文化"措辞是否需要同批改？边界到哪里（哪些场景仍要"独立问题"）？

**验收拷问**：
❓ 全仓 grep「忽略之前的所有对话」类措辞是否已无残留指向多轮场景？
❓ 指代追问场景（七.1 场景①）是否通过，同时单轮独立问题场景无回归？

### 3.【P0】修复短文本误判 needsClarification 导致的反问弹卡（依赖：无）

**重点文档**：`docs/modules/11-AI代理面板-Agent.md:323-334`（置信度<0.7/文本<6 字符触发澄清）、`docs/REQUIREMENTS.md:115`（AGT-15 模糊输入弹卡）

**重点代码**：`src/main/ai/intentRouter.ts:140-141`（`text.length < 10` 判定）、`:109-117`（chat 兜底）、`src/main/ai/agent/agentContext.ts:471-478`（needsClarification 改用 Agent 提示词）、`src/main/ai/agent/agentToolSelector.ts:100-107`（chat 意图只剩 `ask_question_card`）、`src/main/ai/agent/agentPromptBuilder.ts:275-280`（"不确定就用卡片提问"前缀）

**执行前拷问**：
❓ 短文本规则本意是防无意义输入，「它有什么优势」恰是合法短追问——判别标准改成什么（指代词命中？上一轮存在 assistant 回答？）
❓ 判为"带上下文的追问"后，意图应路由到哪类（chat 保留？kbQa？），与 一.1 的历史保留如何联动？

**验收拷问**：
❓ 合法短追问（<10 字、含指代）不再触发 `ask_question_card`，而真正的无意义输入（<6 字符）仍能触发澄清？
❓ `npm run lint` 下规则改动无 any/硬编码告警？

### 4.【P0】assistant.tool_calls 落库 + 孤儿 tool 消息修复（依赖：无）

**重点文档**：`docs/architecture/database.md:45-82`（ai_messages 表结构）、`docs/modules/11-AI代理面板-Agent.md:140-151`（DDL）、`docs/architecture/ai-agent.md:63-73`（工具结果回填流程）

**重点代码**：`src/main/ai/agent/agentToolExecutor.ts:77-90`（tool_calls 仅内存组装）与 `:498-506`（仅落 tool 行）、`src/main/db/ai.ts:631-654`（`appendMessage` 的 `toolCalls` 形参无调用方）、回读 `src/main/ai/agent/agentContext.ts:360-366`（丢弃 toolCalls 不重建）、协议层 `src/main/ai/llm/anthropicClient.ts:221-234`、`src/main/ai/llm/anthropicCompat.ts:89-103`（tool 角色静默丢弃）

**执行前拷问**：
❓ 修复方案选哪种：A. 落库 assistant.tool_calls 并回读重建；B. 回读时为孤儿 tool 行合成占位 assistant？两者对历史 token 与 provider 兼容性的影响？
❓ anthropicClient 协议层丢 tool 的行为是否要同步修（Agent 主循环虽恒走 OpenAI 客户端，但摘要/HyDE 走 Anthropic）？
❓ 数据库变更是否需要迁移？如何保证"空库执行 + 从上一版本升级"双路径？

**验收拷问**：
❓ 跨轮历史中是否还存在无前置 assistant 的 tool 行？provider 是否报 400？
❓ 含多工具调用的会话连续追问，searchKB 结果在下一轮仍可被 LLM 引用？

### 5.【P0】历史窗口评估（20 条 / 3 轮对指代场景是否足够）（依赖：一.1、一.4）

**重点文档**：`docs/architecture/ai-agent.md:76-82`、`docs/REQUIREMENTS.md:116`（达阈值自动压缩）、`docs/requirements/agent-perf-optimize.req.md:11-17`

**重点代码**：`src/main/ai/agent/agentContext.ts:359`（硬编码读 20 条）与 `:360-366`、`src/main/db/ai.ts:728-744`（分页 SQL）、`src/main/ai/agent/agentHelpers.ts:13-14`（`CONTEXT_WINDOW=64000`、`KEEP_RECENT_ROUNDS=3`）、`src/main/ai/contextManager.ts:109-170`（压缩触发与轮次切分）、`src/main/ai/agent/agentLoop.ts:269-285`（压缩调用点）

**执行前拷问**：
❓ 20 条读取上限 + 保留 3 轮，在"一轮含多条 tool 消息"的 RAG 会话里实际覆盖几轮对话？指代窗口够不够？
❓ 若调大窗口，与压缩阈值（0.85/0.65 动态阈值，`agentHelpers.ts:44-46`）如何联动不超窗？
❓ 参考阈值（`多轮对话记忆设计.txt:4-7`：20 条/8000 token 触发摘要、每 4 条/1200 token 增量、6500 token 紧凑、50000 硬截断）与项目现状冲突，采纳哪些？**所有数值需按 64000 窗口实测调优**。

**验收拷问**：
❓ 压缩触发后，七.1 场景③（压缩后指代）是否仍成立？
❓ 压缩前后 token 估算与耗时是否有观测数据支撑调参结论？

---

## 二、RAG 与查询理解模块

### 1.【P0】代词消解接入对话历史（resolveReferences/detectAmbiguities 传入历史）（依赖：无）

**重点文档**：`docs/architecture/knowledge.md:40-49`（queryPlanner 查询理解）、`docs/REQUIREMENTS.md:161`（KB-10 指代消解需求）、`docs/modules/11-AI代理面板-Agent.md:87-101`

**重点代码**：`src/main/ai/tools/searchKBHandler.ts:25`（调 `detectAmbiguities(query)` 不传历史）、`src/main/ai/knowledge/queryPlanner.ts:212`（`PRONOUN_RE` 以「它」开头）、`:225`（空历史直接原样返回）、`:432-434`（有代词无历史必判 `pronoun_reference`）、另一调用点 `:510`

**执行前拷问**：
❓ 历史从哪一层取（agentContext 已组装的 messages？DB 最近 N 轮？），如何保证 searchKBHandler 拿到的是**同一份**历史且不含被压缩丢弃的部分？
❓ 消解成功后，是否要回写"代词→实体"映射供后续轮次复用？写到哪（见 模块三）？

**验收拷问**：
❓ 「它有什么优势」经 searchKB 时，代词是否被替换为上一轮实体再检索，且不再命中 `pronoun_reference` 误判？
❓ 无历史的全新会话中纯代词提问，行为仍与现在一致（正确反问）？

### 2.【P0】clarificationContext 指代防误报（有历史就不要生成"它指什么"卡）（依赖：二.1）

**重点文档**：`docs/modules/11-AI代理面板-Agent.md:296-310`（分轮澄清与 pronoun_reference 类型，表 `:303`）、`docs/requirements/archive/agent-ux-optimize.req.md:74-86`（分轮需求）

**重点代码**：`src/main/ai/knowledge/knowledgeClarify.ts:17-22`（「你提到的『X』具体指的是什么？」模板）与 `:168-169`（指示调 `ask_question_card`）、`src/main/ai/tools/searchKBHandler.ts:87-120`（refused/空结果时注入澄清，`94-106` 拒答结构、`113-120` clarificationContext）

**执行前拷问**：
❓ 判别条件改成什么（历史中存在可解析先行词 → 不生成澄清；检索仍 refused → 走原有拒答文案）？两层逻辑如何不互相覆盖？
❓ 与 `kbSearch.ts:736` 拒答阈值的联动：代词已消解但检索仍低分时，给"换词重检索"还是"反问"？

**验收拷问**：
❓ RAG 后追问指代句：不再出现「你提到的『它』具体指的是什么」卡片，回答能落到上一轮主题的笔记内容？
❓ 真正歧义（多实体候选、无历史）时卡片仍正常出现（防矫枉过正）？

### 3.【P2】hadPronounRef 指代触发率统计接入 diagnostics（依赖：二.1、二.2）

**重点文档**：`docs/modules/11-AI代理面板-Agent.md:87-101`（diagnostics 字段：耗时/候选数/intentType/hadPronounRef/研究循环）、`docs/requirements/agent-md-kb-optimize.req.md:34-45`（指代消解触发率统计需求）

**重点代码**：`src/main/ai/knowledge/queryPlanner.ts`（指代判定输出点）、`src/main/ai/tools/searchKBHandler.ts:87-120`（澄清分支）

**执行前拷问**：
❓ 统计口径：消解成功率 vs 澄清触发率分别怎么定义？落在哪（diagnostics 字段 / 日志表）？
❓ 数据如何被七.1 验收引用（有可查询的数字，而非肉眼观察）？

**验收拷问**：
❓ 指标可在 diagnostics 中查到，且修复前后有对比数据？

### 4.【P1】classifyIntent 接入 searchKB 主管线（依赖：无）

**重点文档**：`docs/TODO.md:175,191`（已知问题：未接入主管线）、`docs/requirements/agent-perf-optimize.req.md:63-69`（来源）、`:39-46`（S12 查询理解增强仅低优先级规划）、`docs/TODO.md:67-70`

**重点代码**：`src/main/ai/knowledge/queryPlanner.ts`（classifyIntent 定义与调用 `:510`）、`src/main/ai/tools/searchKBHandler.ts`（主管线入口）、`src/main/ai/knowledge/kbSearch.ts:445-783`

**执行前拷问**：
❓ 接入后与 `intentRouter.ts:17-67` 的关键词规则如何分工（谁优先、冲突怎么办）？
❓ 接入范围：只影响检索查询改写，还是也影响意图路由？边界在哪避免牵连模块一？

**验收拷问**：
❓ `docs/TODO.md:175,191` 两条已知问题可标记关闭的证据是什么？
❓ FTS5/vector/hybrid 三模式检索质量无回归（拒答率、命中率对比）？

---

## 三、记忆存储与数据层模块

> 本模块为复杂任务，均带外部检索 ①②③。

### 1.【P1】画像 / 摘要 / 实体三类记忆表设计 + 双时间字段（依赖：一.4）

**重点文档**：`docs/architecture/database.md:45-82`（现有 ai_conversations/ai_messages/agent_run_events 表）、`docs/modules/11-AI代理面板-Agent.md:140-151`（DDL 口径）、`docs/architecture/database.md`（DAO 规范）、`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:3`（会话元数据/结构化用户画像/对话摘要滑动窗口/向量经验库）、`C:\Users\lenovo\Desktop\多轮对话记忆设计.txt:8`（实体画像卡片）

**重点代码**：`src/main/db/index.ts:182`（建表位置）、`src/main/db/ai.ts:538-546`（summary 写）与 `:483-493`（读）

**执行前拷问**：
❓ 双时间（Valid Time 现实有效期 / Transaction Time 系统写入时间，`生产级Agent Memory.txt:6-8`）在表结构里怎么落（两列？追加日志表？），"用户搬家"类状态覆写场景如何查询？
❓ 三类表与现有 `ai_conversations.summary` 是替代还是共存？旧数据如何迁移（空库 + 升级双路径）？
❓ 画像表的字段结构化到什么粒度（JSON 自由结构 vs 固定列）？

**验收拷问**：
❓ 从空库执行迁移、从上一版本升级，两条路径都成功？
❓ 双时间查询能正确还原"某时刻用户的真实画像版本"？

**外部检索**：
① Docs MCP Server 查询 `langchain` 库索引：LangGraph checkpoint / state schema 跨会话持久化最新文档；再查 `letta` 库索引：Core Memory / Archival Memory / Memory Blocks 存储模型
② fastcrw 检索："bitemporal database valid time transaction time design" 的设计资料
③ fastcrw 检索："agent memory ledger event sourcing materialized view eviction policy" 的功能实现及特性

### 2.【P1】Ledger / Views / Policy 三层状态管理（依赖：三.1）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:4`（Ledger 追加日志、Views 物化视图、Policy 驱逐/合并策略）、`C:\Users\lenovo\Desktop\多轮对话记忆设计.txt:15`（遗忘机制、冲突清洗、增量写入）

**重点代码**：`src/main/db/`（DAO 层新增点）、`src/main/ai/contextManager.ts:125-170`（现有压缩可作为 Policy 的一部分评估）

**执行前拷问**：
❓ Ledger（只追加）与现有 `ai_messages` 的关系：复用还是新表？物化视图 Views 要预聚合出哪几类（最近实体？活跃话题？）？
❓ Policy 的驱逐/合并触发条件（时间？容量？冲突检测）？与 三.1 双时间如何配合（淘汰旧版本而非删除事实）？

**验收拷问**：
❓ 写入只追加不修改，可通过 Ledger 重放还原任意时点状态？
❓ 驱逐后近期关键事实仍可被召回（七.1 场景不回归）？

**外部检索**：
① Docs MCP Server 查询 `mem0` 库索引：memory 存储分层（facts/trajectory）与 update/conflict 机制最新文档
② fastcrw 检索："append-only ledger materialized view memory consolidation design" 的设计资料
③ fastcrw 检索："LLM memory eviction merge policy token budget" 的功能实现及特性

### 3.【P2】向量化经验库（复用现有 kb 基础设施 + embedding 未配置降级）（依赖：三.1）

**重点文档**：`docs/architecture/knowledge.md`（检索管线）、`docs/specs/embedding-architecture.md`、`.claude/CLAUDE.md:75-76`（向量为可选路径、`kb_chunks.vector` 需配置 embedding 才写入、默认降级 FTS5+标题）、`C:\Users\lenovo\Desktop\多轮对话记忆设计.txt:9`（长期情景记忆：切分片段→向量库→语义检索）

**重点代码**：`src/main/ai/knowledge/kbIndexer.ts`、`src/main/ai/knowledge/kbSearch.ts:445-783`（topK/拒答/RRF）

**执行前拷问**：
❓ 经验库与用户笔记库是同库同表还是独立命名空间？如何避免经验污染笔记检索结果（拒答 0.6、外发过滤 `filterKbEgressResults` 的边界）？
❓ embedding 未配置时降级策略是什么（照抄 FTS5+标题，还是干脆不启用经验召回）？

**验收拷问**：
❓ 未配置 embedding 的环境下无报错、行为可预期？
❓ 经验召回不会把笔记检索的拒答率/出处可跳转特性带坏？

**外部检索**：
① Docs MCP Server 查询 `langchain` 库索引：vector store 可选后端与 metadata 过滤最新文档
② fastcrw 检索："episodic memory vector retrieval RAG agent design" 的设计资料
③ fastcrw 检索："hybrid search FTS5 vector degradation fallback" 的功能实现及特性

### 4.【P1】数据迁移（空库 + 从上一版本升级双路径）（依赖：三.1、三.2）

**重点文档**：`docs/architecture/database.md`（表结构与迁移约定）、`docs/plan/doc-pipeline.plan/01-batch-changes.md` 与 `:02-data-migrations.md`（既有迁移批次写法范例）

**重点代码**：`src/main/db/index.ts`（建表/迁移入口）、`src/main/db/ai.ts`

**执行前拷问**：
❓ 迁移脚本如何保证幂等（重复执行不炸）？
❓ 从上一版本升级时，`ai_conversations.summary` 旧摘要如何初始化到新结构？
❓ 历史迁移文件是否被改（铁律：不得擅改已应用的迁移）？

**验收拷问**：
❓ 空库全新执行 ✓、旧版本库升级 ✓、重复执行 ✓ 三条路径都有验证记录？
❓ 升级后既有会话历史与摘要无丢失？

---


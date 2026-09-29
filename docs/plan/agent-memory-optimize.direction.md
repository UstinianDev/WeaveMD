# WeaveMD 智能创作 Agent · Agent Memory 优化方向

> 导入信息：来源 `C:\Users\lenovo\Desktop\优化方向\优化方向.md`，导入日期 2026-09-28。
> 交付物性质：**只给优化方向，不改任何项目代码**。执行者：后续交由能力更强的模型（Claude Code）实施。
> 形态约定：模块用「一、二、三…」分类；模块内任务用「1. 2. 3.」罗列；每个任务给出重点文档/代码位置（行号）、grill-me 拷问（执行前 + 验收双段）；复杂任务带外部检索 ①②③。
> 参考资料 `生产级Agent Memory.txt`、`多轮对话记忆设计.txt` 存放于本机桌面，**不随本文入库**，引用行号仅对持有者有效。

---

## 0. 使用说明

1. **本文档不做任何代码修改**，仅列方向、定位、拷问与检索指引；实施前须按项目规范先更新 `docs/` 设计文档再动代码（`.claude/AGENTS.md` §3.1）。
2. **行号为 2026-09-28 只读扫描快照**。代码可能已变动，执行每个任务前**必须先用 grep/关键词重新定位确认**，行号只作定位参考，不得盲信。
3. **优先级**：`P0` = 根因修复，不做则记忆体系无效；`P1` = 记忆体系主干；`P2` = 远期能力。任务标题后标注依赖关系（如 `依赖：一.1`）。
4. **执行顺序路线图**：
   - 第一批（P0）：模块一全部 → 模块二.1、二.2 → 七.1 场景①②验证
   - 第二批（P1）：模块四 → 模块三 → 模块五 → 二.4 → 七.1 完整场景、七.2、七.3
   - 第三批（P2）：二.3 → 三.3 → 五.4 → 模块六
5. **硬约束红线（任何任务不得违反）**：
   - 不减少历史轮次、不截断工具结果：`docs/requirements/agent-perf-optimize.req.md:11-17`
   - AI 写入必经确认（铁律一）**仅约束笔记内容写入**；记忆（画像/摘要）写入策略见任务 五.3 的边界说明：`.claude/CLAUDE.md:72`
   - 知识库 0.6 拒答、置顶 ×1.5、searchMode 三模式降级行为不变：`.claude/CLAUDE.md:75-76`
   - 数据迁移必须可从空库执行、也能从上一版本升级，历史迁移文件不得擅改（全局 AGENTS.md 硬性规则）
   - 质量门禁全绿才算完成：`tsc + vitest + eslint(0 error) + vite build + E2E`：`.claude/CLAUDE.md:10-12`
6. **外部检索工具**（复杂任务用）：
   - ① **Docs MCP Server**（docs-cli）：按下方给定的**具体库索引**查最新文档；
   - ②③ **fastcrw**：按给定关键词查具体主题的**设计/技术资料/功能实现及特性**。
7. **参数取值原则**：本文档给出的阈值均为参考值，**需按 `CONTEXT_WINDOW = 64000`（`src/main/ai/agent/agentHelpers.ts:13`）实测调优**，不得直接照抄外部资料数值。

## 0.5 背景与根因定位

**实测问题**：用户先问 RAG 相关问题，AI 正常回答；用户追问「它有什么优势」，AI 反而调用 `ask_question_card` 反问「"它"指什么」。

**五条根因 → 代码定位 → 任务索引表**：

| # | 根因 | 代码定位 | 指向任务 |
|---|------|----------|----------|
| 1 | 第二问被判 `chat` 意图后**历史被整段丢弃**，上一轮 AI 回答与 searchKB 结果一行都不发给 LLM | `src/main/ai/agent/agentContext.ts:417-420`；chat 兜底判定 `src/main/ai/intentRouter.ts:109-117` | 一.1 |
| 2 | 存在 system 注入明令**「忽略之前的所有对话内容……这是全新的独立问题」**，从指令层禁止指代消解 | `src/main/ai/agent/agentContext.ts:440-451`（447-450）；`CHAT_SYSTEM_PROMPT` `src/main/ai/agent/agentPromptBuilder.ts:369-379` | 一.2 |
| 3 | 短文本（<10 字）触发 `needsClarification` → chat 意图工具集收缩到只剩 `ask_question_card`，且前缀要求"不确定就用卡片提问、不要猜测" | `src/main/ai/intentRouter.ts:140-141`；`src/main/ai/agent/agentContext.ts:471-478`；`src/main/ai/agent/agentToolSelector.ts:100-107` | 一.3 |
| 4 | `assistant.tool_calls` 从不落库 → 下一轮历史出现**孤儿 tool 消息**（缺前置 assistant 调用行），跨轮时 searchKB 结果事实上不可用/被 provider 忽略 | `src/main/ai/agent/agentToolExecutor.ts:77-90`（仅内存）vs `:498-506`（落库）；`src/main/db/ai.ts:631-654`（`toolCalls` 形参全库无调用方）；回读 `src/main/ai/agent/agentContext.ts:361-366` | 一.4 |
| 5 | KB 层代词消解**不传对话历史**：`resolveReferences(query, 空历史)` 原样返回，`pronoun_reference` 判定必命中，`clarificationContext` 生成「你提到的『X』具体指的是什么？」并指示 LLM 调 `ask_question_card` | `src/main/ai/tools/searchKBHandler.ts:25`；`src/main/ai/knowledge/queryPlanner.ts:212,225,432-434`；`src/main/ai/knowledge/knowledgeClarify.ts:17-22,168-169` | 二.1、二.2 |

> 说明：根因 1/3 与根因 5 是**两条互斥但现象一致**的路径（第二问被判 chat 则走 1/3；仍持有 searchKB 则走 5），必须两条都修。

**参考资料（只读引用，禁止修改）**：
- `C:\Users\lenovo\Desktop\生产级Agent Memory.txt` — 分层设计、Ledger/Views/Policy、双时间、经验沉淀（`:3-12`）
- `C:\Users\lenovo\Desktop\多轮对话记忆设计.txt` — 三层记忆、三级渐进压缩阈值、实体画像、长期情景记忆、后台异步写入（`:2-15`）

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

## 四、提示词与记忆注入模块

### 1.【P1】memory.md 接入 system prompt（终结"只存不喂"）（依赖：三.1）

**重点文档**：`docs/modules/05-设置界面-Settings.md:19-26,30-39`（soul/memory/style 三文件设置项）、`docs/architecture/ai-agent.md:84-90`（prompt 构建职责）

**重点代码**：`src/main/ai/files/globalAgentFiles.ts:4-18`（三文件定义）与 `:41`（memory 默认内容：用户偏好/技术栈/长期项目/已确认决策/重要经验）与 `:106-125`（读写）；**全库无注入调用方**（`agentContext.ts`/`agentPromptBuilder.ts` 未 import）；注入点 `src/main/ai/agent/agentPromptBuilder.ts:269-366`、`src/main/ai/agent/agentContext.ts:471-491`；IPC 仅设置页 `src/main/ai/ipc/agentHandlers.ts:413,423-441`

**执行前拷问**：
❓ memory.md（用户手写）与任务 五 的自动画像**冲突时谁优先**（用户显式写入应覆盖自动生成？合并规则？）
❓ 注入位置放 system prompt 哪一段（`agentPromptBuilder.ts:286-290` 核心规则前/后）？token 预算多大、超长怎么截断？
❓ soul.md/style.md 是否同批注入（范围控制，避免顺手扩需求）？

**验收拷问**：
❓ memory.md 中写「用户偏好：XX」后，新会话首答即体现，且**跨会话生效**？
❓ 未配置 memory.md（默认模板）时无注入开销与行为差异？

### 2.【P1】分层 Prompt 组装（System + 画像 + 历史片段 + 最近 N 轮）（依赖：三.1、四.1）

**重点文档**：`C:\Users\lenovo\Desktop\多轮对话记忆设计.txt:12`（组装公式：System Prompt + 画像记忆 + 历史片段 + 最近几轮对话）、`:14`（精准检索原则：事实依赖结构化查询，语境依赖向量召回）、`docs/architecture/ai-agent.md:59-73`

**重点代码**：`src/main/ai/agent/agentContext.ts:483-501`（最终 messages 形态：system 文档上下文 → system 主提示 → 分隔标记 → 历史 → 强调指令 → 当前 user）、`src/main/ai/agent/agentPromptBuilder.ts:269-366` 与 `:94-129`（文档上下文段）

**执行前拷问**：
❓ 层级顺序如何定（画像放最前还是最后？历史片段与近 N 轮如何切分）？与 一.2 移除"忽略历史"后的措辞如何统一？
❓ 与现有"分轮澄清前缀/强调指令"注入（`agentContext.ts:440-451`）叠加后的总提示词结构长什么样（给出目标结构树）？
❓ 哪些层依赖 模块三 的表（未就绪时如何降级占位）？

**验收拷问**：
❓ 拿一条真实长会话打印组装结果，五层齐备、无相互矛盾的指令？
❓ token 占用在 64000 窗口预算内（给出各层实测占比）？

### 3.【P1】摘要 prompt 改造：保留关键事实与指代先行词（依赖：一.2、一.5）

**重点文档**：`docs/architecture/ai-agent.md:24-27,53`（压缩 cache-safe fork、丢图保最近 3 张）、`docs/specs/ai-panel-features.md:16-22`

**重点代码**：`src/main/ai/contextManager.ts:192-259`（`summarizeViaLlm`，`:199-229` cache-safe fork、`:231-259` 回退模式）、**`:242`（现 prompt 明令"不要包含具体的问题和答案"——这是指代失败放大器）**、`:125-139`（buildCompressed）、`:145-170`（保留最近 N 轮）

**执行前拷问**：
❓ 改造后摘要要保留什么（主题关键词、已讨论实体、用户关键决策、最近答案的结论），仍如何避免摘要膨胀回吃 token？
❓ 参考三级渐进压缩（`多轮对话记忆设计.txt:4-7`：summary_text 20条/8000token → session_memory 每4条/1200token 增量 → compact_summary 6500token → 50000 硬截断）——项目采纳几级？**数值按 CONTEXT_WINDOW=64000 实测调优**
❓ cache-safe fork（保 prompt cache 命中）在改摘要内容后是否仍成立？

**验收拷问**：
❓ 压缩触发后追问「它有什么优势」，摘要里能否找到先行词（七.1 场景③）？
❓ 压缩前后 token/延迟对比数据在案，无 cache 命中率异常下跌？

---

## 五、记忆读写工具模块

> 本模块为复杂任务，均带外部检索 ①②③。

### 1.【P1】显式记忆读写工具注册（Agent 主动调用的慢思考回路）（依赖：三.1、四.2）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:5`（显式读写策略：Agent 主动调用记忆工具）、`docs/architecture/ai-agent.md:107-152`（工具注册与投放）、`docs/modules/11-AI代理面板-Agent.md:114-129`

**重点代码**：`src/main/ai/toolRegistry.ts:62-92`（handlerMap）与 `:99-388`（CORE_TOOLS schema，参照 `ask_question_card` 的 `:218` 注册写法）、`src/main/ai/agent/agentToolSelector.ts:69-149`（按意图投放）、`src/main/ai/agent/agentToolPolicy.ts:37-38`（调用次数上限）

**执行前拷问**：
❓ 工具集怎么划（memory_read / memory_write / memory_update？参数 schema 谁定）？与自动注入（四.1/四.2）的分工：何时读工具、何时直接注入？
❓ 哪些意图给这些工具（全给 vs 仅特定意图）？调用次数上限设多少（参照 `searchKB ≤ 10`）？
❓ 工具读到的记忆是否要像 searchKB 一样计入外发过滤/脱敏？

**验收拷问**：
❓ 一次典型多轮任务中，Agent 能主动存入并主动读回一条跨会话事实？
❓ 工具 schema 通过参数预验证（`agentToolExecutor.ts:103-113` 同款校验）且无 any？

**外部检索**：
① Docs MCP Server 查询 `langmem` 库索引：memory tools（create/str_replace/search memory）工具定义与写入流程最新文档；再查 `mem0` 库索引：add/search/update/delete memory API
② fastcrw 检索："explicit memory tool calling agent slow thinking loop design" 的设计资料
③ fastcrw 检索："agent tool registry schema validation LLM memory tool" 的功能实现及特性

### 2.【P1】后台异步增量写入 + 冲突清洗（依赖：三.2、五.1）

**重点文档**：`C:\Users\lenovo\Desktop\多轮对话记忆设计.txt:13`（后台异步线程：AI 响应后分析对话、写入新档案/清洗冲突）、`:15`（动态记忆系统：遗忘、冲突清洗、增量写入、自我更新自我净化）、`docs/architecture/ipc.md`（事件持久化）

**重点代码**：`src/main/ai/agent/agentTaskWorker.ts`（后台执行与事件持久化）、`src/main/ai/agent/agentEventStore.ts:156-202`（persistAndSend）与 `:237-262`（replayFromSeq，注意 `session_id` vs conversationId 口径疑似不一致，实施时先验证）、`src/main/ai/contextManager.ts:192-259`（LLM 调用范式可复用）

**执行前拷问**：
❓ 触发时机：done 事件后？会话结束时？节流策略（每 N 条消息）？
❓ 冲突清洗规则：新旧事实矛盾时谁赢（时间新者赢？置信度？用户显式值赢）？与 三.1 双时间如何配合？
❓ 后台 LLM 调用的成本与失败/超时/降级如何处理（不得阻塞用户下一轮提问）？

**验收拷问**：
❓ 连续对话中后台写入不阻塞主循环、失败静默重试有日志？
❓ 制造"用户搬家"式矛盾事实两次写入后，画像保留正确版本？

**外部检索**：
① Docs MCP Server 查询 `mem0` 库索引：add 流程中的 conflict resolution / deduplication 最新文档
② fastcrw 检索："background async memory write conflict resolution incremental update" 的设计资料
③ fastcrw 检索："user profile fact deduplication recency vs explicit override" 的功能实现及特性

### 3.【P1】记忆写入控制策略（自动写 + 可视化 + 手动删除/编辑）（依赖：五.2）

**重点文档**：`.claude/CLAUDE.md:72`（铁律一：AI 写入必经确认——**约束对象是笔记内容**）、`docs/REQUIREMENTS.md:145`（WC-03 交互确认流程）、`docs/modules/05-设置界面-Settings.md`（设置页形态参考）

**重点代码**：确认流程参照 `src/main/ai/agent/agentToolExecutor.ts:442-460`（交互触发）、`src/main/ai/ipc/agentHandlers.ts`（新增记忆管理 IPC 参照）、`src/render/stores/agentStore.ts`（渲染层状态）

**执行前拷问**：
❓ 边界定案：记忆自动后台写入**不需要**逐条弹确认（记忆≠笔记写入），但需要什么可见性（查看入口？最近写入列表？）？
❓ 手动删除/编辑入口放哪（设置页三文件旁？AI 面板新增视图？）——注意禁止顺手做无关 UI 重构，最小改动方案？
❓ 敏感信息边界：哪些内容禁止写入记忆（凭据、密钥——全局硬性规则）？

**验收拷问**：
❓ 用户能查看到自动写入的记忆并手动删除/编辑，删除后新会话不再注入？
❓ 铁律一语义未被削弱（笔记写入确认流程回归测试仍绿）？

**外部检索**：
① Docs MCP Server 查询 `letta` 库索引：memory block 编辑/人机协同修订（human-in-the-loop memory editing）最新文档
② fastcrw 检索："agent memory transparency UI edit delete user control design" 的设计资料
③ fastcrw 检索："automatic memory capture privacy credential redaction" 的功能实现及特性

### 4.【P2】遗忘 / 过期机制（依赖：三.2、五.2）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:12`（方法会过期需复核淘汰、规则合并去重防膨胀）、`C:\Users\lenovo\Desktop\多轮对话记忆设计.txt:15`（遗忘机制）

**重点代码**：`src/main/db/`（Policy 落地点，依赖 三.2）、`src/main/ai/contextManager.ts`

**执行前拷问**：
❓ 遗忘触发条件（时间衰减？容量上限？用户行为信号）？哪些记忆**不可遗忘**（用户显式标记的偏好）？
❓ 过期复核由谁做（自动打分 vs 提示用户确认）？

**验收拷问**：
❓ 长期运行模拟下记忆条数有上界、无无限膨胀？
❓ 关键用户偏好在模拟遗忘后仍存活？

**外部检索**：
① Docs MCP Server 查询 `langmem` 库索引：memory consolidation / decay 最新文档
② fastcrw 检索："memory forgetting decay curve agent design" 的设计资料
③ fastcrw 检索："memory consolidation merge deduplication token budget" 的功能实现及特性

---

## 六、经验沉淀与 Skill 模块

> 本模块为 P2 远期能力，复杂任务，均带外部检索 ①②③。

### 1.【P2】执行轨迹 → 可复用 Skill 提炼（依赖：三.2、五.1）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:9-10`（程序性经验沉淀：Logs→定期回看反思→成功路径抽象为步骤/失败根因抽象为避坑规则）、`.claude/CLAUDE.md:29-30`（项目已有 `src/main/ai/skills/` 与 skillLoader）、`docs/modules/11-AI代理面板-Agent.md`（skillLoader 职责）

**重点代码**：`src/main/ai/skills/`（skillLoader 现有实现）、`src/main/ai/agent/agentEventStore.ts`（轨迹来源：chunk/tool/done 事件）、`src/main/ai/toolRegistry.ts`（技能注入点参照）

**执行前拷问**：
❓ 提炼是全自动（LLM 定期回看日志）还是半自动（人工审核后生效）？参考文档避坑指南 `:12` 要求"工具不成熟先人工审核再生效"——采纳哪档？
❓ 轨迹来源用 `agent_run_events` 还是 `ai_messages`（前者含 chunk 噪声，后者缺工具细节）？
❓ 与现有 skills/（用户手写技能）的存放与命名如何共存不冲突？

**验收拷问**：
❓ 构造 3 次同类任务轨迹，提炼出的步骤可被第 4 次任务直接调用且结果正确？
❓ 失败轨迹提炼出的避坑规则在后续任务中确实被触发？

**外部检索**：
① Docs MCP Server 查询 `langmem` 库索引：procedural memory / skill 提取相关最新文档；再查 `langchain` 库索引：reflection / self-improvement 模式
② fastcrw 检索："distill reusable skills from agent execution trajectories reflection design" 的设计资料
③ fastcrw 检索："agent skill library induction from logs success failure path" 的功能实现及特性

### 2.【P2】经验的结构化存储 + 任务类型识别注入（依赖：六.1、四.2）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:11`（存和用：结构化存储保持流程顺序 → 注入上下文识别任务类型后作行为指导 → 沉淀成技能）

**重点代码**：`src/main/ai/skills/`、`src/main/ai/agent/agentContext.ts:483-501`（注入位置）、`src/main/ai/intentRouter.ts:17-67`（任务类型识别可复用）

**执行前拷问**：
❓ 存储结构如何保持"流程规则的顺序"（有序 JSON？markdown 步骤？）？
❓ 注入时机由什么触发（意图分类命中？工具调用前检索？），注入量如何控 token？

**验收拷问**：
❓ 识别到任务类型后，行为指导出现在提示词中且顺序未被洗乱？
❓ 未命中类型时零注入、无副作用？

**外部检索**：
① Docs MCP Server 查询 `langchain` 库索引：structured memory / store namespace 组织方式最新文档
② fastcrw 检索："procedural memory structured steps prompt injection design" 的设计资料
③ fastcrw 检索："task type classification routing memory retrieval" 的功能实现及特性

### 3.【P2】防膨胀三防线：合并去重 / 过期复核 / 人工审核（依赖：六.1、六.2）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:12`（避坑：避免过拟合、方法过期需复核淘汰、规则合并去重防膨胀、工具不成熟先人工审核再生效）

**重点代码**：`src/main/ai/skills/`（技能清单管理）、`src/main/db/`（经验表 Policy 落地）

**执行前拷问**：
❓ 去重判定标准（语义相似度阈值 vs 关键词）？合并由谁执行（自动 vs 审核）？
❓ "过期复核"的周期与信号是什么？人工审核的入口在哪（最小改动方案）？

**验收拷问**：
❓ 注入 50 条相似经验后，三防线生效、注入条数有上界？
❓ 复核淘汰后的经验不再出现在任何提示词中？

**外部检索**：
① Docs MCP Server 查询 `langmem` 库索引：memory deduplication / curation 最新文档
② fastcrw 检索："skill library deduplication expiry human review design" 的设计资料
③ fastcrw 检索："LLM rule consolidation anti overfitting guardrail" 的功能实现及特性

---

## 七、测试与验收模块

### 1.【P1】指代 E2E 三场景（场景①随一.1 同批交付）（依赖：一.1、一.2、一.3、二.1、二.2）

**重点文档**：`docs/architecture/testing.md`（测试策略）、`docs/testing/`（既有 TDD 报告写法范例，如 `agent-cost-optimize.tdd.md`）、`.claude/CLAUDE.md:11`（`npx playwright test` 真实 Chromium E2E）

**重点代码**：`playwright.config.*` 与 e2e 用例目录（实施时 glob 定位）、`src/main/ai/agent/agentContext.ts`（被测行为）、`src/render/components/AIAgent/cards/QuestionCard.tsx`（断言不弹卡）

**执行前拷问**：
❓ 三场景固定为：①RAG 问答后问「它有什么优势」→ 不弹卡且回答引用先行词；②chat 意图下历史仍存在；③压缩触发后指代仍成立——是否需补"全新会话纯代词仍正确反问"的反向用例？
❓ 场景③如何稳定触发压缩（注入大历史 vs 调低阈值构造）？
❓ E2E 是否要 mock LLM？用哪个后端保证可重复？

**验收拷问**：
❓ 三场景在 CI 质量门禁下稳定通过（连续 3 次无 flaky）？
❓ 修复前跑会失败、修复后通过（证明用例真的覆盖根因）？

### 2.【P1】质量门禁回归（依赖：全部任务）

**重点文档**：`.claude/CLAUDE.md:10-12`（门禁四件套）、`.claude/rules/WORKFLOW.md`（编码→测试→文档→提交流程）

**重点代码**：`package.json` scripts（`npm run lint` / `typecheck` / `test` / `build`）

**执行前拷问**：
❓ 每批任务（P0/P1/P2）交付时各跑哪些门禁（全量 vs 快速集）？
❓ 改了 DB 表结构后，`npm run test` 是否覆盖迁移双路径用例？

**验收拷问**：
❓ `tsc + vitest + eslint(0 error) + vite build + npx playwright test` 全绿的输出证据是否留存到 `docs/testing/`？
❓ 是否同步更新了 `docs/` 对应设计文档与 `docs/TODO.md` 状态？

### 3.【P1】压缩 / 记忆单元测试（依赖：一.5、三.1、四.3）

**重点文档**：`docs/architecture/testing.md`、`docs/requirements/agent-perf-optimize.req.md:11-17`（历史保留红线的守护测试）

**重点代码**：`src/main/ai/contextManager.ts:109-170,192-259`（阈值与摘要）、`src/main/ai/agent/agentContext.ts:359-424`（历史组装）、`src/main/db/ai.ts`（记忆表 DAO）

**执行前拷问**：
❓ 守护测试清单：历史 20 条读取、KEEP_RECENT_ROUNDS、chat 意图历史保留、tool_calls 落库回读、记忆表迁移双路径——还缺什么？
❓ 参考阈值改动（四.3）后，测试如何锁定"不减历史轮次"红线？

**验收拷问**：
❓ vitest 全绿且新增用例能对被修改的阈值/行为产生失败信号（变异验证：故意改错应变红）？
❓ 测试断言不含 any、不依赖真实网络？

---

*本文档由 `/devflow-documents` 于 2026-09-28 从 `C:\Users\lenovo\Desktop\优化方向\优化方向.md` 导入，正文与原件一致（仅头部补导入元信息、文末落盘说明改写）。原件为其唯一权威来源；`生产级Agent Memory.txt`、`多轮对话记忆设计.txt` 两份参考材料不入库，保持本机原样。*

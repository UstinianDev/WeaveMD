# Agent 提示词组装与上下文注入规范（Agent Prompt & Context）

> 规范编号：SPEC-AGENT-PTX | 版本：v1.0 | 状态：生效（已实施）| 更新：2026-10-01
> 关联需求：[agent-cost-optimize.req.md](../../requirements/agent-cost-optimize.req.md)（A1~A5、B1）、
> [agent-memory-optimize.req.md](../../requirements/agent-memory-optimize.req.md)（P0-2）、
> [agent-memory-optimize-2.req.md](../../requirements/agent-memory-optimize-2.req.md)（A1 三文件、B4 画像、Q15）、
> [agent-memory-optimize-3.req.md](../../requirements/agent-memory-optimize-3.req.md)（D4 经验注入）、
> [agent-perf-optimize.req.md](../../requirements/agent-perf-optimize.req.md)（S7）
> 关联模块：[docs/modules/11-AI代理面板-Agent.md](../../modules/11-AI代理面板-Agent.md)
> 关联架构：[docs/architecture/ai-agent.md](../../architecture/ai-agent.md)
> 关联规范：[SPEC-AGENT-COST](./agent-cost-caching.md)（成本公式与缓存断点）、[SPEC-AGENT-MEM](./agent-memory.md)（记忆载体、召回与提炼）、[SPEC-AGENT-TOOL](./agent-tool-runtime.md)（工具注册与 defer 运行时）

**分工**：req 管「需求与红线」（为什么这样定），本篇管「实现级行为契约」（提示词必须长什么样、什么条件下注入什么）；
记忆载体与经验提炼归 SPEC-AGENT-MEM，成本核算与提示词缓存归 SPEC-AGENT-COST，工具注册与 defer 运行时归模块文档
[modules/11 §3](../../modules/11-AI代理面板-Agent.md)。同一事实两边只留一处，本篇用「见 req §x」交叉引用不复述理由。

**来源标记**：〔cost §2.x〕= `docs/plan/agent-cost-optimize.plan.md`；〔mem §2.1 A-a〕= `agent-memory-optimize.plan.md`；
〔mem2 §6 B4〕= `agent-memory-optimize-2.plan.md` §6；〔mem3 §6 D4〕= `agent-memory-optimize-3.plan.md` §6；
〔perf2 §S7〕= `agent-perf-optimize.phase2.plan.md`。plan 目录后续移除，标记仅作 git 历史回溯锚点。

---

## 1. 范围

本篇约束以下五类长期行为：

1. 系统提示的组装顺序与可选块注入（Agent / Chat 两分支）；
2. 个性化三块（三文件 / 画像 / 经验）的注入契约与截断；
3. 经验技能的 `intents` 标注解析与意图匹配；
4. 反上下文措辞统一与文档上下文注入门控；
5. 文件操作叙述约束与提示词前缀稳定性原则。

不包含：成本公式与缓存断点（SPEC-AGENT-COST）、`agent_memory` 表与召回（SPEC-AGENT-MEM）、
工具 schema 与 defer 加载运行时（SPEC-AGENT-TOOL）、意图判定规则本身（`intentRouter`，见 architecture/ai-agent.md）。

## 2. 系统提示组装总契约

### 2.1 分支选择

`prepareAgentContext` 按下式选择提示词分支（`src/main/ai/agent/agentContext.ts`）：

```
useAgentPrompt = !isChatIntent || needsClarification || hasAttachments
```

即：**默认 chat 意图走 Chat 提示；chat 判定但需澄清（needsClarification）、或本会话带附件时改走 Agent 提示**。
两分支都接收三个可选个性化块，读取只做一次、两分支各传一次。〔mem2 §6 B4、mem3 §6 D4〕

### 2.2 Agent 分支块序

`buildAgentSystemPrompt(fileListSnapshot, localFileTreeSnapshot, needsClarification?, attachmentManifest?,
globalFilesBlock?, profileBlock?, experienceBlock?)` —— 第 6 参 `profileBlock`、第 7 参 `experienceBlock` 均为可选。〔mem2 §6 B4、mem3 §6 D4〕

固定顺序（`src/main/ai/agent/agentPromptBuilder.ts:410` 起）：

| 序 | 段 | 说明 |
|---|---|---|
| 1 | 开场角色 + 澄清前缀（条件） | `needsClarification` 为真时插入【注意】提问前缀 |
| 2 | 【核心规则】1~4 | 见 §5 |
| 3 | 三文件块（soul/memory/style） | 空则跳过，见 §3.2 |
| 4 | 画像块 | 空则跳过，见 §3.3 |
| 5 | 经验块 | 空则跳过，见 §3.4 |
| 6 | `## 工作流` | 个性化三块必须在 `## 工作流` **之前**结束 |
| 7 | `## 分轮澄清策略` / `## 工具规则` | 既有静态段 |
| 8 | `## 文件操作后的回复` | 见 §7，插在 `## 写入规则` 之前〔cost §2.2 A1〕 |
| 9 | `## 写入规则` / `## 要点` / `## 回复风格` / `## 回答格式` | 见 §7 |
| 10 | 文件列表快照 → 本地文件树快照 → 附件清单 | 动态快照置尾（静态在前、动态在后，见 §8） |

### 2.3 Chat 分支块序

`buildChatSystemPrompt(globalFilesBlock?, profileBlock?, experienceBlock?)` 与 Agent 分支**同构**（Q15：chat 同样注入三块）〔mem2 §6 B4〕：

```
开场 + 【核心规则】1~4 → 三文件块 → 画像块 → 经验块 → 【注意力锚点】
```

- 【注意力锚点】**必须留在最后一行**（recency bias），任何块不得插到它之后；
- 不传参时输出与导出常量 `CHAT_SYSTEM_PROMPT` **逐字一致**（既有护栏断言对象，改引用方式不改内容）〔mem2 §6 B4、§1 Q15〕。

### 2.4 空块与逐字基线口径（三块统一）

- 可选块注入前先 `trim`，**空串/纯空白一律不注入**（对应段整体跳过），输出与不传参时**逐字一致**；
- 未就绪场景（未配置、读取失败、无匹配）由调用方传 `''`，**零占位噪音** —— 禁止注入 `(暂无画像)` 之类占位文本〔mem2 §6 B4 变异验证口径〕；
- 该口径对三文件块、画像块、经验块一致（A1 / B4 / D4 同款）。

## 3. 个性化块注入

### 3.1 通用截断 `truncateBlockWithMarker`

`agentPromptBuilder.ts:41`：按 token 上限**二分裁剪**（前缀越短 token 越少 → 谓词单调），块尾追加截断标注；
**保证 `estimateTokens(结果) ≤ limit`，标注本身计入上限**。三个个性化块与文档上下文共用同一工具。〔mem2 §6 B4〕

| 块 | 上限常量 | 值 | 截断标注 |
|---|---|---|---|
| 三文件块 | `GLOBAL_FILES_TOKEN_LIMIT` | 2000 | `(已截断，完整内容见设置页)` |
| 画像块 | `PROFILE_TOKEN_LIMIT` | 2000 | `(画像过长已截断)` |
| 经验块 | `EXPERIENCE_TOKEN_LIMIT` | 2000 **[待校准]** | `(经验过长已截断)` |

- 三文件块上限 2000 为 Q4 裁定（设置页 `recommendedChars` 不改，发送侧兜底闸），见 req-2 Q4〔mem2 §6 B4〕；
- `PROFILE_TOKEN_LIMIT = 2000`：与三文件块共用同一预算刻度（个性化层合计 ≤4000）；**该批没有画像体量的实测数据**，
  不凭空另设更小值，数量侧由 40 条条数上限兜底〔mem2 §6 B4〕；
- `EXPERIENCE_TOKEN_LIMIT = 2000` **[待校准]**：注释明写「单次会话内匹配到的技能条数分布尚无线上实测数据，
  超限统一走截断 + 标注」，取值按 `CONTEXT_WINDOW = 64000` 实测调优而非照抄外部资料〔mem3 §6 D4〕。**该标注不得删除**。

### 3.2 三文件块（全局 Agent 文件）

soul / memory / style 三文件整体作为一个块注入，位置**紧跟【核心规则】**（注意力锚点区，不放文档上下文之后）。
未配置时为空串不注入。〔mem2 §1 A1；细节归 req-2 四.1〕

### 3.3 画像块

**构造纯函数 `buildProfileBlock(rows)`**（`src/main/ai/agent/agentContext.ts:307`）契约：〔mem2 §6 B4〕

1. 标题：稳定小节 `【用户画像】` + 一行说明（「…用于个性化作答；与用户当面陈述冲突时以用户当面陈述为准」）；
2. 条目行：`- subject：content`（两者皆有），多行 content 折为单行；subject/content 至少一项非空否则该行过滤；
3. 排序：`writtenAt` 新者优先，**同一时刻按 `id` 降序**（稳定 tie-break）；
4. 条数上限 `PROFILE_MAX_ENTRIES = 40`，超出时追加省略标注 `(画像超过 40 条，已省略 N 条较旧条目)`；
5. 过滤后全空 → 返回 `''`（**连标题都不留**）。

**读取 `readActiveProfileBlock(userId, db?)`**：无 `userId` / 无 `db` / 查询抛错 → **一律 `''` 不抛出**（读取失败静默降级为不注入）。
生产链路由后台 worker 向 `AgentLoopDeps.db` 注入；**若未来新增不传 db 的调用路径，画像会静默降级为不注入（不报错）——
这是已知取舍**（为避免 better-sqlite3 原生模块进测试 import 图）。〔mem2 §6 B4 残余风险〕

### 3.4 经验块

- 注入通道：`buildAgentSystemPrompt` 第 7 参 / `buildChatSystemPrompt` 第 3 参；位置**紧跟画像块之后、`## 工作流` 之前**
  （chat 侧 = 锚点前，锚点仍居末）。完整块序：**核心规则 → 三文件 → 画像 → 经验 → `## 工作流`**〔mem3 §6 D4〕；
- 结构：标题 `【可复用经验】` + 说明行（「按原步骤顺序执行，不要调整步骤次序」）+ 每技能 `【技能 name】description` + instructions **原文按序拼接**；
- **chat 分支生产恒空**：`EXPERIENCE_INTENTS` 白名单排除 `chat`，而走 `buildChatSystemPrompt` 的唯一条件就是 `intent==='chat'`
  ⇒ 第 3 参生产上恒收 `''`。能力完整（有单测），**记 TODO 待 `intentRouter` 能区分「闲聊/未知类型」后即生效**〔mem3 §6 D4 裁定 1〕。

## 4. 经验匹配与 `intents` 标注契约

### 4.1 白名单（单一口径）

`EXPERIENCE_INTENTS` 定义在 `agentPromptBuilder.ts:95`，为**唯一口径**，三方共用：
注入侧（`agentContext.buildExperienceBlock`）、技能读取侧（`skillLoader` front matter 解析）、草稿写入侧（`skillAutoStore` 校验）。
值 = **5 个显式规则意图**：`rewrite` / `kbQa` / `tech` / `web` / `create`；
**`chat` 与任何白名单外的值一律不合法**（chat 是无规则 fallback，无法区分闲聊与未知任务类型）〔mem3 §6 D4〕。

### 4.2 front matter 解析（读路径 `parseIntents`）

`src/main/ai/skills/skillLoader.ts:277`：

- **逗号分隔 `rewrite, kbQa` 与 JSON 数组 `["rewrite","kbQa"]` 两种写法等价**（统一去括号、去引号、trim 后按逗号切分），结果去重保序；
- **非法值（含 `chat`）忽略并 `console.warn`**（warn 载荷含 skill 名、被忽略值、白名单），合法值保留；
- **字段缺失或空白 → `undefined`**（= 未标注，注入侧走推断）；
- **字段存在但全部非法 → `[]`**（= 已标注却不适用，**不回落推断**）〔mem3 §6 D4〕。

### 4.3 草稿校验（写路径 `assertIntents`）

`src/main/ai/skills/skillAutoStore.ts:141` —— 草稿是 LLM 产出，**不做静默丢弃**，任一违规即**抛错整批拒写**：

- 缺省（`undefined`/`null`）合法 → `undefined`；
- 非数组 / 空数组 / 含非字符串 / 任一值不在白名单（含 `chat`）→ 抛错；
- 合法时去重返回。〔mem3 §6 D4〕

### 4.4 注入匹配与排序（`buildExperienceBlock`）

`src/main/ai/agent/agentContext.ts:386`，四步：〔mem3 §6 D4〕

1. **白名单拦截**：当前意图不在 `EXPERIENCE_INTENTS`（**含 `chat` 与未知值**）→ 返回 `''`，一律不注入；
2. **显式命中**：技能标了 `intents` → 只看 `intents.includes(intent)`，**不回落推断**（`[]` 恒不注入）；
3. **推断命中**：未标 `intents` 的老技能 → 用 `name + description` 拼标签跑 `classifyIntent(label, { hasHistory: true })`
   （**复用 `intentRouter` 既有关键词规则表，不复制、不改其判定逻辑**），推断不中不注入；
4. **无匹配 / 无技能 / instructions 全空** → `''`，零占位噪音。

**排序**：**显式命中在前、推断命中在后，组内保持 `skills` 原序** —— 注入顺序可预测，instructions 步骤语义不被洗乱。

## 5. 反上下文措辞统一

四处同批统一为同一措辞，**禁止**再出现「忽略之前的所有对话内容和历史摘要」「每条用户消息都是独立的新指令」类表述；
红线与动机见 req P0-2（[agent-memory-optimize.req.md §二 P0-2](../../requirements/agent-memory-optimize.req.md)）。〔mem §2.1 A-a〕

**统一措辞原文**（四处一致）：

> 历史与摘要仅用于理解当前问题中的指代与上下文，不要延续上一轮未完成的作答

四处锚点与配套条款：

| # | 锚点 | 内容 |
|---|---|---|
| 1 | `agentPromptBuilder` 核心规则（Agent 分支） | 规则 1 **「你必须且只能回答用户的最后一条消息」保留**（防串题由它承担）；规则 2 = 统一措辞；规则 3 = 指代词结合历史理解；规则 4 = 当前问题标记 |
| 2 | `CHAT_SYSTEM_PROMPT`（Chat 分支） | 规则 1~3 同构；规则 4 = 「与当前问题无关的历史话题不主动展开」。原字符串逐字保留为基线 |
| 3 | `contextManager.SUMMARY_USAGE_NOTE` | 摘要注入前缀：`以下为历史摘要（<统一措辞>）：<summary>` |
| 4 | 会话尾部强调 system 消息（`agentContext.ts:714`，原 `:449`） | `【重要】请只回答最后一条用户消息。<统一措辞>`；**其前方的分隔行 `=== 当前用户问题（必须回答此问题）===` 保留**（插在最后一条 user 消息前） |

## 6. 文档上下文注入门控

### 6.1 门控谓词（B1）

`shouldInjectDocumentContext(intent, currentDocument)`（`agentPromptBuilder.ts:247`）：〔cost §2.3〕

```
注入 ⇔ intent ∈ {rewrite, create, tech} 且 (currentDocument ?? '').trim() 非空
```

- `chat` / `kbQa` / `web` **一律不注入**（回答来源分别是对话、知识库、搜索结果，当前文档是纯冗余）；
- **`needsClarification` 分支同样不注入** —— 门控只看 `intent`，与走哪个提示词分支无关；
- 三个写作意图保留注入：`editBlocks` 在 create/tech 可用，模型需要文档全文作参考（放宽理由见 req B1）；
- 空文档 / 空白文档不注入。

### 6.2 注入形式与预算

- 注入为**独立 system 消息**，置于主系统提示**之前**（`agentContext.ts:772-778`）；每轮随请求**重发**（非增量）；
- 整篇模式（DB 文档无磁盘路径）：`estimateTokens > 5000` 时截到 20000 字符 + 尾标 `[文档过长已截断…]`
  （`DOC_CONTEXT_TOKEN_LIMIT=5000 / DOC_CONTEXT_CHAR_LIMIT=20000`）。〔cost §2.3〕

### 6.3 引用模式（带磁盘路径）

`currentFileRef.path` 存在时走**引用模式**：只注入文件名 + 路径 + 规模统计 + 标题大纲（前 10 条、单条 120 字）+ 开头摘要
（前 20 行、1200 字），**不注入全文**，正文由 LLM 用 `readLocalFile` 按路径读取（B9 三-1②）。
无文档/空文档返回 `null` 不注入。

## 7. 文件操作叙述约束

动机与豁免清单（质量护栏 5 项）见 req A 轨（[agent-cost-optimize.req.md §需求清单 A](../../requirements/agent-cost-optimize.req.md)）；本节只定提示词行为。〔cost §2.2〕

### 7.1 `## 文件操作后的回复` 段（A1/A3/A4）

位置：插在 `## 写入规则` **之前**；适用范围 = 调用写工具后的回复文本。段内契约：

- **≤2 行**：只写「做了什么 + 结果」；
- **禁止复述 diff 卡片已展示的变更内容**（变更明细由卡片承载）；
- **不加标题、不列小节、不写总结段、不给后续建议**；
- 长度硬上限写入提示：`FILE_OP_NARRATION_TOKEN_LIMIT = 80` tokens，档位 `FILE_OP_NARRATION_TOKEN_LIMITS = [0, 40, 80, 160]`
  （0 = 只报结果、160 = 允许完整说明，供 A/B 调参，默认 80 ≈ 2 行）；
- **适用写工具清单**（`FILE_OP_WRITE_TOOLS`，代码现状 10 个）：`createFile` / `createFolder` / `editBlocks` / `editLocalFile` /
  `renameFile` / `moveFile` / `deleteFile` / `deleteLocalFile` / `preview_file_revision` / `preview_patch_files`
  （plan 原文「8 个」与代码不符，以代码为准）；
- **豁免**（本段不约束）：产物 payload（`createFile.content`、`editBlocks` 全文）、`ask_question_card` 提问文本、
  错误与安全警告、澄清提问轮次。

配套改写（A3，落在 `## 写入规则`）：安全变更「执行成功即可」；删除前说明降为「**仅目标不唯一时**先列将删清单」，
其余由确认卡片承担（删除确认硬拦截不变，见 req 硬性约束）。

### 7.2 `## 回答格式` 双分支（A2）

由无条件改为**条件式**，两条分支都保留、原结构化规则不删除：

- **知识类回答**（检索解读、分析、问答、联网搜索结果）：Markdown 结构化（标题/列表/代码块/粗体），长文标题分段；
- **文件操作轮次**：不套用结构化格式，改按 `## 文件操作后的回复` 的 2 行规则输出；
- `## 回复风格`（禁寒暄、不复述问题、结论先行、不解释基础概念、段落 ≤3 句、列表 ≤5 项）与禁 emoji 条款常驻。

**不整体注入外部规则模板原文**（避免每次调用 +~1,000 input tokens 的短问答倒亏，取舍见 req 已对齐问题 4）。〔cost §2.2 A5〕

## 8. 提示词前缀稳定性

### 8.1 五原则（长线红线，来自 Anthropic Prompt Cache 设计）〔perf2 §核心原则〕

1. **前缀匹配决定一切**：任何前缀变更都会使后续所有缓存失效；
2. **静态在前、动态在后**：工具定义 → 系统角色与规则 → 项目/用户文件 → 动态内容；
3. **用消息而非系统提示变更**：动态信息优先通过 `<system-reminder>` 追加到 user message；
4. **绝不中途增删工具**：用 `defer_loading` 替代增删，用工具自身模拟状态切换；
5. **压缩 fork 必须共享父前缀**：压缩复用相同 system prompt + tools + context，末尾追加压缩指令。

### 8.2 S7 四层结构与落地状态〔perf2 §S7〕

设计目标（从最稳定到最动态）：

| 层 | 内容 | 落地状态（2026-10-01 核对） |
|---|---|---|
| L1 全局稳定 | 工具定义，**确定性顺序（`function.name` 字母序**，`toolRegistry.ts:465` `localeCompare`；defer 运行时归 [SPEC-AGENT-TOOL §5](./agent-tool-runtime.md)） | ✅ 已落地（phase2 交付） |
| L2 会话稳定 | 系统角色、行为规则、Skills 描述 | ✅ 静态段在前（组装顺序见 §2.2） |
| L3 项目稳定 | 规范类文件（WeaveMD 落为三文件块） | ✅ 已落地（memory-2 A1） |
| L4 动态 | 文件列表快照、文档上下文 → 设计要求**迁出 system、改 `<system-reminder>` 追加到 user message** | ⚠️ **未落地**：现状动态快照仍在 system prompt **尾部**，文档上下文为独立前置 system 消息（§6.2）；`<system-reminder>` 通道全仓无实现 |

S7 原案在 phase2 批次**仅部分落地**（commit `ee459bc` 记录：字母序已交付，提示分层与动态上下文迁移未包含）。
现状「静态在前、动态置尾」满足原则 2 的 system 内排序，但**原则 3 的消息侧迁移是已知欠账**；
调整动态内容位置前必须先读 §8.1 原则 1（任何迁移都是一次性的前缀失效决策）。

## 9. 边界与红线（交叉引用，不在此复述）

- 叙述削减的功能质量红线与 5 项豁免 → req [agent-cost-optimize §硬性约束 / §质量护栏](../../requirements/agent-cost-optimize.req.md)；
- 反上下文改写的边界（合法指代允许沿用历史、跨话题由规则 1 兜住）→ req [agent-memory-optimize P0-2](../../requirements/agent-memory-optimize.req.md)；
- 三文件/画像的 token 上限与截断裁定 → req-2 Q4 / §四；chat 也注入 → req-2 Q15；
- 经验注入的意图范围与 chat 歧义处置 → req-3 D4（5 显式意图、chat 不注入）；
- 铁律一仅约束笔记内容写入，**不约束上下文拼装**（req-1 红线 2）；
- 不减少历史轮次、不截断工具结果（req-perf §硬性约束「上下文不瘦身」）。

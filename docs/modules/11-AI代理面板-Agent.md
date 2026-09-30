# AI 代理面板 (Agent) 功能总结

> 模块编号：11 | 优先级：P1 | 最后更新：2026-09-18
> 需求编号：AGT-01~19 / KB-01~05（docs/REQUIREMENTS.md 3.7 / 3.8）

**关联文档（渐进式披露，按需加载）：**

| 文档 | 内容 |
|------|------|
| [ai-panel-features](../specs/ai-panel-features.md) | 7 期分期实施 + 体验优化 + Notus 对齐 + 写控制 + Agentic RAG 交付记录 |
| [ai-agent 架构](../architecture/ai-agent.md) | Agent 循环 / 工具系统 / 意图路由 / 协议分流 |

> 本文档保留 §1-§6（功能概述、架构、设计决策、数据模型、模块交互、未决项）+ §7-§10（Diff 卡片系统、提问卡片系统、触发优化、Emoji 禁令）。

---

## 1. 功能概述

右侧 AI 面板（顶部导航栏「AI」按钮开合），**仅 Agent 模式**（Chat 模式已删除）：

- **Agent**：辅助创作——30 个工具（5 核心 + 25 延迟；只读/写入/交互/搜索）+ 3 内置 skills + 用户扩展 + 意图识别/提问卡片/上下文压缩/工具调用轨迹 + 知识库召回（FTS5）与出处
- **块级改写**：AI 面板 composer 输入 `@文档 ` / `@ + 描述` 触发（document scope）→ 红删绿增预览 → 确认 `updateContent` 入 undo 栈
- **Composer 标签**：TipTap contentEditable 实现，`/skill`（蓝色 chip）和 `@file`（绿色 chip）以可视化标签渲染，支持整体选中/删除，@tiptap/suggestion 自动补全
- **AI 标题自动编号**：渲染层自动为 h1-h4 添加编号（h1→中文数字、h2→阿拉伯、h3→层级、h4→带圈），已有编号检测跳过
- **Agentic RAG**：所有非 chat 意图均可自主调用 searchKB（LLM 决定是否检索）
- **HyDE**：假设性文档 embedding 检索（语义匹配更精准）

两条铁律：**① AI 写入必经确认**；**② 笔记外发必须用户知情同意**（联网同意已停用，三配置齐全即视为许可）。

**三视图 UI**：home（RECENT 最近 3）/ session（会话）/ settings（设置侧栏）

## 2. 架构位置

```
src/main/ai/                  # AI 主进程服务
├── llm/                      # LLM 客户端（remote-only SSE 流式）
│   ├── llmClient.ts
│   └── modelList.ts
├── agent/                    # Agent 核心
│   ├── agentLoop.ts          # 函数调用循环（按意图 6~12 轮）
│   ├── agentLoopGuard.ts     # 死循环检测
│   ├── agentSession.ts       # 会话管理
│   ├── agentTaskQueue.ts     # 任务队列
│   ├── agentTaskWorker.ts    # 后台任务执行器
│   └── agentEventStore.ts    # 事件持久化
├── knowledge/                # 知识库
│   ├── kbIndexer.ts          # 导入/分块/增量重索引
│   ├── kbSearch.ts           # FTS5 关键词召回
│   └── embeddingClient.ts    # Embedding 客户端
├── tools/                    # 工具处理器（30 个）
│   ├── webSearch.ts          # 联网搜索
│   ├── deleteLocalFile.ts    # 本地文件删除
│   ├── previewFileRevision.ts# 全文修订预览
│   └── ...
├── toolRegistry.ts           # 工具注册表
├── intentRouter.ts           # 意图路由（规则启发式 6 类）
├── contextManager.ts         # 上下文压缩
├── skills/                   # Skills 体系（loader/paths/autoStore/distiller/manager/installer）
├── searchClient.ts           # 多引擎搜索客户端
└── ipc/                      # IPC handler 按域拆分（7 模块）

src/render/components/AIAgent/   # 面板 UI
├── panel/                      # 三视图外壳
├── cards/                      # QuestionCard 底部滑出面板
└── settings/                   # AI 设置组件

src/render/stores/
├── agentStore.ts               # 会话状态 + 工具轨迹 + 提案
└── rewriteStore.ts             # 改写状态机
```

## 3. 关键设计决策

| 维度 | 决策 |
|------|------|
| LLM 后端 | 仅远程 OpenAI 兼容 API（remote-only，必须填 key） |
| 知识库 | 账号内全部笔记 + 导入 md/txt 文档统一索引（FTS5） |
| 召回 | FTS5 关键词召回 + 拒答阈值 0.6 + 出处可跳转 + 置顶 ×1.5 |
| 意图识别 | 规则启发式 6 类（chat/rewrite/create/tech/kbQa/web） |
| 上下文压缩 | token 估算 = 字符数/4；动态阈值自动触发 |
| 写控制 | writeMode: auto/manual；staleness detection（MD5） |
| 搜索配置 | 未配置时不注入 web_search（避免 LLM 调用失败） |
| 安全 | safeStorage 加密密钥；系统路径黑名单（deleteLocalFile） |

## 3.1 最近优化（2026-09-18 agent-md-kb-optimize）

### 知识库检索管线可观测性

在 `searchKB()` 全链路添加 `performance.now()` 耗时统计和候选数量统计，返回可选 `diagnostics` 字段：

```typescript
interface IKbDiagnostics {
  timings: { fts5Ms, vectorMs, titleMs, rrfMs, weightingMs, aggregationMs, rerankMs, totalMs };
  counts: { fts5Candidates, vectorCandidates, titleCandidates, mergedCandidates, afterWeighting, afterAggregation, finalResults };
  cacheSnapshot?: { searchResultHit, rerankHit };
  queryUnderstanding?: { intentType, isFallthrough, hadPronounRef };   // D1 已接线（2026-09-30）
  researchLoop?: { subQueryCount, cacheHits, totalResults };           // 仅声明，尚未赋值
}
```

**关键文件**：`src/shared/ai/kb.ts`（接口）+ `src/main/ai/knowledge/kbSearch.ts`（埋点）

#### `queryUnderstanding` 已接线（2026-09-30 agent-memory-optimize-3 / D1）

- 赋值点：`kbSearch.ts` 主路径、缓存命中变体、两条早退路径（`cleaned` 空 / 候选为空）**四处全部回传**，四类调用都计入指代触发率分母。
- `intentType` = `mapIntentToType(detectQueryIntent(query))`（独立取值，不与 rerank 局部变量耦合）；`isFallthrough` = 意图规则零命中 → chat fallback（`intentRouter.classifyIntent(query).intent === 'chat'`）。
- `hadPronounRef` 由新增可选入参 `KbSearchOptions.hadPronounRef` 驱动（kbSearch 不持有 history，改写在 `searchKBHandler` 层发生），缺省保守记 `false`。
- 落点：`searchKBHandler` 把 diagnostics 作为**独立小节**挂进工具 `content`（`ai_messages.content` / `agent_run_events.payload_json` 两个既有 sink 可 SQL 查询），既有字段 `results`/`refused`/`threshold`/`best`/`clarificationContext` 一律不动；`searchKb` 未回传 diagnostics 时 content 保持改前的裸数组形状。
- **反向指标警告**：`detectAmbiguities` 的 `pronoun_reference` = 有指代词但无历史（未消解），与 `hadPronounRef` 方向相反，**不可互推**。
- `researchLoop` 字段目前仍**仅声明未赋值**（`researchLoop()` 在 `knowledgeContext.ts`，不产出 `IKbDiagnostics`），待后续接线。

### 研究循环并行化

`knowledgeContext.ts` 的 `researchLoop()` 从串行 `for...of` 改为 `Promise.allSettled()` 并行执行：

- **并发限制**：最多 3 个并行子查询
- **提前终止**：`highQuality >= 3` 时停止
- **错误隔离**：单个子查询失败不影响其他
- **串行 fallback**：并行执行失败时自动降级

**关键文件**：`src/main/ai/knowledge/knowledgeContext.ts`

### Agent 代码重复消除

提取 `processStreamingToolRound()` 和 `executeToolRound()` 的 8 块公共逻辑到 `agentToolExecutor.ts`：

| 函数 | 说明 |
|------|------|
| `deduplicateAskQuestionCards` | ask_question_card 去重 |
| `assembleToolTurn` | toolTurn 组装 |
| `extractThinkingText` | thinking 文本提取 |
| `validateQuestionCardArgs` | 参数预验证 |
| `checkForceConfirmTools` | FORCE_CONFIRM_TOOLS 拦截（统一浅拷贝） |
| `mergeResultsWithBudget` | 结果合并 + 聚合预算 |
| `processToolResultsLoop` | handleToolResult 循环 |
| `handleInteractionPause` | 交互暂停 |

**关键文件**：`src/main/ai/agent/agentToolExecutor.ts`（导出）+ `src/main/ai/agent/agentLoop.ts`（调用）

### 延迟工具重发优化

- **重发上限**：`while (deferredRetryCount < 3)` — 最多 3 次总调用（1 原始 + 2 重试）
- **保留已执行结果**：通过 `executor.waitForAll(skipSet)` 收集非延迟工具结果，注入 LLM 上下文
- **Schema 升级追踪**：`upgradedDeferredTools` Set 避免无限重试
- **遥测日志**：`console.debug('[AgentLoop] 延迟工具重发', {...})`

**关键文件**：`src/main/ai/agent/agentLoop.ts` L259-430

## 3.2 Skills 加载链路、提炼技能与经验注入（2026-09-30 agent-memory-optimize-3 / D3 + D4）

### 加载链路（六.1 的三条断链已修复）

修复前：`agentContext.ts` 与 `skillManager.ts` **4 处无参 `loadSkills()`** → 只返回内置 3 个
core skill → 用户手写技能与提炼技能对 `runSkill` / `list_skills` 完全不可见（渲染侧
`agent:skills:list` 另有 5 个目录，保持不动）。

修复后（`src/main/ai/skills/skillPaths.ts` 统一推导目录）：

| 调用点 | 改动 |
|---|---|
| `agentContext.ts`（组装 `ctx.skills`） | `loadSkills(getDefaultSkillDirs())` —— 影响 `runSkill` |
| `skillManager.ts` × 3（`getManagedSkills` / `getManagedSkill` / `setSkillEnabled`） | 同上 —— 影响 `list_skills` / `get_skill_details` |
| `loadSkills()` 无参 | 默认走 `getDefaultSkillDirs()`（含 `userData/skills`），非 Electron 环境返回 `[]` |

扫描目录 = `userData/skills`，支持三种结构：`<name>/SKILL.md`、`<name>.md`、
`_auto/<name>.md`；**同名冲突 `console.warn` 后跳过后加载者**（内置 core 优先）。

### 提炼技能存储（纯文件系统，无 DB 表）

```
userData/skills/
├── <name>.md / <name>/SKILL.md   # 用户手写技能（既有）
└── _auto/                        # 提炼生效技能（status: active）
    └── _drafts/                  # 提炼草稿（status: draft，人工确认前绝不生效）
```

- 单文件格式沿用 front matter + 正文：`name:` / `description:` / `status:` / `source: auto`。
- **双重防线**：`_drafts/` 不参与扫描；`_auto/` 内必须 `status: active`；任意位置
  `status: draft` 一律过滤 —— 未确认草稿不进 `ctx.skills` / `list_skills` / `runSkill` / 任何 prompt。
- 技能名闸 `auto_[a-z0-9_]{1,60}`（`skillPaths.AUTO_SKILL_NAME_RE`）+ 路径闸 `isPathInside`
  （解析后绝对路径必须落在目标目录内），两道闸任一不过即拒绝、零副作用。

### 后台提炼任务（`skillDistiller.ts`，范式抄第二批 `memoryWriter.ts`）

触发链：`AgentTaskWorker.handleTaskSuccess` 在 **`AI_STREAM_DONE` 之后**调
`maybeEnqueueSkillDistillation`（同步快速返回：节流 + 同会话 pending 去重 + 入队，绝不调 LLM）
→ 队列轮询取出 → `processSkillDistillTask` → `runSkillDistillJob`：

1. 轨迹筛选：`hasCompletedAgentTask(conversationId, userId)` 只认 `agent_task_queue.status='completed'`；
2. 轨迹读取：**新增** `getConversationMessagesPage(conversationId, userId, { limit, beforeId })`
   （`rowid` 游标分页 + `user_id` 隔离 + 全参数化），既有 `getRecentMessagesByRounds` **零改动**；
3. LLM 结构化提炼 → `parseSkillDrafts` 严格校验（name 正则 / 长度 / 条数 ≤ 3，
   **任一项不合法整批抛错零写入**）→ 语义去重（同 name / 同 description 跳过并 warn）→ **只写草稿目录**；
4. 失败落 `failed` 不重试、`console.error` 带上下文，**永不 reject**（不阻塞下一轮提问）。

节流常量 `SKILL_DISTILL_MIN_ROUND_GAP = 4`（**无实测数据、待校准**）。pending 去重按
「同会话任意 pending」判定，避免 `AgentTaskQueue.enqueue` 的 supersede 误伤 `memory_extract`。

### 人工确认入口（半自动铁律）

- IPC 三通道 `ai:skilldraft:list` / `:approve` / `:reject`（`ipc/skillDraftHandlers.ts`），
  **照抄第二批 C3 `memoryHandlers.ts` 范式**：`isTrustedSender` + JWT 解 `userId` + `findById`
  + fail-closed + 名称/路径双闸；**不接受渲染层传入 userId**。
- `approveDraftSkill` 是**唯一** draft → active 路径（写 `_auto/<name>.md` 并标 `status: active`，
  再删草稿）；`rejectDraftSkill` 删除草稿文件。
- 设置页入口：`Settings/SkillsPanel.tsx`「提炼技能（待确认）」栏 —— 只读列表 + 二次确认的
  「确认启用 / 驳回」，数据走 `agentStore.loadSkillDrafts / approveSkillDraft / rejectSkillDraft`。

**关键文件**：`src/main/ai/skills/{skillPaths,skillLoader,skillAutoStore,skillDistiller,skillManager}.ts`、
`src/main/db/ai.ts`（分页查询 + 成功终态）、`src/main/ai/agent/agentTaskWorker.ts`（触发与路由）、
`src/main/ai/ipc/skillDraftHandlers.ts`、`src/render/components/AIAgent/settings/SkillsPanel.tsx`

**已知缺口（记 TODO）**：`sendRoutes.ts` 的 `routeSlashSkill` 仍把 `/skillname` 前缀剥掉
（技能名不进主进程），改渲染→主进程载荷结构超出 D3 范围；`isSkillEnabled` 仍无调用方。

### 任务类型标注与经验注入（2026-09-30 agent-memory-optimize-3 / D4 六.2）

**经验的载体 = D3 的生效技能文件正文**（`_auto/<name>.md` 的 instructions markdown 步骤天然
保持顺序），**不新建存储、不建表、不碰 `db/index.ts` 与迁移**。D4 只做两件事：front matter 加
`intents` 字段 + 按意图注入经验块。

#### front matter 新增可选 `intents:`（D4 唯一的数据结构扩展）

| 环节 | 行为 |
|---|---|
| `skillLoader.parseSkillMarkdown` | 逗号分隔 `rewrite, kbQa` 或 JSON 数组 `["rewrite","kbQa"]` 等价；值须落在白名单，**非法值（含 `chat`）忽略并 `console.warn`**；字段缺失 → `undefined`（未标注）、全非法 → `[]`（已标注却不适用） |
| `skillAutoStore.assertValidSkillDraft` | 草稿侧**严格校验**：非数组 / 空数组 / 白名单外（含 `chat`）→ 抛错，与其余字段同口径整批拒写；缺省合法（D3 与更早格式零回归） |
| `skillAutoStore.serializeSkillFile` | 带 `intents` 才写该键，老文件往返无差异 |

**白名单 `EXPERIENCE_INTENTS = [rewrite, kbQa, tech, web, create]`**（定义在
`agentPromptBuilder.ts`，注入侧与技能侧共用同一口径）。**`chat` 不在其中**：它是 `intentRouter`
的无规则 fallback（`scores.size===0` 即落 chat），无法区分闲聊与未知任务类型，**一律不注入**。

#### 注入链路（读取一次，两个分支各传一次）

```
prepareAgentContext
  ├─ skills    = loadSkills(getDefaultSkillDirs())   # D3 已修的加载链路
  ├─ intent    = classifyIntent(...)                 # 既有计算，零成本
  └─ experienceBlock = buildExperienceBlock(skills, intent.intent)
        ├─ intent 不在白名单（含 chat）→ ''（一律不注入）
        ├─ 技能标了 intents → 只看显式命中，不回落推断（[] = 已标注却不适用）
        ├─ 未标 intents → classifyIntent(name + description) 推断，不中就不注入
        └─ 无匹配 / 无技能 → ''（零占位噪音，与 A1/B4 同口径）
  └─ buildAgentSystemPrompt(…第 7 参) / buildChatSystemPrompt(…第 3 参)
        块位置：核心规则 → 三文件 → 画像 → **经验** → ## 工作流（chat 侧 → 锚点前）
```

- **顺序保持**：块内按 `skills` 原序拼接（显式命中在前、推断命中在后），instructions 正文
  原样插入 —— 步骤顺序不被洗乱；超 `EXPERIENCE_TOKEN_LIMIT` 截断 + `(经验过长已截断)` 标注。
- **预算**：`EXPERIENCE_TOKEN_LIMIT = 2000`，与 A1/B4 同一预算刻度（三层个性化块合计 ≤6000
  = 9.4% 窗口）。实测（`estimateTokens`）：典型提炼技能 **188 token**、4000 字极限技能
  **2521 token**（截断保留 2000）；主提示三块典型满载 **3150（4.92%，余量 60850）**、
  三块顶格最坏 **7562（11.82%，余量 56438）**。单次会话匹配技能条数分布 **[待校准]**。
- **护栏**：缺省第 7 参 / 传空串 / 传纯空白 → 输出与改动前**逐字一致**（sha256 基线全绿），
  空块不留标题、不留空行残留。
- **调试用**：`chat` 意图、未命中意图、无技能三条路径均为零注入，因此经验块只在 5 个显式
  规则意图上出现。

**D4 关键文件**：`src/main/ai/agent/agentPromptBuilder.ts`（`EXPERIENCE_INTENTS` /
`EXPERIENCE_TOKEN_LIMIT` / 两函数加参与插块）、`src/main/ai/agent/agentContext.ts`
（`buildExperienceBlock` + 两分支接线）、`src/main/ai/skills/skillLoader.ts`（`intents` 解析）、
`src/main/ai/skills/skillAutoStore.ts`（草稿校验与落盘）、`src/main/ai/skills/skillDistiller.ts`
（提炼 prompt 要求标注 `intents`）。

## 4. 数据模型

```sql
ai_config(id, user_id UNIQUE, remote_base_url, model, api_key_enc, write_mode, ...)
ai_conversations(id, user_id, mode, summary, created_at, updated_at)
ai_messages(id, conversation_id, role, content, tool_call_id, tool_calls, created_at)
agent_run_events(id, session_id, conversation_id, seq, event_type, payload_json, created_at)
kb_documents(id, user_id, file_id, source_type, title, pinned, status, created_at)
kb_chunks(id, document_id, seq, content, vector BLOB, embedding_model, source_ref, created_at)
kb_chunks_fts -- FTS5 虚拟表 + 触发器同步
images_vec -- vec0 虚拟表（仅图片向量）
```

## 5. 与其他模块的交互

| 模块 | 交互 |
|------|------|
| 编辑主区 v2 | 块级改写复用块树 + 面板 `@文档 ` 触发（document scope）+ updateContent 可撤销 |
| 文件管理 | 知识库检索账号内文件 + 保存/删除联动重嵌入 |
| 设置界面 | AI 配置（key/联网/写模式/阈值）加入设置面板 |
| 数据持久化 | 8+ 表 + safeStorage 加密 |
| IPC | 111 通道（11 组） |

## 6. 未决项 / 延期

- ⚠️ **真 MCP server 管理**（context7/firecrawl）——延期
- ⚠️ **GitHub 自取 `writing-shape` 技能**——延期
- ✅ 其余功能均已交付（详见 [交付记录](../specs/ai-panel-features.md)）

---

## 7. Diff 卡片系统

### 7.1 DiffSummaryCard 统一组件

三种写工具的预览卡片——改写（rewrite）、块级编辑（editBlocks）、文件补丁（patch）——曾分别独立
实现 diff 渲染逻辑。现已统一为 `DiffSummaryCard` 单一组件，通过 **discriminated union type**
路由数据源：

```ts
type DiffSummarySource =
  | { kind: 'rewrite'; data: RewriteProposal | RewriteFileProposal[] }
  | { kind: 'editBlocks'; data: EditBlocksProposal[] }
  | { kind: 'patch'; data: IPatchProposal[] };
```

- **`normalizeSource()`**：将三种异构数据源标准化为 `NormalizedDiffFile[]`（label / oldContent /
  newContent / sourceIndex）
- **`diffLines()`**（`src/render/filters/rewriteDiff.ts`）行级 LCS diff，红删绿增统一渲染
- 单文件场景在标题行直接显示 `(−N / +M)` 统计；多文件场景显示文件名列表（>50 个文件默认截断，
  提供"显示全部"按钮）
- 操作行：`全部废弃` / `查看详情` / `全部应用`（应用后切换为 `关闭`）
- 结果态横幅：已应用（绿色）+ 已取消（灰色）

### 7.2 三种薄壳卡片

| 卡片 | 文件 | 职责 |
|------|------|------|
| `RewritePreviewCard` | `cards/RewritePreviewCard.tsx` | 读 rewriteStore，构建 `{ kind: 'rewrite' }` source，error/stale banner 逻辑 |
| `EditBlocksPreviewCard` | `cards/EditBlocksPreviewCard.tsx` | 读 agentStore.editBlocksProposals，构建 `{ kind: 'editBlocks' }` source |
| `PatchPreviewCard` | `cards/PatchPreviewCard.tsx` | 读 agentStore.patchProposals，构建 `{ kind: 'patch' }` source |

薄壳卡片仅负责 **store 读写 + 详情面板开关**，diff 渲染全量委托给 `DiffSummaryCard`。
不传 `onApplyAll` / `onDiscardAll` / `onDismiss` 时，`DiffSummaryCard` 内部
`useDiffSummaryHandlers` hook 按 `source.kind` 自动路由到对应 store 方法。

### 7.3 DetailModal 系统

三种详情面板，均通过 `createPortal` 挂载到 `document.body`，实现**居中全应用模态框**：

| 详情面板 | 文件 | 特性 |
|----------|------|------|
| `RewriteDetailModal` | `cards/RewriteDetailModal.tsx` | 左侧文件列表 + 右侧行级 diff；单文件按 fileName 选 |
| `EditBlocksDetailModal` | `cards/EditBlocksDetailModal.tsx` | 左侧文件列表 + 右侧行级 diff；**同名文件合并**（`mergeProposalsByFile`）；按 toolName 区分标题 |
| `PatchDetailModal` | `cards/PatchDetailModal.tsx` | 展平所有 proposal.files 的扁平列表；[新增]/[删除] 类型标记 |

三个 DetailModal 共享样式风格：
- macOS 三色圆点标题栏（复用 `insert-url-modal` CSS class）
- `Escape` 键关闭
- 左侧文件列表可点击切换，右侧实时 diff 预览

### 7.4 mergeProposalsByFile（同名文件合并）

`editBlocks` 工具可能在同一轮被多次调用（例如 LLM 先输出草稿再修正同一文件），同一文件名的
多个提案需要合并为一个展示：

- 以 `fileName` 为 key 去重，取首个 `originalContent` + 最后一个 `newContent`
- 返回合并后的虚拟提案列表 + 每个虚拟项对应的原始索引数组（`originalIndices`），
  便于 apply/discard 时批量操作

### 7.5 流式延迟显示

三种薄壳卡片在渲染时均检查 `useAgentStore.isStreaming`：

```
if (isStreaming) return null;
```

流式传输期间不显示任何预览卡片，避免用户在 LLM 回答未完成时误触 `全部应用` /
`全部废弃`。流式结束后（isStreaming 切回 false），卡片自动出现。

### 7.6 Staleness 检测

用户在 AI 回答期间可能手动编辑文档，导致预览 diff 的基准内容过期。
`useDiffSummaryHandlers` hook 在 apply 前执行 staleness 检测：

| source.kind | 检测方式 |
|-------------|----------|
| `rewrite` | 调 rewriteStore.applyRewrite → 读 `staleRejected` 标记 |
| `editBlocks` | 对比首个 pending proposal 的 `originalContent` 与当前编辑器 `content`。**豁免**：`editLocalFile` / `createFile`（直接写盘工具，文件已变更，无需比对 originalContent） |
| `patch` | 对比 proposal 的 `contentHash`（数组或单值）与当前编辑器 `simpleHash(content)` |

检测失败时显示红色横幅 `"文档已被外部修改，请重新生成"`，apply 操作被拦截。

---

## 8. 提问卡片系统

### 8.1 QuestionCard 向导模式

`QuestionCard`（`cards/QuestionCard.tsx`）实现类 `useReducer` **单题向导状态机**：

- **状态**：`answers`（Record<string, string>）、`currentIndex`、`slideDirection`、
  `shakeTarget`、`showOtherInput`、`otherText`
- **可见性过滤**：支持 `dependsOn` + `condition` 条件依赖，不满足条件的问题自动跳过
- **底部滑入动画**：半透明遮罩层（`z-40`）+ 面板从底部 `translateY` 滑入（`z-50`），
  使用 `requestAnimationFrame` 触发 CSS transition
- **进度圆点指示器**：纯指示器（不可点击），当前题 accent 填充 + ring，已答半透明，
  未答空心边框

### 8.2 选择题 300ms 自动跳转

选择题和确认题选中后 **300ms 自动跳转到下一题**（最后一题不自动跳转），
通过 `useRef<setTimeout>` 管理，切换题目时清除前一个定时器。

### 8.3 未回答提交检测

点击提交时遍历所有可见题，找到第一个未回答的题：
- 跳转到该题（`setCurrentIndex`）
- 设置 `shakeTarget` 触发红色震动 + 边框动画（`question-card-shake` CSS）
- 2 秒后自动清除震动状态

### 8.4 ABCD 选项标签 + 加粗蓝色问题

- **选项标签**：`String.fromCharCode(65 + idx)` 生成 A/B/C/D 圆形标签，
  选中时 accent 填充白色数字
- **题目文本**：`text-[var(--accent)] font-bold`（加粗蓝色），字号 15px
- 选择题提供"其它"按钮，点击后弹出内联文本输入框，自动聚焦

### 8.5 删除确认变体

`variant="delete_confirm"` 触发红色警告样式：
- 标题：红色脉冲圆点 + "此操作不可恢复"
- 确认按钮：`bg-gradient-to-r from-red-500 to-red-600`
- 取消按钮：红色边框透明背景

### 8.6 分轮澄清策略（buildClarificationContext）

`knowledgeClarify.ts` 中的 `buildClarificationContext` 实现分轮策略，
与 Agent 的 `ask_question_card` 工具联动：

| 场景 | 歧义类型 | 问题类型 |
|------|----------|----------|
| 代词指代不清 | `pronoun_reference` | 文本题："你提到的「X」具体指的是什么？" |
| 缺少主语 | `missing_subject` | 文本题："能否提供更多细节？" |
| 范围过广 | `broad_scope` | 选择题："概念解释/操作步骤/技术细节/最佳实践" |
| 太短 | `too_short` | 文本题："请描述更详细一些" |

**分轮策略**：第 1 轮核心歧义消解（文本提问，最多 2 题）→ 第 2 轮范围细化（choice 提问，
最多 2 题）。生成格式化的澄清上下文字符串，注入 `searchKB` 工具的返回结果，
引导 LLM 在下一轮调用 `ask_question_card`。

### 8.7 detectTextQuestions 文本问题检测兜底

`agentLoop.ts` 中的 `detectTextQuestions` 函数作为兜底扫描器：

- 匹配问号（`?` / `？`）
- 匹配提问关键词模式
- 匹配编号问题模式

当 LLM 在文本中直接提问（而非使用 `ask_question_card` 工具调用）时，
系统注入指令强制下一轮使用正确的工具调用形式。仅在有 `ask_question_card` 工具可用时触发。

### 8.8 needsClarification 意图标记

`intentRouter.ts` 在以下条件设置 `needsClarification: true`：

- 置信度 < 0.7
- 输入文本 < 6 字符
- 置信度 < 0.85 且文本 < 10 字符
- chat fallback 时文本 < 10 字符

`agentLoop.ts` 启动时检查 `needsClarification` 标志：即使意图判为 chat，
只要 `needsClarification` 为 true，就使用 Agent 提示词 + 提供
`ask_question_card` 工具，确保模糊输入可以被追问澄清。

---

## 9. 触发优化

### 9.1 ask_question_card 去重

DeepSeek 等模型在流式输出中可能先输出不完整的 tool call（空 questions 数组），
然后再输出完整调用。`agentLoop.ts` `executeToolCalls()` 在每轮执行前进行**跨轮去重**：

```ts
const dedupedToolCalls = accumulatedToolCalls.filter((tc, idx, arr) => {
  if (tc.name !== 'ask_question_card') return true;
  // 空 questions → 丢弃（除非是最后一个）
  // JSON 解析失败 → 如果后面还有同名调用则丢弃
});
```

两层防护：
1. **跨轮去重**（同一次 tool_calls 数组内多个 ask_question_card 调用的合并）
2. **同轮兜底**（空参数调用被过滤，只保留最后一个有效调用）

### 9.2 editLocalFile diff 预览

`editLocalFile` 工具在写盘前先读取旧内容，生成 diff 提案供用户预览：

- 读取目标文件的当前内容作为 `originalContent`
- 将 LLM 生成的新内容作为 `newContent`
- 构建 `EditBlocksProposal` 推送 UI 端，通过 `DiffSummaryCard` 展示红删绿增
- 确认后才执行实际写盘

### 9.3 chat 意图 ask_question_card 支持

`agentToolSelector.ts` 的 `toolsForIntent()` 中，chat 意图也提供了 `ask_question_card`
工具（当 `hasInteractionSupport` 为 true 时）：

```ts
case 'chat':
  if (hasInteractionSupport) {
    names.add('ask_question_card');
  }
  return all.filter((t) => names.has(t.function.name));
```

结合 `needsClarification` 标志，确保模糊/简短的 chat 输入能被 Agent 追问澄清，
而非 LLM 直接猜测意图后输出可能不准确的回答。

---

## 10. Emoji 禁令

Agent 系统提示词（`agentPromptBuilder.ts`）明确禁止 LLM 在回复中使用 emoji：

```
- 禁止在回复中使用 emoji 表情符号（如 ⚠️ ❌ ✅ 🎉 等）。使用纯文本标记代替。
```

此规则同时影响：
- **Chat 系统提示词**（`CHAT_SYSTEM_PROMPT`）：闲聊模式同样禁止 emoji
- **Agent 系统提示词**：所有意图的 Agent 回复均受约束
- **格式规则**：LLM 被要求使用 `**粗体**`、`- 列表` 和标题代替 emoji 标记

此规则在系统提示中的位置靠前（格式规范区块），确保 LLM 优先遵守。

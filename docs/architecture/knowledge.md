# 知识库系统架构

> 最后更新：2026-10-01

## 系统概览

知识库系统提供文档导入、分块、索引和检索能力，基于 SQLite FTS5 全文检索。

## 核心流程

```
文档导入 → 分块（jieba 分词） → FTS5 索引
    ↓
用户查询 → 意图识别 → searchKB 工具
    ↓
FTS5 关键词召回 → 结果返回 LLM
```

## 索引模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 导入/分块 | `kbIndexer.ts` | 7 格式导入（先 `parseDocument` 再入索引，失败写 `status='error'`）+ 按段落分块 + 增量重索引 + 附件关联（`source_type='attachment'`） |
| 分词 | `tokenizer.ts` | jieba-wasm（cut_for_search + bigram 回退） |
| 图片索引 | `imageIndexer.ts` | images_vec 表 + 多模态 embedding |
| Embedding | `embeddingClient.ts` | 向量生成（HyDE 用） |

### 索引时机

- 导入/置顶：即时索引
- 文件保存：防抖异步重索引（~1200ms）
- 文件删除：同步清除 FTS

### 索引状态

```
pending → done → error
```

## 检索模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 关键词召回 | `kbSearch.ts` | FTS5 BM25 检索 |
| 检索缓存 | `searchCache.ts` | 搜索结果缓存（3min TTL）+ 重排缓存（5min TTL） |
| 查询理解 | `queryPlanner.ts` | 5 类意图 + 指代消解 + 查询扩展 |
| 意图透传 | `kbSearch.ts` | `diagnostics.queryUnderstanding.agentIntent`（Agent 任务意图，Q21 诊断字段，不改检索参数） |
| 知识澄清 | `knowledgeClarify.ts` | 歧义检测 → 澄清卡片 |
| 证据分级 | `knowledgeRuntime.ts` | 4 级：grounded/weak/conflicting/no_evidence |
| 研究循环 | `knowledgeContext.ts` | 证据不足自动子查询 |

### Agent 任务意图 ↔ KB 检索策略意图：桥接不合并（Q21，agent-multi-intent 任务 9）

项目里存在两套「意图」，**语义不同、层级不同，桥接但不合并**：

| | Agent 任务意图 | KB 检索策略意图 |
|------|----------------|-----------------|
| 类型 | `IntentName`（create/rewrite/kbQa/tech/web/chat） | `QueryIntentType`（fact/procedure/comparison/summary/follow_up） |
| 判定方 | `intentRouter`/`intentTiering`（Agent 侧） | `queryPlanner.classifyIntent`（规则，KB 侧） |
| 作用 | 决定**工具集**（`toolsForIntent`）与子任务链编排 | 决定**检索策略**（`expandByIntent` 扩展词、follow_up 实体替换） |
| 不做 | 不改写 searchMode / topK / threshold | 不拆任务、不增减工具 |

**透传链路（仅诊断，Q21）**：`ToolCtx.agentIntent`（`agentContext` 构造 toolCtx 时注入主
intent；子任务链 `subtaskOrchestrator.applySubtaskContext` 切换子任务时覆写为
`subtask.intent`）→ `searchKBHandler` 调用 `ctx.searchKb` 时透传
`opts.agentIntent` → `kbSearch.buildQueryUnderstanding` 写入
`diagnostics.queryUnderstanding.agentIntent`（**可选字段**，缺省不写键，旧消费端忽略）。

- **冲突优先级**：Agent 定工具集、KB 定检索策略，**以 Agent 为准** —— Agent 判 chat 则
  工具集无 `searchKB`（queryPlanner 判 comparison 也不影响）；Agent 判 kbQa 则工具可用，
  扩展策略仍按 planner（`expandedQueries` 含比较/步骤扩展）。
- **检索参数红线**：`agentIntent` 只进 diagnostics 作审计/诊断，**不改**
  `searchMode / topK / threshold / pinnedWeight`（延续 A3「意图只驱动扩展」约束）。
- **检索一次（kbQa 子任务）**：`applySubtaskContext` 在 kbQa 子任务（且
  `deps.searchKb` + useKnowledgeBase 闸齐全）按子任务 query 调
  `createPreloadedSearchKb` 单槽预载；工具首访**等待在飞预载落地后重扫**
  （`agentKbPreloader` 竞态兜底）→ 全链对该 query 底层检索恰一次。

### 检索模式

`searchMode` 三模式（`kbSearch.ts`，默认 `hybrid`）：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `fts5` | 纯关键词检索 | 精确术语 |
| `vector` | 纯向量语义检索 | 模糊/改述 |
| `hybrid` | FTS5 + 向量 + 标题三路 RRF | 通用查询 |

> **向量路径的前提**：`kbSearch` 只有拿到 `queryVector` 才走向量分支
> （`searchMode === 'vector' || 'hybrid'` **且** `opts.queryVector` 非空）。
> 而 `queryVector` **只在 `searchKB` 工具传 `hyde: true` 且已配置 embedding 时才生成**
> （`searchKBHandler.ts`）。因此**默认（hybrid）调用实际降级为 FTS5 + 标题匹配**
> （`kbSearch.ts:468` 注释：无 queryVector 时降级到纯 FTS5 + 标题）。
> `vectorSearch` 对 `kb_chunks.vector` 用 sqlite-vec `vec_distance_cosine`，扩展缺失时 try/catch 静默降级。
>
> **三模式的降级口径（不一致，勿混写）**——条件是**两段独立的 `&&`**：
>
> | 模式 | 无 `queryVector` 时的实际行为 |
> |------|------------------------------|
> | `fts5` | FTS5 + 标题（本就不用向量） |
> | `vector` | **不回退 FTS5**：路径 1（FTS5）与路径 2（向量）都不跑，**只剩路径 3 标题匹配**（及 agent 注入的 `expandedQueries` FTS）→ 无候选时按 0.6 阈值**规范拒答**，不降级 |
> | `hybrid`（默认） | **降级为 FTS5 + 标题**（路径 2 跳过，路径 1/3 照跑） |
>
> 即「任意模式都降级」的说法与实现不符（`agent-memory-optimize-3` req §七 已按红线判为「改文档不改代码」）。

### 拒答机制

召回分数低于阈值（默认 0.6）时拒答，避免幻觉。

## HyDE 假设性文档检索

```
用户查询 → LLM 生成假设性文档（100-200 字）
    ↓
createEmbedding 向量化
    ↓
向量语义检索 → 与 FTS5 结果 RRF 融合
```

增加约 1-2s 延迟，仅在 LLM 主动传 `hyde: true` 时触发。

## 数据模型

```sql
kb_documents(id, user_id, file_id, source_type, title, pinned, status, created_at, attachment_id)
             -- attachment_id 关联 parsed_attachments.id（B4/D3）；source_type 取值 'db'|'import'|'attachment'
             -- 删除附件经 removeParsedAttachment → removeByAttachment 清理关联 KB 文档
kb_chunks(id, document_id, seq, content, vector BLOB, embedding_model, source_ref, created_at)
             -- vector 由 kbIndexer 在配置了 embedding 时写入；未配置则为 NULL
kb_chunks_fts -- FTS5 虚拟表（jieba 分词，触发器同步；增删改均走标准 INSERT/DELETE，见 database.md）
kb_documents_fts -- FTS5 文档级虚拟表（增删改均走标准 INSERT/DELETE，见 database.md）
kb_images(id, document_id, source_ref, mime_type, embedding_model, created_at)
images_vec -- vec0 虚拟表，仅图片向量（sqlite-vec 可用时创建）
```

## KB 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| topK | 5 | 返回结果数 |
| threshold | 0.6 | 拒答阈值 |
| pinnedWeight | 1.5 | 置顶权重 |
| searchMode | hybrid | 检索模式 |

参数持久化到 `ai_config` 表，通过 `kb:get-settings` / `kb:set-settings` IPC 同步。

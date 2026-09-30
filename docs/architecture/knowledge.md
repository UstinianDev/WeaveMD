# 知识库系统架构

> 最后更新：2026-09-09

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
| 知识澄清 | `knowledgeClarify.ts` | 歧义检测 → 澄清卡片 |
| 证据分级 | `knowledgeRuntime.ts` | 4 级：grounded/weak/conflicting/no_evidence |
| 研究循环 | `knowledgeContext.ts` | 证据不足自动子查询 |

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
> （`searchKBHandler.ts`）。因此**默认调用实际降级为 FTS5 + 标题匹配**
> （`kbSearch.ts` 注释：无 queryVector 时降级到纯 FTS5 + 标题）。
> `vectorSearch` 对 `kb_chunks.vector` 用 sqlite-vec `vec_distance_cosine`，扩展缺失时 try/catch 静默降级。

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
kb_documents_fts -- FTS5 文档级虚拟表
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

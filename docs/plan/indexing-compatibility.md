# 索引流程兼容性设计

> 日期：2026-09-06 | 状态：设计完成

## 1. 目标

确保索引流程可扩展，支持未来 PDF/图片内容切片，同时保持向后兼容。

## 2. 现状分析

### 现有索引流程
```
kbIndexer.ts:
  indexNote()    → splitNote() → insertChunksBatch() → createEmbedding() → UPDATE vector
  indexFile()    → splitNote() → insertChunksBatch() → createEmbedding() → UPDATE vector
  indexDbFile()  → splitNote() → insertChunksBatch()  (纯 FTS5，无向量)
```

### 现有向量生成
```typescript
// kbIndexer.ts 行 143-174
if (embeddingConfig && insertedChunks.length > 0) {
  for (let i = 0; i < insertedChunks.length; i += EMBED_BATCH_SIZE) {
    const batch = insertedChunks.slice(i, i + EMBED_BATCH_SIZE);
    const response = await createEmbedding({
      baseUrl: embeddingConfig.baseUrl,
      model: embeddingConfig.model,
      apiKey: embeddingConfig.apiKey,
      input: texts,
    });
    // UPDATE kb_chunks SET vector = ?, embedding_model = ? WHERE id = ?
  }
}
```

### 现有数据库字段
```sql
-- kb_chunks 表
vector BLOB              -- Float32Array 向量
embedding_model TEXT     -- 记录用哪个模型生成的向量

-- kb_documents 表
source_type TEXT         -- 'db' | 'file' | 'url'
```

## 3. 兼容性分析

### 3.1 已具备的扩展能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 批量 Embedding | ✅ 已有 | `createEmbeddingBatch` 支持批量 |
| 多模态 Embedding | ✅ 已有 | `createImageEmbedding` 已实现 |
| embedding_model 记录 | ✅ 已有 | 每个 chunk 记录用哪个模型 |
| 向量搜索 | ✅ 已有 | sqlite-vec cosine 搜索 |
| 混合搜索 | ✅ 已有 | RRF 三路融合 |
| 批量大小控制 | ✅ 已有 | `EMBED_BATCH_SIZE` 可配置 |

### 3.2 未来扩展点

| 扩展 | 需要改动 | 影响范围 |
|------|---------|---------|
| PDF 内容切片 | 新增 `splitPDF()` 函数 | kbIndexer.ts |
| 图片 OCR 切片 | 新增 `splitImage()` 函数 | kbIndexer.ts |
| 图片 Embedding | 已有 `createImageEmbedding` | 仅调用方 |
| 搜索模式切换 | 新增 `searchMode` 参数 | kbSearch.ts |

## 4. 设计方案

### 4.1 索引流程扩展接口

```typescript
// kbIndexer.ts 新增分块策略枚举
type ChunkStrategy = 'text' | 'pdf' | 'image';

// 索引入口统一为 indexContent
async function indexContent(
  userId: string,
  documentId: string,
  content: string,
  strategy: ChunkStrategy,
  embeddingConfig?: EmbeddingConfigRow
): Promise<number> {
  const chunks = strategy === 'text'
    ? splitNote(content)
    : strategy === 'pdf'
    ? await splitPDF(content)
    : await splitImage(content);

  // 后续流程与现有逻辑一致：insertChunksBatch → createEmbedding
}
```

### 4.2 向量生成兼容性

现有逻辑已兼容：
- `createEmbedding` 接受 `string | string[]` 输入
- `createImageEmbedding` 接受 base64 图片
- 批量大小由 `embeddingConfig.batchSize` 控制
- 失败降级到纯 FTS5（已有 try-catch）

### 4.3 搜索模式兼容性

见 `embedding-architecture.md` 的搜索模式设计。索引时始终生成向量（如果配置了 Embedding），搜索时根据 `searchMode` 决定是否使用。

## 5. 结论

**当前索引流程已具备足够的扩展能力**，无需重构。未来添加 PDF/图片支持时：

1. 新增 `splitPDF()` / `splitImage()` 分块函数
2. 在 `indexContent()` 中按策略选择分块函数
3. 向量生成和存储逻辑复用现有代码
4. 搜索层通过 `searchMode` 控制是否使用向量

唯一需要注意的是：不同模态的 Embedding 模型可能不同（文本 vs 图片），需要在 `embeddingConfig` 中区分 `model` 和 `multimodalModel`（已有此字段）。

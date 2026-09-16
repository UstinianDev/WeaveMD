---
name: embedding-cache-s10
description: S10 embedding 缓存 — LRU+TTL 手写实现，集成 createEmbedding/createEmbeddingBatch，测试19例全绿
metadata:
  type: project
---

## S10: Embedding 缓存实现要点

**Why:** 相同文本的 embedding 向量跨请求确定性不变，缓存可避免重复 HTTP 调用，减少延迟和 API 费用。

**How to apply:** 修改 `embeddingClient.ts` 中的 `createEmbedding` 和 `createEmbeddingBatch` 时，注意：
- 缓存键使用 `xxHash64Sync(text)`，不依赖外部模块（纯 Map 实现）
- TTL 30 分钟，最大 500 条，LRU 驱逐策略（Map 迭代顺序=插入顺序）
- `getCachedEmbedding` 在 TTL 过期时删除条目返回 null；命中时 move-to-end 维持 LRU
- `createEmbedding` 和 `createEmbeddingBatch` 都先遍历输入，将 cached/uncached 分流
- API 调用仅针对 uncached 文本；全部命中时 promptTokens=0 且不发起 HTTP 请求
- `invalidateEmbeddingCache()` 供测试清理
- 图片 embedding (`createImageEmbedding`) 不加入缓存
- 测试使用 `vi.useFakeTimers()` 验证 TTL，mock `global.fetch` 验证 API 调用次数

## 修改文件

- `src/main/ai/knowledge/embeddingClient.ts` — 新增 import xxHash64Sync + 缓存函数 + 集成到 createEmbedding / createEmbeddingBatch
- `tests/main/ai/embeddingCache.test.ts` — 新建，19 条测试全部通过
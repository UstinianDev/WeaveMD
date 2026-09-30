# Embedding 架构设计

> 日期：2026-09-06 | 状态：设计完成

## 1. 目标

设计 Embedding 抽象层，让后续切换 FTS5 ↔ 向量搜索更简单，支持三种搜索模式：
- **FTS5-only**：纯关键词搜索（当前默认，无需 Embedding 配置）
- **Vector-only**：纯向量语义搜索（需 Embedding API）
- **Hybrid**：混合搜索（FTS5 + 向量 + 标题匹配 → RRF 融合）

## 2. 现状分析

### 现有架构
```
embeddingClient.ts  →  kbIndexer.ts (索引时生成向量)
                   →  kbSearch.ts  (搜索时可选向量路)
embeddingConfig.ts  →  存储 Embedding API 配置
kb.ts (shared)      →  IEmbeddingProviderConfig 类型定义
```

### 当前搜索流程
```
searchKB(userId, query, opts)
  ├── 路径 1: FTS5 BM25 召回（始终执行）
  ├── 路径 2: 向量余弦搜索（opts.queryVector 存在时执行）
  ├── 路径 3: 标题匹配（始终执行）
  └── RRF 融合 → 加权 → 段聚合 → 条件重排
```

## 3. 设计方案

### 3.1 搜索模式配置

在 `EmbeddingConfigRow` 和 `IEmbeddingProviderConfig` 中添加 `searchMode` 字段：

```typescript
type SearchMode = 'fts5' | 'vector' | 'hybrid';
```

| 模式 | FTS5 | 向量 | 标题匹配 | RRF | 依赖 |
|------|------|------|---------|-----|------|
| `fts5` | ✅ | ❌ | ✅ | ❌ | 无 |
| `vector` | ❌ | ✅ | ✅ | ❌ | Embedding API |
| `hybrid` | ✅ | ✅ | ✅ | ✅ | Embedding API |

### 3.2 条件执行逻辑

在 `searchKB` 函数中根据 `searchMode` 条件执行：

```typescript
// searchKB 函数内部
const mode = opts.searchMode ?? 'hybrid';

// 路径 1: FTS5（仅 fts5 和 hybrid 模式）
const ftsRows = (mode === 'fts5' || mode === 'hybrid')
  ? ftsSearch(db, userId, cleaned, candidateLimit)
  : [];

// 路径 2: 向量（仅 vector 和 hybrid 模式，且 queryVector 存在）
const vecScores = (mode === 'vector' || mode === 'hybrid') && opts.queryVector
  ? vectorSearch(db, userId, opts.queryVector, vecLimit, vecScoreThreshold)
  : new Map<string, number>();

// 路径 3: 标题匹配（所有模式）
const titleScores = titleMatchSearch(db, userId, cleaned, candidateLimit);

// RRF 融合（仅 hybrid 模式，且三路都有数据）
const results = mode === 'hybrid'
  ? rrfFusion([ftsSorted, vecSorted, titleSorted], rrfK)
  : simpleWeightedMerge(ftsSorted, vecSorted, titleSorted);
```

### 3.3 数据流

> **状态标注（2026-10-01，agent-memory-optimize-3 D6 实测）：本节是设计稿，未落地。**
> - `ai_embedding_config.search_mode` 字段**已建**（`addColumnIfMissing`，默认 `'hybrid'`）
>   但**全仓零消费**：`embeddingConfig.searchMode` 不向 `agentTaskWorker` 传递，
>   也不存在所谓的 `searchKb wrapper` 中转层；
> - 实际链路是 `agentTaskWorker` → `searchKBHandler` → `searchKB(userId, query, opts)`，
>   `opts.searchMode` 由**调用方显式传入**（缺省 `hybrid`），不读配置表；
> - 因此下图仅表达**目标形态**；按红线「searchMode 降级行为不变」，本批只改文档不改代码，
>   字段消费记 TODO。

```
用户配置 searchMode
       ↓
embeddingConfig.searchMode → agentTaskWorker → searchKb wrapper   ← 设计未实现（字段已建未消费）
       ↓
searchKB(userId, query, { searchMode, queryVector })
       ↓
┌─ fts5:   FTS5 + Title → 加权 → 段聚合
├─ vector: Vec + Title  → 加权 → 段聚合
└─ hybrid: FTS5 + Vec + Title → RRF → 加权 → 段聚合
       ↓
条件重排（LLM rerank，可选）
       ↓
返回结果
```

## 4. 接口变更

### 4.1 共享类型（`src/shared/ai/kb.ts`）
- `IEmbeddingProviderConfig.searchMode?: SearchMode`
- `EMBEDDING_PROVIDER_DEFAULTS.*.searchMode = 'hybrid'`

### 4.2 数据库层（`src/main/db/embeddingConfig.ts`）
- `EmbeddingConfigRow.searchMode: string`
- `EmbeddingConfigDbRow.search_mode: string`
- SQL 字段: `search_mode TEXT DEFAULT 'hybrid'`

### 4.3 搜索层（`src/main/ai/knowledge/kbSearch.ts`）
- `KbSearchOptions.searchMode?: SearchMode`
- `searchKB()` 内部条件执行

### 4.4 索引层（`src/main/ai/knowledge/kbIndexer.ts`）
- 无需修改：向量生成始终在 Embedding 配置存在时执行
- 搜索模式仅影响搜索，不影响索引

## 5. 向后兼容

- `searchMode` 默认 `'hybrid'`：无 Embedding 配置时自动降级到 FTS5 + 标题匹配
- `queryVector` 为空时向量路自动跳过（现有行为不变）
- 旧版数据库无 `search_mode` 字段时使用 DEFAULT 'hybrid'

## 6. 验收标准

1. 配置 `searchMode: 'fts5'` 时，搜索只走 FTS5 + 标题匹配
2. 配置 `searchMode: 'vector'` 时，搜索只走向量 + 标题匹配
3. 配置 `searchMode: 'hybrid'` 时，搜索走三路 RRF（现有行为）
4. 无 Embedding 配置时的降级**按模式分叉**（2026-10-01 实测口径，与当前代码一致）：
   - `fts5` / `hybrid`（默认）：降级到 FTS5 + 标题匹配；
   - `vector`：**不回退 FTS5**（模式门禁在无 `queryVector` 时直接挡掉 FTS5 路），
     只剩标题匹配 → 无候选时按规范拒答（threshold 0.6），**不降级**。
5. 所有现有测试通过（tsc 0 | vitest 通过 | lint 0 error）

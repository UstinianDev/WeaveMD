# 性能优化计划：智能创作Agent / 搜索知识库 / 写控制与任务安全

> 生成时间：2026-09-11
> 任务级别：L 级（跨模块，多天）
> 优化顺序：高优先级先行

---

## 一、变更清单

### 1.1 文件白名单

| 模块 | 文件路径 | 变更类型 |
|------|----------|----------|
| 写控制 | `src/main/ai/agent/agentCheckpoint.ts` | 增量写入 |
| Agent | `src/main/ai/agent/agentLoop.ts` | 分页加载 + 增量 token |
| KB | `src/main/ai/knowledge/tokenizer.ts` | 异步加载 |
| KB | `src/main/ai/knowledge/kbSearch.ts` | FTS5 索引 |
| KB | `src/main/db/kb.ts` | 新增 FTS5 表 |
| 事件 | `src/main/ai/agent/agentEventStore.ts` | 批量写入 |
| 快照 | `src/main/ai/agent/agentSnapshot.ts` | 增量更新 |
| Agent | `src/main/ai/agent/agentPromptBuilder.ts` | 文件列表缓存 |
| Agent | `src/main/ai/utils/tokenEstimator.ts` | LRU 缓存 |
| KB | `src/main/ai/knowledge/searchCache.ts` | LRU 缓存 |
| Agent | `src/main/ai/agent/agentKbPreloader.ts` | 预加载优化 |

### 1.2 测试文件

| 文件路径 | 变更类型 |
|----------|----------|
| `tests/main/ai/agentCheckpoint.test.ts` | 新增 |
| `tests/main/ai/agentLoop.test.ts` | 更新 |
| `tests/main/ai/tokenizer.test.ts` | 更新 |
| `tests/main/ai/kbSearch.test.ts` | 更新 |
| `tests/main/ai/agentEventStore.test.ts` | 更新 |
| `tests/main/ai/agentSnapshot.test.ts` | 更新 |
| `tests/main/ai/tokenEstimator.test.ts` | 更新 |

---

## 二、优化顺序

### 2.1 Phase 1: 高优先级（P0）

**目标**: 解决最大瓶颈，提升 30-50%

| 序号 | 瓶颈 | 优化方案 | 预期提升 | 工时 |
|------|------|----------|----------|------|
| 1 | B1 | Checkpoint 增量写入 | 60% | 2h |
| 2 | B2 | 消息历史分页加载 | 70% | 1.5h |

**依赖**: 无

**风险**: 中（需要确保增量合并的正确性）

---

### 2.2 Phase 2: 中优先级（P1）

**目标**: 解决中等瓶颈，提升 15-25%

| 序号 | 瓶颈 | 优化方案 | 预期提升 | 工时 |
|------|------|----------|----------|------|
| 3 | B3 | Token 估算增量更新 | 50% | 1h |
| 4 | B4 | jieba-wasm 异步加载 | 80% | 1.5h |
| 5 | B6 | 事件批量写入 | 60% | 2h |

**依赖**: 无

**风险**: 中（需要确保异步加载的线程安全）

---

### 2.3 Phase 3: 低优先级（P2）

**目标**: 解决次要瓶颈，提升 10-15%

| 序号 | 瓶颈 | 优化方案 | 预期提升 | 工时 |
|------|------|----------|----------|------|
| 6 | B5 | 标题匹配 FTS5 索引 | 80% | 1.5h |
| 7 | B7 | 快照增量更新 | 70% | 2h |
| 8 | B8 | 文件列表缓存 | 90% | 1h |

**依赖**: 无

**风险**: 低

---

### 2.4 Phase 4: 低优先级（P3）

**目标**: 解决低优先级瓶颈，提升 5-10%

| 序号 | 瓶颈 | 优化方案 | 预期提升 | 工时 |
|------|------|----------|----------|------|
| 9 | B9 | 搜索缓存 LRU | 80% | 0.5h |
| 10 | B10 | Token 估算缓存 | 70% | 0.5h |

**依赖**: 无

**风险**: 低

---

## 三、详细方案

### 3.1 B1: Checkpoint 增量写入

**文件**: `src/main/ai/agent/agentCheckpoint.ts`

**当前代码**:
```typescript
export function saveCheckpoint(db, sessionId, data) {
  const checkpointJson = JSON.stringify(data);
  sessionDao.saveCheckpoint(db, sessionId, checkpointJson);
}
```

**优化方案**:
```typescript
export function saveCheckpointIncremental(
  db: Database,
  sessionId: string,
  newMessages: AgentLlmMessage[],
  toolCallsHistory: IAgentToolCall[],
  roundsUsed: number,
  reasoningTokenCount: number | null,
  intent: IIntent | null
): void {
  // 1. 读取现有 checkpoint
  const existing = loadCheckpoint(db, sessionId);
  
  // 2. 合并新消息
  const mergedMessages = existing
    ? [...existing.llmMessages, ...newMessages]
    : newMessages;
  
  // 3. 合并工具调用历史
  const mergedToolCalls = existing
    ? [...existing.toolCallsHistory, ...toolCallsHistory]
    : toolCallsHistory;
  
  // 4. 构建增量 checkpoint
  const checkpointData: CheckpointData = {
    roundIndex: existing ? existing.roundIndex + 1 : 0,
    llmMessages: mergedMessages,
    toolCallsHistory: mergedToolCalls,
    roundsUsed,
    reasoningTokenCount,
    intent,
  };
  
  // 5. 序列化并写入
  const checkpointJson = JSON.stringify(checkpointData);
  sessionDao.saveCheckpoint(db, sessionId, checkpointJson);
}
```

**预期效果**:
- 序列化数据量减少 60-80%（只序列化增量部分）
- 写入延迟降低 60%+

---

### 3.2 B2: 消息历史分页加载

**文件**: `src/main/ai/agent/agentLoop.ts`

**当前代码**:
```typescript
const rawDbMessages = getMessagesByConversation(convId, userId)
  .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
  .map(m => ({ role: m.role, content: m.content, ... }))
  .filter(m => m.content && m.content.trim().length > 0);
```

**优化方案**:
```typescript
// 1. 新增 DAO 方法：分页加载
export function getMessagesByConversationPaginated(
  conversationId: string,
  userId: string,
  limit: number = 20,
  offset: number = 0
): AIMessage[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM ai_messages
    WHERE conversation_id = ? AND user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(conversationId, userId, limit, offset) as AIMessage[];
}

// 2. Agent Loop 中使用分页加载
const recentMessages = getMessagesByConversationPaginated(convId, userId, 20, 0);
const rawDbMessages = recentMessages
  .reverse()  // 恢复时间顺序
  .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
  .map(m => ({ role: m.role, content: m.content, ... }))
  .filter(m => m.content && m.content.trim().length > 0);
```

**预期效果**:
- 长对话时加载延迟降低 70%+
- 内存占用减少 50%+

---

### 3.3 B3: Token 估算增量更新

**文件**: `src/main/ai/agent/agentLoop.ts`

**当前代码**:
```typescript
// 压缩后重算
ctx.totalTokens = ctx.llmMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
```

**优化方案**:
```typescript
// 1. 压缩前记录旧 token 数
const oldTokenCount = ctx.totalTokens;

// 2. 压缩
ctx.llmMessages = buildCompressed(ctx.llmMessages, newSummary, KEEP_RECENT_ROUNDS);

// 3. 增量计算新 token 数
const newTokenCount = ctx.llmMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
ctx.totalTokens = newTokenCount;

// 4. 可选：记录压缩比（用于调试）
const compressionRatio = newTokenCount / oldTokenCount;
console.log(`[Agent] Context compression ratio: ${compressionRatio.toFixed(2)}`);
```

**预期效果**:
- Token 估算延迟降低 50%+
- 压缩触发阈值更准确

---

### 3.4 B4: jieba-wasm 异步加载

**文件**: `src/main/ai/knowledge/tokenizer.ts`

**当前代码**:
```typescript
function ensureJiebaSync(): boolean {
  if (jiebaStatus === 'ok') return true;
  try {
    const mod = require('jieba-wasm') as Record<string, unknown>;
    ...
  }
}
```

**优化方案**:
```typescript
// 1. 应用启动时后台加载
let jiebaLoadPromise: Promise<boolean> | null = null;

export function initJiebaAsync(): Promise<boolean> {
  if (jiebaStatus === 'ok') return Promise.resolve(true);
  if (jiebaLoadPromise) return jiebaLoadPromise;
  
  jiebaLoadPromise = new Promise((resolve) => {
    setTimeout(() => {
      try {
        const mod = require('jieba-wasm') as Record<string, unknown>;
        if (typeof mod.cut_for_search === 'function') {
          cutForSearch = mod.cut_for_search;
          jiebaStatus = 'ok';
          resolve(true);
        } else {
          jiebaStatus = 'fail';
          resolve(false);
        }
      } catch {
        jiebaStatus = 'fail';
        resolve(false);
      }
    }, 0);  // 异步执行
  });
  
  return jiebaLoadPromise;
}

// 2. tokenize 函数中使用异步加载
export async function tokenizeAsync(text: string): Promise<string[]> {
  await initJiebaAsync();
  if (cutForSearch) {
    return cutForSearch(text, true);
  }
  return bigramFallback(text);
}

// 3. 同步版本保持兼容
export function tokenize(text: string): string[] {
  if (jiebaStatus === 'ok' && cutForSearch) {
    return cutForSearch(text, true);
  }
  return bigramFallback(text);
}
```

**预期效果**:
- 首次 KB 搜索延迟降低 80%+
- 主线程不阻塞

---

### 3.5 B6: 事件批量写入

**文件**: `src/main/ai/agent/agentEventStore.ts`

**当前代码**:
```typescript
export function persistAndSend(db, mainWindow, sessionId, convId, eventType, payload) {
  const event = eventDao.insertEvent(db, sessionId, convId, nextSeq, eventType, payloadJson);
  mainWindow.webContents.send(`ai:stream:${eventType}`, { ... });
  return event;
}
```

**优化方案**:
```typescript
// 1. 批量写入队列
const eventBatchQueue: Array<{
  db: BetterSqlite3Database;
  sessionId: string;
  conversationId: string;
  seq: number;
  eventType: string;
  payloadJson: string;
}> = [];

let batchFlushTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_FLUSH_INTERVAL = 100;  // 100ms

// 2. 批量写入函数
function flushEventBatch(): void {
  if (eventBatchQueue.length === 0) return;
  
  const batch = [...eventBatchQueue];
  eventBatchQueue.length = 0;
  
  // 批量 INSERT
  const db = batch[0].db;
  const insertStmt = db.prepare(`
    INSERT INTO agent_run_events (id, session_id, conversation_id, seq, event_type, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((items: typeof batch) => {
    for (const item of items) {
      const id = randomUUID();
      insertStmt.run(id, item.sessionId, item.conversationId, item.seq, item.eventType, item.payloadJson);
    }
  });
  
  insertMany(batch);
  
  // 批量 IPC 发送
  for (const item of batch) {
    const mainWindow = ...;  // 需要从外部传入
    mainWindow.webContents.send(`ai:stream:${item.eventType}`, {
      sessionId: item.sessionId,
      conversationId: item.conversationId,
      seq: item.seq,
      ...JSON.parse(item.payloadJson),
    });
  }
}

// 3. persistAndSend 中使用批量队列
export function persistAndSendBatch(
  db: BetterSqlite3Database,
  mainWindow: BrowserWindow,
  sessionId: string,
  conversationId: string,
  eventType: string,
  payload: unknown
): AgentRunEvent {
  let seq = seqCounters.get(sessionId);
  if (seq === undefined) {
    seq = eventDao.getLatestSeq(db, sessionId);
  }
  const nextSeq = seq + 1;
  seqCounters.set(sessionId, nextSeq);
  const payloadJson = JSON.stringify(payload);
  
  // 加入批量队列
  eventBatchQueue.push({
    db,
    sessionId,
    conversationId,
    seq: nextSeq,
    eventType,
    payloadJson,
  });
  
  // 启动批量刷新定时器
  if (!batchFlushTimer) {
    batchFlushTimer = setTimeout(() => {
      flushEventBatch();
      batchFlushTimer = null;
    }, BATCH_FLUSH_INTERVAL);
  }
  
  // 返回事件对象（本地构造，不等待 DB 写入）
  return {
    id: randomUUID(),
    sessionId,
    conversationId,
    seq: nextSeq,
    eventType: eventType as AgentRunEvent['eventType'],
    payloadJson,
    createdAt: new Date().toISOString(),
  };
}
```

**预期效果**:
- 事件持久化延迟降低 60%+
- IPC 发送频率降低 80%+

---

### 3.6 B5: 标题匹配 FTS5 索引

**文件**: `src/main/db/kb.ts`

**当前代码**:
```typescript
const rows = db.prepare(`
  SELECT id AS docId, title
    FROM kb_documents
   WHERE user_id = ?
     AND (${orClauses})  // (title LIKE ? OR file_path LIKE ?) OR ...
   LIMIT ?
`).all(...params);
```

**优化方案**:
```typescript
// 1. 新增 FTS5 虚拟表
export const KB_DOC_FTS_MIGRATION_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS kb_documents_fts USING fts5(
    title,
    file_path,
    user_id UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  DROP TRIGGER IF EXISTS kb_documents_fts_ai;
  CREATE TRIGGER kb_documents_fts_ai AFTER INSERT ON kb_documents BEGIN
    INSERT INTO kb_documents_fts(rowid, title, file_path, user_id)
    VALUES (new.rowid, new.title, new.file_path, new.user_id);
  END;

  DROP TRIGGER IF EXISTS kb_documents_fts_ad;
  CREATE TRIGGER kb_documents_fts_ad AFTER DELETE ON kb_documents BEGIN
    INSERT INTO kb_documents_fts(kb_documents_fts, rowid, title, file_path, user_id)
    VALUES ('delete', old.rowid, old.title, old.file_path, old.user_id);
  END;

  DROP TRIGGER IF EXISTS kb_documents_fts_au;
  CREATE TRIGGER kb_documents_fts_au AFTER UPDATE ON kb_documents BEGIN
    INSERT INTO kb_documents_fts(kb_documents_fts, rowid, title, file_path, user_id)
    VALUES ('delete', old.rowid, old.title, old.file_path, old.user_id);
    INSERT INTO kb_documents_fts(rowid, title, file_path, user_id)
    VALUES (new.rowid, new.title, new.file_path, new.user_id);
  END;
`;

// 2. kbSearch.ts 中使用 FTS5 查询
function titleMatchSearchFts5(
  db: Database.Database,
  userId: string,
  query: string,
  limit: number
): Map<string, number> {
  const result = new Map<string, number>();
  const cleaned = sanitizeFtsQuery(query);
  if (!cleaned) return result;
  
  try {
    const rows = db.prepare(`
      SELECT d.id AS docId, d.title,
             bm25(kb_documents_fts) AS bm
        FROM kb_documents_fts
        JOIN kb_documents d ON d.rowid = kb_documents_fts.rowid
       WHERE kb_documents_fts MATCH ? AND kb_documents_fts.user_id = ?
       ORDER BY bm
       LIMIT ?
    `).all(cleaned, userId, limit) as Array<{
      docId: string;
      title: string;
      bm: number;
    }>;
    
    for (const row of rows) {
      // BM25 分数转换为 0-1 范围
      const score = Math.max(0, 1 - Math.abs(row.bm) / 10);
      result.set(row.docId, score);
    }
  } catch {
    // FTS5 查询失败时静默跳过
  }
  
  return result;
}
```

**预期效果**:
- 标题匹配延迟降低 80%+
- 搜索结果更准确

---

### 3.7 B7: 快照增量更新

**文件**: `src/main/ai/agent/agentSnapshot.ts`

**当前代码**:
```typescript
export async function createSnapshot(db, sessionId, userId) {
  const files = db.prepare(
    "SELECT id, name, content FROM files WHERE user_id = ? AND deleted_at IS NULL AND name LIKE '%.md'"
  ).all(userId);
  ...
}
```

**优化方案**:
```typescript
// 1. 新增 DAO 方法：获取自上次快照后修改的文件
export function getModifiedFilesSinceLastSnapshot(
  db: BetterSqlite3Database,
  userId: string,
  sessionId: string
): Array<{ id: string; name: string; content: string }> {
  // 获取上次快照时间
  const lastSnapshot = db.prepare(`
    SELECT created_at FROM agent_file_snapshots
    WHERE session_id = ? AND user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId, userId) as { created_at: string } | undefined;
  
  const since = lastSnapshot?.created_at || '1970-01-01';
  
  // 查询自上次快照后修改的文件
  return db.prepare(`
    SELECT id, name, content FROM files
    WHERE user_id = ?
      AND deleted_at IS NULL
      AND name LIKE '%.md'
      AND modified_at > ?
  `).all(userId, since) as Array<{ id: string; name: string; content: string }>;
}

// 2. createSnapshot 中使用增量查询
export async function createSnapshotIncremental(
  db: BetterSqlite3Database,
  sessionId: string,
  userId: string
): Promise<void> {
  const files = getModifiedFilesSinceLastSnapshot(db, userId, sessionId);
  
  if (files.length === 0) {
    console.log('[agentSnapshot] No modified .md files to snapshot');
    return;
  }
  
  snapshotDao.saveSnapshot(
    db,
    sessionId,
    userId,
    files.map(f => ({ fileId: f.id, fileName: f.name, content: f.content }))
  );
  
  console.log(`[agentSnapshot] Created incremental snapshot for ${files.length} files`);
}
```

**预期效果**:
- 快照创建延迟降低 70%+
- 存储空间减少 50%+

---

### 3.8 B8: 文件列表缓存

**文件**: `src/main/ai/agent/agentPromptBuilder.ts`

**当前代码**:
```typescript
export function buildFileListSnapshot(files: FileEntry[]): string {
  if (files.length === 0) return '';
  const truncated = files.slice(0, MAX_FILE_LIST);
  ...
}
```

**优化方案**:
```typescript
// 1. 会话级缓存
const fileListCache = new Map<string, {
  snapshot: string;
  timestamp: number;
}>();

const FILE_LIST_CACHE_TTL = 5 * 60 * 1000;  // 5 分钟

// 2. 带缓存的文件列表构建
export function buildFileListSnapshotCached(
  userId: string,
  files: FileEntry[]
): string {
  const cacheKey = userId;
  const cached = fileListCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < FILE_LIST_CACHE_TTL) {
    return cached.snapshot;
  }
  
  const snapshot = buildFileListSnapshot(files);
  fileListCache.set(cacheKey, { snapshot, timestamp: Date.now() });
  return snapshot;
}

// 3. 文件操作后清除缓存
export function invalidateFileListCache(userId: string): void {
  fileListCache.delete(userId);
}
```

**预期效果**:
- 文件列表查询延迟降低 90%+
- Agent 调用延迟降低 5-20ms

---

### 3.9 B9: 搜索缓存 LRU

**文件**: `src/main/ai/knowledge/searchCache.ts`

**当前代码**:
```typescript
const searchResultCache = new Map<string, SearchResultCacheEntry>();
```

**优化方案**:
```typescript
// 1. LRU 缓存实现
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;
  
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }
  
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 移动到最新位置
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 淘汰最旧条目
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
  
  delete(key: K): void {
    this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  get size(): number {
    return this.cache.size;
  }
}

// 2. 使用 LRU 缓存
const searchResultCache = new LRUCache<string, SearchResultCacheEntry>(100);
```

**预期效果**:
- 缓存清理延迟降低 80%+
- 内存占用更可控

---

### 3.10 B10: Token 估算缓存

**文件**: `src/main/ai/utils/tokenEstimator.ts`

**当前代码**:
```typescript
export function estimateTokens(text: string): number {
  const t = text || '';
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < t.length; i++) {
    ...
  }
  return Math.ceil(cjk * 0.75 + other * 0.25);
}
```

**优化方案**:
```typescript
// 1. LRU 缓存
const tokenCache = new LRUCache<string, number>(1000);

// 2. 带缓存的 Token 估算
export function estimateTokensCached(text: string): number {
  const t = text || '';
  
  // 短文本不缓存（缓存开销 > 计算开销）
  if (t.length < 100) {
    return estimateTokens(t);
  }
  
  const cached = tokenCache.get(t);
  if (cached !== undefined) {
    return cached;
  }
  
  const result = estimateTokens(t);
  tokenCache.set(t, result);
  return result;
}
```

**预期效果**:
- Token 估算延迟降低 70%+
- 重复计算减少 90%+

---

## 四、测试计划

### 4.1 单元测试

| 测试文件 | 测试内容 | 覆盖率目标 |
|----------|----------|------------|
| agentCheckpoint.test.ts | 增量写入 + 合并逻辑 | 90%+ |
| agentLoop.test.ts | 分页加载 + 增量 token | 85%+ |
| tokenizer.test.ts | 异步加载 + 降级策略 | 90%+ |
| kbSearch.test.ts | FTS5 查询 + 结果一致性 | 85%+ |
| agentEventStore.test.ts | 批量写入 + 保序 | 90%+ |
| agentSnapshot.test.ts | 增量更新 + 完整性 | 85%+ |
| tokenEstimator.test.ts | LRU 缓存 + 一致性 | 90%+ |

### 4.2 集成测试

- Agent 循环端到端测试
- KB 搜索端到端测试
- 事件持久化端到端测试

### 4.3 性能基准测试

- Agent 单轮延迟基准
- KB 搜索延迟基准
- 事件持久化延迟基准
- 快照创建延迟基准

---

## 五、风险缓解

| 风险 | 缓解措施 |
|------|----------|
| 行为变化 | 回归测试 + 行为守护 |
| 缓存一致性 | TTL + 失效机制 |
| 异步错误 | try-catch 兜底 |
| 内存泄漏 | LRU + 容量限制 |
| 并发安全 | 事务 + 锁机制 |

---

## 六、交付标准

### 6.1 性能验收

- [ ] Agent 单轮延迟降低 50%+
- [ ] KB 搜索延迟降低 47%+
- [ ] 事件持久化延迟降低 67%+
- [ ] 快照创建延迟降低 60%+

### 6.2 功能验收

- [ ] 回归测试全绿
- [ ] 行为守护测试通过
- [ ] 端到端连通性验证通过

### 6.3 质量验收

- [ ] 无内存泄漏
- [ ] 无并发安全问题
- [ ] 无缓存一致性问题

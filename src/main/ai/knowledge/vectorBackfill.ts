// ============================================
// WeaveMD — 向量回填（B5 四-1②）
// ============================================
// 职责：
// 1. resolveEmbedding — 单点解析真实 embedding 配置（判定语义复用 KB_STATUS 的
//    provider + apiKeyEnc 双重判定），未配置返回 null → 调用方走纯 FTS5 分支
//    （docs/architecture/knowledge.md 既有约定，不得破坏）。
// 2. 后台回填任务 — 历史 chunk 缺向量 / 切换模型后旧向量（embedding_model 不匹配）
//    分批限速重算；防抖合并高频触发；状态机 pending→running→done|error
//    （对齐 kb_documents.status 可观测范式，纯内存态，不加 DDL）。
// 回填期间检索不经本模块（searchKB 走 FTS5 + 可选向量路径），互不阻塞。
// 3.（agent-memory-optimize-3 D6）agent_memory 单行向量生成与存量回填 ——
//    失败一律 console.warn 后静默降级（向量保持 NULL、检索走 D5 的 trigram FTS5）。

import type { Database as BetterSqlite3Database } from 'better-sqlite3';

import { getAiConfig } from '../../db/ai';
import { getEmbeddingConfig } from '../../db/embeddingConfig';
import { hasMemoryVector, upsertMemoryVector } from '../../db/agentMemory';
import { decryptApiKey } from '../secureConfig';
import { getDatabase } from '../../db/index';
import { createEmbedding } from './embeddingClient';
import { chunkEmbeddingText } from './kbIndexer';

// ---------------------------------------------------------------------------
// 配置解析（kbIndexOpts 与回填任务共用的唯一判定入口）
// ---------------------------------------------------------------------------

/** 已解密的 embedding 配置（明文 key 只在主进程内流转）。 */
export interface ResolvedEmbedding {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * 解析当前用户的真实 embedding 配置。
 * 判定顺序（复用 KB_STATUS 语义）：ai_config.kbEmbeddingProvider 存在
 * → ai_embedding_config.apiKeyEnc 存在 → 解密成功；任一失败返回 null（纯 FTS5）。
 */
export function resolveEmbedding(userId: string): ResolvedEmbedding | null {
  try {
    const ai = getAiConfig(userId);
    if (!ai?.kbEmbeddingProvider) return null;
    const cfg = getEmbeddingConfig(userId);
    if (!cfg?.apiKeyEnc || !cfg.baseUrl || !cfg.model) return null;
    const apiKey = decryptApiKey(cfg.apiKeyEnc);
    if (!apiKey) return null;
    return { baseUrl: cfg.baseUrl, model: cfg.model, apiKey };
  } catch {
    // 配置读取/解密异常一律降级（检索回 FTS5，不阻断索引）
    return null;
  }
}

// ---------------------------------------------------------------------------
// 回填状态机（可观测：pending → running → done / error）
// ---------------------------------------------------------------------------

export type VectorBackfillPhase = 'idle' | 'pending' | 'running' | 'done' | 'error';

export interface VectorBackfillStatus {
  phase: VectorBackfillPhase;
  /** 本次扫描的待回填 chunk 总数。 */
  total: number;
  /** 已写回向量的 chunk 数。 */
  processed: number;
  /** 本次回填针对的 embedding 模型（切换模型即重算旧向量）。 */
  model: string | null;
  /** 失败原因（phase=error 时非空）。 */
  error: string | null;
  updatedAt: number;
}

export interface BackfillRunOptions {
  /** 每批 embedding 的 chunk 数（默认 20，对齐写索引批量）。 */
  batchSize?: number;
  /** 批间限速延迟 ms（默认 300，防打爆 embedding API）。 */
  batchDelayMs?: number;
  /** 单次运行最大批数（默认 100，防空转）。 */
  maxBatches?: number;
}

const BACKFILL_DEBOUNCE_MS = 2000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_BATCH_DELAY_MS = 300;
const DEFAULT_MAX_BATCHES = 100;

const states = new Map<string, VectorBackfillStatus>();
const timers = new Map<string, NodeJS.Timeout>();

function idleStatus(): VectorBackfillStatus {
  return {
    phase: 'idle',
    total: 0,
    processed: 0,
    model: null,
    error: null,
    updatedAt: Date.now(),
  };
}

export function getVectorBackfillStatus(userId: string): VectorBackfillStatus {
  return states.get(userId) ?? idleStatus();
}

function setStatus(
  userId: string,
  patch: Partial<VectorBackfillStatus>
): VectorBackfillStatus {
  const next: VectorBackfillStatus = {
    ...getVectorBackfillStatus(userId),
    ...patch,
    updatedAt: Date.now(),
  };
  states.set(userId, next);
  return next;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

// ---------------------------------------------------------------------------
// 调度（防抖）
// ---------------------------------------------------------------------------

/**
 * 调度一次后台向量回填（防抖 2s 合并高频触发；running 中忽略——当前扫描已覆盖缺口）。
 * 非阻塞：同步返回，检索/索引不等待回填。
 */
export function scheduleVectorBackfill(userId: string): void {
  if (!userId) return;
  if (getVectorBackfillStatus(userId).phase === 'running') return;
  const existing = timers.get(userId);
  if (existing) clearTimeout(existing);
  setStatus(userId, { phase: 'pending', error: null });
  const timer = setTimeout(() => {
    timers.delete(userId);
    void runVectorBackfill(userId).catch(() => {
      // runVectorBackfill 内部已把失败收敛为 error 状态；此处兜底不外抛
    });
  }, BACKFILL_DEBOUNCE_MS);
  timer.unref?.();
  timers.set(userId, timer);
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

/**
 * 立即执行一轮回填（分批限速）。失败收敛为 phase='error' 不抛；
 * 并发重入时直接返回当前状态（不重复执行）。
 */
export async function runVectorBackfill(
  userId: string,
  opts?: BackfillRunOptions
): Promise<VectorBackfillStatus> {
  const current = getVectorBackfillStatus(userId);
  if (current.phase === 'running') return current;

  const emb = resolveEmbedding(userId);
  if (!emb) return current; // 未配置：保持原状态，不扫库不调 API（纯 FTS5）

  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchDelayMs = opts?.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS;
  const maxBatches = opts?.maxBatches ?? DEFAULT_MAX_BATCHES;

  setStatus(userId, {
    phase: 'running',
    total: 0,
    processed: 0,
    model: emb.model,
    error: null,
  });

  try {
    const db = getDatabase();
    const where =
      'FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id ' +
      'WHERE d.user_id = ? AND (c.vector IS NULL OR c.embedding_model IS NOT ?)';

    const countRow = db
      .prepare(`SELECT COUNT(*) AS cnt ${where}`)
      .get(userId, emb.model) as { cnt: number } | undefined;
    const total = countRow?.cnt ?? 0;
    setStatus(userId, { total });
    if (total === 0) return setStatus(userId, { phase: 'done' });

    let processed = 0;
    for (let batch = 0; batch < maxBatches; batch++) {
      const rows = db
        .prepare(
          `SELECT c.id AS chunkId, c.content AS content, c.heading_path AS headingPath ${where} ORDER BY c.created_at, c.seq LIMIT ?`
        )
        .all(userId, emb.model, batchSize) as Array<{
        chunkId: string;
        content: string;
        headingPath: string | null;
      }>;
      if (rows.length === 0) break;

      const response = await createEmbedding({
        baseUrl: emb.baseUrl,
        model: emb.model,
        apiKey: emb.apiKey,
        // B8 四-4②：回填侧与写索引同构 —— 向量输入带 headingPath 前缀（FTS 不动）
        input: rows.map((r) => chunkEmbeddingText(r.headingPath, r.content ?? '')),
      });

      const update = db.prepare(
        'UPDATE kb_chunks SET vector = ?, embedding_model = ? WHERE id = ?'
      );
      let updated = 0;
      for (let i = 0; i < rows.length; i++) {
        const vec = response.embeddings[i];
        if (!Array.isArray(vec)) continue;
        // Float32 BLOB（与写索引一致；sqlite-vec 缺失时列仅存储，检索侧降级 FTS5）
        update.run(Buffer.from(new Float32Array(vec).buffer), emb.model, rows[i].chunkId);
        updated++;
      }
      if (updated === 0) {
        // 整批无向量写回 → 视为失败，防空转打爆 API
        throw new Error('embedding produced no vectors for batch');
      }
      processed += updated;
      setStatus(userId, { processed });
      await delay(batchDelayMs); // 批间限速（下一轮查询无缺口即退出）
    }

    return setStatus(userId, { phase: 'done' });
  } catch (err) {
    return setStatus(userId, {
      phase: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 测试重置：清空防抖定时器与状态（不对外暴露）。 */
export function resetVectorBackfill(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  states.clear();
}

// ---------------------------------------------------------------------------
// agent-memory-optimize-3 D6（三.3 向量化经验库）：agent_memory 向量写入与回填
// ---------------------------------------------------------------------------
// 与 kb_chunks 回填的差别：记忆行由 C1 工具 / C2 后台提取**同步写入后异步补向量**，
// 失败语义必须与 D2/D3 一致 —— **console.warn 一条、向量保持 NULL、不抛、不重试**，
// 绝不改变工具返回结构、绝不让后台任务落 failed。

/** 记忆向量回填的分批参数（与 kb_chunks 回填同口径）。**无实测数据、待校准**。 */
const MEMORY_BACKFILL_BATCH_SIZE = 20;
const MEMORY_BACKFILL_BATCH_DELAY_MS = 300;
const MEMORY_BACKFILL_MAX_BATCHES = 100;

export interface MemoryVectorBackfillOptions {
  /** 每批 embedding 的记忆条数（默认 20，对齐写索引批量）。 */
  batchSize?: number;
  /** 批间限速延迟 ms（默认 300，防打爆 embedding API）。 */
  batchDelayMs?: number;
  /** 单次运行最大批数（默认 100，防空转）。 */
  maxBatches?: number;
}

export interface MemoryVectorBackfillResult {
  /** 本次扫描到的缺口行总数。 */
  total: number;
  /** 本次实际写回向量的行数。 */
  processed: number;
}

/** 记忆 embedding 输入（写入 / 回填 / 检索三处同口径：subject 作前缀 + 换行 + 正文）。 */
function memoryEmbeddingText(subject: string, content: string): string {
  return `${subject ?? ''}\n${content ?? ''}`;
}

/**
 * 单行记忆的向量生成（异步、**永不 reject**）。
 * 短路顺序：已有向量 → 跳过；未配置 embedding → 跳过（向量保持 NULL，检索走 FTS5）；
 * API / 写库任何失败 → `console.warn` 一条后返回。
 * 调用方（C1 工具 / C2 后台提取）只需 `void` 调用，无需也不应 await。
 */
export async function writeMemoryVectorAsync(
  db: BetterSqlite3Database,
  userId: string,
  id: number,
  subject: string,
  content: string
): Promise<void> {
  try {
    if (!userId || !id) return;
    if (hasMemoryVector(db, userId, id)) return; // 已有向量（同指纹去重返回既有行）→ 不重复调 API
    const emb = resolveEmbedding(userId);
    if (!emb) return; // 未配置 embedding → 静默跳过，不报错
    const response = await createEmbedding({
      baseUrl: emb.baseUrl,
      model: emb.model,
      apiKey: emb.apiKey,
      input: memoryEmbeddingText(subject, content),
    });
    const vec = response.embeddings[0];
    if (!Array.isArray(vec) || vec.length === 0) {
      console.warn('[vectorBackfill] 记忆 embedding 返回空向量（静默降级，向量保持 NULL）', {
        userId,
        id,
        model: emb.model,
      });
      return;
    }
    upsertMemoryVector(db, userId, id, vec, emb.model);
  } catch (error) {
    console.warn('[vectorBackfill] 记忆向量生成失败（静默降级，向量保持 NULL）', {
      userId,
      id,
      subject,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 存量 active 行的向量回填（覆盖 `vector IS NULL` 与切换模型后 `embedding_model` 不匹配的行）。
 * - 未配置 embedding → **不扫库不调 API**，直接返回 `{total:0, processed:0}`（纯 FTS5 语义）；
 * - 分批限速 + 最大批数上限，口径与 `runVectorBackfill` 一致；
 * - 任何失败收敛为 `console.warn` 后返回已处理数，**绝不 reject**。
 */
export async function backfillMemoryVectors(
  db: BetterSqlite3Database,
  userId: string,
  opts?: MemoryVectorBackfillOptions
): Promise<MemoryVectorBackfillResult> {
  const result: MemoryVectorBackfillResult = { total: 0, processed: 0 };
  try {
    if (!userId) return result;
    const emb = resolveEmbedding(userId);
    if (!emb) return result; // 未配置：不扫库、不调 API（纯 FTS5）

    const batchSize = opts?.batchSize ?? MEMORY_BACKFILL_BATCH_SIZE;
    const batchDelayMs = opts?.batchDelayMs ?? MEMORY_BACKFILL_BATCH_DELAY_MS;
    const maxBatches = opts?.maxBatches ?? MEMORY_BACKFILL_MAX_BATCHES;
    const where =
      'WHERE user_id = ? AND valid_to IS NULL AND (vector IS NULL OR embedding_model IS NOT ?)';

    const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM agent_memory ${where}`).get(
      userId,
      emb.model
    ) as { cnt: number } | undefined;
    result.total = Number(countRow?.cnt ?? 0);
    if (result.total === 0) return result;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = db
        .prepare(`SELECT id, subject, content FROM agent_memory ${where} ORDER BY id ASC LIMIT ?`)
        .all(userId, emb.model, batchSize) as Array<{
        id: number;
        subject: string;
        content: string;
      }>;
      if (rows.length === 0) break;

      const response = await createEmbedding({
        baseUrl: emb.baseUrl,
        model: emb.model,
        apiKey: emb.apiKey,
        input: rows.map((r) => memoryEmbeddingText(r.subject, r.content)),
      });

      let updated = 0;
      for (let i = 0; i < rows.length; i += 1) {
        const vec = response.embeddings[i];
        if (!Array.isArray(vec) || vec.length === 0) continue;
        if (upsertMemoryVector(db, userId, rows[i].id, vec, emb.model)) updated += 1;
      }
      if (updated === 0) {
        // 整批无向量写回 → 视为失败，防空转打爆 API
        throw new Error('embedding produced no vectors for batch');
      }
      result.processed += updated;
      await delay(batchDelayMs);
    }
  } catch (error) {
    console.warn('[vectorBackfill] 记忆向量回填失败（静默降级，向量保持 NULL）', {
      userId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return result;
}

/** 在途回填去重（同一 userId 只跑一轮；D2 的三处触发点可能交叠）。 */
const memoryBackfillInflight = new Map<string, Promise<MemoryVectorBackfillResult>>();

/**
 * 调度一次记忆向量回填：**复用 D2 已有的三处触发点**（应用启动 / C1 写入后 / C2 后台提取成功），
 * 不新建定时器。在途重复调用直接复用同一轮；**永不 reject**。
 */
export function scheduleMemoryVectorBackfill(
  db: BetterSqlite3Database,
  userId: string
): Promise<void> {
  if (!userId) return Promise.resolve();
  const existing = memoryBackfillInflight.get(userId);
  if (existing) return existing.then(() => undefined, () => undefined);
  const task = backfillMemoryVectors(db, userId).finally(() => {
    memoryBackfillInflight.delete(userId);
  });
  memoryBackfillInflight.set(userId, task);
  return task.then(() => undefined, () => undefined);
}

/** 测试重置：清空在途回填去重状态。 */
export function resetMemoryVectorBackfill(): void {
  memoryBackfillInflight.clear();
}

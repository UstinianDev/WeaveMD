// ============================================
// WeaveMD — 知识库混合检索（R2~R6 完整检索管线）
// ============================================
// searchKB(userId, query, opts) 为对外契约。
// R2: RRF 混合检索融合（向量 + FTS5 + 标题匹配三路并行）
// R3: 加权策略（当前文件/时效/标题/置顶）
// R4: 段聚合增强（heading 提升 + 单文件 cap + 上下文扩展）
// R6: 条件重排（LLM 重排，可选注入）

import { getDatabase } from '../../db/index';
import { buildFtsQuery } from './tokenizer';
import type Database from 'better-sqlite3';
import type {
  IKbSearchResult,
  IKbSearchDetailedResponse,
  QueryIntentType,
} from '@shared/ai';

// ---------------------------------------------------------------------------
// 接口定义
// ---------------------------------------------------------------------------

export interface KbSearchOptions {
  // 原有参数
  topK?: number;
  fuse?: number;
  pinnedWeight?: number;
  threshold?: number;
  /** 查询向量（可选，由 embeddingClient 生成，用于向量余弦搜索）。 */
  queryVector?: number[];
  // R2: RRF 融合参数
  rrfK?: number;
  candidateMultiplier?: number;
  vecScoreThreshold?: number;
  // R3: 加权参数
  currentFileId?: string;
  /** 当前文件加权上限（默认 0.12）。 */
  currentFileBoost?: number;
  /** 时效加权（默认 0.05）。 */
  recencyBoost?: number;
  /** 标题加权（默认 0.1）。 */
  headingBoost?: number;
  // R4: 段聚合参数
  maxChunksPerFile?: number;
  contextExpand?: number;
  // R5: 扩展查询
  expandedQueries?: string[];
  // R6: 条件重排开关
  enableConditionalRerank?: boolean;
  /** LLM 重排函数（可选注入，避免直接依赖 llmClient）。 */
  rerankFn?: (query: string, results: IKbSearchResult[]) => Promise<IKbSearchResult[]>;
}

/** 向后兼容的简单响应类型。 */
export type KbSearchResponse = {
  refused: boolean;
  threshold: number;
  best: IKbSearchResult | null;
  results: IKbSearchResult[];
};

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const EPS = 1e-9;
const DEFAULT_RRF_K = 60;
const DEFAULT_CANDIDATE_MULTIPLIER = 4;
const DEFAULT_VEC_SCORE_THRESHOLD = 0.5;
const DEFAULT_CURRENT_FILE_BOOST = 0.12;
const DEFAULT_RECENCY_BOOST = 0.05;
const DEFAULT_HEADING_BOOST = 0.1;
const DEFAULT_MAX_CHUNKS_PER_FILE = 3;
const DEFAULT_CONTEXT_EXPAND = 1;
/** 时效加权窗口（7 天，毫秒）。 */
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 纯函数（保留原有）
// ---------------------------------------------------------------------------

/**
 * 净化用户查询为 FTS5 匹配字符串（R11：委托 tokenizer.buildFtsQuery）。
 * jieba 分词 → CJK token 前缀匹配 → OR 连接；jieba 不可用时降级 bigram。
 */
export function sanitizeFtsQuery(query: string): string {
  return buildFtsQuery(query);
}

/**
 * 查询意图检测（简单启发式）。
 * 返回 'question' | 'command' | 'keyword' 用于条件重排。
 */
export function detectQueryIntent(query: string): 'question' | 'command' | 'keyword' {
  const q = query.trim().toLowerCase();

  // 问题模式
  if (/^(什么|如何|怎么|为什么|哪个|哪里|谁|多少|是否|能否|请问|请告诉)/.test(q)) return 'question';
  if (/^(what|how|why|which|where|who|when|is|are|can|could|please|tell)/.test(q)) return 'question';
  if (q.includes('?') || q.includes('？')) return 'question';

  // 命令模式
  if (/^(帮我|请|创建|删除|修改|查找|搜索|列出|显示|生成|写|读)/.test(q)) return 'command';
  if (/^(help|create|delete|modify|find|search|list|show|generate|write|read)/.test(q)) return 'command';

  // 默认为关键词
  return 'keyword';
}

// ---------------------------------------------------------------------------
// R2: RRF 混合检索
// ---------------------------------------------------------------------------

/** 召回候选（rankCandidates 输入）。bm = FTS5 BM25 原始分。 */
export interface SearchCandidate {
  chunkId: string;
  documentId: string;
  fileName: string;
  content: string;
  seq: number;
  pinned: boolean;
  sourceRef: string | null;
  bm: number;
  /** 向量余弦相似度分数（0-1），无向量时为 null。 */
  vecScore: number | null;
  /** 标题/路径匹配分数（0-1），无匹配时为 0。 */
  titleScore: number;
  /** chunk 类型标记（heading 路径非空则为 heading）。 */
  isHeading?: boolean;
}

/** RRF 单路结果：chunkId + 原始排名。 */
interface RrfChannelEntry {
  chunkId: string;
  rank: number;
}

/**
 * RRF 融合：将多路按原始排名分配 rrfScore 并求和。
 * rrfScore(rank, k) = 1 / (k + rank)
 * 返回 chunkId → 总 rrfScore 的 Map。
 */
export function rrfFusion(
  channels: RrfChannelEntry[][],
  rrfK: number = DEFAULT_RRF_K
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const channel of channels) {
    for (const entry of channel) {
      const prev = scores.get(entry.chunkId) ?? 0;
      scores.set(entry.chunkId, prev + 1 / (rrfK + entry.rank));
    }
  }
  return scores;
}

/**
 * sqlite-vec 向量余弦搜索（可选路径）。
 * 查询向量由外部 embeddingClient 生成后传入。
 * 返回 chunkId → cosine 相似度 Map。
 */
function vectorSearch(
  db: Database.Database,
  userId: string,
  queryVector: number[],
  limit: number,
  threshold: number = DEFAULT_VEC_SCORE_THRESHOLD
): Map<string, number> {
  const result = new Map<string, number>();
  try {
    // sqlite-vec cosine 查询：vec_distance_cosine 返回距离 [0, 2]，similarity = 1 - distance/2
    const rows = db.prepare(`
      SELECT c.id AS chunkId,
             vec_distance_cosine(c.vector, ?) AS distance
        FROM kb_chunks c
        JOIN kb_documents d ON d.id = c.document_id
       WHERE d.user_id = ?
         AND c.vector IS NOT NULL
       ORDER BY distance ASC
       LIMIT ?
    `).all(Buffer.from(new Float32Array(queryVector).buffer), userId, limit) as Array<{
      chunkId: string;
      distance: number;
    }>;

    for (const row of rows) {
      const similarity = Math.max(0, 1 - row.distance / 2);
      // 低于阈值的不纳入
      if (similarity >= threshold) {
        result.set(row.chunkId, similarity);
      }
    }
  } catch {
    // sqlite-vec 不可用时静默降级
  }
  return result;
}

/**
 * 标题/路径 LIKE 匹配（补充召回）。
 * 单条查询 + OR 条件（替代逐关键词 N 次查询）。
 * 返回 documentId → 匹配分数（0-1）。
 */
function titleMatchSearch(
  db: Database.Database,
  userId: string,
  query: string,
  limit: number
): Map<string, number> {
  const result = new Map<string, number>();
  const keywords = query.split(/\s+/).filter(k => k.length > 1).slice(0, 3);
  if (keywords.length === 0) return result;

  // 构建 OR 条件：每个关键词对应 (title LIKE ? OR file_path LIKE ?)
  const orClauses = keywords.map(() => '(title LIKE ? OR file_path LIKE ?)').join(' OR ');
  const params: unknown[] = [userId];
  for (const kw of keywords) {
    params.push(`%${kw}%`, `%${kw}%`);
  }
  params.push(limit);

  try {
    const rows = db.prepare(`
      SELECT id AS docId, title
        FROM kb_documents
       WHERE user_id = ?
         AND (${orClauses})
       LIMIT ?
    `).all(...params) as Array<{ docId: string; title: string }>;

    for (const row of rows) {
      if (!row.docId || !row.title) continue;
      let score = 0;
      for (const kw of keywords) {
        const match = row.title.toLowerCase().includes(kw.toLowerCase()) ? 0.3 : 0.1;
        score += match;
      }
      result.set(row.docId, Math.min(1, score));
    }
  } catch {
    // 表不存在或查询失败时静默跳过
  }
  return result;
}

/**
 * RRF 评分 + 排序（替代原有 rankCandidates 的加权融合）。
 * - 三路并行：向量（sqlite-vec cosine）+ FTS5（BM25）+ 标题匹配（LIKE）
 * - 每路按分数排序分配 rank，rrfScore = 1 / (k + rank)
 * - chunk 最终分 = 各路 rrfScore 之和
 * - R2: 向量候选 = topK × candidateMultiplier，vecScoreThreshold 过滤
 * 返回按 score 降序的 IKbSearchResult[]。
 */
export function rankCandidates(
  candidates: SearchCandidate[],
  pinnedWeight: number,
  _fuse: number = 0.5, // 保留参数签名兼容，RRF 模式下不使用
  rrfK: number = DEFAULT_RRF_K
): IKbSearchResult[] {
  if (candidates.length === 0) return [];

  // 构建三路排名
  // 路径 1: FTS5 BM25（降序，bm 越小越好，取负值排序）
  const ftsSorted = [...candidates]
    .sort((a, b) => a.bm - b.bm) // BM25 原始分越小越好
    .map((c, i) => ({ chunkId: c.chunkId, rank: i + 1 }));

  // 路径 2: 向量余弦（降序，相似度越高越好）
  const vecCandidates = candidates.filter(c => c.vecScore !== null);
  const vecSorted = [...vecCandidates]
    .sort((a, b) => (b.vecScore ?? 0) - (a.vecScore ?? 0))
    .map((c, i) => ({ chunkId: c.chunkId, rank: i + 1 }));

  // 路径 3: 标题匹配（降序）
  const titleCandidates = candidates.filter(c => c.titleScore > 0);
  const titleSorted = [...titleCandidates]
    .sort((a, b) => b.titleScore - a.titleScore)
    .map((c, i) => ({ chunkId: c.chunkId, rank: i + 1 }));

  // RRF 融合
  const rrfScores = rrfFusion([ftsSorted, vecSorted, titleSorted], rrfK);

  // 构建候选 map（用于快速查找原始数据）
  const candidateMap = new Map<string, SearchCandidate>();
  for (const c of candidates) {
    candidateMap.set(c.chunkId, c);
  }

  // 4a: 预建排名 Map（O(1) 查找替代 O(n) find）
  const ftsRankMap = new Map(ftsSorted.map(e => [e.chunkId, e.rank]));
  const vecRankMap = new Map(vecSorted.map(e => [e.chunkId, e.rank]));
  const titleRankMap = new Map(titleSorted.map(e => [e.chunkId, e.rank]));

  // 生成结果
  const scored: IKbSearchResult[] = [];
  for (const [chunkId, rrfScore] of rrfScores) {
    const c = candidateMap.get(chunkId);
    if (!c) continue;

    scored.push({
      docId: c.documentId,
      chunkId: c.chunkId,
      fileName: c.fileName,
      content: c.content,
      seq: c.seq,
      score: rrfScore,
      pinned: c.pinned,
      sourceRef: c.sourceRef,
      isHeading: c.isHeading,
      rrfRanks: {
        vec: vecRankMap.get(chunkId),
        fts: ftsRankMap.get(chunkId),
        title: titleRankMap.get(chunkId),
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ---------------------------------------------------------------------------
// R3: 加权策略（RRF 之后）
// ---------------------------------------------------------------------------

/**
 * 应用加权策略：
 * - 当前文件加权：+min(currentFileBoost, max(0.04, score*0.25))
 * - 时效加权：文件 7 天内更新 → +recencyBoost
 * - 标题加权：heading 类型 chunk → +headingBoost
 * - 置顶：×pinnedWeight
 */
export function applyWeighting(
  result: IKbSearchResult,
  opts: {
    currentFileId?: string;
    currentFileBoost?: number;
    recencyBoost?: number;
    headingBoost?: number;
    pinnedWeight?: number;
    updatedAt?: number | null; // 文件更新时间戳（毫秒）
  }
): IKbSearchResult {
  let score = result.score;

  // 当前文件加权
  if (opts.currentFileId && result.docId === opts.currentFileId) {
    const boost = opts.currentFileBoost ?? DEFAULT_CURRENT_FILE_BOOST;
    score += Math.min(boost, Math.max(0.04, result.score * 0.25));
  }

  // 时效加权：7 天内更新的文件
  if (opts.updatedAt) {
    const age = Date.now() - opts.updatedAt;
    if (age >= 0 && age < RECENCY_WINDOW_MS) {
      score += opts.recencyBoost ?? DEFAULT_RECENCY_BOOST;
    }
  }

  // 标题加权
  if (result.isHeading) {
    score += opts.headingBoost ?? DEFAULT_HEADING_BOOST;
  }

  // 置顶
  if (result.pinned) {
    score *= opts.pinnedWeight ?? 1.5;
  }

  return { ...result, score };
}

// ---------------------------------------------------------------------------
// R4: 段聚合增强
// ---------------------------------------------------------------------------

/**
 * 段聚合增强：
 * - heading 提升：heading chunk 的分数提升给同 heading 下子 chunk
 * - 单文件 cap：maxChunksPerFile，取分数最高的 N 个
 * - 上下文扩展：匹配 chunk 前后各扩展 contextExpand 个 chunk（通过 seq 查 kb_chunks）
 * - maxSections = max(topK*2, 8)
 */
export function aggregateAndExpand(
  results: IKbSearchResult[],
  db: Database.Database,
  userId: string,
  opts: {
    maxChunksPerFile?: number;
    contextExpand?: number;
    topK?: number;
  }
): IKbSearchResult[] {
  if (results.length === 0) return [];

  const maxChunksPerFile = opts.maxChunksPerFile ?? DEFAULT_MAX_CHUNKS_PER_FILE;
  const contextExpand = opts.contextExpand ?? DEFAULT_CONTEXT_EXPAND;
  const maxSections = Math.max((opts.topK ?? 5) * 2, 8);

  // Step 1: heading 提升 — heading chunk 的分数传递给同文档下相邻 chunk
  const headingScores = new Map<string, number>(); // docId → heading 最高分
  for (const r of results) {
    if (r.isHeading) {
      const prev = headingScores.get(r.docId) ?? 0;
      headingScores.set(r.docId, Math.max(prev, r.score));
    }
  }

  // heading boost：同文档非 heading chunk 从 heading 分数中获得 30% 提升
  const boosted = results.map(r => {
    if (!r.isHeading && headingScores.has(r.docId)) {
      const headingScore = headingScores.get(r.docId)!;
      return { ...r, score: r.score + headingScore * 0.3 };
    }
    return r;
  });

  // Step 2: 单文件 cap — 每个文件最多取 maxChunksPerFile 个最高分 chunk
  const byFile = new Map<string, IKbSearchResult[]>();
  for (const r of boosted) {
    const arr = byFile.get(r.docId) ?? [];
    arr.push(r);
    byFile.set(r.docId, arr);
  }

  const capped: IKbSearchResult[] = [];
  for (const [, arr] of byFile) {
    arr.sort((a, b) => b.score - a.score);
    capped.push(...arr.slice(0, maxChunksPerFile));
  }

  // Step 3: 上下文扩展 — 4b: 批量查询邻居（减少 N 次 SQL 为 1 次）
  const expanded: IKbSearchResult[] = [];
  const seenChunkIds = new Set<string>();

  // 加入匹配 chunk 自身
  for (const r of capped) {
    if (!seenChunkIds.has(r.chunkId)) {
      expanded.push(r);
      seenChunkIds.add(r.chunkId);
    }
  }

  if (contextExpand > 0 && capped.length > 0) {
    // 按 docId 分组收集 (seq, chunkId) 用于批量查询
    const docSeqGroups = new Map<string, Array<{ seq: number; chunkId: string; score: number }>>();
    for (const r of capped) {
      const arr = docSeqGroups.get(r.docId) ?? [];
      arr.push({ seq: r.seq, chunkId: r.chunkId, score: r.score });
      docSeqGroups.set(r.docId, arr);
    }

    try {
      // 批量构建 OR 条件：每条 (docId, seq-range) 对应一个 AND 子句
      const orClauses: string[] = [];
      const params: Array<string | number> = [];
      for (const [docId, seqs] of docSeqGroups) {
        for (const s of seqs) {
          orClauses.push('(d.id = ? AND c.seq BETWEEN ? AND ? AND c.id != ?)');
          params.push(docId, s.seq - contextExpand, s.seq + contextExpand, s.chunkId);
        }
      }
      // 构建 seq→score 映射，用于计算扩展 chunk 的分数
      const seqScoreMap = new Map<string, number>();
      for (const [docId, seqs] of docSeqGroups) {
        for (const s of seqs) {
          seqScoreMap.set(`${docId}:${s.seq}`, s.score);
        }
      }

      const sql = `
        SELECT c.id AS chunkId, c.document_id AS documentId, c.content, c.seq,
               c.source_ref AS sourceRef, d.title AS fileName, d.pinned,
               c.heading_path AS headingPath
          FROM kb_chunks c
          JOIN kb_documents d ON d.id = c.document_id
         WHERE d.user_id = ?
           AND (${orClauses.join(' OR ')})
         ORDER BY c.seq
      `;

      const neighbors = db.prepare(sql).all(userId, ...params) as Array<{
        chunkId: string;
        documentId: string;
        content: string;
        seq: number;
        sourceRef: string | null;
        fileName: string;
        pinned: number;
        headingPath: string | null;
      }>;

      for (const n of neighbors) {
        if (seenChunkIds.has(n.chunkId)) continue;
        seenChunkIds.add(n.chunkId);
        // 找到最近的源匹配 chunk 分数（取最近 seq 的那个）
        const parentScore = seqScoreMap.get(`${n.documentId}:${n.seq - contextExpand}`)
          ?? seqScoreMap.get(`${n.documentId}:${n.seq + contextExpand}`)
          ?? 0;
        expanded.push({
          docId: n.documentId,
          chunkId: n.chunkId,
          fileName: n.fileName,
          content: n.content,
          seq: n.seq,
          score: parentScore * 0.5,
          pinned: !!n.pinned,
          sourceRef: n.sourceRef ?? null,
          isHeading: !!n.headingPath,
        });
      }
    } catch {
      // 批量查询失败时静默跳过扩展
    }
  }

  // 按分数排序，截取 maxSections
  expanded.sort((a, b) => b.score - a.score);
  return expanded.slice(0, maxSections);
}

// ---------------------------------------------------------------------------
// R6: 条件重排
// ---------------------------------------------------------------------------

/** R6 重排缓存：5 分钟 TTL。 */
interface RerankCacheEntry {
  results: IKbSearchResult[];
  timestamp: number;
}
const rerankCache = new Map<string, RerankCacheEntry>();
const RERANK_CACHE_TTL_MS = 5 * 60 * 1000;
/** 4c: 惰性清理 — 每 N 次写入才遍历清理一次过期条目。 */
let rerankWriteCount = 0;
const RERANK_CLEANUP_INTERVAL = 50;

// ---------------------------------------------------------------------------
// 搜索结果缓存（优化：避免重复查询）
// ---------------------------------------------------------------------------

/** 搜索结果缓存条目。 */
interface SearchResultCacheEntry {
  response: IKbSearchDetailedResponse;
  timestamp: number;
}

/** 搜索结果缓存：3 分钟 TTL，最大 100 条目。 */
const searchResultCache = new Map<string, SearchResultCacheEntry>();
const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
const SEARCH_CACHE_MAX_SIZE = 100;
/** 惰性清理计数器。 */
let searchCacheWriteCount = 0;
const SEARCH_CACHE_CLEANUP_INTERVAL = 20;

/**
 * 生成搜索缓存键。
 * 排除 expandedQueries（LLM 动态生成，不参与缓存键）。
 */
function getSearchCacheKey(userId: string, query: string, opts: KbSearchOptions): string {
  return `${userId}::${query}::${opts.topK ?? 5}::${opts.currentFileId ?? ''}::${opts.threshold ?? 0.6}`;
}

/**
 * 清除过期的搜索缓存条目。
 */
function cleanupSearchCache(): void {
  const now = Date.now();
  for (const [key, entry] of searchResultCache) {
    if (now - entry.timestamp > SEARCH_CACHE_TTL_MS) {
      searchResultCache.delete(key);
    }
  }
  // 如果超过最大容量，删除最旧的条目
  if (searchResultCache.size > SEARCH_CACHE_MAX_SIZE) {
    const entries = [...searchResultCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - SEARCH_CACHE_MAX_SIZE);
    for (const [key] of toDelete) {
      searchResultCache.delete(key);
    }
  }
}

/**
 * 使搜索缓存失效（KB 文档索引/删除/更新后调用）。
 */
export function invalidateKbSearchCache(userId?: string): void {
  if (userId) {
    // 精确失效：仅清除该用户的缓存
    for (const key of searchResultCache.keys()) {
      if (key.startsWith(`${userId}::`)) {
        searchResultCache.delete(key);
      }
    }
  } else {
    searchResultCache.clear();
  }
}

/**
 * 判断是否需要条件重排（满足任一条件）：
 * 1. top2 差距 < 0.03
 * 2. 意图 summary | comparison | follow_up
 * 3. 结果分散 3+ 文件
 * 4. 置信度低（top1 分数 < 0.15）
 */
export function shouldRerank(
  results: IKbSearchResult[],
  intent: QueryIntentType
): boolean {
  if (results.length < 2) return false;

  // 条件 1: top2 差距 < 0.03
  const top2Gap = results[0].score - results[1].score;
  if (top2Gap < 0.03) return true;

  // 条件 2: 意图 summary | comparison | follow_up
  if (intent === 'summary' || intent === 'comparison' || intent === 'follow_up') return true;

  // 条件 3: 结果分散 3+ 文件
  const uniqueFiles = new Set(results.map(r => r.docId));
  if (uniqueFiles.size >= 3) return true;

  // 条件 4: 置信度低
  if (results[0].score < 0.15) return true;

  return false;
}

/**
 * 将 detectQueryIntent 的返回值映射到 QueryIntentType。
 */
function mapIntentToType(intent: 'question' | 'command' | 'keyword'): QueryIntentType {
  switch (intent) {
    case 'question': return 'fact';
    case 'command': return 'procedure';
    case 'keyword': return 'fact';
  }
}

/**
 * 条件重排（R6）：满足触发条件时调用 LLM 对 top-N 评分。
 * 使用内存 5 分钟 TTL 缓存。
 */
export async function conditionalRerank(
  results: IKbSearchResult[],
  query: string,
  intent: QueryIntentType,
  opts: {
    enableConditionalRerank?: boolean;
    rerankFn?: (query: string, results: IKbSearchResult[]) => Promise<IKbSearchResult[]>;
  }
): Promise<IKbSearchResult[]> {
  // 未启用或无重排函数时直接返回
  if (!opts.enableConditionalRerank || !opts.rerankFn) {
    return results;
  }

  // 检查是否需要重排
  if (!shouldRerank(results, intent)) {
    return results;
  }

  // 检查缓存（4c: 读取时检查 TTL，过期即删）
  const cacheKey = `${query}::${results.map(r => r.chunkId).join(',')}`;
  const cached = rerankCache.get(cacheKey);
  if (cached) {
    if (Date.now() - cached.timestamp < RERANK_CACHE_TTL_MS) {
      return cached.results;
    }
    rerankCache.delete(cacheKey);
  }

  try {
    // 调用 LLM 重排（取 top-10 送入重排）
    const topN = results.slice(0, 10);
    const reranked = await opts.rerankFn(query, topN);

    // 合并：重排后的 top-N + 剩余未重排的
    const rerankedIds = new Set(reranked.map(r => r.chunkId));
    const remaining = results.filter(r => !rerankedIds.has(r.chunkId));
    const final = [...reranked, ...remaining];

    // 写入缓存
    rerankCache.set(cacheKey, { results: final, timestamp: Date.now() });

    // 4c: 惰性清理 — 每 RERANK_CLEANUP_INTERVAL 次写入才遍历清理一次
    rerankWriteCount += 1;
    if (rerankWriteCount >= RERANK_CLEANUP_INTERVAL) {
      rerankWriteCount = 0;
      const now = Date.now();
      for (const [key, entry] of rerankCache) {
        if (now - entry.timestamp > RERANK_CACHE_TTL_MS) {
          rerankCache.delete(key);
        }
      }
    }

    return final;
  } catch {
    // 重排失败时返回原始结果
    return results;
  }
}

// ---------------------------------------------------------------------------
// searchKB — 对外契约
// ---------------------------------------------------------------------------

/**
 * 混合检索：FTS5 BM25 + 向量余弦（可选）+ 标题匹配 → RRF 融合 → 加权 → 段聚合 → 条件重排。
 * 无 queryVector 时降级到纯 FTS5 + 标题匹配。
 */
export async function searchKB(
  userId: string,
  query: string,
  opts: KbSearchOptions
): Promise<IKbSearchDetailedResponse> {
  const topK = opts.topK ?? 5;
  const pinnedWeight = opts.pinnedWeight ?? 1.5;
  const threshold = opts.threshold ?? 0.6;
  const rrfK = opts.rrfK ?? DEFAULT_RRF_K;
  const candidateMultiplier = opts.candidateMultiplier ?? DEFAULT_CANDIDATE_MULTIPLIER;
  const vecScoreThreshold = opts.vecScoreThreshold ?? DEFAULT_VEC_SCORE_THRESHOLD;

  const cleaned = sanitizeFtsQuery(query);
  const emptyResponse: IKbSearchDetailedResponse = {
    refused: true,
    threshold,
    best: null,
    results: [],
  };
  if (!cleaned) return emptyResponse;

  // 缓存检查：跳过 expandedQueries（LLM 动态生成，每次不同）
  const hasExpandedQueries = opts.expandedQueries && opts.expandedQueries.length > 0;
  if (!hasExpandedQueries) {
    const cacheKey = getSearchCacheKey(userId, query, opts);
    const cached = searchResultCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL_MS) {
      return cached.response;
    }
    // 清理过期缓存（惰性清理）
    searchCacheWriteCount += 1;
    if (searchCacheWriteCount >= SEARCH_CACHE_CLEANUP_INTERVAL) {
      searchCacheWriteCount = 0;
      cleanupSearchCache();
    }
  }

  const db = getDatabase();
  const candidateLimit = Math.max(1, topK * candidateMultiplier);

  // ---- 三路并行召回 ----

  // 路径 1: FTS5 BM25 召回
  const ftsRows = db
    .prepare(
      `SELECT c.id AS chunkId, c.document_id AS documentId, c.content, c.seq,
              c.source_ref AS sourceRef, c.heading_path AS headingPath,
              d.title AS fileName, d.pinned,
              bm25(kb_chunks_fts) AS bm
         FROM kb_chunks_fts
         JOIN kb_chunks c ON c.rowid = kb_chunks_fts.rowid
         JOIN kb_documents d ON d.id = c.document_id
        WHERE kb_chunks_fts MATCH ? AND d.user_id = ?
        ORDER BY bm LIMIT ?`
    )
    .all(cleaned, userId, candidateLimit) as Array<{
    chunkId: string;
    documentId: string;
    content: string;
    seq: number;
    sourceRef: string | null;
    headingPath: string | null;
    fileName: string;
    pinned: number;
    bm: number;
  }>;

  // 路径 2: 向量搜索（可选），候选 = topK × candidateMultiplier
  const vecLimit = topK * candidateMultiplier;
  const vecScores = opts.queryVector
    ? vectorSearch(db, userId, opts.queryVector, vecLimit, vecScoreThreshold)
    : new Map<string, number>();

  // 路径 3: 标题匹配
  const titleScores = titleMatchSearch(db, userId, cleaned, candidateLimit);

  // ---- R5: 扩展查询合并 ----
  // expandedQueries 由外部（agentLoop）注入，每条扩展查询额外走 FTS5 召回
  const extraFtsRows: typeof ftsRows = [];
  if (opts.expandedQueries && opts.expandedQueries.length > 0) {
    for (const eq of opts.expandedQueries) {
      const eqCleaned = sanitizeFtsQuery(eq);
      if (!eqCleaned) continue;
      try {
        const rows = db.prepare(`
          SELECT c.id AS chunkId, c.document_id AS documentId, c.content, c.seq,
                 c.source_ref AS sourceRef, c.heading_path AS headingPath,
                 d.title AS fileName, d.pinned,
                 bm25(kb_chunks_fts) AS bm
            FROM kb_chunks_fts
            JOIN kb_chunks c ON c.rowid = kb_chunks_fts.rowid
            JOIN kb_documents d ON d.id = c.document_id
           WHERE kb_chunks_fts MATCH ? AND d.user_id = ?
           ORDER BY bm LIMIT ?
        `).all(eqCleaned, userId, Math.ceil(candidateLimit / 2)) as typeof ftsRows;
        extraFtsRows.push(...rows);
      } catch {
        // 扩展查询失败时静默跳过
      }
    }
  }

  // 合并所有 FTS 结果（去重）
  const allFtsRows = [...ftsRows];
  const seenFtsChunkIds = new Set(ftsRows.map(r => r.chunkId));
  for (const r of extraFtsRows) {
    if (!seenFtsChunkIds.has(r.chunkId)) {
      allFtsRows.push(r);
      seenFtsChunkIds.add(r.chunkId);
    }
  }

  // ---- 构建候选集 ----

  // 收集所有涉及的 documentId（用于查 updated_at）
  const docIds = new Set<string>();
  for (const r of allFtsRows) docIds.add(r.documentId);
  // 向量结果也可能命中不同文档，从 vecScores 的 chunkId 反查
  // （但此处 vecScores 只有 chunkId，需要额外查询，简化为仅用 FTS 已知文档）

  // 查询文档更新时间
  const updatedAtMap = new Map<string, number>();
  if (docIds.size > 0) {
    try {
      const placeholders = Array.from(docIds).map(() => '?').join(',');
      const docRows = db.prepare(`
        SELECT id, updated_at FROM kb_documents WHERE id IN (${placeholders})
      `).all(...docIds) as Array<{ id: string; updated_at: string | null }>;
      for (const row of docRows) {
        if (row.updated_at) {
          updatedAtMap.set(row.id, new Date(row.updated_at).getTime());
        }
      }
    } catch {
      // 查询失败时静默跳过
    }
  }

  // 也从向量结果中补充 chunkId → documentId 映射
  const vecChunkIds = [...vecScores.keys()].filter(id => !seenFtsChunkIds.has(id));
  if (vecChunkIds.length > 0) {
    try {
      const placeholders = vecChunkIds.map(() => '?').join(',');
      const vecDocRows = db.prepare(`
        SELECT c.id AS chunkId, c.document_id AS documentId, c.content, c.seq,
               c.source_ref AS sourceRef, c.heading_path AS headingPath,
               d.title AS fileName, d.pinned
          FROM kb_chunks c
          JOIN kb_documents d ON d.id = c.document_id
         WHERE c.id IN (${placeholders})
      `).all(...vecChunkIds) as Array<{
        chunkId: string;
        documentId: string;
        content: string;
        seq: number;
        sourceRef: string | null;
        headingPath: string | null;
        fileName: string;
        pinned: number;
      }>;
      for (const r of vecDocRows) {
        allFtsRows.push({ ...r, bm: 0 }); // BM25 分为 0，纯向量命中
        docIds.add(r.documentId);
      }
    } catch {
      // 查询失败时静默跳过
    }
  }

  // 构建候选
  const candidates: SearchCandidate[] = allFtsRows.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    fileName: r.fileName,
    content: r.content,
    seq: r.seq,
    pinned: !!r.pinned,
    sourceRef: r.sourceRef ?? null,
    bm: r.bm,
    vecScore: vecScores.get(r.chunkId) ?? null,
    titleScore: titleScores.get(r.documentId) ?? 0,
    isHeading: !!r.headingPath,
  }));
  if (candidates.length === 0) return emptyResponse;

  // ---- R2: RRF 融合评分 ----
  const ranked = rankCandidates(candidates, pinnedWeight, opts.fuse, rrfK);

  // ---- R3: 加权策略 ----
  const weighted = ranked.map(r => {
    const updatedAt = updatedAtMap.get(r.docId) ?? null;
    return applyWeighting(r, {
      currentFileId: opts.currentFileId,
      currentFileBoost: opts.currentFileBoost,
      recencyBoost: opts.recencyBoost,
      headingBoost: opts.headingBoost,
      pinnedWeight,
      updatedAt,
    });
  });

  // 重新排序（加权后分数可能改变排序）
  weighted.sort((a, b) => b.score - a.score);

  // ---- R4: 段聚合增强 ----
  const aggregated = aggregateAndExpand(weighted, db, userId, {
    maxChunksPerFile: opts.maxChunksPerFile,
    contextExpand: opts.contextExpand,
    topK,
  });

  // ---- R6: 条件重排 ----
  const intent = detectQueryIntent(query);
  const intentType = mapIntentToType(intent);
  const reranked = await conditionalRerank(aggregated, query, intentType, {
    enableConditionalRerank: opts.enableConditionalRerank,
    rerankFn: opts.rerankFn,
  });

  // ---- 截取 topK + 拒答判断 ----
  const results = reranked.slice(0, topK);
  const best = results[0] ?? null;
  const refused = !best || best.score < threshold;

  const response: IKbSearchDetailedResponse = {
    refused,
    threshold,
    best,
    results,
  };

  // 写入缓存（跳过 expandedQueries 场景）
  if (!hasExpandedQueries) {
    const cacheKey = getSearchCacheKey(userId, query, opts);
    searchResultCache.set(cacheKey, { response, timestamp: Date.now() });
  }

  return response;
}

/**
 * 向后兼容的简单搜索接口（返回 KbSearchResponse）。
 * 调用方（agentTaskWorker、agentHandlers）使用此函数。
 */
export async function searchKBCompat(
  userId: string,
  query: string,
  opts: KbSearchOptions
): Promise<KbSearchResponse> {
  const detailed = await searchKB(userId, query, opts);
  return {
    refused: detailed.refused,
    threshold: detailed.threshold,
    best: detailed.best,
    results: detailed.results,
  };
}

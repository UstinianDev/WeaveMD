// ============================================
// WeaveMD — FTS5 查询构建与 BM25 评分（提取自 kbSearch.ts）
// ============================================
// 提供：FTS5 查询净化、RRF 融合、向量/标题召回、候选排序。
// 原属于 kbSearch.ts R2 部分，拆分以降低单文件复杂度。

import { buildFtsQuery } from './tokenizer';
import type Database from 'better-sqlite3';
import type { IKbSearchResult } from '@shared/ai';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const EPS = 1e-9;
export const DEFAULT_RRF_K = 60;
export const DEFAULT_CANDIDATE_MULTIPLIER = 4;
export const DEFAULT_VEC_SCORE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// FTS5 查询构建
// ---------------------------------------------------------------------------

/**
 * 净化用户查询为 FTS5 匹配字符串（R11：委托 tokenizer.buildFtsQuery）。
 * jieba 分词 → CJK token 前缀匹配 → OR 连接；jieba 不可用时降级 bigram。
 */
export function sanitizeFtsQuery(query: string): string {
  return buildFtsQuery(query);
}

// ---------------------------------------------------------------------------
// R2: RRF 混合检索类型与函数
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
export function vectorSearch(
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
 * 标题/路径 FTS5 匹配（性能优化）。
 * 使用 FTS5 全文索引替代 LIKE 查询，加速标题匹配检索。
 * 返回 documentId → 匹配分数（0-1）。
 */
export function titleMatchSearch(
  db: Database.Database,
  userId: string,
  query: string,
  limit: number
): Map<string, number> {
  const result = new Map<string, number>();

  // 清理查询：移除 FTS5 特殊字符
  const FTS_SPECIAL_RE = /[!"()*:^~+\-&|<>[\]{}]/g;
  const cleaned = query.replace(FTS_SPECIAL_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return result;

  // 构建 FTS5 查询：分词后 OR 连接
  const keywords = cleaned.split(/\s+/).filter(k => k.length > 1).slice(0, 5);
  if (keywords.length === 0) return result;

  // FTS5 查询：每个关键词加 * 前缀匹配
  const ftsQuery = keywords.map(kw => `${kw}*`).join(' OR ');

  try {
    const rows = db.prepare(`
      SELECT d.id AS docId, d.title,
             bm25(kb_documents_fts) AS bm
        FROM kb_documents_fts
        JOIN kb_documents d ON d.rowid = kb_documents_fts.rowid
       WHERE kb_documents_fts MATCH ?
         AND kb_documents_fts.user_id = ?
       ORDER BY bm
       LIMIT ?
    `).all(ftsQuery, userId, limit) as Array<{
      docId: string;
      title: string;
      bm: number;
    }>;

    for (const row of rows) {
      if (!row.docId || !row.title) continue;
      // BM25 分数转换为 0-1 范围（bm 越小越好，取绝对值后归一化）
      const score = Math.max(0, 1 - Math.abs(row.bm) / 10);
      result.set(row.docId, Math.min(1, score));
    }
  } catch {
    // FTS5 查询失败时静默跳过（可能索引未建立）
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
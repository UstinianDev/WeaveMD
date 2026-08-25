// ============================================
// WeaveMD — 知识库混合检索（FTS5 BM25 + 向量余弦 + 标题匹配）
// ============================================
// searchKB(userId, query, opts) 为对外契约（精确签名）。
// 混合检索：FTS5 BM25 + sqlite-vec 向量余弦 + 标题/路径 LIKE 匹配，三路融合排序。
// 无向量时降级到纯 FTS5 + 标题匹配。topK×2 候选池 → 融合评分 → 取 topK → 拒答。

import { getDatabase } from '../db/index';
import type Database from 'better-sqlite3';
import type { IKbSearchResult } from '@shared/ai';

export interface KbSearchOptions {
  topK?: number;
  fuse?: number;
  pinnedWeight?: number;
  threshold?: number;
  /** 查询向量（可选，由 embeddingClient 生成，用于向量余弦搜索）。 */
  queryVector?: number[];
}

export type KbSearchResponse = {
  refused: boolean;
  threshold: number;
  best: IKbSearchResult | null;
  results: IKbSearchResult[];
};

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;
const FTS_SPECIAL_RE = /[!"()*:^~+\-&|<>[\]{}]/g;

function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

/**
 * 净化用户查询为纯 token 匹配：
 * 1) 剥离 FTS5 语法特殊字符（防语法注入/误导）；2) 折叠连续空白为单空格；
 * 3) 对含 CJK 的 token 追加 `*` 前缀（连续 CJK 视为单 token，须 `知识*` 式命中）。
 */
export function sanitizeFtsQuery(query: string): string {
  const cleaned = query.replace(FTS_SPECIAL_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((tok) => (hasCjk(tok) ? `${tok}*` : tok))
    .join(' ');
}

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
}

/**
 * 段聚合：将同一文档中相邻 seq 的片段合并为更大的上下文。
 * 相邻片段合并后 content 拼接，score 取最高分。
 * 合并窗口：seq 差值 <= 1 的片段视为相邻。
 */
export function aggregateSegments(
  results: IKbSearchResult[],
  windowSize: number = 1
): IKbSearchResult[] {
  if (results.length === 0) return [];

  // 按 documentId + seq 排序
  const sorted = [...results].sort((a, b) => {
    if (a.docId !== b.docId) return a.docId.localeCompare(b.docId);
    return a.seq - b.seq;
  });

  const aggregated: IKbSearchResult[] = [];
  let current: IKbSearchResult | null = null;

  for (const item of sorted) {
    if (!current) {
      current = { ...item };
      continue;
    }

    // 同一文档且相邻 seq → 合并
    if (
      current.docId === item.docId &&
      Math.abs(current.seq - item.seq) <= windowSize
    ) {
      current.content += '\n\n' + item.content;
      current.score = Math.max(current.score, item.score);
      // seq 保持第一个片段的 seq
    } else {
      aggregated.push(current);
      current = { ...item };
    }
  }

  if (current) aggregated.push(current);
  return aggregated;
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

/**
 * 条件重排：根据查询意图调整排序策略。
 * - question：优先高分片段（精确匹配）
 * - command：优先完整上下文（聚合后片段）
 * - keyword：保持原序
 */
export function rerankByIntent(
  results: IKbSearchResult[],
  intent: 'question' | 'command' | 'keyword'
): IKbSearchResult[] {
  if (intent === 'keyword') return results;

  const sorted = [...results];

  if (intent === 'question') {
    // 问题模式：优先高分片段
    sorted.sort((a, b) => b.score - a.score);
  } else if (intent === 'command') {
    // 命令模式：优先长片段（更完整上下文）
    sorted.sort((a, b) => b.content.length - a.content.length);
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// 向量搜索 + 标题匹配
// ---------------------------------------------------------------------------

/**
 * sqlite-vec 向量余弦搜索（可选路径）。
 * 查询向量由外部 embeddingClient 生成后传入。
 * 返回 chunkId → cosine 相似度 Map。
 */
function vectorSearch(
  db: Database.Database,
  userId: string,
  queryVector: number[],
  limit: number
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
      result.set(row.chunkId, similarity);
    }
  } catch {
    // sqlite-vec 不可用时静默降级
  }
  return result;
}

/**
 * 标题/路径 LIKE 匹配（补充召回）。
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

  for (const keyword of keywords) {
    try {
      const rows = db.prepare(`
        SELECT id AS docId, title
          FROM kb_documents
         WHERE user_id = ?
           AND (title LIKE ? OR file_path LIKE ?)
         LIMIT ?
      `).all(userId, `%${keyword}%`, `%${keyword}%`, limit) as Array<{
        docId: string;
        title: string;
      }>;

      for (const row of rows) {
        if (!row.docId || !row.title) continue;
        const existing = result.get(row.docId) ?? 0;
        const exactMatch = row.title.toLowerCase().includes(keyword.toLowerCase()) ? 0.3 : 0.1;
        result.set(row.docId, Math.min(1, existing + exactMatch));
      }
    } catch {
      // 表不存在或查询失败时静默跳过
    }
  }
  return result;
}

/**
 * 评分 + 排序（纯函数，可单测）：
 * - ftsNorm 对候选 BM25 做 min-max 归一（同极值 → 全部 1）。
 * - 三路融合：FTS × fuse + 向量 × (1-fuse) + 标题 × 0.1。
 * - pinned 文档 × pinnedWeight。
 * 返回按 score 降序的 IKbSearchResult[]。
 */
export function rankCandidates(
  candidates: SearchCandidate[],
  pinnedWeight: number,
  fuse: number = 0.5
): IKbSearchResult[] {
  if (candidates.length === 0) return [];

  const bms = candidates.map((c) => c.bm);
  const min = Math.min(...bms);
  const max = Math.max(...bms);
  const range = max - min;
  const ftsNorm = (bm: number): number => (range > EPS ? (bm - min) / range : 1);

  const scored = candidates.map((c) => {
    const fts = ftsNorm(c.bm);
    const vec = c.vecScore;
    const title = c.titleScore ?? 0;

    // 三路融合：有向量时 fuse 控制 FTS vs 向量权重，无向量时 FTS 权重更高
    let score: number;
    if (vec !== null && vec !== undefined) {
      // 有向量数据：三路融合
      score = fts * fuse + vec * (1 - fuse) + title * 0.1;
    } else {
      // 无向量数据：FTS 为主 + 标题补充（保持向后兼容）
      score = fts * 0.9 + title * 0.1;
    }
    if (c.pinned) score *= pinnedWeight;

    return {
      docId: c.documentId,
      chunkId: c.chunkId,
      fileName: c.fileName,
      content: c.content,
      seq: c.seq,
      score,
      pinned: c.pinned,
      sourceRef: c.sourceRef,
    } satisfies IKbSearchResult;
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ---------------------------------------------------------------------------
// searchKB — 对外契约
// ---------------------------------------------------------------------------

/**
 * 混合检索：FTS5 BM25 + 向量余弦（可选）+ 标题匹配 → 融合评分 → 取 topK → 拒答。
 * 无 queryVector 时降级到纯 FTS5 + 标题匹配。
 */
export async function searchKB(
  userId: string,
  query: string,
  opts: KbSearchOptions
): Promise<KbSearchResponse> {
  const topK = opts.topK ?? 5;
  const pinnedWeight = opts.pinnedWeight ?? 1.5;
  const threshold = opts.threshold ?? 0.6;
  const fuse = opts.fuse ?? 0.5;

  const cleaned = sanitizeFtsQuery(query);
  const response: KbSearchResponse = {
    refused: true,
    threshold,
    best: null,
    results: [],
  };
  if (!cleaned) return response;

  const db = getDatabase();
  const candidateLimit = Math.max(1, topK * 2);

  // FTS5 BM25 召回
  const rows = db
    .prepare(
      `SELECT c.id AS chunkId, c.document_id AS documentId, c.content, c.seq,
              c.source_ref AS sourceRef, d.title AS fileName, d.pinned,
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
    fileName: string;
    pinned: number;
    bm: number;
  }>;

  // 向量搜索（可选）
  const vecScores = opts.queryVector
    ? vectorSearch(db, userId, opts.queryVector, candidateLimit * 2)
    : new Map<string, number>();

  // 标题匹配
  const titleScores = titleMatchSearch(db, userId, cleaned, candidateLimit);

  // 融合分数到候选
  const candidates: SearchCandidate[] = rows.map((r) => ({
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
  }));
  if (candidates.length === 0) return response;

  const ranked = rankCandidates(candidates, pinnedWeight, fuse);

  // 段聚合：合并相邻片段
  const aggregated = aggregateSegments(ranked, 1);

  // 条件重排：根据查询意图调整排序
  const intent = detectQueryIntent(query);
  const reranked = rerankByIntent(aggregated, intent);

  const results = reranked.slice(0, topK);
  const best = results[0] ?? null;
  const refused = !best || best.score < threshold;
  return { refused, threshold, best, results };
}

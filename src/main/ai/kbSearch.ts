// ============================================
// WeaveMD — 知识库召回（FTS5 BM25）融合/拒答/置顶
// ============================================
// searchKB(userId, query, opts) 为对外契约（精确签名）。
// 纯 FTS5 BM25 召回（向量已去除）。topK×2 候选池 → BM25 归一 + 置顶加权 → 取 topK → 拒答。
// FTS 查询净化（sanitizeFtsQuery）剥离 FTS5 特殊字符并对 CJK token 追加 * 前缀通配，
// 避免语法注入与 unicode61 连续 CJK 裸 MATCH 不命中的问题。

import { getDatabase } from '../db/index';
import type { IKbSearchResult } from '@shared/ai';

export interface KbSearchOptions {
  topK?: number;
  fuse?: number;
  pinnedWeight?: number;
  threshold?: number;
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
}

/**
 * 评分 + 排序（纯函数，可单测）：
 * - ftsNorm 对候选 BM25 做 min-max 归一（同极值 → 全部 1）。
 * - pinned 文档 × pinnedWeight。
 * - fuse 参数为向后保留位（纯 FTS 无向量项，不影响分值）。
 * 返回按 score 降序的 IKbSearchResult[]。
 */
export function rankCandidates(
  candidates: SearchCandidate[],
  pinnedWeight: number,
  _fuse?: number
): IKbSearchResult[] {
  if (candidates.length === 0) return [];

  const bms = candidates.map((c) => c.bm);
  const min = Math.min(...bms);
  const max = Math.max(...bms);
  const range = max - min;
  const normOf = (bm: number): number => (range > EPS ? (bm - min) / range : 1);

  const scored = candidates.map((c) => {
    const ftsNorm = normOf(c.bm);
    let score = ftsNorm;
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
 * FTS5 BM25 取 topK×2 候选 →（BM25 归一 + 置顶加权）评分 → 取 topK →
 * 拒答判定（top < threshold → refused）。纯 FTS，无向量路径，不抛给调用方。
 */
export async function searchKB(
  userId: string,
  query: string,
  opts: KbSearchOptions
): Promise<KbSearchResponse> {
  const topK = opts.topK ?? 5;
  const pinnedWeight = opts.pinnedWeight ?? 1.5;
  const threshold = opts.threshold ?? 0.6;

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

  const candidates: SearchCandidate[] = rows.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    fileName: r.fileName,
    content: r.content,
    seq: r.seq,
    pinned: !!r.pinned,
    sourceRef: r.sourceRef ?? null,
    bm: r.bm,
  }));
  if (candidates.length === 0) return response;

  const ranked = rankCandidates(candidates, pinnedWeight);
  const results = ranked.slice(0, topK);
  const best = results[0] ?? null;
  const refused = !best || best.score < threshold;
  return { refused, threshold, best, results };
}

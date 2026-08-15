// ============================================
// WeaveMD — 知识库双路召回（FTS5 BM25 + 向量余弦）融合/拒答/置顶
// ============================================
// searchKB(userId, query, opts) 为对外契约（精确签名）。
// 向量不可用时 searchKB 自动降级仅 FTS5，不让调用方感知 embedding 异常。
// FTS 查询净化（sanitizeFtsQuery）剥离 FTS5 特殊字符并对 CJK token 追加 * 前缀通配，
// 避免语法注入与 unicode61 连续 CJK 裸 MATCH 不命中的问题。

import { getDatabase } from '../db/index';
import { decodeFloat32Array } from '../db/kb';
import { embedBatch } from './embeddingClient';
import type { IKbSearchResult } from '@shared/ai';

export interface KbSearchOptions {
  topK?: number;
  fuse?: number;
  vectorEnabled?: boolean;
  pinnedWeight?: number;
  threshold?: number;
  /** embedding 服务 host（可选，默认本机 Ollama）。 */
  embeddingHost?: string;
  /** embedding 模型 id（可选，默认 nomic-embed-text）。 */
  embeddingModel?: string;
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

/** 余弦相似度：dot / (||a||·||b|| + eps)；零向量 → 0。 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB) + EPS;
  return dot / denom;
}

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

/** 召回候选（rankCandidates 输入）。bm = FTS5 BM25 原始分；vector 为已解码 chunk 向量。 */
export interface SearchCandidate {
  chunkId: string;
  documentId: string;
  fileName: string;
  content: string;
  seq: number;
  pinned: boolean;
  sourceRef: string | null;
  bm: number;
  vector: Float32Array | null;
}

/**
 * 融合评分 + 排序（纯函数，可单测）：
 * - ftsNorm 对候选 BM25 做 min-max 归一（同极值 → 全部 1）。
 * - 有查询向量且 chunk 有向量 → score = fuse*ftsNorm + (1-fuse)*cosine；否则仅 ftsNorm。
 * - pinned 文档 × pinnedWeight。
 * 返回按 score 降序的 IKbSearchResult[]。
 */
export function rankCandidates(
  candidates: SearchCandidate[],
  queryVec: Float32Array | null,
  fuse: number,
  pinnedWeight: number
): IKbSearchResult[] {
  if (candidates.length === 0) return [];

  const bms = candidates.map((c) => c.bm);
  const min = Math.min(...bms);
  const max = Math.max(...bms);
  const range = max - min;
  const normOf = (bm: number): number => (range > EPS ? (bm - min) / range : 1);

  const scored = candidates.map((c) => {
    const ftsNorm = normOf(c.bm);
    let score: number;
    if (queryVec && c.vector) {
      const cos = Math.max(0, cosineSimilarity(queryVec, c.vector));
      score = fuse * ftsNorm + (1 - fuse) * cos;
    } else {
      score = ftsNorm;
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
 * 双路召回：FTS5 BM25 取 topK×2 候选 →（vectorEnabled 时）查询向量余弦融合 →
 * 融合评分 → 置顶加权 → 取 topK → 拒答判定（top < threshold → refused）。
 * embedding 失败/无向量自动降级仅 FTS 分，不抛给调用方。
 */
export async function searchKB(
  userId: string,
  query: string,
  opts: KbSearchOptions
): Promise<KbSearchResponse> {
  const topK = opts.topK ?? 5;
  const fuse = opts.fuse ?? 0.5;
  const vectorEnabled = opts.vectorEnabled ?? false;
  const pinnedWeight = opts.pinnedWeight ?? 1.5;
  const threshold = opts.threshold ?? 0.6;
  const embedHost = opts.embeddingHost ?? 'http://localhost:11434';
  const embedModel = opts.embeddingModel ?? 'nomic-embed-text';

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
              c.source_ref AS sourceRef, c.vector, d.title AS fileName, d.pinned,
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
    vector: Buffer | null;
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
    vector: r.vector ? decodeFloat32Array(r.vector) : null,
  }));
  if (candidates.length === 0) return response;

  // 查询向量（vectorEnabled 时才嵌入；失败降级为 null → 仅 FTS 分）
  let queryVec: Float32Array | null = null;
  if (vectorEnabled) {
    try {
      const vecs = await embedBatch(embedHost, embedModel, [cleaned]);
      if (vecs[0]) queryVec = new Float32Array(vecs[0]);
    } catch {
      queryVec = null;
    }
  }

  const ranked = rankCandidates(candidates, queryVec, fuse, pinnedWeight);
  const results = ranked.slice(0, topK);
  const best = results[0] ?? null;
  const refused = !best || best.score < threshold;
  return { refused, threshold, best, results };
}

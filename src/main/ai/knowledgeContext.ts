// ============================================
// WeaveMD — 知识库上下文构建（R9+R10）
// ============================================
// R9: 证据不足→自动多轮子查询 + 内存缓存
// R10: 文档级上下文注入（全文 ≤18K / outline+段落，总预算 50K）
// 纯函数 + 依赖注入（searchKb / getDocument），可单测。

import type {
  IKbSearchResult,
  IKbSearchDetailedResponse,
  IQueryUnderstanding,
  IEvidenceAssessment,
  EvidenceGrade,
} from '@shared/ai/kb';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface KbContextBuildOptions {
  /** 最大 token 预算（默认 50000）。 */
  totalBudget?: number;
  /** 单文档最大 token（默认 18000）。 */
  perDocBudget?: number;
  /** 是否启用研究循环。 */
  enableResearchLoop?: boolean;
  /** 研究循环最大子查询数（初始 3 + 回退 2）。 */
  maxSubQueries?: number;
  /** 当前文件 ID（加权用）。 */
  currentFileId?: string;
}

export interface KbContextResult {
  /** 注入 system prompt 的上下文文本。 */
  contextText: string;
  /** 证据评估。 */
  evidence: IEvidenceAssessment;
  /** 使用的子查询列表（研究循环）。 */
  subQueries: string[];
  /** 总 token 估算。 */
  estimatedTokens: number;
}

// ---------------------------------------------------------------------------
// 研究循环缓存（内存 5 分钟 TTL）
// ---------------------------------------------------------------------------

interface CachedResearch {
  results: IKbSearchResult[];
  timestamp: number;
}

const researchCache = new Map<string, CachedResearch>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCacheKey(userId: string, query: string): string {
  return `${userId}::${query}`;
}

function getCachedResearch(userId: string, query: string): IKbSearchResult[] | null {
  const key = getCacheKey(userId, query);
  const cached = researchCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    researchCache.delete(key);
    return null;
  }
  return cached.results;
}

function setCachedResearch(userId: string, query: string, results: IKbSearchResult[]): void {
  const key = getCacheKey(userId, query);
  researchCache.set(key, { results, timestamp: Date.now() });
  // 限制缓存大小
  if (researchCache.size > 100) {
    const oldest = researchCache.keys().next().value;
    if (oldest !== undefined) researchCache.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// 研究循环：证据不足→多轮子查询
// ---------------------------------------------------------------------------

/** 搜索函数类型（依赖注入）。 */
export type SearchKbFn = (
  userId: string,
  query: string,
  opts: Record<string, unknown>
) => Promise<IKbSearchDetailedResponse>;

/** 文档获取函数类型（依赖注入）。 */
export type GetDocumentFn = (docId: string) => { title: string; content?: string } | null;

/** 基于查询理解生成子查询。 */
function generateSubQueries(
  understanding: IQueryUnderstanding,
  maxQueries: number
): string[] {
  const queries: string[] = [];
  const { standalone, expanded, intent } = understanding;

  // 初始查询
  queries.push(standalone);

  // 基于意图扩展
  if (intent === 'comparison') {
    queries.push(`${standalone} 优缺点`);
    queries.push(`${standalone} 区别`);
  } else if (intent === 'summary') {
    queries.push(`${standalone} 概述`);
    queries.push(`${standalone} 要点`);
  } else if (intent === 'procedure') {
    queries.push(`${standalone} 步骤`);
    queries.push(`${standalone} 流程`);
  }

  // 补充 expanded 查询
  for (const q of expanded) {
    if (!queries.includes(q) && queries.length < maxQueries) {
      queries.push(q);
    }
  }

  return queries.slice(0, maxQueries);
}

/**
 * 研究循环：初始搜索不足时，自动生成子查询并重新检索。
 * 返回合并去重后的结果。
 */
export async function researchLoop(
  userId: string,
  query: string,
  understanding: IQueryUnderstanding,
  searchKb: SearchKbFn,
  opts: { maxSubQueries?: number; threshold?: number } = {}
): Promise<IKbSearchResult[]> {
  const maxSub = opts.maxSubQueries ?? 5; // 3 初始 + 2 回退
  const threshold = opts.threshold ?? 0.6;
  const subQueries = generateSubQueries(understanding, maxSub);

  const allResults: IKbSearchResult[] = [];
  const seenChunkIds = new Set<string>();

  for (const sq of subQueries) {
    // 检查缓存
    const cached = getCachedResearch(userId, sq);
    if (cached) {
      for (const r of cached) {
        if (!seenChunkIds.has(r.chunkId)) {
          seenChunkIds.add(r.chunkId);
          allResults.push(r);
        }
      }
      continue;
    }

    try {
      const res = await searchKb(userId, sq, { topK: 5, threshold: threshold * 0.8 });
      if (res.results?.length) {
        setCachedResearch(userId, sq, res.results);
        for (const r of res.results) {
          if (!seenChunkIds.has(r.chunkId)) {
            seenChunkIds.add(r.chunkId);
            allResults.push(r);
          }
        }
      }
    } catch {
      // 单个子查询失败不中断研究循环
    }

    // 已有足够高质量结果时提前终止
    const highQuality = allResults.filter((r) => r.score >= threshold);
    if (highQuality.length >= 3) break;
  }

  // 按分数降序
  allResults.sort((a, b) => b.score - a.score);
  return allResults;
}

// ---------------------------------------------------------------------------
// R10: 文档级上下文注入
// ---------------------------------------------------------------------------

/** 估算文本 token 数（粗略：中文 ~1.5 字/token，英文 ~4 字/token）。 */
function estimateTokens(text: string): number {
  const cjkCount = (text.match(/[一-鿿]/g) || []).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 1.5 + otherCount / 4);
}

/**
 * 构建文档级上下文。
 * - 短文档（≤ perDocBudget token）：全文注入
 * - 长文档：outline（heading 列表）+ 匹配段落
 * - 总预算控制
 */
function buildDocumentContext(
  results: IKbSearchResult[],
  getDocument: GetDocumentFn,
  perDocBudget: number,
  totalBudget: number
): { text: string; usedTokens: number } {
  if (results.length === 0) return { text: '', usedTokens: 0 };

  // 按文档分组
  const docGroups = new Map<string, IKbSearchResult[]>();
  for (const r of results) {
    const group = docGroups.get(r.docId) || [];
    group.push(r);
    docGroups.set(r.docId, group);
  }

  // 按最高分数排序文档
  const sortedDocs = [...docGroups.entries()].sort(
    ([, a], [, b]) => Math.max(...b.map((r) => r.score)) - Math.max(...a.map((r) => r.score))
  );

  let usedTokens = 0;
  const parts: string[] = [];

  for (const [docId, docResults] of sortedDocs) {
    if (usedTokens >= totalBudget) break;

    const doc = getDocument(docId);
    if (!doc) continue;

    const title = doc.title;
    const fullContent = doc.content;

    if (fullContent) {
      const docTokens = estimateTokens(fullContent);
      const remainingBudget = totalBudget - usedTokens;
      const docBudget = Math.min(perDocBudget, remainingBudget);

      if (docTokens <= docBudget) {
        // 短文档：全文注入
        parts.push(`## 文档：${title}\n\n${fullContent}`);
        usedTokens += docTokens;
      } else {
        // 长文档：outline + 匹配段落
        const headings = extractHeadings(fullContent);
        const matchedParagraphs = docResults
          .sort((a, b) => a.seq - b.seq)
          .map((r) => r.content)
          .join('\n\n');

        const outlineText = headings.length > 0
          ? `### 大纲\n${headings.join('\n')}`
          : '';

        const paraTokens = estimateTokens(matchedParagraphs);
        const outlineTokens = estimateTokens(outlineText);
        const availableForPara = docBudget - outlineTokens;

        if (paraTokens <= availableForPara) {
          parts.push(`## 文档：${title}\n\n${outlineText}\n\n### 匹配段落\n\n${matchedParagraphs}`);
          usedTokens += outlineTokens + paraTokens;
        } else {
          // 截断匹配段落
          const truncated = truncateToTokenBudget(matchedParagraphs, availableForPara);
          parts.push(`## 文档：${title}\n\n${outlineText}\n\n### 匹配段落\n\n${truncated}`);
          usedTokens += outlineTokens + estimateTokens(truncated);
        }
      }
    } else {
      // 无全文：仅输出匹配段落
      const matchedParagraphs = docResults
        .sort((a, b) => a.seq - b.seq)
        .map((r) => r.content)
        .join('\n\n');
      const paraTokens = estimateTokens(matchedParagraphs);
      const remainingBudget = totalBudget - usedTokens;

      if (paraTokens <= remainingBudget) {
        parts.push(`## 文档：${title}\n\n${matchedParagraphs}`);
        usedTokens += paraTokens;
      } else {
        const truncated = truncateToTokenBudget(matchedParagraphs, remainingBudget);
        parts.push(`## 文档：${title}\n\n${truncated}`);
        usedTokens += estimateTokens(truncated);
      }
    }
  }

  return { text: parts.join('\n\n---\n\n'), usedTokens };
}

/** 提取文档中的标题行。 */
function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed)) {
      headings.push(trimmed);
    }
  }
  return headings.slice(0, 50); // 最多 50 个标题
}

/** 截断文本到 token 预算。 */
function truncateToTokenBudget(text: string, budget: number): string {
  if (budget <= 0) return '';
  const estimated = estimateTokens(text);
  if (estimated <= budget) return text;

  // 按比例截断
  const ratio = budget / estimated;
  const charLimit = Math.floor(text.length * ratio * 0.9); // 留 10% 余量
  return text.slice(0, charLimit) + '\n\n[已截断…]';
}

// ---------------------------------------------------------------------------
// 主入口：构建知识库上下文
// ---------------------------------------------------------------------------

/**
 * 构建知识库上下文（R9 研究循环 + R10 文档级注入）。
 * 1. 首次搜索结果评估证据等级
 * 2. 证据不足→研究循环（多轮子查询）
 * 3. 文档级上下文注入（全文 / outline + 段落）
 * 4. 返回上下文文本 + 证据评估
 */
export async function buildKbContext(
  userId: string,
  query: string,
  initialResults: IKbSearchDetailedResponse,
  understanding: IQueryUnderstanding | undefined,
  searchKb: SearchKbFn,
  getDocument: GetDocumentFn,
  opts: KbContextBuildOptions = {}
): Promise<KbContextResult> {
  const totalBudget = opts.totalBudget ?? 50000;
  const perDocBudget = opts.perDocBudget ?? 18000;
  const enableResearch = opts.enableResearchLoop !== false;

  let results = initialResults.results || [];
  let evidence: IEvidenceAssessment = initialResults.evidence ?? {
    grade: initialResults.refused ? 'no_evidence' : 'grounded',
    confidence: initialResults.best?.score ?? 0,
  };
  const subQueries: string[] = [];

  // R9: 研究循环 — 证据不足时自动多轮查询
  if (enableResearch && understanding && (evidence.grade === 'no_evidence' || evidence.grade === 'weak_evidence')) {
    const researchResults = await researchLoop(
      userId,
      query,
      understanding,
      searchKb,
      { maxSubQueries: opts.maxSubQueries ?? 5, threshold: initialResults.threshold }
    );

    if (researchResults.length > results.length) {
      results = researchResults;
      // 重新评估证据
      const bestScore = results[0]?.score ?? 0;
      if (bestScore >= (initialResults.threshold ?? 0.6) * 1.2) {
        evidence = { grade: 'grounded', confidence: Math.min(0.95, bestScore) };
      } else if (bestScore >= (initialResults.threshold ?? 0.6)) {
        evidence = { grade: 'weak_evidence', confidence: bestScore };
      }
      subQueries.push(...generateSubQueries(understanding, opts.maxSubQueries ?? 5));
    }
  }

  // R10: 文档级上下文注入
  const docContext = buildDocumentContext(results, getDocument, perDocBudget, totalBudget);

  // 构建最终上下文
  const contextParts: string[] = [];

  if (docContext.text) {
    contextParts.push(`以下是从知识库中检索到的相关内容：\n\n${docContext.text}`);
  }

  // 证据等级提示
  if (evidence.grade === 'weak_evidence') {
    contextParts.push('\n\n[提示] 检索到的内容置信度较低，请在回答时注明不确定性。');
  } else if (evidence.grade === 'conflicting_evidence') {
    contextParts.push('\n\n[提示] 检索到的内容存在矛盾，请分别呈现不同来源的观点。');
  } else if (evidence.grade === 'no_evidence') {
    contextParts.push('\n\n[提示] 未找到足够相关的知识库内容。');
  }

  return {
    contextText: contextParts.join(''),
    evidence,
    subQueries,
    estimatedTokens: docContext.usedTokens + estimateTokens(contextParts.join('')) - docContext.usedTokens,
  };
}

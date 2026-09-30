import type { ToolCtx, ToolResult } from '../toolTypes';
import type { IKbDiagnostics, IQueryUnderstanding } from '@shared/ai/kb';
import type { ConversationMessage } from '../knowledge/queryPlanner';
import { detectAmbiguities, classifyIntent, resolveReferencesDetailed, expandByIntent } from '../knowledge/queryPlanner';
import { buildClarificationContext } from '../knowledge/knowledgeClarify';
import { getCachedHydeResult, setCachedHydeResult } from '../knowledge/searchCache';

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 从搜索结果构建最小化 IQueryUnderstanding。
 * 用于在搜索被拒或无结果时触发澄清检测。
 * confidence 基于最佳搜索得分（0~1 映射），歧义检测走 queryPlanner 规则引擎。
 *
 * P0-6：history 透传 detectAmbiguities（代词/过短判定的历史门控随之放行）。
 * A3：history 同步透传 classifyIntent（有历史时 follow_up 判定不再退化为 fact）。
 */
export function buildMinimalUnderstanding(
  query: string,
  res: {
    refused: boolean;
    threshold: number;
    best: { score: number } | null;
    results: Array<{ score: number }>;
  },
  history?: ConversationMessage[]
): IQueryUnderstanding {
  const ambiguities = detectAmbiguities(query, history);
  const intents = classifyIntent(query, history);
  const primaryIntent = intents[0] ?? 'fact';

  // confidence 从最佳搜索得分推断
  let confidence = 0.2; // 默认低置信（无结果）
  if (res.best && res.best.score > 0) {
    confidence = Math.min(res.best.score, 0.9);
  } else if (res.results.length > 0 && res.results[0].score > 0) {
    confidence = Math.min(res.results[0].score, 0.9);
  }

  return {
    intent: primaryIntent,
    intents,
    standalone: query,
    expanded: [query],
    ambiguities,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// 工具处理器
// ---------------------------------------------------------------------------

/**
 * 合并 P0-6 原 query 回退与 A3 意图扩展。
 * 两者皆空时返回 undefined，保持改前语义（不传 expandedQueries）。
 */
function mergeExpandedQueries(base: string[] | undefined, additions: string[]): string[] | undefined {
  const merged = new Set<string>(base ?? []);
  for (const addition of additions) {
    if (addition) merged.add(addition);
  }
  return merged.size > 0 ? Array.from(merged) : undefined;
}

/**
 * D1：把本次 `resolved` 结果归一到 diagnostics.queryUnderstanding.hadPronounRef。
 * 改写判定只发生在本层（kbSearch 不持有 history），下游闭包/预载缓存可能未透传
 * `opts.hadPronounRef`，落库 sink（工具 content）必须以本次实际改写结果为准。
 * diagnostics 缺失时原样返回 undefined，content 保持改前形状。
 */
function withPronounFlag(
  diagnostics: IKbDiagnostics | undefined,
  hadPronounRef: boolean
): IKbDiagnostics | undefined {
  if (!diagnostics || !diagnostics.queryUnderstanding) return diagnostics;
  return {
    ...diagnostics,
    queryUnderstanding: { ...diagnostics.queryUnderstanding, hadPronounRef },
  };
}

export async function handleSearchKB(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> {
  if (!ctx.searchKb) {
    return { content: '', status: 'error', errorDesc: 'searchKB: 知识库未就绪' };
  }
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) {
    return { content: '', status: 'error', errorDesc: 'searchKB: 缺少 query' };
  }
  const topK = typeof args.topK === 'number' ? args.topK : undefined;
  const searchMode = typeof args.searchMode === 'string'
    ? args.searchMode as 'fts5' | 'vector' | 'hybrid'
    : undefined;
  const hyde = args.hyde === true;

  // P0-6: 代词改写必须发生在 sanitizeFtsQuery 之前（kbSearch 内部清洗），并作为检索 query
  const { query: effectiveQuery, resolved } = resolveReferencesDetailed(query, ctx.history);

  // HyDE：先生成假设性文档 embedding，再用于向量检索
  let queryVector: number[] | undefined;
  if (hyde && ctx.generateHydeVector) {
    // S9: HyDE 结果缓存（10 分钟 TTL），缓存键 = userId + query
    const cached = getCachedHydeResult(ctx.userId, effectiveQuery);
    if (cached) {
      queryVector = cached;
    } else {
      const vec = await ctx.generateHydeVector(effectiveQuery);
      if (vec) {
        queryVector = vec;
        setCachedHydeResult(ctx.userId, effectiveQuery, vec);
      }
    }
  }

  // A3: 用改写后的 effectiveQuery 做意图分类 —— 只驱动查询扩展策略，
  // 绝不改 searchMode / topK / threshold / pinnedWeight（searchMode 仍由 LLM 入参决定）
  const intents = classifyIntent(effectiveQuery, ctx.history);
  const intentExpansions = expandByIntent(effectiveQuery, intents, ctx.history);

  const res = await ctx.searchKb(ctx.userId, effectiveQuery, {
    topK,
    queryVector,
    searchMode,
    // P0-6 双路召回：改写发生时原 query 走 expandedQueries + RRF，不二选一；
    // A3: 意图扩展与原 query 回退叠加
    expandedQueries: mergeExpandedQueries(resolved ? [query] : undefined, intentExpansions),
    // D1 指代触发率：把本次改写结果交给 kbSearch 记进 diagnostics（缺省由本层归一兜底）
    hadPronounRef: resolved,
  });

  // D1: 以本次 resolved 为准归一 hadPronounRef（下游闭包可能未透传该入参）
  const diagnostics = withPronounFlag(res.diagnostics, resolved);

  // R4: 搜索被拒或无结果时，检测是否需要澄清
  let clarificationContext: string | null = null;
  if (res.refused || (res.results && res.results.length === 0)) {
    const understanding = buildMinimalUnderstanding(effectiveQuery, res, ctx.history);
    clarificationContext = buildClarificationContext(understanding, res.refused || false);
  }

  if (res.refused) {
    const resultObj: Record<string, unknown> = {
      refused: true,
      threshold: res.threshold,
      best: res.best,
      message: '未找到足够相关的来源',
    };
    if (clarificationContext) {
      resultObj.clarificationNeeded = true;
      resultObj.clarificationContext = clarificationContext;
    }
    // D1: diagnostics 作为独立小节挂进 content（既有 6 键逐键不动）
    if (diagnostics) resultObj.diagnostics = diagnostics;
    return { content: JSON.stringify(resultObj), status: 'ok' };
  }

  // 无澄清需求时保持原有数组格式（向后兼容）；有 diagnostics 时以独立小节挂载
  if (!clarificationContext) {
    if (!diagnostics) {
      return { content: JSON.stringify(res.results), status: 'ok' };
    }
    return {
      content: JSON.stringify({ results: res.results, diagnostics }),
      status: 'ok',
    };
  }

  return {
    content: JSON.stringify({
      results: res.results,
      clarificationNeeded: true,
      clarificationContext,
      ...(diagnostics ? { diagnostics } : {}),
    }),
    status: 'ok',
  };
}
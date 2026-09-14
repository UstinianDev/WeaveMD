import type { ToolCtx, ToolResult } from '../toolTypes';
import type { IQueryUnderstanding } from '@shared/ai/kb';
import { detectAmbiguities, classifyIntent } from '../knowledge/queryPlanner';
import { buildClarificationContext } from '../knowledge/knowledgeClarify';

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 从搜索结果构建最小化 IQueryUnderstanding。
 * 用于在搜索被拒或无结果时触发澄清检测。
 * confidence 基于最佳搜索得分（0~1 映射），歧义检测走 queryPlanner 规则引擎。
 */
function buildMinimalUnderstanding(
  query: string,
  res: {
    refused: boolean;
    threshold: number;
    best: { score: number } | null;
    results: Array<{ score: number }>;
  }
): IQueryUnderstanding {
  const ambiguities = detectAmbiguities(query);
  const intent = classifyIntent(query);

  // confidence 从最佳搜索得分推断
  let confidence = 0.2; // 默认低置信（无结果）
  if (res.best && res.best.score > 0) {
    confidence = Math.min(res.best.score, 0.9);
  } else if (res.results.length > 0 && res.results[0].score > 0) {
    confidence = Math.min(res.results[0].score, 0.9);
  }

  return {
    intent,
    standalone: query,
    expanded: [query],
    ambiguities,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// 工具处理器
// ---------------------------------------------------------------------------

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

  // HyDE：先生成假设性文档 embedding，再用于向量检索
  let queryVector: number[] | undefined;
  if (hyde && ctx.generateHydeVector) {
    const vec = await ctx.generateHydeVector(query);
    if (vec) queryVector = vec;
  }

  const res = await ctx.searchKb(ctx.userId, query, {
    topK,
    queryVector,
    searchMode,
  });

  // R4: 搜索被拒或无结果时，检测是否需要澄清
  let clarificationContext: string | null = null;
  if (res.refused || (res.results && res.results.length === 0)) {
    const understanding = buildMinimalUnderstanding(query, res);
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
    return { content: JSON.stringify(resultObj), status: 'ok' };
  }

  // 无澄清需求时保持原有数组格式（向后兼容）
  if (!clarificationContext) {
    return { content: JSON.stringify(res.results), status: 'ok' };
  }

  return {
    content: JSON.stringify({
      results: res.results,
      clarificationNeeded: true,
      clarificationContext,
    }),
    status: 'ok',
  };
}
import { planQuery } from '../knowledge/queryPlanner';
import type { ToolResult } from '../toolTypes';

export function handleResearchSearch(args: Record<string, unknown>): ToolResult {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) {
    return { content: '', status: 'error', errorDesc: 'research_search: 缺少 query' };
  }
  const maxSubQueries = typeof args.maxSubQueries === 'number' ? args.maxSubQueries : 3;

  // 使用查询规划器拆分查询
  const plan = planQuery(query);
  const subQueries = plan.subQueries.slice(0, maxSubQueries);

  // 返回研究计划（实际搜索由 agentLoop 或渲染侧执行）
  return {
    content: JSON.stringify({
      original: plan.original,
      strategy: plan.strategy,
      subQueries,
      message: `已拆分为 ${subQueries.length} 个子查询，策略：${plan.strategy}`,
    }),
    status: 'ok',
  };
}

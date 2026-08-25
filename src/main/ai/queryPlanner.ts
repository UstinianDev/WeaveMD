// ============================================
// WeaveMD — 查询规划器（研究模式）
// ============================================
// 将用户查询拆分为多个子查询，用于研究模式的多搜索策略。
// 输入：用户原始查询
// 输出：子查询列表（按相关性排序）

export interface QueryPlan {
  original: string;
  subQueries: string[];
  strategy: 'broad' | 'focused' | 'comparative';
}

/**
 * 查询意图分析（简单启发式）。
 */
function analyzeQueryIntent(query: string): 'broad' | 'focused' | 'comparative' {
  const q = query.toLowerCase();

  // 比较型查询
  if (/vs|versus|对比|比较|区别|差异|优劣|哪个更好/.test(q)) return 'comparative';

  // 聚焦型查询（具体问题）
  if (/^(什么|如何|怎么|为什么|哪个|哪里|谁|多少)/.test(q)) return 'focused';
  if (/^(what|how|why|which|where|who|when)/.test(q)) return 'focused';

  // 广泛型查询（主题探索）
  return 'broad';
}

/**
 * 生成子查询（简单规则引擎）。
 * 实际项目中可用 LLM 生成更智能的子查询。
 */
function generateSubQueries(query: string, intent: QueryPlan['strategy']): string[] {
  const queries: string[] = [query]; // 原始查询始终包含

  if (intent === 'comparative') {
    // 比较型：拆分为独立查询
    const parts = query.split(/\s*(?:vs|versus|对比|比较|和|与|及)\s*/i);
    if (parts.length >= 2) {
      queries.push(...parts.map((p) => p.trim()).filter(Boolean));
    }
  } else if (intent === 'broad') {
    // 广泛型：添加限定词查询
    queries.push(`${query} 概述`);
    queries.push(`${query} 最新进展`);
    queries.push(`${query} 最佳实践`);
  }

  // 去重
  return [...new Set(queries)];
}

/**
 * 规划查询：将用户查询拆分为多个子查询。
 */
export function planQuery(query: string): QueryPlan {
  const trimmed = query.trim();
  if (!trimmed) {
    return { original: query, subQueries: [], strategy: 'focused' };
  }

  const strategy = analyzeQueryIntent(trimmed);
  const subQueries = generateSubQueries(trimmed, strategy);

  return {
    original: trimmed,
    subQueries,
    strategy,
  };
}

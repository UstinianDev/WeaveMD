// ============================================
// WeaveMD — 查询理解与规划（R5）
// ============================================
// 意图分类（5类）+ 指代消解 + 查询扩展 + 模糊检测。
// 纯函数，不依赖 LLM / 数据库，可单测。

import type { QueryIntentType, AmbiguityType, IQueryUnderstanding } from '@shared/ai/kb';

// ---------------------------------------------------------------------------
// 意图分类
// ---------------------------------------------------------------------------

/** 意图关键词模式。 */
const INTENT_PATTERNS: Array<{ intent: QueryIntentType; patterns: RegExp[] }> = [
  {
    intent: 'comparison',
    patterns: [
      /vs|versus|对比|比较|区别|差异|优缺点|优劣|哪个更好|which.*better/i,
    ],
  },
  {
    intent: 'summary',
    patterns: [
      /总结|概括|综述|概述|overview|summarize|summary|汇总|梳理/i,
    ],
  },
  {
    intent: 'procedure',
    patterns: [
      /步骤|流程|怎么做|如何做|教程|指南|guide|tutorial|how\s+to|方法|操作/i,
    ],
  },
  {
    intent: 'fact',
    patterns: [
      /^(什么|如何|怎么|为什么|哪个|哪里|谁|多少|是否|能否|请问|请告诉)/,
      /^(what|how|why|which|where|who|when|is|are|can|could|please|tell)\b/i,
      /[?？]$/,
    ],
  },
  {
    intent: 'follow_up',
    patterns: [
      /上面|刚才|之前|那个|它|这个|this|that|it|继续|接着|然后呢|还有呢/i,
    ],
  },
];

/** 对话历史消息。 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 意图分类（规则 + 启发式）。 */
export function classifyIntent(query: string, history?: ConversationMessage[]): QueryIntentType {
  const q = query.trim();

  // follow_up 优先：有历史 + 包含指代词
  if (history && history.length > 0) {
    const hasReference = /[它这那this that it上面刚才之前]/i.test(q);
    if (hasReference) return 'follow_up';
  }

  // 按优先级匹配
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (intent === 'follow_up') continue; // 已在上面处理
    for (const pat of patterns) {
      if (pat.test(q)) return intent;
    }
  }

  // 默认 fact
  return 'fact';
}

// ---------------------------------------------------------------------------
// 指代消解
// ---------------------------------------------------------------------------

/** 从对话历史提取最近主题词。 */
function extractRecentTopic(history: ConversationMessage[]): string | null {
  // 从最近 3 条 user 消息中提取名词短语
  const userMsgs = history
    .filter((m) => m.role === 'user')
    .slice(-3)
    .map((m) => m.content);

  for (const msg of userMsgs.reverse()) {
    // 去掉问句标记，取核心名词
    const cleaned = msg.replace(/[?？！!。.]+$/g, '').trim();
    if (cleaned.length >= 2 && cleaned.length <= 30) {
      return cleaned;
    }
  }
  return null;
}

/** 指代词正则。 */
const PRONOUN_RE = /^(它|这个|那个|this|that|it|上面的|刚才的|之前的)\s*/i;

/** 指代消解：替换代词为最近主题词。无历史时返回原查询。 */
export function resolveReferences(query: string, history?: ConversationMessage[]): string {
  if (!history || history.length === 0) return query;

  const topic = extractRecentTopic(history);
  if (!topic) return query;

  const q = query.trim();
  // 如果查询以指代词开头，替换为主题词
  if (PRONOUN_RE.test(q)) {
    return q.replace(PRONOUN_RE, `${topic}的`);
  }
  return q;
}

// ---------------------------------------------------------------------------
// 查询扩展
// ---------------------------------------------------------------------------

/** 基于意图生成扩展查询列表。 */
export function expandQuery(query: string, intent: QueryIntentType): string[] {
  const standalone = query.trim();
  switch (intent) {
    case 'fact':
      return [standalone];
    case 'summary':
      return [standalone, `${standalone} 概述`];
    case 'comparison':
      return [standalone, `${standalone} 优缺点`, `${standalone} 区别`];
    case 'follow_up':
      return [standalone];
    case 'procedure':
      return [standalone, `${standalone} 步骤`, `${standalone} 教程`];
    default:
      return [standalone];
  }
}

// ---------------------------------------------------------------------------
// 模糊检测
// ---------------------------------------------------------------------------

/** 检测查询模糊类型。 */
export function detectAmbiguities(query: string, history?: ConversationMessage[]): AmbiguityType[] {
  const q = query.trim();
  const ambiguities: AmbiguityType[] = [];

  // 代词引用但无历史
  if (PRONOUN_RE.test(q) && (!history || history.length === 0)) {
    ambiguities.push('pronoun_reference');
  }

  // 缺少主语（太短 + 无问号）
  if (q.length < 4 && !q.includes('?') && !q.includes('？')) {
    ambiguities.push('missing_subject');
  }

  // 太宽泛
  const broadPatterns = /^(介绍一下|说说|讲讲|聊聊|tell\s+me\s+about)/i;
  if (broadPatterns.test(q)) {
    ambiguities.push('broad_scope');
  }

  // 太短
  if (q.length < 2) {
    ambiguities.push('too_short');
  }

  return ambiguities;
}

// ---------------------------------------------------------------------------
// 完整查询理解管线
// ---------------------------------------------------------------------------

/** 查询理解完整管线。 */
export function understandQuery(
  query: string,
  history?: ConversationMessage[]
): IQueryUnderstanding {
  const intent = classifyIntent(query, history);
  const standalone = resolveReferences(query, history);
  const expanded = expandQuery(standalone, intent);
  const ambiguities = detectAmbiguities(query, history);

  // 置信度：有歧义→低，follow_up→中，其余→高
  let confidence = 0.9;
  if (ambiguities.length > 0) confidence = 0.5;
  else if (intent === 'follow_up') confidence = 0.7;

  return {
    intent,
    standalone,
    expanded,
    ambiguities,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// 向后兼容：planQuery（researchSearchHandler 使用）
// ---------------------------------------------------------------------------

export interface QueryPlan {
  original: string;
  subQueries: string[];
  strategy: 'broad' | 'focused' | 'comparative';
}

/** 向后兼容的查询规划（基于 understandQuery）。 */
export function planQuery(query: string): QueryPlan {
  const understanding = understandQuery(query);
  const strategyMap: Record<QueryIntentType, QueryPlan['strategy']> = {
    fact: 'focused',
    summary: 'broad',
    comparison: 'comparative',
    follow_up: 'focused',
    procedure: 'focused',
  };
  return {
    original: understanding.standalone,
    subQueries: understanding.expanded,
    strategy: strategyMap[understanding.intent],
  };
}

// ============================================
// WeaveMD — Intent router (Agent)
// ============================================
// 规则启发式意图分类（纯函数，无 LLM 依赖）。
// 升级点：后续可换 LLM 分类（保留 classifyIntent 一致签名，方便替换实现）。

import type { IIntent, IntentName } from '@shared/ai';

interface IntentRule {
  intent: IntentName;
  /** 命中即累加权重的关键词（小写匹配）。顺序 = 越靠前越强。 */
  keywords: string[];
  /** 正则命中（原始大小写匹配）。 */
  patterns?: RegExp[];
}

const RULES: IntentRule[] = [
  {
    intent: 'rewrite',
    // A1b 补词：优化/整理/美化/改进/润一润 及其变体（含英文，避免落 chat fallback）
    keywords: ['修改', '改写', '润色', '缩写', '扩写', '精简', '压缩', '优化', '整理', '美化', '改进', '润一润', '润一下', '改一下', '润色一下', '优化一下', '整理一下', '美化一下', '改进一下', '缩一下', '扩一下', 'polish', 'rewrite', 'shorten', 'expand', 'summarize', 'paraphrase', 'optimize', 'improve', 'refine', 'clean up'],
  },
  {
    intent: 'kbQa',
    keywords: ['知识库', '笔记里', '我的笔记', '笔记中', '文档里', '搜索笔记', '根据笔记', '查笔记', '哪些笔记', '问答', 'kb', 'knowledge base', '依据知识库', '翻笔记', '摘录'],
  },
  {
    intent: 'tech',
    keywords: ['代码', '函数', '框架', '技术', 'bug', '报错', 'error', 'api', 'typescript', 'javascript', 'python', 'java', '算法', '架构', '库', '前端', '后端', 'json', 'sql', 'git', 'react', 'node', 'typescript', '配置', '依赖', '接口'],
  },
  {
    intent: 'web',
    keywords: ['网页', '抓取', '爬取', '爬虫', '搜索网页', '在线资料', '联网查', '打开网页', '网站内容', 'url', 'http', '抓', 'scrape', 'crawl', 'web', 'online'],
  },
  {
    intent: 'create',
    keywords: ['写', '创作', '起草', '生成', '写一段', '写一篇', '写个', '写一首', '标题', '文案', '大纲', '故事', 'prompt', 'write', 'create', 'draft', '内容'],

  },
];

/**
 * 规则启发式意图分类。
 * 返回：intent + confidence + 可选 candidates（模糊/低置信）。
 * confidence 最高 1；多意图接近时视为模糊并给出候选。
 */
export function classifyIntent(input: string): IIntent {
  const text = (input ?? '').trim();
  if (!text) {
    return { intent: 'chat', confidence: 0.5, reason: 'empty input' };
  }

  const lower = text.toLowerCase();
  // 权重表：intent -> 累计命中分
  const scores = new Map<IntentName, number>();
  const hitReasons: string[] = [];

  for (const rule of RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        score += 1;
        hitReasons.push(`${rule.intent}:${kw}`);
      }
    }
    if (score > 0) scores.set(rule.intent, score);
  }

  // 无人为关键词命中时，落在闲聊
  if (scores.size === 0) {
    return {
      intent: 'chat',
      confidence: 0.7,
      candidates: ['chat'],
      reason: hitReasons.join(',') || 'chat fallback',
    };
  }

  // 最高分与次高分
  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const topScore = top[1];
  const total = ranked.reduce((acc, [, s]) => acc + s, 0);
  const secondary = ranked[1]?.[1] ?? 0;

  // 置信度 = 最高分占比（受并列/贴近影响）
  let confidence = total > 0 ? topScore / total : 0;

  // 模糊判定：最高与次高接近（差值 ≤ 1）且非压倒性 -> 给候选
  let candidates: IntentName[] | undefined;
  if (ranked.length > 1 && topScore - secondary <= 1 && topScore / total < 0.6) {
    candidates = ranked.map(([i]) => i);
    confidence = Math.min(confidence, 0.5);
  }
  // 独立强力命中（单一规则 3+ 词）可拉高到足以上界
  if (topScore >= 3 && ranked.length === 1) {
    confidence = 0.9;
  }

  return {
    intent: top[0],
    confidence: Math.max(0, Math.min(1, confidence)),
    ...(candidates ? { candidates } : {}),
    reason: hitReasons.join(','),
  };
}

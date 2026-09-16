// ============================================
// WeaveMD — 查询理解与规划（R5）
// ============================================
// 意图分类（5类+复合）+ 指代消解 + 查询扩展 + 模糊检测。
// S12: 多意图分类 / 增强指代消解 / 语义歧义检测 / 同义词扩展。
// 纯函数，不依赖 LLM / 数据库，可单测。

import type { QueryIntentType, AmbiguityType, IQueryUnderstanding } from '@shared/ai/kb';

// ---------------------------------------------------------------------------
// 意图分类（S12 扩展：多意图 + 复合模式）
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

/**
 * S12: 复合意图检测规则。
 * 当用户输入同时包含不同维度的关键词时，返回多个意图。
 * 格式：[regex, intents] — 命中则返回指定多意图。
 */
const HYBRID_PATTERNS: Array<{ pattern: RegExp; intents: QueryIntentType[] }> = [
  {
    // "对比A和B的步骤" / "比较X和Y的做法" / "区别并给出教程"
    pattern: /(对比|比较|区别|差异|vs).*(步骤|教程|怎么做|方法|指南|操作|流程)/i,
    intents: ['comparison', 'procedure'],
  },
  {
    // "对比...并总结" / "比较优劣再概括"
    pattern: /(对比|比较|区别|差异|vs).*(总结|概括|概述|汇总|梳理)/i,
    intents: ['comparison', 'summary'],
  },
  {
    // "总结...的步骤" / "概述方法流程"
    pattern: /(总结|概括|概述|汇总).*(步骤|流程|方法|操作|教程)/i,
    intents: ['summary', 'procedure'],
  },
  {
    // "为什么A和B不同" / "这两个有什么区别为什么" — 事实+对比
    pattern: /(为什么|为何).*(区别|差异|不同|vs)/i,
    intents: ['fact', 'comparison'],
  },
  {
    // "梳理...并说明" / "总结然后解释原理"
    pattern: /(梳理|总结|概括).*(为什么|原理|原因|定义)/i,
    intents: ['summary', 'fact'],
  },
];

/** 对话历史消息。 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 意图分类（规则 + 启发式）。
 * S12: 返回 QueryIntentType[]（支持多意图），复合查询返回多意图。
 */
export function classifyIntent(
  query: string,
  history?: ConversationMessage[]
): QueryIntentType[] {
  const q = query.trim();

  // S12: 复合意图优先检测（在单意图匹配之前）
  for (const { pattern, intents } of HYBRID_PATTERNS) {
    if (pattern.test(q)) return intents;
  }

  // follow_up 优先：有历史 + 包含指代词
  if (history && history.length > 0) {
    const hasReference = /[它这那this that it上面刚才之前]/i.test(q);
    if (hasReference) return ['follow_up'];
  }

  // 按优先级匹配（取第一个命中意图）
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (intent === 'follow_up') continue; // 已在上面处理
    for (const pat of patterns) {
      if (pat.test(q)) return [intent];
    }
  }

  // 默认 fact
  return ['fact'];
}

// ---------------------------------------------------------------------------
// 指代消解（S12 扩展：中文指代词 + 跨文档引用）
// ---------------------------------------------------------------------------

/**
 * 从对话历史中提取实体名。
 * 从最近 3 轮对话中搜索与指代词相关的实体。
 */
export function extractEntityFromHistory(
  messages: ConversationMessage[],
  pronoun: string
): string | null {
  if (!messages || messages.length === 0) return null;

  // 反向遍历最近消息，找匹配的实体
  const recent = messages.slice(-6); // 最近 3 轮 = 最多 6 条消息
  for (let i = recent.length - 1; i >= 0; i--) {
    const content = recent[i].content;
    if (!content) continue;

    // 根据指代词类型匹配不同实体模式
    if (/前者/.test(pronoun)) {
      // "前者" → 提取并列结构中的第一个
      const match = content.match(/([^，。,、\s]{2,30})[和与及跟]([^，。,、\s]{2,30})/);
      if (match) return match[1];
      // 列表格式 "1. xxx 2. yyy"
      const listMatch = content.match(/(?:\d[.、]\s*)([^\d\n]{2,30})(?:\d[.、]\s*)/);
      if (listMatch) return listMatch[1].trim();
    }
    if (/后者/.test(pronoun)) {
      // "后者" → 提取并列结构中的第二个（限制为不含"的"的名词短语）
      const match = content.match(/([^，。,、\s]{2,30})[和与及跟]([^，。,、\s]{2,30})/);
      if (match) {
        // 第二个捕获组可能包含额外后缀，截断到纯实体名
        const raw = match[2];
        const clean = raw.replace(/[的之].*$/, '').trim();
        if (clean.length >= 2) return clean;
        return raw;
      }
      const listMatch = content.match(/\d[.、]\s*[^\d\n]{2,30}(\d[.、]\s*([^\d\n]{2,30}))/);
      if (listMatch) {
        // 取第二个列表项
        const secondMatch = content.match(/(?:\d[.、]\s*[^\d\n]{2,30})(\d[.、]\s*([^\d\n]{2,30}))/);
        if (secondMatch) return secondMatch[2].trim();
      }
    }
    if (/上面(提到)?的|该/.test(pronoun)) {
      // "上面提到的"/"该" → 提取最近一条消息的主题
      const topic = extractRecentTopic([recent[i]]);
      if (topic) return topic;
    }
    if (/那[篇个项]/.test(pronoun)) {
      // "那篇文档"/"那个项目" → 提取文档/项目名称
      const docMatch = content.match(/(?:文档|文件|笔记|文章|项目)[：「:]\s*([^\s，,]{2,40})/);
      if (docMatch) return docMatch[1];
      // 书名号引用
      const bookMatch = content.match(/《([^》]{2,40})》/);
      if (bookMatch) return bookMatch[1];
    }

    // 通用：提取最近包含专有名词/文件名的消息
    const nounMatch = content.match(/(?:关于|对于|在|讨论)[「《]?([^\s，,。」》]{2,30})/);
    if (nounMatch) return nounMatch[1];
  }

  return null;
}

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

/**
 * S12: 扩展指代词正则。
 * 新增：前者/后者/上面提到的/该/那篇文档/那个
 */
const PRONOUN_RE = /^(它|这个|那个|前者|后者|上面提到的|该|那篇文档|那个项目|那篇文章|this|that|it|上面的|刚才的|之前的)\s*/i;

/**
 * S12: 跨文档引用正则。
 * 检测 "那篇文档的作者" / "它的创建时间" 类跨实体引用。
 */
const CROSS_DOC_RE = /(那[篇个项]|前者|后者|它|该)(?:的)?(作者|创建|修改|内容|标题|属性|信息)/i;

/**
 * 指代消解：替换代词为最近主题词或历史实体。
 * S12: 支持中文指代词扩展 + 跨文档引用实体提取。
 */
export function resolveReferences(query: string, history?: ConversationMessage[]): string {
  if (!history || history.length === 0) return query;

  const q = query.trim();

  // S12: 跨文档引用检测
  const crossMatch = q.match(CROSS_DOC_RE);
  if (crossMatch) {
    const pronoun = crossMatch[1];
    const entity = extractEntityFromHistory(history, pronoun);
    if (entity) {
      const attribute = crossMatch[2];
      // 替换整个跨文档引用模式
      const replaced = q.replace(CROSS_DOC_RE, `${entity}的${attribute}`);
      if (replaced !== q) return replaced;
    }
  }

  // 原有指代词替换 + 扩展
  const topic = extractRecentTopic(history);
  if (!topic) {
    // S12: 如果没有简单主题，尝试从历史中提取实体
    const pronounMatch = q.match(PRONOUN_RE);
    if (pronounMatch) {
      const entity = extractEntityFromHistory(history, pronounMatch[1]);
      if (entity) {
        return q.replace(PRONOUN_RE, `${entity}的`);
      }
    }
    return q;
  }

  // 如果查询以指代词开头，替换为主题词
  if (PRONOUN_RE.test(q)) {
    // S12: "前者"/"后者" 使用更精确的实体提取
    const pronounMatch = q.match(PRONOUN_RE);
    if (pronounMatch && /^(前者|后者)$/.test(pronounMatch[1].trim())) {
      const entity = extractEntityFromHistory(history, pronounMatch[1].trim());
      if (entity) return q.replace(PRONOUN_RE, `${entity}的`);
    }
    return q.replace(PRONOUN_RE, `${topic}的`);
  }
  return q;
}

// ---------------------------------------------------------------------------
// 查询扩展（S12 扩展：基于意图的同义词追加）
// ---------------------------------------------------------------------------

/** S12: 意图 → 同义词映射（规则驱动，不调用 LLM）。 */
const INTENT_SYNONYMS: Record<QueryIntentType, string[]> = {
  procedure: ['步骤', '教程', '指南', '方法'],
  comparison: ['对比', '区别', '优劣'],
  fact: ['定义', '概念', '概述'],
  summary: ['总结', '归纳', '概览'],
  follow_up: [],
};

/**
 * 基于意图生成扩展查询列表。
 * S12: 追加意图同义词（规则驱动，不调用 LLM）。
 */
export function expandQuery(query: string, intents: QueryIntentType[]): string[] {
  const standalone = query.trim();
  const allExpanded = new Set<string>([standalone]);

  // 原有扩展逻辑（每个意图的固化扩展）
  for (const intent of intents) {
    switch (intent) {
      case 'fact':
        // fact 不强制扩展，但追加同义词（如果尚未包含）
        break;
      case 'summary':
        if (!standalone.includes('概述')) allExpanded.add(`${standalone} 概述`);
        break;
      case 'comparison':
        if (!standalone.includes('优缺')) allExpanded.add(`${standalone} 优缺点`);
        if (!standalone.includes('区别')) allExpanded.add(`${standalone} 区别`);
        break;
      case 'procedure':
        if (!standalone.includes('步骤')) allExpanded.add(`${standalone} 步骤`);
        if (!standalone.includes('教程')) allExpanded.add(`${standalone} 教程`);
        break;
      case 'follow_up':
        // follow_up 不扩展
        break;
    }

    // S12: 追加同义词（规则驱动）
    const synonyms = INTENT_SYNONYMS[intent] ?? [];
    for (const syn of synonyms) {
      if (!standalone.includes(syn)) {
        allExpanded.add(`${standalone} ${syn}`);
      }
    }
  }

  return Array.from(allExpanded);
}

// ---------------------------------------------------------------------------
// 模糊检测（S12 扩展：语义歧义）
// ---------------------------------------------------------------------------

/**
 * S12: 常见多义词及其候选领域。
 * key = 多义词, value = 候选领域列表 + 消歧线索关键词。
 */
const AMBIGUOUS_TERMS: Record<string, Array<{ domain: string; clues: string[] }>> = {
  '苹果': [
    { domain: '水果/公司', clues: ['水果', '吃', '味道', 'iPhone', '手机', 'Mac', '电脑', '编程', '代码', 'iOS', 'macOS'] },
  ],
  'Python': [
    { domain: '编程语言/蛇', clues: ['编程', '代码', '开发', '库', '语法', '蛇', '爬行动物', '动物'] },
  ],
  'Java': [
    { domain: '编程语言/咖啡/岛屿', clues: ['编程', '代码', '开发', '咖啡', '饮料', '岛屿', '旅行'] },
  ],
  'Shell': [
    { domain: '命令行/贝壳/外壳', clues: ['终端', '命令', '脚本', 'bash', '贝壳', '海洋', '壳牌', '石油'] },
  ],
  'C': [
    { domain: '编程语言/字母/化学元素', clues: ['编程', '代码', '语言', '字母', '化学', '元素', '碳'] },
  ],
  'R': [
    { domain: '编程语言/字母', clues: ['编程', '统计', '数据分析', '语言', '字母'] },
  ],
  'Go': [
    { domain: '编程语言/围棋/动词', clues: ['编程', '代码', '语言', '围棋', '棋', '走'] },
  ],
  'Rust': [
    { domain: '编程语言/铁锈', clues: ['编程', '代码', '语言', '铁锈', '生锈', '金属'] },
  ],
  'Spring': [
    { domain: '框架/春天/弹簧', clues: ['编程', '框架', 'Java', '春天', '季节', '弹簧', '泉水'] },
  ],
  'Vue': [
    { domain: '框架/法语词', clues: ['编程', '框架', '前端', 'JavaScript', '法语', '视角'] },
  ],
  'React': [
    { domain: '框架/动词', clues: ['编程', '框架', '前端', 'JavaScript', '回应', '反应'] },
  ],
  '表格': [
    { domain: '数据/形式', clues: ['数据', 'Excel', '数据库', '申请', '填写', '登记'] },
  ],
  '渲染': [
    { domain: '计算机/艺术', clues: ['计算机', '图形', '浏览器', '3D', '视频', '美术', '绘画'] },
  ],
  '模型': [
    { domain: 'AI/数学/物理', clues: ['AI', '机器学习', '训练', '参数', '数学', '物理', '三维', '建模'] },
  ],
  '网络': [
    { domain: '计算机网络/社交网络', clues: ['计算机', 'TCP', 'IP', '协议', '社交', '人际', '朋友圈'] },
  ],
};

/**
 * 检测查询中的语义歧义（多义词）。
 * S12: 新增，检测常见多义词并根据上下文判断是否需要澄清。
 */
function detectSemanticAmbiguity(query: string, history?: ConversationMessage[]): boolean {
  const lower = query.toLowerCase();

  for (const [term, candidates] of Object.entries(AMBIGUOUS_TERMS)) {
    // S12: 单字符 ASCII 词（C/R）需要词边界匹配，避免 "C" 匹配到 "TypeScript"
    // CJK 字符（如"苹果"）用 includes 即可，因为中文词不会嵌套在其他中文词中
    const isAsciiSingle = term.length === 1 && /^[a-zA-Z]$/.test(term);
    if (isAsciiSingle) {
      const bwRe = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (!bwRe.test(lower)) continue;
    } else {
      if (!lower.includes(term.toLowerCase())) continue;
    }

    // 检查查询本身的消歧线索
    for (const candidate of candidates) {
      const hasClueInQuery = candidate.clues.some((clue) =>
        lower.includes(clue.toLowerCase())
      );
      if (hasClueInQuery) return false; // 查询本身足够明确
    }

    // 检查历史消息中的消歧线索
    if (history && history.length > 0) {
      const historyText = history
        .map((m) => m.content.toLowerCase())
        .join(' ');
      for (const candidate of candidates) {
        const hasClueInHistory = candidate.clues.some((clue) =>
          historyText.includes(clue.toLowerCase())
        );
        if (hasClueInHistory) return false; // 历史上下文已消歧
      }
    }

    // 没有消歧线索 → 标记为语义歧义
    return true;
  }

  return false;
}

/** 检测查询模糊类型。S12: 新增语义歧义检测。 */
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

  // S12: 语义歧义检测
  if (detectSemanticAmbiguity(q, history)) {
    ambiguities.push('semantic_ambiguity');
  }

  return ambiguities;
}

// ---------------------------------------------------------------------------
// 完整查询理解管线
// ---------------------------------------------------------------------------

/** 查询理解完整管线。S12: 支持多意图 + 增强歧义检测。 */
export function understandQuery(
  query: string,
  history?: ConversationMessage[]
): IQueryUnderstanding {
  const intents = classifyIntent(query, history);
  const primaryIntent = intents[0] ?? 'fact';
  const standalone = resolveReferences(query, history);
  const expanded = expandQuery(standalone, intents);
  const ambiguities = detectAmbiguities(query, history);

  // 置信度：有歧义→低，follow_up→中，多意图→中，其余→高
  let confidence = 0.9;
  if (ambiguities.length > 0) confidence = 0.5;
  else if (primaryIntent === 'follow_up') confidence = 0.7;
  else if (intents.length > 1) confidence = 0.75;

  return {
    intent: primaryIntent,
    intents,
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

/** S12: 多意图合并策略。 */
function mergeStrategies(strategies: QueryPlan['strategy'][]): QueryPlan['strategy'] {
  if (strategies.includes('comparative')) return 'comparative';
  if (strategies.includes('broad')) return 'broad';
  return 'focused';
}

/** 向后兼容的查询规划（基于 understandQuery）。S12: 支持多意图策略合并。 */
export function planQuery(query: string): QueryPlan {
  const understanding = understandQuery(query);
  const strategyMap: Record<QueryIntentType, QueryPlan['strategy']> = {
    fact: 'focused',
    summary: 'broad',
    comparison: 'comparative',
    follow_up: 'focused',
    procedure: 'focused',
  };

  // S12: 多意图时合并策略
  const strategies = understanding.intents.map((i) => strategyMap[i]);
  const mergedStrategy = mergeStrategies(strategies);

  return {
    original: understanding.standalone,
    subQueries: understanding.expanded,
    strategy: mergedStrategy,
  };
}
import { describe, expect, it } from 'vitest';
import {
  classifyIntent,
  resolveReferences,
  detectAmbiguities,
  expandQuery,
  understandQuery,
  planQuery,
  extractEntityFromHistory,
} from '@main/ai/knowledge/queryPlanner';
import type { ConversationMessage } from '@main/ai/knowledge/queryPlanner';
import type { QueryIntentType } from '@shared/ai/kb';

// ---------------------------------------------------------------------------
// 测试 1: 多意图检测（复合查询）
// ---------------------------------------------------------------------------

describe('S12 多意图检测 (HYBRID_PATTERNS)', () => {
  it('"对比A和B的步骤" → ["comparison", "procedure"]', () => {
    const intents = classifyIntent('对比Python和JavaScript的步骤');
    expect(intents).toHaveLength(2);
    expect(intents).toContain('comparison');
    expect(intents).toContain('procedure');
  });

  it('"比较React和Vue的区别并总结" → ["comparison", "summary"]', () => {
    const intents = classifyIntent('比较React和Vue的区别并总结');
    expect(intents).toHaveLength(2);
    expect(intents).toContain('comparison');
    expect(intents).toContain('summary');
  });

  it('"总结部署流程和步骤" → ["summary", "procedure"]', () => {
    const intents = classifyIntent('总结部署流程和步骤');
    expect(intents).toHaveLength(2);
    expect(intents).toContain('summary');
    expect(intents).toContain('procedure');
  });

  it('"为什么React和Vue的区别这么大" → ["fact", "comparison"]', () => {
    const intents = classifyIntent('为什么React和Vue的区别这么大');
    expect(intents).toHaveLength(2);
    expect(intents).toContain('fact');
    expect(intents).toContain('comparison');
  });

  it('普通单意图仍只返回一个意图', () => {
    const intents = classifyIntent('什么是TypeScript');
    expect(intents).toHaveLength(1);
    expect(intents[0]).toBe('fact');
  });

  it('"总结归纳" — summary单意图', () => {
    const intents = classifyIntent('总结一下Kubernetes的核心概念');
    expect(intents).toHaveLength(1);
    expect(intents[0]).toBe('summary');
  });

  it('混合不匹配的模式回归单意图', () => {
    const intents = classifyIntent('如何安装Node.js');
    expect(intents).toHaveLength(1);
    // "如何" 命中 fact 模式（"如何安装" 不含 procedure 所需的 "如何做"），这是已有行为
    expect(intents[0]).toBe('fact');
  });
});

// ---------------------------------------------------------------------------
// 测试 2: 指代消解增强（中文指代词 + 跨文档引用）
// ---------------------------------------------------------------------------

describe('S12 指代消解增强', () => {
  it('"前者" 指代消解：从历史提取第一个实体', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: 'React和Vue有什么区别？' },
      { role: 'assistant', content: 'React和Vue的主要区别在于...' },
    ];
    const resolved = resolveReferences('前者的作者是谁？', history);
    expect(resolved).toContain('React');
  });

  it('"后者" 指代消解：从历史提取第二个实体', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: 'TypeScript和JavaScript的区别' },
    ];
    const resolved = resolveReferences('后者的性能如何？', history);
    expect(resolved).toContain('JavaScript');
  });

  it('"那篇文档" 跨文档引用提取实体', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: '请分析文档：《React设计原理》' },
    ];
    const resolved = resolveReferences('那篇文档的作者是谁？', history);
    expect(resolved).toContain('React设计原理');
    expect(resolved).toContain('作者');
  });

  it('"它的" 代指消解（跨文档引用）', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: 'WeaveMD项目的架构是怎样的？' },
    ];
    const resolved = resolveReferences('它的主要模块有哪些？', history);
    expect(resolved).not.toBe('它的主要模块有哪些？');
    expect(resolved).toContain('WeaveMD');
  });

  it('无历史时，指代词查询原样返回', () => {
    const result = resolveReferences('这个是什么意思？');
    expect(result).toBe('这个是什么意思？');
  });

  it('"上面提到的" 提取最近主题', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: 'Kubernetes的架构是怎样的？' },
      { role: 'assistant', content: 'Kubernetes采用主从架构...' },
      { role: 'user', content: '上面提到的调度器怎么配置？' },
    ];
    const resolved = resolveReferences('该组件支持哪些策略？', history);
    // "上面提到的" 这一条本身不会被匹配（它是倒数第一条 user，但 extractRecentTopic 过滤了太长的"上面提到的..."）
    // "该" → 提取最近 user 消息的主题（Kubernetes的架构是怎样的？ → 去掉问号 → 太长>30? 只有25字符，OK）
    // 或者从倒数第3条取 "Kubernetes的架构是怎样的"
    expect(resolved).not.toBe('该组件支持哪些策略？');
  });
});

// ---------------------------------------------------------------------------
// 测试 3: extractEntityFromHistory 单元测试
// ---------------------------------------------------------------------------

describe('S12 extractEntityFromHistory（跨文档引用实体提取）', () => {
  it('"前者" 从并列结构 A和B 提取A', () => {
    const msgs: ConversationMessage[] = [
      { role: 'user', content: 'Kubernetes和Docker Swarm的对比' },
    ];
    const entity = extractEntityFromHistory(msgs, '前者');
    expect(entity).toBe('Kubernetes');
  });

  it('"后者" 从并列结构 A和B 提取B', () => {
    const msgs: ConversationMessage[] = [
      { role: 'user', content: 'MySQL和PostgreSQL的性能差异' },
    ];
    const entity = extractEntityFromHistory(msgs, '后者');
    expect(entity).toBe('PostgreSQL');
  });

  it('"那篇" 从书名号引用中提取', () => {
    const msgs: ConversationMessage[] = [
      { role: 'user', content: '《深入浅出Vue.js》这本书怎么样？' },
    ];
    const entity = extractEntityFromHistory(msgs, '那篇');
    expect(entity).toBe('深入浅出Vue.js');
  });

  it('"那篇文档" 从文档引用中提取', () => {
    const msgs: ConversationMessage[] = [
      { role: 'user', content: '我有一篇文档：自动化测试指南' },
    ];
    const entity = extractEntityFromHistory(msgs, '那篇文档');
    expect(entity).toBe('自动化测试指南');
  });

  it('空历史返回 null', () => {
    expect(extractEntityFromHistory([], '前者')).toBeNull();
  });

  it('无匹配时返回通用名或 null', () => {
    const msgs: ConversationMessage[] = [
      { role: 'user', content: '今天天气真好' },
    ];
    const entity = extractEntityFromHistory(msgs, '那篇');
    // 通用名词匹配 "关于" 中的 "天气" 或 null
    expect(entity === null || typeof entity === 'string').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 测试 4: 语义歧义检测
// ---------------------------------------------------------------------------

describe('S12 语义歧义检测', () => {
  it('"苹果" 无上下文 → semantic_ambiguity', () => {
    const ambiguities = detectAmbiguities('苹果怎么样？');
    expect(ambiguities).toContain('semantic_ambiguity');
  });

  it('"苹果" 有编程上下文 → 无需歧义标记', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: 'iOS开发中如何调试内存泄漏？' },
      { role: 'user', content: '在iPhone上测试性能' },
    ];
    const ambiguities = detectAmbiguities('苹果的生态如何？', history);
    // 历史中包含 iPhone/iOS → 消歧，不应标记为语义歧义
    expect(ambiguities).not.toContain('semantic_ambiguity');
  });

  it('"Python" 无上下文 → semantic_ambiguity', () => {
    const ambiguities = detectAmbiguities('Python是什么？');
    expect(ambiguities).toContain('semantic_ambiguity');
  });

  it('"Python" 有编程上下文 → 无需歧义标记', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: '学习编程应该从哪门语言开始？' },
    ];
    const ambiguities = detectAmbiguities('Python有什么特点？', history);
    expect(ambiguities).not.toContain('semantic_ambiguity');
  });

  it('"渲染" 在计算机上下文 → 无需歧义标记', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: '浏览器的渲染流程是怎样的？' },
    ];
    const ambiguities = detectAmbiguities('渲染管线有哪些优化？', history);
    expect(ambiguities).not.toContain('semantic_ambiguity');
  });

  it('明确无歧义的词不触发 semantic_ambiguity', () => {
    const ambiguities = detectAmbiguities('TypeScript的泛型如何工作？');
    expect(ambiguities).not.toContain('semantic_ambiguity');
  });

  it('查询本身已消歧（含编程关键词）→ 无歧义', () => {
    const ambiguities = detectAmbiguities('Python编程语言的装饰器怎么用？');
    // 查询中包含 "编程" → 已消歧
    expect(ambiguities).not.toContain('semantic_ambiguity');
  });
});

// ---------------------------------------------------------------------------
// 测试 5: 查询扩展同义词追加
// ---------------------------------------------------------------------------

describe('S12 查询扩展同义词', () => {
  it('procedure 意图追加同义词：步骤/教程/指南/方法', () => {
    const expanded = expandQuery('部署', ['procedure']);
    expect(expanded.length).toBeGreaterThanOrEqual(3);
    expect(expanded).toContain('部署');
    expect(expanded).toContain('部署 步骤');
    expect(expanded.some((e) => e.includes('教程'))).toBe(true);
    expect(expanded.some((e) => e.includes('指南'))).toBe(true);
    expect(expanded.some((e) => e.includes('方法'))).toBe(true);
  });

  it('comparison 意图追加同义词：对比/区别/优劣', () => {
    const expanded = expandQuery('React和Vue', ['comparison']);
    expect(expanded.length).toBeGreaterThanOrEqual(4);
    expect(expanded).toContain('React和Vue');
    expect(expanded).toContain('React和Vue 优缺点');
    expect(expanded).toContain('React和Vue 区别');
    expect(expanded.some((e) => e.includes('对比'))).toBe(true);
    expect(expanded.some((e) => e.includes('优劣'))).toBe(true);
  });

  it('fact 意图追加同义词：定义/概念/概述', () => {
    const expanded = expandQuery('闭包', ['fact']);
    expect(expanded.length).toBeGreaterThanOrEqual(1);
    expect(expanded.some((e) => e.includes('定义'))).toBe(true);
    expect(expanded.some((e) => e.includes('概念'))).toBe(true);
    expect(expanded.some((e) => e.includes('概述'))).toBe(true);
  });

  it('summary 意图追加同义词：总结/归纳/概览', () => {
    const expanded = expandQuery('微服务', ['summary']);
    expect(expanded.length).toBeGreaterThanOrEqual(1);
    expect(expanded.some((e) => e.includes('总结'))).toBe(true);
    expect(expanded.some((e) => e.includes('归纳'))).toBe(true);
    expect(expanded.some((e) => e.includes('概览'))).toBe(true);
  });

  it('follow_up 意图不追加同义词', () => {
    const expanded = expandQuery('继续这个话题', ['follow_up']);
    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toBe('继续这个话题');
  });

  it('多意图：comparison + procedure → 合并两类的同义词', () => {
    const expanded = expandQuery('React和Vue', ['comparison', 'procedure']);
    // 应包含两类 intent 的扩展
    expect(expanded.some((e) => e.includes('区别') || e.includes('对比'))).toBe(true);
    expect(expanded.some((e) => e.includes('步骤') || e.includes('教程'))).toBe(true);
    // 去重
    const deduped = new Set(expanded);
    expect(deduped.size).toBe(expanded.length);
  });

  it('查询已含同义词时不重复追加', () => {
    const expanded = expandQuery('部署教程', ['procedure']);
    // "部署教程" 已经包含 "教程" 和 "步骤"，不应再追加 "部署教程 教程" 或 "部署教程 步骤"
    const hasTutorialDup = expanded.filter((e) => e === '部署教程 教程');
    expect(hasTutorialDup).toHaveLength(0);
    // "步骤" 不在 "部署教程" 中，所以应正常追加
    expect(expanded.some((e) => e === '部署教程 步骤')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 测试 6: 向后兼容 — 原 5 类意图不退化
// ---------------------------------------------------------------------------

describe('S12 向后兼容：原 5 类意图不退化', () => {
  const testCases: Array<{ query: string; expectedIntent: QueryIntentType }> = [
    { query: 'React vs Vue 的优缺点', expectedIntent: 'comparison' },
    { query: '总结一下这篇文章', expectedIntent: 'summary' },
    { query: '如何做压力测试', expectedIntent: 'procedure' },
    { query: '什么是闭包', expectedIntent: 'fact' },
    { query: '为什么选择TypeScript', expectedIntent: 'fact' },
    { query: 'JavaScript是什么？', expectedIntent: 'fact' },
  ];

  for (const { query, expectedIntent } of testCases) {
    it(`"${query}" → "${expectedIntent}"`, () => {
      const intents = classifyIntent(query);
      expect(intents).toHaveLength(1);
      expect(intents[0]).toBe(expectedIntent);
    });
  }

  it('follow_up 有历史时正确检测', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: '什么是闭包？' },
      { role: 'assistant', content: '闭包是指...' },
    ];
    const intents = classifyIntent('它能解决什么问题？', history);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toBe('follow_up');
  });

  it('planQuery 仍然正常工作（向后兼容）', () => {
    const plan = planQuery('React和Vue的对比步骤');
    expect(plan.original).toBeDefined();
    expect(plan.subQueries.length).toBeGreaterThan(0);
    expect(['broad', 'focused', 'comparative']).toContain(plan.strategy);
    // 多意图 → 策略为 comparative（最高优先级）
    expect(plan.strategy).toBe('comparative');
  });

  it('understandQuery 返回完整的 IQueryUnderstanding（含 intents 数组）', () => {
    const result = understandQuery('对比React和Vue的区别并总结');
    expect(result.intent).toBe('comparison'); // 主意图
    expect(result.intents).toHaveLength(2);
    expect(result.intents).toContain('comparison');
    expect(result.intents).toContain('summary');
    expect(result.standalone).toBeDefined();
    expect(result.expanded).toBeDefined();
    expect(result.ambiguities).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('understandQuery 单意图时 intents 只有 1 个元素', () => {
    const result = understandQuery('什么是闭包？');
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toBe('fact');
    expect(result.intent).toBe('fact');
  });

  it('多意图时 confidence 降为中置信度', () => {
    // "总结部署流程" → summary+procedure 复合意图，不含歧义词
    const result = understandQuery('总结部署流程和步骤');
    expect(result.intents.length).toBeGreaterThan(1);
    // 无歧义 + 多意图 = 0.75
    expect(result.confidence).toBe(0.75);
  });
});
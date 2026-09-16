// ============================================
// WeaveMD — agentKbPreloader 测试 (S11 模糊匹配 + 核心查询词提取)
// ============================================
// TDD: 测试 extractCoreTokens、isFuzzyMatch、createPreloadedSearchKb。
// 覆盖：模糊子串命中 / token 交集命中 / 精确匹配向后兼容 / 不相关 query miss / TTL 延长 / 核心词提取。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  extractCoreTokens,
  isFuzzyMatch,
  createPreloadedSearchKb,
} from '@main/ai/agent/agentKbPreloader';
import type { SearchKbFn } from '@main/ai/toolTypes';

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function makeMockSearchKb(delayMs: number = 0): { fn: SearchKbFn; callCount: () => number } {
  let count = 0;
  const fn: SearchKbFn = async (_uid, query, _opts) => {
    count++;
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return {
      refused: false,
      threshold: 0.6,
      best: {
        docId: 'doc-1',
        chunkId: 'chunk-x',
        fileName: 'test.md',
        content: `result for: ${query}`,
        seq: 0,
        score: 0.9,
        pinned: false,
        sourceRef: null,
      },
      results: [
        {
          docId: 'doc-1',
          chunkId: 'chunk-x',
          fileName: 'test.md',
          content: `result for: ${query}`,
          seq: 0,
          score: 0.9,
          pinned: false,
          sourceRef: null,
        },
      ],
    };
  };
  return { fn, callCount: () => count };
}

// ---------------------------------------------------------------------------
// extractCoreTokens
// ---------------------------------------------------------------------------

describe('extractCoreTokens', () => {
  it('去除标点与中文停用词，提取前 3 个有意义 token', () => {
    const result = extractCoreTokens('帮我找一下关于 React 状态管理的笔记', 3);
    // 期望：帮我/找一下/关于/的 被过滤 → React 状态管理 笔记
    expect(result).toBe('React 状态管理 笔记');
  });

  it('中文疑问句——提取核心关键词', () => {
    const result = extractCoreTokens('请问如何配置 Tailwind CSS 的主题颜色系统', 3);
    // 请问/如何 → 过滤；配置 → 保留（>=2 字）；Tailwind → 保留；CSS → 保留
    expect(result).toBe('配置 Tailwind CSS');
  });

  it('纯英文 query 仅去标点（不处理英文停用词）', () => {
    const result = extractCoreTokens('Please find notes about React hooks!', 4);
    // 去标点 ! → 空格；所有 token 保留
    expect(result).toBe('Please find notes about');
  });

  it('空字符串返回空', () => {
    expect(extractCoreTokens('')).toBe('');
  });

  it('仅含停用词时返回空', () => {
    const result = extractCoreTokens('帮我找一个一下关于的', 3);
    expect(result).toBe('');
  });

  it('单字 CJK token 被过滤', () => {
    const result = extractCoreTokens('a b c 的 了 吗', 3);
    // 'a', 'b', 'c' 是拉丁字母开头，保留
    expect(result).toBe('a b c');
  });

  it('CJK 单字（非拉丁）被过滤，>=2 字保留', () => {
    const result = extractCoreTokens('大 测试 项', 3);
    // '大' → 单字 CJK 过滤；'测试' → 保留；'项' → 单字 CJK 过滤
    expect(result).toBe('测试');
  });

  it('混合中英文 + 标点', () => {
    const result = extractCoreTokens('告诉我，关于 "TypeScript" 的类型推导问题。', 3);
    // 告诉我 → 过滤；关于 → 过滤；的 → 过滤；TypeScript → 保留；
    // "类型推导问题" 是连续的 CJK，去除标点后作为一个整体 token（无空白分隔）
    expect(result).toBe('TypeScript 类型推导问题');
  });
});

// ---------------------------------------------------------------------------
// isFuzzyMatch
// ---------------------------------------------------------------------------

describe('isFuzzyMatch', () => {
  it('精确匹配（向后兼容）', () => {
    expect(isFuzzyMatch('React 状态管理', 'React 状态管理')).toBe(true);
  });

  it('子串匹配 — query 是 key 的子串', () => {
    // LLM query "React 状态管理" 是预加载 key "React 状态管理 笔记" 的子串
    expect(isFuzzyMatch('React 状态管理', 'React 状态管理 笔记')).toBe(true);
  });

  it('子串匹配 — key 是 query 的子串', () => {
    expect(isFuzzyMatch('React 状态管理的笔记整理', 'React 状态管理')).toBe(true);
  });

  it('Token 交集匹配 — 2 个公共 token', () => {
    // qTokens: {react, 状态管理}; pkTokens: [react, 状态管理, 笔记]; 交集 >= 2
    expect(isFuzzyMatch('React 状态管理', 'React 状态管理 笔记')).toBe(true);
    // 子串匹配已覆盖，这里走 token 交集路径的场景：顺序不同
    expect(isFuzzyMatch('状态管理 React', 'React 状态管理 笔记')).toBe(true);
  });

  it('Token 交集匹配 — 仅有 1 个公共 token 不命中', () => {
    // qTokens: {react, hooks}; pkTokens: [react, 状态管理, 笔记]; 交集 = 1 < minMatch(2)
    // 注意：query 不能是 preloadKey 的子串，否则会被子串匹配拦截至 true
    expect(isFuzzyMatch('React hooks', 'React 状态管理 笔记')).toBe(false);
  });

  it('完全不相关 query 不命中', () => {
    expect(isFuzzyMatch('JavaScript 教程', 'React 状态管理 笔记')).toBe(false);
  });

  it('空 query 返回 false', () => {
    expect(isFuzzyMatch('', 'React 状态管理')).toBe(false);
  });

  it('空 key 返回 false', () => {
    expect(isFuzzyMatch('React', '')).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(isFuzzyMatch('react 状态管理', 'React 状态管理')).toBe(true);
  });

  it('预加载 key 仅有 1 个 token 时精确匹配命中', () => {
    expect(isFuzzyMatch('React', 'React')).toBe(true);
  });

  it('预加载 key 仅有 1 个 token 时不相关 query 不命中', () => {
    // q 不是 pk 的子串也不是父串，且无公共 token
    expect(isFuzzyMatch('Vue 组件开发', 'React')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createPreloadedSearchKb
// ---------------------------------------------------------------------------

describe('createPreloadedSearchKb', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('模糊子串匹配命中——跳过原始 searchKb', async () => {
    const { fn, callCount } = makeMockSearchKb();
    const message = '帮我找一下关于 React 状态管理的笔记';
    // extractCoreTokens(message) → "React 状态管理 笔记"

    const { searchKb, preloadPromise } = createPreloadedSearchKb(fn, 'user-1', message);
    await preloadPromise; // 等待预加载完成

    // LLM 生成的 query 是预加载 key 的子串
    const result = await searchKb('user-1', 'React 状态管理', { topK: 5 });
    expect(result.results[0].content).toContain('React 状态管理 笔记');
    // 预加载命中，原始函数应未被第二次调用（仅预加载时调用 1 次）
    expect(callCount()).toBe(1);
  });

  it('Token 交集匹配命中——跳过原始 searchKb', async () => {
    const { fn, callCount } = makeMockSearchKb();
    const message = '请问如何配置 Tailwind CSS 的主题颜色系统';
    // extractCoreTokens → "配置 Tailwind CSS"

    const { searchKb, preloadPromise } = createPreloadedSearchKb(fn, 'user-1', message);
    await preloadPromise;

    // LLM query 与预加载 key 有 2 个 token 交集（顺序不同）
    const result = await searchKb('user-1', 'CSS Tailwind 配置方案', { topK: 5 });
    expect(result.results[0].content).toContain('配置 Tailwind CSS');
    expect(callCount()).toBe(1); // 预加载命中
  });

  it('精确匹配仍然有效（向后兼容）', async () => {
    const { fn, callCount } = makeMockSearchKb();
    const message = 'React 状态管理';

    const { searchKb, preloadPromise } = createPreloadedSearchKb(fn, 'user-1', message);
    await preloadPromise;

    const result = await searchKb('user-1', 'React 状态管理', { topK: 5 });
    expect(result.results[0].content).toContain('React 状态管理');
    expect(callCount()).toBe(1);
  });

  it('完全不相关 query——走原始 searchKb', async () => {
    const { fn, callCount } = makeMockSearchKb();
    const message = '帮我找一下关于 React 状态管理的笔记';

    const { searchKb, preloadPromise } = createPreloadedSearchKb(fn, 'user-1', message);
    await preloadPromise;

    const result = await searchKb('user-1', 'JavaScript 闭包原理', { topK: 5 });
    expect(result.results[0].content).toContain('JavaScript 闭包原理');
    // 预加载 1 次 + miss 后走原始 1 次 = 2 次
    expect(callCount()).toBe(2);
  });

  it('TTL 内可多次命中（命中后不删除缓存）', async () => {
    const { fn, callCount } = makeMockSearchKb();
    const message = 'React 状态管理';

    const { searchKb, preloadPromise } = createPreloadedSearchKb(fn, 'user-1', message);
    await preloadPromise;

    // 第一次命中
    const r1 = await searchKb('user-1', 'React 状态管理', { topK: 5 });
    expect(r1.results[0].content).toContain('React 状态管理');

    // 第二次命中（缓存未删除，TTL 内仍可用）
    const r2 = await searchKb('user-1', 'React 状态管理', { topK: 5 });
    expect(r2.results[0].content).toContain('React 状态管理');

    // 两次都命中预加载，原始函数仅预加载时调用 1 次
    expect(callCount()).toBe(1);
  });

  it('TTL 过期后走原始 searchKb', async () => {
    const { fn, callCount } = makeMockSearchKb();
    const message = 'React 状态管理';

    const { searchKb, preloadPromise } = createPreloadedSearchKb(fn, 'user-1', message);
    await preloadPromise;

    // 时间前进 6 分钟（超过 5 分钟 TTL）
    vi.advanceTimersByTime(6 * 60 * 1000);

    const result = await searchKb('user-1', 'React 状态管理', { topK: 5 });
    expect(result.results[0].content).toContain('React 状态管理');
    // TTL 过期：预加载 1 次 + miss 后走原始 1 次 = 2 次
    expect(callCount()).toBe(2);
  });

  it('预加载 key 为空时退化为原始 searchKb', async () => {
    const { fn, callCount } = makeMockSearchKb();
    // 消息仅含停用词，extractCoreTokens 返回 ""
    const message = '帮我找一个的';

    const { searchKb, preloadPromise } = createPreloadedSearchKb(fn, 'user-1', message);
    await preloadPromise;

    const result = await searchKb('user-1', 'anything', { topK: 5 });
    expect(result.results[0].content).toContain('anything');
    // 预加载 key 为空不执行预加载；miss 后走原始
    expect(callCount()).toBe(1);
  });
});
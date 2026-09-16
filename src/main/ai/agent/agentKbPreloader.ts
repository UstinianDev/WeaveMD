// ============================================
// WeaveMD — Agent KB Preloader
// ============================================
// 从 agentLoop.ts 提取：知识库预加载缓存。
// 在 agentLoop 启动时异步预检索用户消息关键词，首轮 searchKB 命中时跳过网络延迟。
// S11: 模糊匹配（子串 + token 交集）+ 核心查询词提取 + TTL 延长至 5 分钟。

import type { SearchKbFn } from '../toolTypes';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 预加载缓存 TTL（5 分钟）：预加载结果在短期内仍然有效，模糊匹配场景下允许多次命中。 */
const KB_PRELOAD_TTL_MS = 5 * 60 * 1000;

/** token 交集匹配的最小匹配数（预加载 key 取前 3 个 token，匹配至少需 2 个）。 */
const MIN_TOKEN_INTERSECTION = 2;

/**
 * 中文常见停用词（高频功能词），用于提取核心查询 token。
 * 覆盖疑问/指令前缀、介词、助词、量词等。
 */
const CN_STOP_WORDS_RE = new RegExp(
  [
    // 指令/疑问前缀
    '帮我', '请', '请问', '找一下', '查一下', '搜索', '查找', '帮我找',
    '给我', '告诉', '显示', '列出', '帮我查', '帮我搜',
    // 介词/关联词
    '关于', '对于', '根据', '按照', '通过', '有关', '相关', '由于',
    '因为', '所以', '虽然', '但是', '如果', '那么',
    // 助词/量词/指示词
    '的', '了', '吗', '呢', '吧', '啊', '哦', '嗯',
    '一下', '一个', '一种', '一些', '这个', '那个', '这些', '那些',
    '什么', '怎么', '怎样', '如何', '哪里', '哪个', '谁', '多少', '几',
    // 常见动词（非内容词）
    '是', '在', '有', '和', '与', '或', '不', '也', '就', '都', '还',
    '要', '会', '能', '可以', '应该', '需要', '必须', '已经', '正在',
    '将', '把', '被', '给', '对', '从', '到', '向',
  ].join('|'),
  'gi'
);

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface KBCacheEntry {
  query: string;
  result: Awaited<ReturnType<SearchKbFn>>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// 核心查询词提取（S11 步骤 1）
// ---------------------------------------------------------------------------

/**
 * 简单启发式：去除标点与中文停用词，取前 N 个有意义 token。
 * 不做分词/NLP，仅依赖正则替换 + 空白分割。
 *
 * 例：
 *   "帮我找一下关于 React 状态管理的笔记" → "React 状态管理 笔记"
 *   "Please find notes about React hooks"   → "Please find notes about React hooks"
 *     （英文不处理停用词以避免过度删除；仅去标点）
 */
export function extractCoreTokens(text: string, maxTokens: number = 3): string {
  // Step 1: 去除中英文标点，替换为空格
  let cleaned = text.replace(/[，。！？；：、""'…—\-.,!?;:'"()[\]【】《》〈〉\s]+/g, ' ');

  // Step 2: 去除中文停用词
  cleaned = cleaned.replace(CN_STOP_WORDS_RE, ' ');

  // Step 3: 折叠空白并分割
  const tokens = cleaned.split(/\s+/).filter((t) => {
    if (t.length === 0) return false;
    // 拉丁字母/数字开头：始终保留
    if (/^[a-zA-Z0-9]/.test(t)) return true;
    // CJK token：长度 >= 2 才保留（单字通常无意义）
    return t.length >= 2;
  });

  return tokens.slice(0, maxTokens).join(' ');
}

// ---------------------------------------------------------------------------
// 模糊匹配（S11 步骤 2）
// ---------------------------------------------------------------------------

/**
 * 判断 LLM 生成的 query 是否命中预加载缓存 key。
 *
 * 匹配策略（短路求值，按优先级）：
 * 1. 精确匹配（向后兼容）
 * 2. 子串匹配（任意方向：query 是 key 的子串，或 key 是 query 的子串）
 * 3. Token 交集匹配（双方按空白分词后，至少 MIN_TOKEN_INTERSECTION 个相同 token）
 *
 * 算法复杂度 O(n)，无外部依赖。
 */
export function isFuzzyMatch(query: string, preloadKey: string): boolean {
  const q = query.trim().toLowerCase();
  const pk = preloadKey.trim().toLowerCase();

  if (!q || !pk) return false;

  // 1. 精确匹配（向后兼容）
  if (q === pk) return true;

  // 2. 子串匹配（任一方向）
  if (pk.includes(q) || q.includes(pk)) return true;

  // 3. Token 交集匹配
  const qTokens = new Set(q.split(/\s+/).filter(Boolean));
  const pkTokens = pk.split(/\s+/).filter(Boolean);

  // 预加载 key 的 token 数可能小于 minMatch，此时取其自身长度
  const minMatch = Math.min(MIN_TOKEN_INTERSECTION, pkTokens.length, qTokens.size);

  let matched = 0;
  for (const t of pkTokens) {
    if (qTokens.has(t)) {
      matched++;
      if (matched >= minMatch) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// 预加载缓存
// ---------------------------------------------------------------------------

/**
 * 创建带预加载缓存的 searchKb 包装函数。
 * 在 agentLoop 启动时异步预检索用户消息关键词，首轮 searchKB 命中时跳过网络延迟。
 *
 * S11 变更：
 * - 预加载 key 使用 extractCoreTokens 提取核心查询词（而非前 100 字符）
 * - 首轮命中使用 isFuzzyMatch 模糊匹配（而非精确匹配）
 * - TTL 延长至 5 分钟
 * - 命中后不删除缓存（TTL 控制过期），允许多次命中
 */
export function createPreloadedSearchKb(
  original: SearchKbFn,
  userId: string,
  message: string
): { searchKb: SearchKbFn; preloadPromise: Promise<void> } {
  // S11: 提取核心查询词（去除标点、停用词，取前 3 个有意义 token）
  const preloadQuery = extractCoreTokens(message, 3);
  const cache = new Map<string, KBCacheEntry>();

  // 异步预加载（fire-and-forget，不阻塞主流程）
  const preloadPromise = (async () => {
    if (!preloadQuery || preloadQuery.length < 2) return;
    try {
      const result = await original(userId, preloadQuery, { topK: 5 });
      cache.set(preloadQuery, { query: preloadQuery, result, timestamp: Date.now() });
    } catch {
      // 预加载失败静默忽略
    }
  })();

  const searchKb: SearchKbFn = async (uid, query, opts) => {
    // S11: 模糊匹配遍历缓存（支持子串 / token 交集命中）
    for (const [key, entry] of cache) {
      if (Date.now() - entry.timestamp < KB_PRELOAD_TTL_MS && isFuzzyMatch(query, key)) {
        // S11: 命中后不删除（TTL 控制过期，允许同一会话多次命中）
        return entry.result;
      }
    }
    return original(uid, query, opts);
  };

  return { searchKb, preloadPromise };
}
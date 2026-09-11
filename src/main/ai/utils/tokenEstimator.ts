// ============================================
// WeaveMD — Token Estimator (shared utility)
// ============================================
// 无 tokenizer 依赖的字量估算：CJK 字符加权 + Latin/其他字符加权。
// 从 contextManager.ts 提取，供 agent 循环和上下文管理共用。
// 性能优化：LRU 缓存（避免重复计算相同内容的 token 数）。

// ---------------------------------------------------------------------------
// LRU 缓存实现（性能优化）
// ---------------------------------------------------------------------------

/**
 * LRU（Least Recently Used）缓存。
 * 自动淘汰最久未使用的条目，避免遍历清理。
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 移动到最新位置（LRU 核心逻辑）
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // 更新现有条目：先删除再插入（移动到最新位置）
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 淘汰最旧条目（Map 迭代顺序 = 插入顺序，第一个即最旧）
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }
}

// ---------------------------------------------------------------------------
// Token 估算缓存
// ---------------------------------------------------------------------------

/** Token 估算缓存：LRU，最大 1000 条目。 */
const tokenCache = new LRUCache<string, number>(1000);

/**
 * token 估算：无 tokenizer，按字符类型加权。
 * - CJK 字符（含扩展 A/B、兼容、韩文、日文假名）：1 字 ≈ 1~2 token，取 0.75 token/字
 * - Latin/其他：1 token ≈ 4 字符，取 0.25 token/char
 * 比统一 length/2 更准确，避免英文被高估 8 倍导致过早压缩。
 */
export function estimateTokens(text: string): number {
  const t = text || '';
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < t.length; i++) {
    const code = t.charCodeAt(i);
    // CJK 统一表意文字 + 扩展 A/B + 兼容 + 韩文 + 日文假名
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk * 0.75 + other * 0.25);
}

/**
 * token 估算（带 LRU 缓存，性能优化）。
 * 相同内容不重复计算，直接返回缓存结果。
 * 短文本（< 100 字符）不缓存（缓存开销 > 计算开销）。
 * @param text 文本内容
 * @returns token 数
 */
export function estimateTokensCached(text: string): number {
  const t = text || '';

  // 短文本不缓存（缓存开销 > 计算开销）
  if (t.length < 100) {
    return estimateTokens(t);
  }

  // 检查缓存
  const cached = tokenCache.get(t);
  if (cached !== undefined) {
    return cached;
  }

  // 计算并缓存
  const result = estimateTokens(t);
  tokenCache.set(t, result);
  return result;
}

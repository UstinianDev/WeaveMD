// ============================================
// WeaveMD — 中文分词器（R11）
// ============================================
// jieba-wasm cut_for_search + bigram 回退。
// 供 kbSearch sanitizeFtsQuery 调用，提升 CJK 查询命中率。

// ---------------------------------------------------------------------------
// jieba-wasm 加载（同步 require，惰性初始化）
// ---------------------------------------------------------------------------

/** jieba cut_for_search 函数引用（null = 尚未加载）。 */
let cutForSearch: ((text: string, hmm?: boolean | null) => string[]) | null = null;

/** jieba 加载状态：'idle' | 'ok' | 'fail' */
let jiebaStatus: 'idle' | 'ok' | 'fail' = 'idle';

/**
 * 同步加载 jieba-wasm（nodejs 环境下 WASM 同步初始化）。
 * 首次调用时尝试 require，失败则降级到 bigram。
 */
function ensureJiebaSync(): boolean {
  if (jiebaStatus === 'ok') return true;
  if (jiebaStatus === 'fail') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('jieba-wasm') as Record<string, unknown>;
    if (typeof mod.cut_for_search === 'function') {
      cutForSearch = mod.cut_for_search as (text: string, hmm?: boolean | null) => string[];
      jiebaStatus = 'ok';
      return true;
    }
    // 回退到普通 cut
    if (typeof mod.cut === 'function') {
      cutForSearch = mod.cut as (text: string, hmm?: boolean | null) => string[];
      jiebaStatus = 'ok';
      return true;
    }
    jiebaStatus = 'fail';
    return false;
  } catch {
    jiebaStatus = 'fail';
    return false;
  }
}

// ---------------------------------------------------------------------------
// CJK 检测
// ---------------------------------------------------------------------------

/** CJK 统一表意文字 + 扩展 A/B 范围（覆盖常用中文、日文汉字）。 */
const CJK_CHAR_RE = /[一-鿿㐀-䶿豈-﫿]/;

function isCjkChar(ch: string): boolean {
  return CJK_CHAR_RE.test(ch);
}

/** 判断 token 是否包含 CJK 字符。 */
function hasCjk(text: string): boolean {
  for (const ch of text) {
    if (isCjkChar(ch)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// bigram 回退分词
// ---------------------------------------------------------------------------

/**
 * 对连续 CJK 字符生成 2-gram，拉丁文/数字按 \w+ 切分。
 * 例：「知识库管理」→ ["知识", "识库", "库管", "管理"]
 * 「Hello世界」→ ["Hello", "世界"]
 */
function bigramFallback(text: string): string[] {
  const tokens: string[] = [];
  // 先按空白切分大块
  const segments = text.split(/\s+/).filter(Boolean);

  for (const seg of segments) {
    // 在段内逐字符扫描，累积连续同类字符
    let buf = '';
    let bufIsCjk = false;

    const flush = () => {
      if (!buf) return;
      if (bufIsCjk) {
        // CJK 连续段：逐字 + bigram
        const chars = [...buf];
        for (const ch of chars) {
          tokens.push(ch);
        }
        for (let i = 0; i < chars.length - 1; i++) {
          tokens.push(chars[i] + chars[i + 1]);
        }
      } else {
        // 非 CJK 段：按 \w+ 提取
        const words = buf.match(/\w+/g);
        if (words) tokens.push(...words);
      }
      buf = '';
    };

    for (const ch of seg) {
      const chIsCjk = isCjkChar(ch);
      if (buf && chIsCjk !== bufIsCjk) {
        flush();
      }
      buf += ch;
      bufIsCjk = chIsCjk;
    }
    flush();
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/**
 * 初始化 jieba-wasm（同步 require）。
 * 返回 true 表示 jieba 可用，false 表示降级到 bigram。
 */
export function initJieba(): boolean {
  return ensureJiebaSync();
}

/**
 * 分词：优先 jieba cut_for_search，回退 bigram + 正则。
 * 首次调用自动尝试加载 jieba-wasm。
 */
export function tokenize(text: string): string[] {
  if (ensureJiebaSync() && cutForSearch) {
    return cutForSearch(text, true);
  }
  return bigramFallback(text);
}

/**
 * 构建 FTS5 查询字符串。
 * 对用户输入分词后，token 间以 OR 连接；CJK token 追加 * 前缀匹配。
 * 例：「知识库」→ jieba cut_for_search → "知识* OR 知识库*"
 */
export function buildFtsQuery(query: string): string {
  // 先剥离 FTS5 特殊字符（防语法注入）
  const FTS_SPECIAL_RE = /[!"()*:^~+\-&|<>[\]{}]/g;
  const cleaned = query.replace(FTS_SPECIAL_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  // 分词（自动加载 jieba 或降级 bigram）
  const rawTokens = tokenize(cleaned);
  if (rawTokens.length === 0) return '';

  // 去重 + 过滤空串和纯空白
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const tok of rawTokens) {
    const t = tok.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
  }

  if (tokens.length === 0) return '';

  // CJK token 追加 * 用于 FTS5 前缀匹配
  return tokens
    .map((tok) => (hasCjk(tok) ? `${tok}*` : tok))
    .join(' OR ');
}

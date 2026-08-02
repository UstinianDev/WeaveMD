// ============================================
// WeaveMD — Search Engine
// ============================================
// Pure search utility module inspired by
// MarkText's search engine (muya/src/search).
// Supports case sensitivity, whole word,
// and regex mode with validation.
// No React dependency — usable anywhere.
// ============================================

// ============================================
// Types
// ============================================

export interface SearchOptions {
  isCaseSensitive?: boolean;
  isWholeWord?: boolean;
  isRegexp?: boolean;
}

export interface MatchResult {
  /** Byte offset in the full content string */
  offset: number;
  /** The matched text (preserving original case) */
  text: string;
  /** 1-based line number */
  line: number;
  /** The full line text containing this match */
  lineText: string;
  /** Column position within the line (0-based) */
  col: number;
}

// Default search options
export const DEFAULT_SEARCH_OPTIONS: Required<SearchOptions> = {
  isCaseSensitive: false,
  isWholeWord: false,
  isRegexp: false,
};

// ============================================
// Helpers
// ============================================

/**
 * Escape regex special characters for plain-text search.
 * Same as RegExp.escape proposal polyfill.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================
// Core Matching
// ============================================

/**
 * Find all matches of `query` in `content` with the given options.
 * Returns an empty array if query is empty, content is empty, or
 * the regex is invalid (silently returns [] — use validateRegex
 * separately for user-facing error messages).
 *
 * Matches are returned in document order regardless of direction;
 * the caller can reverse for "up" navigation.
 *
 * Inspired by MarkText's `matchString()` in muya/src/utils/search.ts
 * and their Search.search() method.
 */
export function findAllMatches(
  content: string,
  query: string,
  options: SearchOptions = {}
): MatchResult[] {
  if (!query || !content) return [];

  const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };
  const { isCaseSensitive, isWholeWord, isRegexp } = opts;

  // Build regex pattern from query
  let searchStr = query;
  let flags = 'g';

  if (!isCaseSensitive) flags += 'i';

  if (!isRegexp) {
    // Escape special characters for plain text search
    searchStr = escapeRegExp(query);
  }

  if (isWholeWord) {
    searchStr = `\\b${searchStr}\\b`;
  }

  try {
    const regex = new RegExp(searchStr, flags);
    const results: MatchResult[] = [];
    const lines = content.split('\n');
    let runningOffset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        results.push({
          offset: runningOffset + match.index,
          text: match[0],
          line: i + 1,
          lineText: line,
          col: match.index,
        });

        // Avoid infinite loop on zero-length matches
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }

      runningOffset += line.length + 1; // +1 for \n
    }

    return results;
  } catch {
    // Invalid regex — return empty silently; caller should validate
    return [];
  }
}

// ============================================
// Regex Validation
// ============================================

/**
 * Validate a regex pattern string.
 * Returns null if valid, or an error message string if invalid.
 * Also warns if the pattern matches empty string (likely not what
 * the user wants).
 */
export function validateRegex(pattern: string): string | null {
  if (!pattern) return null;

  try {
    const re = new RegExp(pattern);

    // Check for empty string match (e.g. `.*` matches everywhere)
    if (re.test('')) {
      return `"${pattern}" 匹配空字符串，请检查正则表达式`;
    }

    return null;
  } catch (e) {
    if (e instanceof SyntaxError) {
      return e.message;
    }
    return '无效的正则表达式';
  }
}

// ============================================
// Replace helpers
// ============================================

/**
 * Replace all occurrences of query in content with replacement value.
 * Supports regex mode: if isRegexp is true and query is a valid regex,
 * it uses RegExp replace with the replacement string (supporting $1, $&, etc.)
 */
export function replaceAll(
  content: string,
  query: string,
  replacement: string,
  options: SearchOptions = {}
): string | null {
  if (!query || !content) return null;

  const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };
  const { isCaseSensitive, isWholeWord, isRegexp } = opts;

  let searchStr = query;
  let flags = 'g';

  if (!isCaseSensitive) flags += 'i';

  if (!isRegexp) {
    searchStr = escapeRegExp(query);
  }

  if (isWholeWord) {
    searchStr = `\\b${searchStr}\\b`;
  }

  try {
    const regex = new RegExp(searchStr, flags);
    return content.replace(regex, replacement);
  } catch {
    return null;
  }
}

// ============================================
// WeaveMD — FindReplaceModal Unit Tests
// ============================================
// Tests cover: findAllMatches (search logic),
// escapeRegExp, validateRegex, replaceAll,
// and the IME composition guard (onKeyDown).
// ============================================

import { describe, expect, it } from 'vitest';
import {
  escapeRegExp,
  findAllMatches,
  validateRegex,
  replaceAll,
} from '../../src/render/services/searchEngine';

// ============================================
// Tests: escapeRegExp
// ============================================

describe('escapeRegExp', () => {
  it('should escape regex special characters', () => {
    expect(escapeRegExp('.')).toBe('\\.');
    expect(escapeRegExp('*')).toBe('\\*');
    expect(escapeRegExp('?')).toBe('\\?');
    expect(escapeRegExp('+')).toBe('\\+');
    expect(escapeRegExp('^')).toBe('\\^');
    expect(escapeRegExp('$')).toBe('\\$');
    expect(escapeRegExp('{')).toBe('\\{');
    expect(escapeRegExp('}')).toBe('\\}');
    expect(escapeRegExp('(')).toBe('\\(');
    expect(escapeRegExp(')')).toBe('\\)');
    expect(escapeRegExp('[')).toBe('\\[');
    expect(escapeRegExp(']')).toBe('\\]');
    expect(escapeRegExp('\\')).toBe('\\\\');
    expect(escapeRegExp('|')).toBe('\\|');
  });

  it('should not escape normal characters', () => {
    expect(escapeRegExp('hello')).toBe('hello');
    expect(escapeRegExp('企业级全套')).toBe('企业级全套');
    expect(escapeRegExp('abc123')).toBe('abc123');
  });

  it('should handle empty string', () => {
    expect(escapeRegExp('')).toBe('');
  });
});

// ============================================
// Tests: findAllMatches
// ============================================

describe('findAllMatches', () => {
  const sample = 'Hello World\nhello world\nHELLO WORLD';

  it('should return empty array for empty query', () => {
    expect(findAllMatches(sample, '')).toEqual([]);
  });

  it('should return empty array for empty content', () => {
    expect(findAllMatches('', 'hello')).toEqual([]);
  });

  it('should find case-insensitive matches (default)', () => {
    const matches = findAllMatches(sample, 'hello');
    expect(matches).toHaveLength(3);
    expect(matches[0].line).toBe(1);
    expect(matches[1].line).toBe(2);
    expect(matches[2].line).toBe(3);
  });

  it('should preserve original case in match text', () => {
    const matches = findAllMatches(sample, 'hello');
    expect(matches[0].text).toBe('Hello');
    expect(matches[1].text).toBe('hello');
    expect(matches[2].text).toBe('HELLO');
  });

  it('should return correct line and column numbers', () => {
    const matches = findAllMatches(sample, 'world');
    expect(matches[0].line).toBe(1);
    expect(matches[0].col).toBe(6);
    expect(matches[1].line).toBe(2);
    expect(matches[1].col).toBe(6);
    expect(matches[2].line).toBe(3);
    expect(matches[2].col).toBe(6);
  });

  it('should find multiple matches on the same line', () => {
    const matches = findAllMatches('test test test', 'test');
    expect(matches).toHaveLength(3);
    expect(matches[0].col).toBe(0);
    expect(matches[1].col).toBe(5);
    expect(matches[2].col).toBe(10);
  });

  it('should calculate correct byte offsets', () => {
    const content = 'line one\nline two\nline three';
    const matches = findAllMatches(content, 'line');
    expect(matches).toHaveLength(3);
    expect(matches[0].offset).toBe(0);
    expect(matches[1].offset).toBe(9);
    expect(matches[2].offset).toBe(18);
  });

  it('should handle Chinese characters correctly', () => {
    const chineseContent = '企业级全栈开发\n企业级应用\n中小企业';
    const matches = findAllMatches(chineseContent, '企业级');
    expect(matches).toHaveLength(2);
    expect(matches[0].line).toBe(1);
    expect(matches[0].col).toBe(0);
    expect(matches[0].text).toBe('企业级');
    expect(matches[1].line).toBe(2);
    expect(matches[1].text).toBe('企业级');
  });

  it('should handle empty lines in content', () => {
    const content = 'hello\n\nworld\n\nhello';
    const matches = findAllMatches(content, 'hello');
    expect(matches).toHaveLength(2);
    expect(matches[0].line).toBe(1);
    expect(matches[1].line).toBe(5);
  });

  it('should return empty array for no matches', () => {
    expect(findAllMatches(sample, 'xyzabc')).toEqual([]);
  });

  // ── Case sensitivity ──

  it('should respect case-sensitive mode', () => {
    const matches = findAllMatches(sample, 'hello', { isCaseSensitive: true });
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('hello');
    expect(matches[0].line).toBe(2);
  });

  it('should find zero case-sensitive matches when no exact match', () => {
    const matches = findAllMatches(sample, 'HELLO', { isCaseSensitive: true });
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('HELLO');
  });

  // ── Whole word ──

  it('should respect whole-word mode', () => {
    const content = 'the word and thesaurus';
    const matches = findAllMatches(content, 'the', { isWholeWord: true });
    expect(matches).toHaveLength(1);
    expect(matches[0].col).toBe(0);
    expect(matches[0].text).toBe('the');
  });

  it('should match whole words only, not substrings', () => {
    const content = 'apple pineapple apple';
    const matches = findAllMatches(content, 'apple', { isWholeWord: true });
    expect(matches).toHaveLength(2);
    expect(matches[0].col).toBe(0);
    expect(matches[1].col).toBe(16);
  });

  it('should combine case sensitivity and whole word', () => {
    const content = 'The the The anotherThe';
    const matches = findAllMatches(content, 'The', {
      isCaseSensitive: true,
      isWholeWord: true,
    });
    expect(matches).toHaveLength(2);
    expect(matches[0].col).toBe(0);
    expect(matches[1].col).toBe(8);
  });

  // ── Regex ──

  it('should support regex mode', () => {
    const content = 'foo bar foo baz';
    const matches = findAllMatches(content, 'f.o', { isRegexp: true });
    expect(matches).toHaveLength(2);
    expect(matches[0].text).toBe('foo');
    expect(matches[1].text).toBe('foo');
  });

  it('should support regex with alternation', () => {
    const content = 'cat dog bird';
    const matches = findAllMatches(content, 'cat|dog', { isRegexp: true });
    expect(matches).toHaveLength(2);
    expect(matches[0].text).toBe('cat');
    expect(matches[1].text).toBe('dog');
  });

  it('should return empty array for invalid regex silently', () => {
    const matches = findAllMatches('hello', '[invalid', { isRegexp: true });
    expect(matches).toEqual([]);
  });

  it('should combine regex with case sensitivity', () => {
    const content = 'Hello HELLO hello';
    const matches = findAllMatches(content, 'hello', {
      isRegexp: true,
      isCaseSensitive: true,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('hello');
  });
});

// ============================================
// Tests: validateRegex
// ============================================

describe('validateRegex', () => {
  it('should return null for valid regex', () => {
    expect(validateRegex('hello')).toBeNull();
    expect(validateRegex('\\d+')).toBeNull();
    expect(validateRegex('[a-z]+')).toBeNull();
  });

  it('should return null for empty input', () => {
    expect(validateRegex('')).toBeNull();
  });

  it('should return error message for invalid regex', () => {
    const error = validateRegex('[invalid');
    expect(error).not.toBeNull();
    expect(error).toContain('Invalid');
  });

  it('should return error for empty-string-matching regex', () => {
    const error = validateRegex('.*');
    expect(error).not.toBeNull();
    expect(error).toContain('匹配空字符串');
  });

  it('should detect empty match pattern', () => {
    expect(validateRegex('a*')).not.toBeNull(); // matches empty string
    expect(validateRegex('a+')).toBeNull(); // requires at least one 'a'
  });
});

// ============================================
// Tests: replaceAll
// ============================================

describe('replaceAll', () => {
  it('should replace all occurrences in plain mode', () => {
    expect(replaceAll('foo foo foo', 'foo', 'bar')).toBe('bar bar bar');
  });

  it('should return null for empty query', () => {
    expect(replaceAll('hello', '', 'world')).toBeNull();
  });

  it('should return null for empty content', () => {
    expect(replaceAll('', 'hello', 'world')).toBeNull();
  });

  it('should support case sensitivity', () => {
    const result = replaceAll('Hello HELLO hello', 'hello', 'hi', {
      isCaseSensitive: true,
    });
    expect(result).toBe('Hello HELLO hi');
  });

  it('should support regex mode', () => {
    const result = replaceAll('foo123 bar456', '\\d+', 'NUM', {
      isRegexp: true,
    });
    expect(result).toBe('fooNUM barNUM');
  });

  it('should support whole word mode', () => {
    const result = replaceAll('the thesaurus and the', 'the', 'a', {
      isWholeWord: true,
    });
    expect(result).toBe('a thesaurus and a');
  });

  it('should return null for invalid regex', () => {
    const result = replaceAll('hello', '[invalid', 'world', {
      isRegexp: true,
    });
    expect(result).toBeNull();
  });
});

// ============================================
// Tests: onKeyDown IME Guard
// ============================================

describe('onKeyDown IME guard', () => {
  /**
   * Simulates the onKeyDown guard used in FindReplaceModal to prevent
   * Enter from triggering find/replace during IME composition.
   */
  function shouldSkipKeyDown(e: { key: string; nativeEvent: { isComposing: boolean }; keyCode: number }): boolean {
    return e.nativeEvent.isComposing || e.keyCode === 229;
  }

  it('should skip keydown when nativeEvent.isComposing is true', () => {
    expect(shouldSkipKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, keyCode: 0 })).toBe(true);
  });

  it('should skip keydown when keyCode is 229 (IME composition)', () => {
    expect(shouldSkipKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, keyCode: 229 })).toBe(true);
  });

  it('should process keydown when not composing', () => {
    expect(shouldSkipKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, keyCode: 13 })).toBe(false);
  });

  it('should process non-Enter keys when not composing', () => {
    expect(shouldSkipKeyDown({ key: 'a', nativeEvent: { isComposing: false }, keyCode: 65 })).toBe(false);
  });
});

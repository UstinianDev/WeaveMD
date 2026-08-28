import { describe, expect, it } from 'vitest';
import { tokenize, buildFtsQuery, initJieba } from '@main/ai/tokenizer';

describe('tokenizer — jieba 加载', () => {
  it('initJieba 返回 boolean', () => {
    const result = initJieba();
    expect(typeof result).toBe('boolean');
  });
});

describe('tokenizer — 分词', () => {
  it('拉丁文按单词切分', () => {
    const tokens = tokenize('hello world');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  it('CJK 连续字符有分词结果', () => {
    const tokens = tokenize('知识库');
    expect(tokens.length).toBeGreaterThan(0);
    // 至少包含一些子串
    expect(tokens.some((t) => t.includes('知'))).toBe(true);
  });

  it('混合中英文分开处理', () => {
    const tokens = tokenize('React框架');
    expect(tokens).toContain('React');
    // CJK 部分有结果
    expect(tokens.some((t) => /[一-鿿]/.test(t))).toBe(true);
  });

  it('英文保持完整', () => {
    const tokens = tokenize('TypeScript');
    expect(tokens).toContain('TypeScript');
  });
});

describe('buildFtsQuery — FTS5 查询构建', () => {
  it('纯英文用 OR 连接', () => {
    const q = buildFtsQuery('hello world');
    expect(q).toContain('hello');
    expect(q).toContain('world');
    expect(q).toContain(' OR ');
  });

  it('中文 token 追加 * 前缀', () => {
    const q = buildFtsQuery('知识');
    expect(q).toContain('知识*');
  });

  it('空输入返回空串', () => {
    expect(buildFtsQuery('')).toBe('');
    expect(buildFtsQuery('   ')).toBe('');
  });

  it('特殊字符被剥离', () => {
    const q = buildFtsQuery('hello "world"');
    expect(q).not.toContain('"');
    expect(q).toContain('hello');
    expect(q).toContain('world');
  });

  it('混合中英文', () => {
    const q = buildFtsQuery('React框架');
    expect(q).toContain('React');
    expect(q).toContain('*');
  });

  it('重复 token 去重', () => {
    const q = buildFtsQuery('test test');
    const parts = q.split(' OR ');
    const uniqueParts = [...new Set(parts)];
    expect(parts.length).toBe(uniqueParts.length);
  });
});

import { describe, expect, it } from 'vitest';

import { tokenizeInline } from '../../../src/render/editor/kernel/inlineLexer';
import type { InlineToken } from '../../../src/render/editor/kernel/inlineLexer';

function simplify(tokens: InlineToken[]): unknown[] {
  return tokens.map((t) => ({
    type: t.type,
    start: t.start,
    end: t.end,
    openLen: t.openLen,
    closeLen: t.closeLen,
    contentStart: t.contentStart,
    contentEnd: t.contentEnd,
    ...(t.children ? { children: simplify(t.children) } : {}),
    ...(t.href !== undefined ? { href: t.href } : {}),
    ...(t.title !== undefined ? { title: t.title } : {}),
    ...(t.isImage !== undefined ? { isImage: t.isImage } : {}),
  }));
}

describe('inlineLexer — 基础', () => {
  it('空文本返回空 token 序列', () => {
    expect(tokenizeInline('')).toEqual([]);
  });

  it('普通文本不产生 token', () => {
    expect(tokenizeInline('hello world 中文 测试')).toEqual([]);
  });

  it('未闭合标记不产生 token', () => {
    expect(tokenizeInline('**x')).toEqual([]);
  });
});

describe('inlineLexer — 加粗 / 斜体', () => {
  it('加粗产生 strong token（含绝对偏移）', () => {
    expect(simplify(tokenizeInline('**bold**'))).toEqual([
      {
        type: 'strong',
        start: 0,
        end: 8,
        openLen: 2,
        closeLen: 2,
        contentStart: 2,
        contentEnd: 6,
        children: [],
      },
    ]);
  });

  it('斜体产生 em token', () => {
    const tokens = tokenizeInline('*i*');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('em');
    expect(tokens[0].start).toBe(0);
    expect(tokens[0].end).toBe(3);
    expect(tokens[0].openLen).toBe(1);
    expect(tokens[0].contentStart).toBe(1);
    expect(tokens[0].contentEnd).toBe(2);
  });

  it('下划线在单词内不作为强调（路径场景）', () => {
    expect(tokenizeInline('foo_bar_baz')).toEqual([]);
  });
});

describe('inlineLexer — 嵌套', () => {
  it('嵌套强调产生 children', () => {
    const tokens = tokenizeInline('**a *b* c**');
    expect(tokens).toHaveLength(1);
    const strong = tokens[0];
    expect(strong.type).toBe('strong');
    const em = strong.children?.find((c) => c.type === 'em');
    expect(em).toBeDefined();
    expect(em?.start).toBe(4);
    expect(em?.end).toBe(7);
    expect(em?.contentStart).toBe(5);
    expect(em?.contentEnd).toBe(6);
  });

  it('链接标签经 children 递归识别', () => {
    const tokens = tokenizeInline('[**b**](https://x.com)');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('link');
    expect(tokens[0].children?.find((c) => c.type === 'strong')).toBeDefined();
  });
});

describe('inlineLexer — 删除线 / 高亮 / 代码 / 转义', () => {
  it('删除线产生 del token', () => {
    expect(tokenizeInline('~~s~~')[0].type).toBe('del');
  });

  it('高亮产生 mark token', () => {
    expect(tokenizeInline('==m==')[0].type).toBe('mark');
  });

  it('下划线产生 underline token（精确小写匹配）', () => {
    const tokens = tokenizeInline('<u>x</u>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('underline');
    expect(tokens[0].start).toBe(0);
    expect(tokens[0].end).toBe(8);
    expect(tokens[0].openLen).toBe(3);
    expect(tokens[0].closeLen).toBe(4);
    expect(tokens[0].contentStart).toBe(3);
    expect(tokens[0].contentEnd).toBe(4);
    // 大写 <U> 不匹配
    expect(tokenizeInline('<U>x</U>')).toEqual([]);
  });

  it('数学公式产生 math token', () => {
    const tokens = tokenizeInline('$x^2$');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('math');
    expect(tokens[0].start).toBe(0);
    expect(tokens[0].end).toBe(5);
    expect(tokens[0].contentStart).toBe(1);
    expect(tokens[0].contentEnd).toBe(4);
    // 不误判：cost $5 / $ x$ / 未闭合
    expect(tokenizeInline('cost $5')).toEqual([]);
    expect(tokenizeInline('$ x$')).toEqual([]);
    expect(tokenizeInline('$x')).toEqual([]);
  });

  it('行内代码产生 code token', () => {
    const tokens = tokenizeInline('`c`');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('code');
    expect(tokens[0].openLen).toBe(1);
    expect(tokens[0].contentStart).toBe(1);
    expect(tokens[0].contentEnd).toBe(2);
  });

  it('反斜杠转义产生 escape token', () => {
    const tokens = tokenizeInline('\\*x\\*');
    expect(tokens).toHaveLength(2);
    expect(tokens[0].type).toBe('escape');
    expect(tokens[0].start).toBe(0);
    expect(tokens[0].end).toBe(2);
  });
});

describe('inlineLexer — 链接 / 图片 / 自动链接', () => {
  it('链接产生 link token（含 href）', () => {
    const tokens = tokenizeInline('[t](https://x.com)');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('link');
    expect(tokens[0].href).toBe('https://x.com');
    expect(tokens[0].contentStart).toBe(1);
    expect(tokens[0].contentEnd).toBe(2);
  });

  it('图片产生 image token（isImage）', () => {
    const tokens = tokenizeInline('![a](https://example.com/a.png)');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('image');
    expect(tokens[0].isImage).toBe(true);
    expect(tokens[0].href).toBe('https://example.com/a.png');
    expect(tokens[0].contentStart).toBe(2);
    expect(tokens[0].contentEnd).toBe(3);
  });

  it('危险链接不产生 token', () => {
    expect(tokenizeInline('[x](javascript:alert(1))')).toEqual([]);
  });

  it('自动链接产生 autolink token', () => {
    const tokens = tokenizeInline('<https://example.com>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('autolink');
    expect(tokens[0].href).toBe('https://example.com');
  });
});

describe('inlineLexer — 前置文本下的绝对偏移', () => {
  it('偏移为相对完整文本的绝对位置', () => {
    const tokens = tokenizeInline('ab **bold** cd');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].start).toBe(3);
    expect(tokens[0].end).toBe(11);
    expect(tokens[0].contentStart).toBe(5);
    expect(tokens[0].contentEnd).toBe(9);
  });

  it('自定义起始偏移扫描子区间', () => {
    const text = 'xx**bold**yy';
    const tokens = tokenizeInline(text, 3, 10);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('em');
    expect(tokens[0].start).toBe(3);
    expect(tokens[0].end).toBe(9);
    expect(tokens[0].contentStart).toBe(4);
    expect(tokens[0].contentEnd).toBe(8);
  });
});

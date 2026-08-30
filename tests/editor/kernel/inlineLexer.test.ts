import { describe, expect, it } from 'vitest';

import {
  clearInlineCache,
  findIntersectingStyleToken,
  findIntersectingStyleTokens,
  normalizeHref,
  safeUrl,
  tokenizeInline,
} from '@render/editor/kernel/inlineLexer';
import type { InlineToken } from '@render/editor/kernel/inlineLexer';

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

describe('inlineLexer — 加粗+斜体叠加（三连 `***`）', () => {
  it('`***abc***` 解析为 em 包裹内层 strong', () => {
    const tokens = tokenizeInline('***abc***');
    expect(tokens).toHaveLength(1);
    const em = tokens[0];
    expect(em.type).toBe('em');
    expect(em.start).toBe(0);
    expect(em.end).toBe(9);
    expect(em.openLen).toBe(1);
    expect(em.closeLen).toBe(1);
    expect(em.contentStart).toBe(1);
    expect(em.contentEnd).toBe(8);
    const strong = em.children?.find((c) => c.type === 'strong');
    expect(strong).toBeDefined();
    expect(strong?.start).toBe(1);
    expect(strong?.end).toBe(8);
    expect(strong?.openLen).toBe(2);
    expect(strong?.closeLen).toBe(2);
    expect(strong?.contentStart).toBe(3);
    expect(strong?.contentEnd).toBe(6);
  });

  it('`___abc___` 同样解析为 em 内嵌 strong', () => {
    const tokens = tokenizeInline('___abc___');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('em');
    expect(tokens[0].children?.find((c) => c.type === 'strong')).toBeDefined();
  });

  it('四连星 `****abc****` 仅识别中间 `**abc**` 为 strong（不产生三连叠加误判）', () => {
    const tokens = tokenizeInline('****abc****');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('strong');
    expect(tokens[0].start).toBe(2);
    expect(tokens[0].end).toBe(9);
    expect(tokens[0].contentStart).toBe(4);
    expect(tokens[0].contentEnd).toBe(7);
  });

  it('`***abc***` 全选：bold 命中内层 strong、italic 命中外层 em', () => {
    expect(findIntersectingStyleToken('***abc***', 'bold', 0, 9)?.type).toBe('strong');
    expect(findIntersectingStyleToken('***abc***', 'italic', 0, 9)?.type).toBe('em');
    expect(findIntersectingStyleToken('***abc***', 'bold', 0, 9)?.start).toBe(1);
    expect(findIntersectingStyleToken('***abc***', 'italic', 0, 9)?.start).toBe(0);
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

describe('inlineLexer — 图片空 href（K1 edit-image-insert-marktext）', () => {
  it('`![]()` 解析为 image token（href=空串）', () => {
    const tokens = tokenizeInline('![]()');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('image');
    expect(tokens[0].isImage).toBe(true);
    expect(tokens[0].href).toBe('');
    expect(tokens[0].start).toBe(0);
    expect(tokens[0].end).toBe(5);
    expect(tokens[0].contentStart).toBe(2);
    expect(tokens[0].contentEnd).toBe(2);
  });

  it('`![a]()` 解析为 image token（空 href 放行，alt 保留）', () => {
    const tokens = tokenizeInline('![a]()');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('image');
    expect(tokens[0].isImage).toBe(true);
    expect(tokens[0].href).toBe('');
    expect(tokens[0].contentStart).toBe(2);
    expect(tokens[0].contentEnd).toBe(3);
  });

  it('`[a]()` 空 href 的 link 不产生 token（仅 image 放行）', () => {
    expect(tokenizeInline('[a]()')).toEqual([]);
  });

  it('图片非空 href 仍走 safeUrl 白名单（危险协议仍拒）', () => {
    expect(tokenizeInline('![a](javascript:alert(1))')).toEqual([]);
    expect(tokenizeInline('![a](data:text/html,x)')).toEqual([]);
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

describe('inlineLexer — STYLE_TOKEN_TYPE 映射', () => {
  it('bold↔strong / italic↔em / strike↔del / highlight↔mark / code↔code / underline↔underline / math↔math', async () => {
    const { STYLE_TOKEN_TYPE } = await import( '@render/editor/kernel/inlineLexer'
    );
    expect(STYLE_TOKEN_TYPE).toEqual({
      bold: 'strong',
      italic: 'em',
      strike: 'del',
      highlight: 'mark',
      code: 'code',
      underline: 'underline',
      math: 'math',
    });
  });
});

describe('inlineLexer — findIntersectingStyleToken', () => {
  it('`**123**` 选区 `[2,7)` 命中 strong（含部分 close 标记）', () => {
    const t = findIntersectingStyleToken('**123**', 'bold', 2, 7);
    expect(t).not.toBeNull();
    expect(t?.type).toBe('strong');
    expect(t?.start).toBe(0);
    expect(t?.end).toBe(7);
    expect(t?.contentStart).toBe(2);
    expect(t?.contentEnd).toBe(5);
  });

  it('`**123**` 选区 `[0,5)` 命中 strong（含部分 open 标记）', () => {
    const t = findIntersectingStyleToken('**123**', 'bold', 0, 5);
    expect(t?.type).toBe('strong');
    expect(t?.start).toBe(0);
    expect(t?.end).toBe(7);
  });

  it('`**123**` 选区 `[0,7)` 命中 strong（完整 token）', () => {
    const t = findIntersectingStyleToken('**123**', 'bold', 0, 7);
    expect(t?.type).toBe('strong');
  });

  it('`**123**` 选区 `[2,5)` 命中 strong（内容区）', () => {
    const t = findIntersectingStyleToken('**123**', 'bold', 2, 5);
    expect(t?.type).toBe('strong');
  });

  it('普通文本无相交返回 null', () => {
    expect(findIntersectingStyleToken('123', 'bold', 0, 3)).toBeNull();
  });

  it('`a **b** c` 选区 `[4,9)`（跨 token）仍命中相交的 strong', () => {
    const t = findIntersectingStyleToken('a **b** c', 'bold', 4, 9);
    expect(t?.type).toBe('strong');
    expect(t?.start).toBe(2);
    expect(t?.end).toBe(7);
  });

  it('各成对样式映射命中', () => {
    expect(findIntersectingStyleToken('*i*', 'italic', 1, 3)?.type).toBe('em');
    expect(findIntersectingStyleToken('~~s~~', 'strike', 2, 4)?.type).toBe('del');
    expect(findIntersectingStyleToken('==h==', 'highlight', 2, 4)?.type).toBe('mark');
    expect(findIntersectingStyleToken('`c`', 'code', 1, 3)?.type).toBe('code');
    expect(findIntersectingStyleToken('<u>x</u>', 'underline', 3, 7)?.type).toBe('underline');
    expect(findIntersectingStyleToken('$x$', 'math', 1, 3)?.type).toBe('math');
  });

  it('children 递归命中（绝对偏移）：`<u>**b**</u>` 选区 `[4,9)` → strong', () => {
    const t = findIntersectingStyleToken('<u>**b**</u>', 'bold', 4, 9);
    expect(t?.type).toBe('strong');
    expect(t?.start).toBe(3);
    expect(t?.end).toBe(8);
    expect(t?.contentStart).toBe(5);
    expect(t?.contentEnd).toBe(6);
  });

  it('返回文档序第一个相交 token（嵌套同风格选外层）', () => {
    const t = findIntersectingStyleToken('**a *b* c**', 'bold', 4, 7);
    expect(t?.type).toBe('strong');
    expect(t?.start).toBe(0);
    expect(t?.end).toBe(11);
  });

  it('链接/图片（无开闭标记）不命中', () => {
    expect(findIntersectingStyleToken('[l](https://x.com)', 'bold', 1, 2)).toBeNull();
  });
});

describe('inlineLexer — findIntersectingStyleTokens（复数，C10 逐 token）', () => {
  it('`a **b** c **d** e` 选区 `[4,13)` 命中两个 strong token', () => {
    const tokens = findIntersectingStyleTokens('a **b** c **d** e', 'bold', 4, 13);
    expect(tokens.map((t) => [t.start, t.end])).toEqual([
      [2, 7],
      [10, 15],
    ]);
  });

  it('选区只跨一个 token 时返回单个', () => {
    const tokens = findIntersectingStyleTokens('a **b** c', 'bold', 4, 9);
    expect(tokens.map((t) => [t.start, t.end])).toEqual([[2, 7]]);
  });

  it('无相交返回空数组', () => {
    expect(findIntersectingStyleTokens('123', 'bold', 0, 3)).toEqual([]);
  });

  it('普通文本含孤立标记（不成对）不命中', () => {
    expect(findIntersectingStyleTokens('a**b', 'bold', 0, 4)).toEqual([]);
  });
});

describe('inlineLexer — 相邻混合强调（PLAN-EDIT-FT4）', () => {
  it('`**12*3***` 解析为 strong 内嵌 em（close run 拆分）', () => {
    const tokens = tokenizeInline('**12*3***');
    expect(tokens).toHaveLength(1);
    const strong = tokens[0];
    expect(strong.type).toBe('strong');
    expect(strong.start).toBe(0);
    expect(strong.end).toBe(9);
    expect(strong.openLen).toBe(2);
    expect(strong.closeLen).toBe(2);
    expect(strong.contentStart).toBe(2);
    expect(strong.contentEnd).toBe(7);
    const em = strong.children?.find((c) => c.type === 'em');
    expect(em).toBeDefined();
    expect(em?.start).toBe(4);
    expect(em?.end).toBe(7);
    expect(em?.contentStart).toBe(5);
    expect(em?.contentEnd).toBe(6);
  });

  it('`**加*粗***` 中文相邻混合强调无字面残体', () => {
    const tokens = tokenizeInline('**加*粗***');
    expect(tokens).toHaveLength(1);
    const strong = tokens[0];
    expect(strong.type).toBe('strong');
    const em = strong.children?.find((c) => c.type === 'em');
    expect(em).toBeDefined();
    expect(em?.contentStart).toBe(4);
    expect(em?.contentEnd).toBe(5);
  });

  it('`__12_3___` 下划线相邻混合：不抛错且识别出 strong', () => {
    const tokens = tokenizeInline('__12_3___');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].type).toBe('strong');
    expect(tokens[0].contentEnd).toBeLessThanOrEqual(7);
  });

  it('`***12*3**` 解析为 strong 内嵌 em（open 三连拆分，与 close run 拆分对称）', () => {
    const tokens = tokenizeInline('***12*3**');
    expect(tokens).toHaveLength(1);
    const strong = tokens[0];
    expect(strong.type).toBe('strong');
    expect(strong.start).toBe(0);
    expect(strong.end).toBe(9);
    expect(strong.openLen).toBe(2);
    expect(strong.closeLen).toBe(2);
    expect(strong.contentStart).toBe(3);
    expect(strong.contentEnd).toBe(7);
    const em = strong.children?.find((c) => c.type === 'em');
    expect(em).toBeDefined();
    expect(em?.start).toBe(2);
    expect(em?.end).toBe(6);
    expect(em?.contentStart).toBe(3);
    expect(em?.contentEnd).toBe(5);
  });

  it('`***a*b**` 同样识别为 strong 内嵌 em（open 三连拆分）', () => {
    const tokens = tokenizeInline('***a*b**');
    expect(tokens).toHaveLength(1);
    const strong = tokens[0];
    expect(strong.type).toBe('strong');
    expect(strong.contentStart).toBe(3);
    expect(strong.contentEnd).toBe(6);
    const em = strong.children?.find((c) => c.type === 'em');
    expect(em).toBeDefined();
    expect(em?.contentStart).toBe(3);
    expect(em?.contentEnd).toBe(4);
  });

  it('两两风格嵌套组合可识别（bold+strike / highlight+bold / bold+math / underline+italic）', () => {
    expect(tokenizeInline('**~~x~~**')[0]?.children?.find((c) => c.type === 'del')).toBeDefined();
    expect(tokenizeInline('==**x**==')[0]?.children?.find((c) => c.type === 'strong')).toBeDefined();
    expect(tokenizeInline('**$x$**')[0]?.children?.find((c) => c.type === 'math')).toBeDefined();
    expect(tokenizeInline('<u>*x*</u>')[0]?.children?.find((c) => c.type === 'em')).toBeDefined();
  });

  it('未闭合/孤立标记保守回退不抛错', () => {
    expect(() => tokenizeInline('**x')).not.toThrow();
    expect(tokenizeInline('**x')).toEqual([]);
    expect(tokenizeInline('a**b')).toEqual([]);
    expect(tokenizeInline('***x')).toEqual([]);
    expect(() => tokenizeInline('a * b')).not.toThrow();
  });
});

describe('inlineLexer — open 三连拆分剩余区递归（fix-inline-marker-remainder）', () => {
  it('A1 旗舰：`***12*<u>3</u>**` 解析为 strong 内嵌 [em, underline]', () => {
    const tokens = simplify(tokenizeInline('***12*<u>3</u>**'));
    expect(tokens).toEqual([
      {
        type: 'strong',
        start: 0,
        end: 16,
        openLen: 2,
        closeLen: 2,
        contentStart: 3,
        contentEnd: 14,
        children: [
          {
            type: 'em',
            start: 2,
            end: 6,
            openLen: 1,
            closeLen: 1,
            contentStart: 3,
            contentEnd: 5,
            children: [],
          },
          {
            type: 'underline',
            start: 6,
            end: 14,
            openLen: 3,
            closeLen: 4,
            contentStart: 9,
            contentEnd: 10,
            children: [],
          },
        ],
      },
    ]);
    const strong = tokenizeInline('***12*<u>3</u>**')[0];
    expect(strong.children?.map((c) => c.type)).toEqual(['em', 'underline']);
  });

  it('A2 护栏：`***12*3**` 剩余区纯文本，children 仍仅 em', () => {
    const strong = tokenizeInline('***12*3**')[0];
    expect(strong.type).toBe('strong');
    expect(strong.children?.map((c) => c.type)).toEqual(['em']);
  });

  it('A3 护栏：`***12*34**` 剩余区纯文本，children 仍仅 em', () => {
    const strong = tokenizeInline('***12*34**')[0];
    expect(strong.type).toBe('strong');
    expect(strong.children?.map((c) => c.type)).toEqual(['em']);
  });

  it('A4 五种成对标记在剩余区逐一识别（del/mark/underline/code/math）', () => {
    const cases: Array<[string, string, number, number, number]> = [
      ['***12*~~3~~**', 'del', 6, 8, 9],
      ['***12*==3==**', 'mark', 6, 8, 9],
      ['***12*<u>3</u>**', 'underline', 6, 9, 10],
      ['***12*`3`**', 'code', 6, 7, 8],
      ['***12*$3$**', 'math', 6, 7, 8],
    ];
    for (const [source, type, start, cs, ce] of cases) {
      const strong = tokenizeInline(source)[0];
      const child = strong.children?.find((c) => c.type === type);
      expect(child, source).toBeDefined();
      expect(child?.start).toBe(start);
      expect(child?.contentStart).toBe(cs);
      expect(child?.contentEnd).toBe(ce);
    }
  });

  it('A5 嵌套：`***12*~~<u>3</u>~~**` del 内嵌 underline', () => {
    const strong = tokenizeInline('***12*~~<u>3</u>~~**')[0];
    expect(strong.children?.map((c) => c.type)).toEqual(['em', 'del']);
    const del = strong.children?.find((c) => c.type === 'del');
    expect(del).toBeDefined();
    const underline = del?.children?.find((c) => c.type === 'underline');
    expect(underline).toBeDefined();
    expect(underline?.start).toBe(8);
    expect(underline?.contentStart).toBe(11);
    expect(underline?.contentEnd).toBe(12);
  });
});

describe('inlineLexer — safeUrl 裸域名放行（editor-link-image-fix B1）', () => {
  it('放行无协议裸域名（至少一个点）', () => {
    expect(safeUrl('www.baidu.com')).toBe('www.baidu.com');
    expect(safeUrl('baidu.com:8080/x')).toBe('baidu.com:8080/x');
    expect(safeUrl('example.com/a#b')).toBe('example.com/a#b');
    expect(safeUrl('a.io')).toBe('a.io');
  });

  it('拒绝非域名 href', () => {
    // 无点 → 不算域名
    expect(safeUrl('localhost')).toBeNull();
    // 危险协议（BARE_DOMAIN_RE 首字符要求 [a-z0-9]，不以 a 开头即不匹配）
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('vbscript:evil')).toBeNull();
  });

  it('既有放行不回归：协议 / 根路径 / Windows 路径 / UNC', () => {
    expect(safeUrl('https://x.com')).toBe('https://x.com');
    expect(safeUrl('/p')).toBe('/p');
    expect(safeUrl(String.raw`\\server\share\x`)).toBe(String.raw`\\server\share\x`);
    expect(safeUrl(String.raw`C:\a.png`)).toBe(String.raw`C:\a.png`);
  });
});

describe('inlineLexer — LRU 缓存', () => {
  beforeEach(() => {
    clearInlineCache();
  });

  it('相同参数二次调用返回相同结果（缓存命中）', () => {
    const text = '**bold** and *italic*';
    const first = tokenizeInline(text);
    const second = tokenizeInline(text);
    expect(second).toEqual(first);
    // 同一引用（缓存直接返回）
    expect(second).toBe(first);
  });

  it('不同 text 参数产生不同结果', () => {
    const a = tokenizeInline('**a**');
    const b = tokenizeInline('**b**');
    expect(a[0].contentStart).toBe(2);
    expect(b[0].contentStart).toBe(2);
    expect(a).not.toBe(b);
  });

  it('不同 start/end 区间产生不同缓存条目', () => {
    const text = 'xx**bold**yy';
    const full = tokenizeInline(text, 0, text.length);
    const sub = tokenizeInline(text, 2, 10);
    expect(full).toHaveLength(1);
    expect(sub).toHaveLength(1);
    expect(full).not.toBe(sub);
  });

  it('clearInlineCache 清除后重新计算', () => {
    const text = '**test**';
    const first = tokenizeInline(text);
    clearInlineCache();
    const second = tokenizeInline(text);
    expect(second).toEqual(first);
    // 清除后不是同一引用
    expect(second).not.toBe(first);
  });

  it('缓存容量溢出时淘汰最旧条目', () => {
    // 填满 256 条
    for (let i = 0; i < 256; i++) {
      tokenizeInline(`**item-${i}**`);
    }
    // 再加一条触发淘汰
    tokenizeInline('**overflow**');
    // 第一条（item-0）应被淘汰，重新计算
    const result = tokenizeInline('**item-0**');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('strong');
  });
});

describe('inlineLexer — normalizeHref（editor-link-image-fix B1）', () => {
  it('无协议裸域名补 https:// 前缀', () => {
    expect(normalizeHref('www.baidu.com')).toBe('https://www.baidu.com');
    expect(normalizeHref('baidu.com:8080/x')).toBe('https://baidu.com:8080/x');
  });

  it('已有协议原样返回', () => {
    expect(normalizeHref('https://x.com')).toBe('https://x.com');
    expect(normalizeHref('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(normalizeHref('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  it('相对路径 / 锚点 / Windows 路径原样返回', () => {
    expect(normalizeHref('/p')).toBe('/p');
    expect(normalizeHref('./x')).toBe('./x');
    expect(normalizeHref('../y')).toBe('../y');
    expect(normalizeHref('#anchor')).toBe('#anchor');
    expect(normalizeHref(String.raw`C:\a.png`)).toBe(String.raw`C:\a.png`);
    expect(normalizeHref(String.raw`\\server\share\a.png`)).toBe(String.raw`\\server\share\a.png`);
  });

  it('空串返回空', () => {
    expect(normalizeHref('')).toBe('');
    expect(normalizeHref('   ')).toBe('');
  });
});

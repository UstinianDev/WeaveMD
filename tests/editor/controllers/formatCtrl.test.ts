import { describe, expect, it } from 'vitest';

import { EditorInstance } from '../../../src/render/editor/editorInstance';
import { formatCtrl } from '../../../src/render/editor/controllers';
import { renderInline } from '../../../src/render/editor/kernel/inlineRenderer';
import { stripSameStylePairs, stripInlineSyntax } from '../../../src/render/editor/kernel';

function paragraphId(instance: EditorInstance): string {
  const id = Object.keys(instance.tree.blocks).find(
    (bid) => instance.tree.blocks[bid].type === 'paragraph'
  );
  if (!id) throw new Error('no paragraph block');
  return id;
}

function apply(
  instance: EditorInstance,
  style: Parameters<typeof formatCtrl.formatRange>[2],
  start: number,
  end: number,
  options: { url?: string; restoreSelection?: boolean } = {}
): void {
  formatCtrl.formatRange(instance, paragraphId(instance), style, start, end, options);
}

function applyResult(
  instance: EditorInstance,
  style: Parameters<typeof formatCtrl.formatRange>[2],
  start: number,
  end: number,
  options: { url?: string; restoreSelection?: boolean } = {}
): ReturnType<typeof formatCtrl.formatRange> {
  return formatCtrl.formatRange(instance, paragraphId(instance), style, start, end, options);
}

describe('formatCtrl — Toggle-off（Step 1）', () => {
  it('已包裹内选区解除（形态 A：标记在选区外）', () => {
    const instance = new EditorInstance('**a**');
    apply(instance, 'bold', 2, 3);
    expect(instance.getMarkdown()).toBe('a');
  });

  it('全选包裹区解除（形态 B：选区自身含完整包裹标记）', () => {
    const instance = new EditorInstance('**a**');
    apply(instance, 'bold', 0, 5);
    expect(instance.getMarkdown()).toBe('a');
  });

  it('连续两次应用恢复原文，不产生双层标记', () => {
    const instance = new EditorInstance('**a**');
    apply(instance, 'bold', 0, 5);
    expect(instance.getMarkdown()).toBe('a');
    apply(instance, 'bold', 0, 1);
    expect(instance.getMarkdown()).toBe('**a**');
    expect(instance.getMarkdown()).not.toContain('****');
  });

  it('italic 不误判 bold 边界（不可延伸规则）', () => {
    const instance = new EditorInstance('**a**');
    // italic 选区在 bold 内部：boundary 可延伸 → 不解除，走 Toggle-on → 嵌套
    apply(instance, 'italic', 2, 3);
    expect(instance.getMarkdown()).toBe('***a***');
  });

  it('highlight 全选解除', () => {
    const instance = new EditorInstance('==a==');
    apply(instance, 'highlight', 0, 5);
    expect(instance.getMarkdown()).toBe('a');
  });

  it('code 内选区解除', () => {
    const instance = new EditorInstance('`a`');
    apply(instance, 'code', 0, 3);
    expect(instance.getMarkdown()).toBe('a');
  });
});

describe('formatCtrl — Toggle-on（Step 2）与光标', () => {
  it('无格式选区应用包裹', () => {
    const instance = new EditorInstance('hello world');
    const result = formatCtrl.formatRange(instance, paragraphId(instance), 'bold', 0, 5);
    expect(instance.getMarkdown()).toBe('**hello** world');
    expect(result?.focus?.offset).toBe(9);
  });

  it('折叠光标插入标记间（现状语义保持）', () => {
    const instance = new EditorInstance('abc');
    apply(instance, 'italic', 1, 1);
    expect(instance.getMarkdown()).toBe('a**bc');
  });

  it('F11 存量变更：选区覆盖完整 token 及部分标记 → 解除为 `a already c`', () => {
    const instance = new EditorInstance('a **already** c');
    apply(instance, 'bold', 2, 13);
    expect(instance.getMarkdown()).toBe('a already c');
  });

  it('underline 选区包裹', () => {
    const instance = new EditorInstance('ab');
    apply(instance, 'underline', 0, 2);
    expect(instance.getMarkdown()).toBe('<u>ab</u>');
  });

  it('underline 折叠光标插入 <u></u>', () => {
    const instance = new EditorInstance('ab');
    apply(instance, 'underline', 1, 1);
    expect(instance.getMarkdown()).toBe('a<u></u>b');
  });

  it('math 选区包裹', () => {
    const instance = new EditorInstance('x');
    apply(instance, 'math', 0, 1);
    expect(instance.getMarkdown()).toBe('$x$');
  });

  it('math 折叠光标插入 $$', () => {
    const instance = new EditorInstance('ab');
    apply(instance, 'math', 1, 1);
    expect(instance.getMarkdown()).toBe('a$$b');
  });

  it('link 现状不回归', () => {
    const instance = new EditorInstance('ab');
    const result = formatCtrl.formatRange(
      instance,
      paragraphId(instance),
      'link',
      0,
      2,
      { url: 'u' }
    );
    expect(instance.getMarkdown()).toBe('[ab](u)');
    expect(result?.focus?.offset).toBe(7);
  });

  it('image 选区非空：alt=选中文本', () => {
    const instance = new EditorInstance('hello');
    const result = formatCtrl.formatRange(
      instance,
      paragraphId(instance),
      'image',
      0,
      5,
      { url: 'a.png' }
    );
    expect(instance.getMarkdown()).toBe('![hello](a.png)');
    expect(result?.focus?.offset).toBe(15);
  });

  it('image 折叠光标：默认占位 + 光标置 url 末尾', () => {
    const instance = new EditorInstance('');
    const result = formatCtrl.formatRange(
      instance,
      paragraphId(instance),
      'image',
      0,
      0,
      { url: 'a.png' }
    );
    expect(instance.getMarkdown()).toBe('![图片](a.png)');
    expect(result?.focus?.offset).toBe(12);
  });

  it('边界 clamp 不越界', () => {
    const instance = new EditorInstance('abc');
    expect(() => formatCtrl.formatRange(instance, paragraphId(instance), 'bold', -5, 99)).not.toThrow();
  });
});

describe('formatCtrl — clearFormat（橡皮擦）', () => {
  it('清除选区全部行内标记为纯文本', () => {
    const instance = new EditorInstance('**bold** and *italic*');
    formatCtrl.clearFormat(instance, paragraphId(instance), 0, 20);
    expect(instance.getMarkdown()).toBe('bold and italic');
  });

  it('折叠选区返回 null（no-op）', () => {
    const instance = new EditorInstance('abc');
    const result = formatCtrl.clearFormat(instance, paragraphId(instance), 1, 1);
    expect(result).toBeNull();
  });
});

describe('formatCtrl — Step 0 选区归一化（FT3 §4.1 G1）', () => {
  it('`**123**` 选区 `[2,7)`（含部分 close 标记）→ 解除为 123', () => {
    const instance = new EditorInstance('**123**');
    apply(instance, 'bold', 2, 7);
    expect(instance.getMarkdown()).toBe('123');
  });

  it('`**123**` 选区 `[0,5)`（含部分 open 标记）→ 解除为 123', () => {
    const instance = new EditorInstance('**123**');
    apply(instance, 'bold', 0, 5);
    expect(instance.getMarkdown()).toBe('123');
  });

  it('`**123**` 选区 `[0,7)`（完整 token）→ 解除为 123', () => {
    const instance = new EditorInstance('**123**');
    apply(instance, 'bold', 0, 7);
    expect(instance.getMarkdown()).toBe('123');
  });

  it('`**123**` 选区 `[2,5)`（内容区，形态 A）→ 解除为 123', () => {
    const instance = new EditorInstance('**123**');
    apply(instance, 'bold', 2, 5);
    expect(instance.getMarkdown()).toBe('123');
  });

  it('`123` 全选 → 包裹为 **123**', () => {
    const instance = new EditorInstance('123');
    apply(instance, 'bold', 0, 3);
    expect(instance.getMarkdown()).toBe('**123**');
  });

  it('`a **b** c` 选区 `[4,9)`（跨 token 覆盖 close）→ 解除为 `a b c`', () => {
    const instance = new EditorInstance('a **b** c');
    apply(instance, 'bold', 4, 9);
    expect(instance.getMarkdown()).toBe('a b c');
  });

  it('各成对样式 case B：`*i*`/`~~s~~`/`==h==`/`` `c` ``/`<u>x</u>`/`$x$` 覆盖标记均解除', () => {
    const cases: Array<[string, Parameters<typeof formatCtrl.formatRange>[2], number, number, string]> = [
      ['*i*', 'italic', 1, 3, 'i'],
      ['~~s~~', 'strike', 2, 4, 's'],
      ['==h==', 'highlight', 2, 4, 'h'],
      ['`c`', 'code', 1, 3, 'c'],
      ['<u>x</u>', 'underline', 3, 7, 'x'],
      ['$x$', 'math', 1, 3, 'x'],
    ];
    for (const [text, style, s, e, expected] of cases) {
      const instance = new EditorInstance(text);
      apply(instance, style, s, e);
      expect(instance.getMarkdown()).toBe(expected);
    }
  });

  it('italic 不误判 bold 边界（`**a**` 内选 `*` 区不解除）', () => {
    const instance = new EditorInstance('**a**');
    apply(instance, 'italic', 2, 3);
    expect(instance.getMarkdown()).toBe('***a***');
  });
});

describe('formatCtrl — C10 跨多 token 逐 token 拆分（FT3 §4.1 扩展）', () => {
  it('`a **b** c **d** e` 选区覆盖两个 token 的边界标记 → 两 token 均解除为 `a b c d e`', () => {
    const instance = new EditorInstance('a **b** c **d** e');
    apply(instance, 'bold', 4, 13);
    expect(instance.getMarkdown()).toBe('a b c d e');
  });

  it('选区从 token1 内容区跨到 token2 open 标记 → 两 token 均解除', () => {
    const instance = new EditorInstance('a **b** c **d** e');
    apply(instance, 'bold', 4, 12);
    expect(instance.getMarkdown()).toBe('a b c d e');
  });

  it('跨多 token 高亮（`==b==`）同样逐 token 解除', () => {
    const instance = new EditorInstance('a ==b== c ==d== e');
    apply(instance, 'highlight', 2, 11);
    expect(instance.getMarkdown()).toBe('a b c d e');
  });

  it('选区跨 token 但只触 open 侧标记（从 close 内部到 token 外）→ 解除该 token', () => {
    const instance = new EditorInstance('a **b** c');
    apply(instance, 'bold', 3, 9);
    expect(instance.getMarkdown()).toBe('a b c');
  });

  it('case A 补全：`**abc**` 选区 `[2,4)`（内容区内部分选区）→ 解除为 `abc`，绝不产生 `****`', () => {
    const instance = new EditorInstance('**abc**');
    apply(instance, 'bold', 2, 4);
    expect(instance.getMarkdown()).toBe('abc');
    expect(instance.getMarkdown()).not.toContain('****');
  });

  it('selection 契约：跨多 token 解除返回映射到 content 区间', () => {
    const instance = new EditorInstance('a **b** c **d** e');
    const result = applyResult(instance, 'bold', 4, 13, { restoreSelection: true });
    expect(instance.getMarkdown()).toBe('a b c d e');
    expect(result?.selection).toMatchObject({ start: 2, end: 7 });
  });

  it('跨 token 解除后不产生双层标记（`****` 不出现）', () => {
    const instance = new EditorInstance('a **b** c');
    apply(instance, 'bold', 4, 9);
    expect(instance.getMarkdown()).not.toContain('****');
  });
});

describe('formatCtrl — 跨风格叠加（bold+italic `***`，C11）', () => {
  it('`**a**` 全选点 italic → `***a***` 且无 `****`', () => {
    const instance = new EditorInstance('**a**');
    apply(instance, 'italic', 0, 5);
    expect(instance.getMarkdown()).toBe('***a***');
    expect(instance.getMarkdown()).not.toContain('****');
  });

  it('`*a*` 全选点 bold → `***a***` 且无 `****`', () => {
    const instance = new EditorInstance('*a*');
    apply(instance, 'bold', 0, 3);
    expect(instance.getMarkdown()).toBe('***a***');
    expect(instance.getMarkdown()).not.toContain('****');
  });

  it('`***a***` 全选点 bold → 解除为 `*a*`', () => {
    const instance = new EditorInstance('***a***');
    apply(instance, 'bold', 0, 7);
    expect(instance.getMarkdown()).toBe('*a*');
  });

  it('`***a***` 全选点 italic → 解除为 `**a**`', () => {
    const instance = new EditorInstance('***a***');
    apply(instance, 'italic', 0, 7);
    expect(instance.getMarkdown()).toBe('**a**');
  });

  it('`***a***` 选内容 `a` 点 italic（case A）→ 解除为 `**a**`', () => {
    const instance = new EditorInstance('***a***');
    apply(instance, 'italic', 3, 4);
    expect(instance.getMarkdown()).toBe('**a**');
  });

  it('`***a***` 选内容 `a` 点 bold（case A）→ 解除为 `*a*`', () => {
    const instance = new EditorInstance('***a***');
    apply(instance, 'bold', 3, 4);
    expect(instance.getMarkdown()).toBe('*a*');
  });

  it('stripSameStylePairs：`***a***` 去 italic → `**a**`、去 bold → `*a*`', () => {
    expect(stripSameStylePairs('***a***', 'italic')).toBe('**a**');
    expect(stripSameStylePairs('***a***', 'bold')).toBe('*a*');
  });

  it('`**123**` 选内容前部 `12` 点 italic → `***12*3**`（open 三连拆分产物）', () => {
    const instance = new EditorInstance('**123**');
    apply(instance, 'italic', 2, 4);
    expect(instance.getMarkdown()).toBe('***12*3**');
  });

  it('`***12*3**` 再选斜体内容 `12` 点 italic → 回退 `**123**`', () => {
    const instance = new EditorInstance('***12*3**');
    apply(instance, 'italic', 3, 5);
    expect(instance.getMarkdown()).toBe('**123**');
  });

  it('stripInlineSyntax：橡皮擦 `***a***` 全区间 → `a`', () => {
    expect(stripInlineSyntax('***a***', 0, 7)).toBe('a');
  });
});

describe('formatCtrl — selection 契约（FT3 §4.3 G3 前半）', () => {
  it('case B 解除返回 selection 映射（content 区间）', () => {
    const instance = new EditorInstance('**123**');
    const result = applyResult(instance, 'bold', 2, 7, { restoreSelection: true });
    expect(instance.getMarkdown()).toBe('123');
    expect(result?.selection).toMatchObject({ start: 0, end: 3 });
    expect(result?.selection?.blockId).toBe(paragraphId(instance));
  });

  it('形态 A 解除返回 selection 映射', () => {
    const instance = new EditorInstance('**123**');
    const result = applyResult(instance, 'bold', 2, 5, { restoreSelection: true });
    expect(instance.getMarkdown()).toBe('123');
    expect(result?.selection).toMatchObject({ start: 0, end: 3 });
    expect(result?.selection?.blockId).toBe(paragraphId(instance));
  });

  it('Step 2 包裹返回 selection 映射（含 open 偏移）', () => {
    const instance = new EditorInstance('123');
    const result = applyResult(instance, 'bold', 0, 3, { restoreSelection: true });
    expect(instance.getMarkdown()).toBe('**123**');
    expect(result?.selection).toMatchObject({ start: 2, end: 5 });
    expect(result?.selection?.blockId).toBe(paragraphId(instance));
  });

  it('link 分支返回 selection 映射（内容区间）', () => {
    const instance = new EditorInstance('ab');
    const result = applyResult(instance, 'link', 0, 2, { url: 'u', restoreSelection: true });
    expect(instance.getMarkdown()).toBe('[ab](u)');
    expect(result?.selection).toMatchObject({ start: 1, end: 3 });
    expect(result?.selection?.blockId).toBe(paragraphId(instance));
  });

  it('restoreSelection 缺省 false 时不返回 selection，维持 focus（键盘路径折叠不变）', () => {
    const instance = new EditorInstance('**123**');
    const result = applyResult(instance, 'bold', 2, 7);
    expect(instance.getMarkdown()).toBe('123');
    expect(result?.selection).toBeUndefined();
    expect(result?.focus).toEqual({ blockId: paragraphId(instance), offset: 0 });
  });

  it('restoreSelection false 时包裹仍只返回 focus', () => {
    const instance = new EditorInstance('123');
    const result = applyResult(instance, 'bold', 0, 3);
    expect(instance.getMarkdown()).toBe('**123**');
    expect(result?.selection).toBeUndefined();
    expect(result?.focus).toEqual({ blockId: paragraphId(instance), offset: 7 });
  });

  it('clearFormat 返回 selection（content 区间映射）', () => {
    const instance = new EditorInstance('**bold** and *italic*');
    const result = formatCtrl.clearFormat(instance, paragraphId(instance), 0, 20);
    expect(instance.getMarkdown()).toBe('bold and italic');
    expect(result?.selection).toMatchObject({ start: 0, end: 15 });
    expect(result?.selection?.blockId).toBe(paragraphId(instance));
    expect(result?.selection?.blockId).toBe(paragraphId(instance));
  });
});

describe('stripSameStylePairs — 同风格标记对去重', () => {
  it('去重同风格完整成对标记', () => {
    expect(stripSameStylePairs('**already**', 'bold')).toBe('already');
  });

  it('区间内去重', () => {
    expect(stripSameStylePairs('a **b** c', 'bold')).toBe('a b c');
  });

  it('非目标风格保留', () => {
    expect(stripSameStylePairs('*i* **b**', 'bold')).toBe('*i* b');
  });

  it('underline 去重', () => {
    expect(stripSameStylePairs('a <u>b</u> c', 'underline')).toBe('a b c');
  });

  it('math 去重', () => {
    expect(stripSameStylePairs('a $b$ c', 'math')).toBe('a b c');
  });
});

describe('stripInlineSyntax — 橡皮擦区间清除', () => {
  it('全类行内标记混排清除', () => {
    expect(
      stripInlineSyntax('**b** *i* ~~s~~ ==h== `c` [l](https://x.com) $x$ <u>u</u>', 0, 53)
    ).toBe('b i s h c l x u');
  });

  it('图片保留 alt 文本', () => {
    expect(stripInlineSyntax('![alt](https://x.com/a.png)', 0, 26)).toBe('alt');
  });

  it('选区与 token 相交即整 token 剥离（无残体）', () => {
    // 选区 [2,5) 与 bold token [2,7) 相交 → 整 token 剥离，无残 `*`
    expect(stripInlineSyntax('a **b** c', 2, 5)).toBe('a b c');
  });

  it('区间外标记不动', () => {
    expect(stripInlineSyntax('**keep** x **gone**', 9, 17)).toBe('**keep** x gone');
  });
});

describe('formatCtrl — open 三连拆分剩余区叠加（fix-inline-marker-remainder）', () => {
  it('C1 对 `***12*3**` 的 `3` 点 underline → `***12*<u>3</u>**` 且渲染嵌套正确无字面', () => {
    const instance = new EditorInstance('***12*3**');
    apply(instance, 'underline', 6, 7);
    const markdown = instance.getMarkdown();
    expect(markdown).toBe('***12*<u>3</u>**');
    const html = renderInline(markdown);
    expect(html).toContain('<u>');
    expect(html).toContain('<em>');
    expect(html).not.toContain('&lt;u&gt;3&lt;/u&gt;');
  });

  it('C2 其余风格（strike/highlight/code/math）叠加文本级守卫', () => {
    const cases: Array<[Parameters<typeof formatCtrl.formatRange>[2], string]> = [
      ['strike', '***12*~~3~~**'],
      ['highlight', '***12*==3==**'],
      ['code', '***12*`3`**'],
      ['math', '***12*$3$**'],
    ];
    for (const [style, expected] of cases) {
      const instance = new EditorInstance('***12*3**');
      apply(instance, style, 6, 7);
      expect(instance.getMarkdown(), style).toBe(expected);
    }
  });

  it('C3 橡皮擦整块 clearFormat(0, 16) → `123`（剩余区标记一并清除）', () => {
    const instance = new EditorInstance('***12*<u>3</u>**');
    formatCtrl.clearFormat(instance, paragraphId(instance), 0, 16);
    expect(instance.getMarkdown()).toBe('123');
  });

  it('C4 区域清除 stripInlineSyntax(..., 9, 10) → `*12*3` 无 `<u>` 残留', () => {
    const stripped = stripInlineSyntax('***12*<u>3</u>**', 9, 10);
    expect(stripped).toBe('*12*3');
    expect(stripped).not.toContain('<u>');
  });
});

describe('formatCtrl — replaceImage（按区间替换图片）', () => {
  it('`![a]()` 命中 image token → `![a](u)`，focus 于 token 末', () => {
    const instance = new EditorInstance('![a]()');
    const result = formatCtrl.replaceImage(instance, paragraphId(instance), 0, 6, {
      src: 'u',
      alt: 'a',
    });
    expect(instance.getMarkdown()).toBe('![a](u)');
    expect(result?.changedBlockIds).toEqual([paragraphId(instance)]);
    expect(result?.focus).toEqual({ blockId: paragraphId(instance), offset: 7 });
  });

  it('传入区间无匹配 image token → 返回 null（不崩溃）', () => {
    const instance = new EditorInstance('abc');
    const result = formatCtrl.replaceImage(instance, paragraphId(instance), 0, 3, {
      src: 'u',
      alt: 'x',
    });
    expect(result).toBeNull();
    expect(instance.getMarkdown()).toBe('abc');
  });

  it('带 title → `![a](u "t")`，focus 于 token 末', () => {
    const instance = new EditorInstance('![a]()');
    const result = formatCtrl.replaceImage(instance, paragraphId(instance), 0, 6, {
      src: 'u',
      alt: 'a',
      title: 't',
    });
    expect(instance.getMarkdown()).toBe('![a](u "t")');
    expect(result?.focus).toEqual({ blockId: paragraphId(instance), offset: 11 });
  });
});
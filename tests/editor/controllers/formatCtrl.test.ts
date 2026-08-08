import { describe, expect, it } from 'vitest';

import { EditorInstance } from '../../../src/render/editor/editorInstance';
import { formatCtrl } from '../../../src/render/editor/controllers';
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
  options: { url?: string } = {}
): void {
  formatCtrl.formatRange(instance, paragraphId(instance), style, start, end, options);
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

  it('toggle-on 先清理同风格标记对（杜绝二层嵌套）', () => {
    // 选区自身含完整包裹标记但边界不可延伸时（如选中已包裹区再扩选），走 Step 2 去重
    const instance = new EditorInstance('a **already** c');
    apply(instance, 'bold', 2, 13);
    expect(instance.getMarkdown()).toBe('a **already** c');
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

import { describe, expect, it } from 'vitest';

import { EditorInstance } from '../../../src/render/editor/editorInstance';
import {
  alignImage,
  formatRange,
  insertImageFromSelection,
  makeImageInline,
  removeImage,
  unlinkRange,
} from '../../../src/render/editor/controllers/formatCtrl';
import type { InlineFormatStyle } from '../../../src/render/editor/controllers/formatCtrl';
import { renderInline } from '../../../src/render/editor/kernel/inlineRenderer';
import {
  appendChild,
  changeBlockType,
  makeParagraph,
  setBlockText,
} from '../../../src/render/editor/kernel';

function firstTextBlock(instance: EditorInstance) {
  const block = Object.values(instance.tree.blocks).find((b) => b.text !== null);
  if (!block) throw new Error('no text block');
  return block;
}

function applyFormat(
  source: string,
  style: InlineFormatStyle,
  start: number,
  end: number,
  url?: string
): string {
  const instance = new EditorInstance(source);
  const block = Object.values(instance.tree.blocks).find((b) => b.text !== null);
  if (!block) throw new Error('no text block');
  formatRange(instance, block.id, style, start, end, { restoreSelection: true, url });
  return instance.tree.blocks[block.id].text as string;
}

/** unlinkRange：返回新文本，无相交链接时返回 null（text 不变） */
function unlink(source: string, start: number, end: number): string | null {
  const instance = new EditorInstance(source);
  const block = Object.values(instance.tree.blocks).find((b) => b.text !== null);
  if (!block) throw new Error('no text block');
  const r = unlinkRange(instance, block.id, start, end);
  return r ? (instance.tree.blocks[block.id].text as string) : null;
}

describe('formatCtrl — 跨风格边界标记折叠（PLAN-EDIT-FT4 / AGT-B）', () => {
  it('R2b：选区含 bold close 标记，underline 不包入 `**`（`**ab**` 选 `b**` → `**a<u>b</u>**`）', () => {
    expect(applyFormat('**ab**', 'underline', 3, 6)).toBe('**a<u>b</u>**');
  });

  it('R2a 对照：同选区点 italic 保持 clean 包裹（`**a*b***`，bold 标记原位）', () => {
    expect(applyFormat('**ab**', 'italic', 3, 6)).toBe('**a*b***');
  });

  it('头部折叠：选区含 bold open 标记，underline 不包入 `**`（选 `**a` → `**<u>a</u>b**`）', () => {
    expect(applyFormat('**ab**', 'underline', 0, 3)).toBe('**<u>a</u>b**');
  });

  it('不破坏普通选区包裹（`ab` 选 `a` → `<u>a</u>b`）', () => {
    expect(applyFormat('ab', 'underline', 0, 1)).toBe('<u>a</u>b');
  });

  it('无配对 open 的尾部 `**` 为字面，不误剥离（`foo**` 选 `o**`）', () => {
    expect(applyFormat('foo**', 'underline', 2, 5)).toBe('fo<u>o**</u>');
  });

  it('选区中部嵌套他风格标记不被折叠（`**a~~b~~c**` 选内容 → 整段包入）', () => {
    expect(applyFormat('**a~~b~~c**', 'underline', 2, 9)).toBe('**<u>a~~b~~c</u>**');
  });
});

describe('formatCtrl — open 三连剩余区选边界叠加（fold 审查探针，fix-inline-marker-remainder）', () => {
  it('D1 italic(9,14)：`***12*<u>3</u>**` → `***12*<u>*3*</u>**`（close 折出）', () => {
    expect(applyFormat('***12*<u>3</u>**', 'italic', 9, 14)).toBe('***12*<u>*3*</u>**');
  });

  it('D2 italic(6,10)：`***12*<u>3</u>**` → `***12*<u>*3*</u>**`（open 折出）', () => {
    expect(applyFormat('***12*<u>3</u>**', 'italic', 6, 10)).toBe('***12*<u>*3*</u>**');
  });

  it('D3 strike(9,14)：`***12*<u>3</u>**` → `***12*<u>~~3~~</u>**`（close 折出）', () => {
    expect(applyFormat('***12*<u>3</u>**', 'strike', 9, 14)).toBe('***12*<u>~~3~~</u>**');
  });
});

describe('formatCtrl — 移除链接（unlinkRange）', () => {
  it('光标折叠在 label 内 → 链接还原为纯文本 label', () => {
    expect(unlink('[b](https://x.io)', 1, 1)).toBe('b');
  });

  it('选区完整覆盖链接 → 还原为 label', () => {
    expect(unlink('[hello](https://x.io)', 0, 19)).toBe('hello');
  });

  it('选区跨越链接前后文 → 仅链接部分还原', () => {
    expect(unlink('a [b](https://x.io) c', 2, 16)).toBe('a b c');
  });

  it('嵌套行内标记的 label 一并清除（`[*b*](u)` → `b`）', () => {
    expect(unlink('[*b*](https://x.io)', 1, 4)).toBe('b');
  });

  it('多个相交链接全部还原', () => {
    expect(unlink('[a](https://u1.io) [b](https://u2.io)', 0, 35)).toBe('a b');
  });

  it('选区在链接之外 → 返回 null 且文本不变', () => {
    const source = 'plain [b](u) text';
    expect(unlink(source, 0, 4)).toBeNull();
    expect(unlink(source, 13, 17)).toBeNull();
  });

  it('restoreSelection 语义：新文本中 label 区间保持可选中', () => {
    const instance = new EditorInstance('a [b](https://u.io) c');
    const block = Object.values(instance.tree.blocks).find((x) => x.text !== null)!;
    const r = unlinkRange(instance, block.id, 2, 9);
    expect(r?.selection).toEqual({ blockId: block.id, start: 2, end: 3 });
  });

  it('图片链接移除后保留图片（`[![a](img)](u)` → `![a](img)`）', () => {
    const src = `[![123](https://img.io/a.png)](https://baidu.com)`;
    expect(unlink(src, 0, src.length)).toBe(`![123](https://img.io/a.png)`);
  });
});

describe('formatCtrl — 图片上添加链接（link 包裹 image）', () => {
  const IMG = 'https://img.io/a.png';
  const src = `![123](${IMG})`;

  it('选区覆盖图片全部语法 → `[![alt](img)](url)`', () => {
    expect(applyFormat(src, 'link', 0, src.length, 'baidu.com')).toBe(
      `[![123](${IMG})](baidu.com)`
    );
  });

  it('选区落在图片 label 内（非源码模式典型选区）→ 扩展覆盖整个图片语法', () => {
    expect(applyFormat(src, 'link', 2, 5, 'baidu.com')).toBe(`[![123](${IMG})](baidu.com)`);
  });

  it('折叠光标落在图片范围内 → 扩展覆盖整个图片语法', () => {
    expect(applyFormat(src, 'link', 3, 3, 'baidu.com')).toBe(`[![123](${IMG})](baidu.com)`);
  });

  it('纯文本选区不受影响（不扩展，正常包 link）', () => {
    expect(applyFormat('plain text', 'link', 0, 5, 'baidu.com')).toBe(
      '[plain](baidu.com) text'
    );
  });

  it('渲染结果：link 包裹 image → 可点击图片', () => {
    const html = renderInline(`[![123](${IMG})](https://baidu.com)`);
    expect(html).toContain('<a class="inline-link" href="https://baidu.com"');
    expect(html).toContain('<img class="inline-image" src="https://img.io/a.png"');
  });

  it('image URL 含空格/中文 → 写入尖括号包裹（`![123](<...>)`）且可解析渲染', () => {
    const url = String.raw`C:\Users\me\My Folder\屏幕截图 2026-08-10 213142.png`;
    const applied = applyFormat('123', 'image', 0, 3, url);
    expect(applied).toBe(`![123](<${url}>)`);
    const html = renderInline(applied);
    expect(html).toContain('inline-image');
    expect(html).toContain(
      'src="media://C%3A/Users/me/My%20Folder/%E5%B1%8F%E5%B9%95%E6%88%AA%E5%9B%BE%202026-08-10%20213142.png"'
    );
  });

  it('link URL 含空格 → 同样尖括号包裹', () => {
    expect(applyFormat('x', 'link', 0, 1, 'https://a b.com')).toBe('[x](<https://a b.com>)');
  });
});

describe('formatCtrl — insertImageFromSelection（K3：图片直选插入）', () => {
  it('行内替换：`abc` 选 `b` → `a![b](src)c`，focus 于 token 末，块类型保持 paragraph', () => {
    const instance = new EditorInstance('abc');
    const block = firstTextBlock(instance);
    const fragment = '![b](C:/x/a%20b.png)';
    const r = insertImageFromSelection(instance, block.id, 1, 2, 'C:/x/a b.png');
    expect(instance.tree.blocks[block.id].text).toBe(`a${fragment}c`);
    expect(instance.tree.blocks[block.id].type).toBe('paragraph');
    expect(r?.focus).toEqual({ blockId: block.id, offset: 1 + fragment.length });
    expect(r?.changedBlockIds).toEqual([block.id]);
  });

  it('空选区 [1,1) → 插入 `![](src)`，focus 于 token 末', () => {
    const instance = new EditorInstance('abc');
    const block = firstTextBlock(instance);
    const fragment = '![](C:/x/a%20b.png)';
    const r = insertImageFromSelection(instance, block.id, 1, 1, 'C:/x/a b.png');
    expect(instance.tree.blocks[block.id].text).toBe(`a${fragment}bc`);
    expect(r?.focus).toEqual({ blockId: block.id, offset: 1 + fragment.length });
  });

  it('src 含括号 → 空格先转 %20，再以 `<...>` 兜底包裹', () => {
    const instance = new EditorInstance('abc');
    const block = firstTextBlock(instance);
    insertImageFromSelection(instance, block.id, 1, 2, 'C:/x/img (1).png');
    expect(instance.tree.blocks[block.id].text).toBe('a![b](<C:/x/img%20(1).png>)c');
  });

  it('整段替换 [0,len) → 转 image-block，focus 指向后续段落起点', () => {
    const instance = new EditorInstance('hello world\n\nnext');
    const first = Object.values(instance.tree.blocks).find(
      (b) => b.text === 'hello world'
    )!;
    const second = Object.values(instance.tree.blocks).find((b) => b.text === 'next')!;
    const r = insertImageFromSelection(
      instance,
      first.id,
      0,
      'hello world'.length,
      'C:/x/a b.png'
    );
    expect(instance.tree.blocks[first.id].text).toBe('![hello world](C:/x/a%20b.png)');
    expect(instance.tree.blocks[first.id].type).toBe('image-block');
    expect(r?.focus).toEqual({ blockId: second.id, offset: 0 });
  });

  it('整段替换且为最后一块 → 自动 append 空段落并 focus', () => {
    const instance = new EditorInstance('hello world');
    const block = firstTextBlock(instance);
    const r = insertImageFromSelection(
      instance,
      block.id,
      0,
      'hello world'.length,
      'C:/x/a b.png'
    );
    expect(instance.tree.blocks[block.id].type).toBe('image-block');
    const next = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'paragraph' && b.id !== block.id
    )!;
    expect(next.text).toBe('');
    expect(r?.focus).toEqual({ blockId: next.id, offset: 0 });
    expect(r?.changedBlockIds).toEqual([block.id, next.id]);
  });

  it('空文本块 → `![](src)` 独立成块并补空段落', () => {
    const instance = new EditorInstance('');
    const block = firstTextBlock(instance);
    const r = insertImageFromSelection(instance, block.id, 0, 0, 'C:/x/a b.png');
    expect(instance.tree.blocks[block.id].text).toBe('![](C:/x/a%20b.png)');
    expect(instance.tree.blocks[block.id].type).toBe('image-block');
    const next = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'paragraph' && b.id !== block.id
    )!;
    expect(next.text).toBe('');
    expect(r?.focus).toEqual({ blockId: next.id, offset: 0 });
  });
});

describe('formatCtrl — alignImage（K3：对齐包裹）', () => {
  it('image-block 已包裹 center → wrapImageAlign 换向 left，类型保持 image-block', () => {
    const instance = new EditorInstance('<div align="center">![a](C:/x.png)</div>');
    const block = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'image-block'
    )!;
    const r = alignImage(instance, block.id, 'left');
    expect(instance.tree.blocks[block.id].text).toBe('<div align="left">![a](C:/x.png)</div>');
    expect(instance.tree.blocks[block.id].type).toBe('image-block');
    expect(r?.changedBlockIds).toEqual([block.id]);
  });

  it('paragraph 独立图（text 恰为 `![a](C:/x.png)`）→ 转 image-block + `<div align="center">` 包裹', () => {
    const instance = new EditorInstance();
    const block = firstTextBlock(instance);
    instance.tree = setBlockText(instance.tree, block.id, '![a](C:/x.png)');
    const r = alignImage(instance, block.id, 'center');
    expect(instance.tree.blocks[block.id].type).toBe('image-block');
    expect(instance.tree.blocks[block.id].text).toBe(
      '<div align="center">![a](C:/x.png)</div>'
    );
    expect(r?.focus).toEqual({
      blockId: block.id,
      offset: '<div align="center">![a](C:/x.png)</div>'.length,
    });
  });

  it('paragraph 行内图（text `x ![a](C:/x.png) y`）→ 返回 null 且文本不变（工具栏置灰依据）', () => {
    const instance = new EditorInstance();
    const block = firstTextBlock(instance);
    instance.tree = setBlockText(instance.tree, block.id, 'x ![a](C:/x.png) y');
    const r = alignImage(instance, block.id, 'center');
    expect(r).toBeNull();
    expect(instance.tree.blocks[block.id].text).toBe('x ![a](C:/x.png) y');
    expect(instance.tree.blocks[block.id].type).toBe('paragraph');
  });
});

describe('formatCtrl — makeImageInline（K3：解除对齐包裹）', () => {
  it('image-block 带包裹 → unwrapImageAlign 转 paragraph，text 为内层原文，focus 于 token 末', () => {
    const instance = new EditorInstance('<div align="center">![a](C:/x.png)</div>');
    const block = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'image-block'
    )!;
    const r = makeImageInline(instance, block.id);
    expect(instance.tree.blocks[block.id].type).toBe('paragraph');
    expect(instance.tree.blocks[block.id].text).toBe('![a](C:/x.png)');
    expect(r?.focus).toEqual({ blockId: block.id, offset: '![a](C:/x.png)'.length });
    expect(r?.changedBlockIds).toEqual([block.id]);
  });

  it('image-block 裸图 → 转 paragraph，text 不变（unwrap 原样返回）', () => {
    const instance = new EditorInstance('![a](C:/x.png)');
    const block = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'image-block'
    )!;
    const r = makeImageInline(instance, block.id);
    expect(instance.tree.blocks[block.id].type).toBe('paragraph');
    expect(instance.tree.blocks[block.id].text).toBe('![a](C:/x.png)');
    expect(r?.focus).toEqual({ blockId: block.id, offset: '![a](C:/x.png)'.length });
  });

  it('paragraph → 返回 null 且文本不变', () => {
    const instance = new EditorInstance();
    const block = firstTextBlock(instance);
    instance.tree = setBlockText(instance.tree, block.id, 'x ![a](C:/x.png) y');
    const r = makeImageInline(instance, block.id);
    expect(r).toBeNull();
    expect(instance.tree.blocks[block.id].text).toBe('x ![a](C:/x.png) y');
    expect(instance.tree.blocks[block.id].type).toBe('paragraph');
  });
});

describe('formatCtrl — removeImage（K3：移除图片）', () => {
  it('行内图：删除 token 绝对区间 [1,15)，focus = start', () => {
    const instance = new EditorInstance();
    const block = firstTextBlock(instance);
    instance.tree = setBlockText(instance.tree, block.id, 'x![a](C:/x.png)y');
    const r = removeImage(instance, block.id, 1, 15);
    expect(instance.tree.blocks[block.id].text).toBe('xy');
    expect(r?.focus).toEqual({ blockId: block.id, offset: 1 });
    expect(r?.changedBlockIds).toEqual([block.id]);
  });

  it('行内图整行删除 → 块变空字符串（既有空块处理约定）', () => {
    const instance = new EditorInstance();
    const block = firstTextBlock(instance);
    instance.tree = setBlockText(instance.tree, block.id, '![a](C:/x.png)');
    const r = removeImage(instance, block.id, 0, 14);
    expect(instance.tree.blocks[block.id].text).toBe('');
    expect(r?.focus).toEqual({ blockId: block.id, offset: 0 });
  });

  it('image-block：整块删除，focus 后一相邻叶子（next 优先）', () => {
    const instance = new EditorInstance('![a](C:/x.png)\n\nnext');
    const img = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'image-block'
    )!;
    const next = Object.values(instance.tree.blocks).find((b) => b.text === 'next')!;
    const r = removeImage(instance, img.id, 0, 14);
    expect(instance.tree.blocks[img.id]).toBeUndefined();
    expect(r?.focus).toEqual({ blockId: next.id, offset: 0 });
    expect(instance.tree.blocks[next.id].text).toBe('next');
  });

  it('image-block：无后邻居 → focus 前一叶子末尾', () => {
    const instance = new EditorInstance('prev\n\n![a](C:/x.png)');
    const img = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'image-block'
    )!;
    const prev = Object.values(instance.tree.blocks).find((b) => b.text === 'prev')!;
    const r = removeImage(instance, img.id, 0, 14);
    expect(instance.tree.blocks[img.id]).toBeUndefined();
    expect(r?.focus).toEqual({ blockId: prev.id, offset: 4 });
  });

  it('image-block：删除后树只剩根 → 补空段落并 focus', () => {
    const instance = new EditorInstance('![a](C:/x.png)');
    const img = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'image-block'
    )!;
    const r = removeImage(instance, img.id, 0, 14);
    const leaves = Object.values(instance.tree.blocks).filter((b) => b.text !== null);
    expect(leaves.length).toBe(1);
    expect(leaves[0].type).toBe('paragraph');
    expect(leaves[0].text).toBe('');
    expect(r?.focus).toEqual({ blockId: leaves[0].id, offset: 0 });
    expect(r?.changedBlockIds).toEqual([img.id, leaves[0].id]);
  });

  it('Bug C：代码块 + image-block（markdown 解析产物）→ 移除图片 → 代码块后补回受保护空段并 focus（SPEC-EDIT-CBTP）', () => {
    // 复现根因：` ``` ` 后直接跟独立行图片，parse 得 [code-block, image-block]（无中间空段）。
    // 移除 image-block 时 adjacentLeafFocus('next') 无 next 回退 prev=code-block（非空），
    // 原逻辑因此跳过补空 → 代码块成为最后一块且无尾随空行（Bug C）。
    const instance = new EditorInstance('```js\ncode\n```\n\n![a](C:/x/a.png)');
    const img = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'image-block'
    )!;
    const r = removeImage(instance, img.id, 0, 100);
    expect(instance.tree.blocks[img.id]).toBeUndefined();
    const leaves = Object.values(instance.tree.blocks).filter((b) => b.text !== null);
    expect(leaves.length).toBe(2);
    expect(leaves[0].type).toBe('code-block');
    expect(leaves[1].type).toBe('paragraph');
    expect(leaves[1].text).toBe('');
    expect(r?.focus).toEqual({ blockId: leaves[1].id, offset: 0 });
    expect(r?.changedBlockIds).toEqual([img.id, leaves[1].id]);
  });

  it('Bug C：代码块 + 受保护空段 + image-block → 移除图片 → 保护空段保留、不追加重复空段', () => {
    // 编辑期结构 [code-block, paragraph(''), image-block]：删除末尾图片应保留既有保护空段。
    const instance = new EditorInstance('```js\ncode\n```');
    let tree = instance.tree;
    const p = makeParagraph(tree, '![b](C:/x/b.png)');
    tree = appendChild(tree, tree.root.id, p);
    tree = changeBlockType(tree, p.id, 'image-block');
    instance.tree = tree;
    const img = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'image-block'
    )!;
    removeImage(instance, img.id, 0, 100);
    const leaves = Object.values(instance.tree.blocks).filter((b) => b.text !== null);
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'paragraph']);
    expect(leaves[1].text).toBe('');
  });

  it('Bug C：代码块 + image-block + 文本 → 移除图片 → 不补空段（代码块非最后叶子，CBTP 不触发）', () => {
    const instance = new EditorInstance('```js\ncode\n```\n\n![a](C:/x/a.png)\n\n尾部文本');
    const img = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'image-block'
    )!;
    removeImage(instance, img.id, 0, 100);
    const leaves = Object.values(instance.tree.blocks).filter((b) => b.text !== null);
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'paragraph']);
    expect(leaves[1].text).toBe('尾部文本');
  });
});

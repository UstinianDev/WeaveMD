import { describe, expect, it } from 'vitest';

import { EditorInstance } from '../../../src/render/editor/editorInstance';
import { formatRange, unlinkRange } from '../../../src/render/editor/controllers/formatCtrl';
import type { InlineFormatStyle } from '../../../src/render/editor/controllers/formatCtrl';
import { renderInline } from '../../../src/render/editor/kernel/inlineRenderer';

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
    expect(html).toContain('file:///C:/Users/me/My Folder/屏幕截图 2026-08-10 213142.png');
  });

  it('link URL 含空格 → 同样尖括号包裹', () => {
    expect(applyFormat('x', 'link', 0, 1, 'https://a b.com')).toBe('[x](<https://a b.com>)');
  });
});

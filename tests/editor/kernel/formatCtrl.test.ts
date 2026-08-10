import { describe, expect, it } from 'vitest';

import { EditorInstance } from '../../../src/render/editor/editorInstance';
import { formatRange } from '../../../src/render/editor/controllers/formatCtrl';
import type { InlineFormatStyle } from '../../../src/render/editor/controllers/formatCtrl';

function applyFormat(source: string, style: InlineFormatStyle, start: number, end: number): string {
  const instance = new EditorInstance(source);
  const block = Object.values(instance.tree.blocks).find((b) => b.text !== null);
  if (!block) throw new Error('no text block');
  formatRange(instance, block.id, style, start, end, { restoreSelection: true });
  return instance.tree.blocks[block.id].text as string;
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

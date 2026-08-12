import { describe, expect, it } from 'vitest';

import { EditorInstance } from '@render/editor/editorInstance';
import { setImageWidth } from '@render/editor/controllers/imageWidthCtrl';

describe('imageWidthCtrl — setImageWidth（R1-KERNEL 独立图宽度提交）', () => {
  it('裸图 → 重写为 `<div align="left" style="width:Npx">…</div>`，changedBlockIds + focus 文本末', () => {
    const instance = new EditorInstance('![a](C:/x.png)');
    const img = Object.values(instance.tree.blocks).find((b) => b.type === 'image-block')!;
    const result = setImageWidth(instance, img.id, 400);
    const wrapped = '<div align="left" style="width:400px">![a](C:/x.png)</div>';
    expect(instance.tree.blocks[img.id].text).toBe(wrapped);
    expect(result?.changedBlockIds).toEqual([img.id]);
    expect(result?.focus).toEqual({ blockId: img.id, offset: wrapped.length });
  });

  it('已对齐的独立图 → 保留 align 仅插入 style，focus 文本末', () => {
    const instance = new EditorInstance('<div align="center">![a](C:/x.png)</div>');
    const img = Object.values(instance.tree.blocks).find((b) => b.type === 'image-block')!;
    const result = setImageWidth(instance, img.id, 300);
    const wrapped = '<div align="center" style="width:300px">![a](C:/x.png)</div>';
    expect(instance.tree.blocks[img.id].text).toBe(wrapped);
    expect(result?.changedBlockIds).toEqual([img.id]);
    expect(result?.focus).toEqual({ blockId: img.id, offset: wrapped.length });
  });

  it('width null → 剥 style，清宽度不崩溃，focus 文本末', () => {
    const instance = new EditorInstance('<div align="left" style="width:400px">![a](C:/x.png)</div>');
    const img = Object.values(instance.tree.blocks).find((b) => b.type === 'image-block')!;
    const result = setImageWidth(instance, img.id, null);
    const stripped = '<div align="left">![a](C:/x.png)</div>';
    expect(instance.tree.blocks[img.id].text).toBe(stripped);
    expect(result?.changedBlockIds).toEqual([img.id]);
    expect(result?.focus).toEqual({ blockId: img.id, offset: stripped.length });
  });

  it('不存在的块 / 非 image-block 块 → null，不改树', () => {
    const instance = new EditorInstance('![a](C:/x.png)');
    const badId = 'no-such-id';
    const before = instance.getMarkdown();
    expect(setImageWidth(instance, badId, 300)).toBeNull();
    // paragraph（尾随补偿空段）非 image-block → null，不改文本
    const para = Object.values(instance.tree.blocks).find((b) => b.type === 'paragraph');
    expect(para).toBeDefined();
    const paraText = para!.text;
    expect(setImageWidth(instance, para!.id, 300)).toBeNull();
    expect(para!.text).toBe(paraText);
    expect(instance.getMarkdown()).toBe(before);
  });

  it('行内图（非独立图段落）→ null（宽度不可持久）', () => {
    const instance = new EditorInstance('pre ![a](C:/x.png) post');
    expect(instance.getMarkdown()).toBe('pre ![a](C:/x.png) post');
    const id = Object.keys(instance.tree.blocks).find(
      (b) => instance.tree.blocks[b].type === 'paragraph'
    )!;
    const text = instance.tree.blocks[id].text;
    expect(setImageWidth(instance, id, 300)).toBeNull();
    expect(instance.tree.blocks[id].text).toBe(text);
  });

  it('非法 width（≤0/NaN）→ null（wrapImageWidth 拒绝）', () => {
    const instance = new EditorInstance('![a](C:/x.png)');
    const img = Object.values(instance.tree.blocks).find((b) => b.type === 'image-block')!;
    expect(setImageWidth(instance, img.id, 0)).toBeNull();
    expect(setImageWidth(instance, img.id, -1)).toBeNull();
    expect(setImageWidth(instance, img.id, NaN)).toBeNull();
    expect(instance.tree.blocks[img.id].text).toBe('![a](C:/x.png)');
  });
});

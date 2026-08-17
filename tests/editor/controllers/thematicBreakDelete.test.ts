import { describe, it, expect } from 'vitest';
import { EditorInstance } from '@render/editor/editorInstance';
import { handleBackspaceAtStart } from '@render/editor/controllers/backspaceCtrl';
import { inputCtrl, enterCtrl } from '@render/editor/controllers';

function paragraphId(instance: EditorInstance): string {
  const id = Object.keys(instance.tree.blocks).find(
    (bid) => instance.tree.blocks[bid].type === 'paragraph'
  );
  if (!id) throw new Error('no paragraph block');
  return id;
}

describe('thematic-break delete', () => {
  describe('空段落退格删 hr', () => {
    it('空段落前是 hr → 退格删除 hr，光标留段落', () => {
      // 构造：先输入文本并回车产生两段，第一段输入 --- 转 hr
      // 实际 markdown 为 '---\n\n\n' (hr + 空段落 + 空段落)
      const inst = new EditorInstance('a');
      const id = paragraphId(inst);
      // 回车产生第二段
      enterCtrl.handleEnter(inst, id, 1);
      // 第一段输入 --- 转 hr（第一段 id 仍有效）
      inputCtrl.handleInput(inst, id, '---', 3);

      const hrBlock = Object.values(inst.tree.blocks).find(b => b.type === 'thematic-break');
      expect(hrBlock).toBeDefined();

      // hr 后应有空段落（原回车产生的第二段）
      const paraBlock = Object.values(inst.tree.blocks).find(
        b => b.type === 'paragraph' && (b.text ?? '').trim() === ''
      );
      expect(paraBlock).toBeDefined();

      const result = handleBackspaceAtStart(inst, paraBlock!.id);
      expect(result).not.toBeNull();
      expect(result!.changedBlockIds).toContain(hrBlock!.id);
      // hr 已被删除
      expect(inst.tree.blocks[hrBlock!.id]).toBeUndefined();
      // 光标留在原段落
      expect(result!.focus?.blockId).toBe(paraBlock!.id);
      expect(result!.focus?.offset).toBe(0);
    });
  });

  describe('非空段落退格不删 hr', () => {
    it('非空段落前是 hr → 退格不删不并（保护）', () => {
      const inst = new EditorInstance('a');
      const id = paragraphId(inst);
      enterCtrl.handleEnter(inst, id, 1);
      inputCtrl.handleInput(inst, id, '---', 3);

      const hrBlock = Object.values(inst.tree.blocks).find(b => b.type === 'thematic-break');
      expect(hrBlock).toBeDefined();

      // hr 后的段落输入文本
      const paraBlock = Object.values(inst.tree.blocks).find(
        b => b.type === 'paragraph' && (b.text ?? '').trim() === ''
      );
      expect(paraBlock).toBeDefined();
      inputCtrl.handleInput(inst, paraBlock!.id, 'hello', 5);

      const result = handleBackspaceAtStart(inst, paraBlock!.id);
      // 不删不并：mergeParagraph 中 hr 在保护列表 → 返回 null
      expect(result).toBeNull();
      expect(inst.tree.blocks[hrBlock!.id]).toBeDefined();
    });
  });

  describe('mergeParagraph 保护列表含 thematic-break', () => {
    it('非空段落退格时前驱是 hr → 不合并（保护）', () => {
      const inst = new EditorInstance('a');
      const id = paragraphId(inst);
      enterCtrl.handleEnter(inst, id, 1);
      inputCtrl.handleInput(inst, id, '---', 3);

      const paraBlock = Object.values(inst.tree.blocks).find(
        b => b.type === 'paragraph' && (b.text ?? '').trim() === ''
      );
      expect(paraBlock).toBeDefined();
      inputCtrl.handleInput(inst, paraBlock!.id, 'text', 4);

      const result = handleBackspaceAtStart(inst, paraBlock!.id);
      expect(result).toBeNull();
    });
  });

  describe('hr 本身 backspaceCtrl 不处理', () => {
    it('thematic-break 块 → handleBackspaceAtStart 返回 null', () => {
      const inst = new EditorInstance('x');
      const id = paragraphId(inst);
      inputCtrl.handleInput(inst, id, '---', 3);
      const hrBlock = Object.values(inst.tree.blocks).find(b => b.type === 'thematic-break');
      expect(hrBlock).toBeDefined();

      const result = handleBackspaceAtStart(inst, hrBlock!.id);
      expect(result).toBeNull();
    });
  });
});

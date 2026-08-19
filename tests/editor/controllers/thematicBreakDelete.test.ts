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
  describe('hr 转换后自动创建空行', () => {
    it('输入 --- 转 hr 后自动创建尾随空行', () => {
      const inst = new EditorInstance('a');
      const id = paragraphId(inst);
      // 输入 --- 转 hr
      inputCtrl.handleInput(inst, id, '---', 3);

      const hrBlock = Object.values(inst.tree.blocks).find(b => b.type === 'thematic-break');
      expect(hrBlock).toBeDefined();

      // hr 后应有空段落（自动创建的尾随空行）
      const paraBlock = Object.values(inst.tree.blocks).find(
        b => b.type === 'paragraph' && (b.text ?? '').trim() === ''
      );
      expect(paraBlock).toBeDefined();

      // 焦点应在尾随空行上
      // （convertParagraphToBlock 返回的 focus 指向尾随空行）
    });
  });

  describe('空段落退格不删 hr（保护）', () => {
    it('空段落前是 hr → 退格不删除（保护）', () => {
      const inst = new EditorInstance('a');
      const id = paragraphId(inst);
      // 输入 --- 转 hr（自动创建尾随空行）
      inputCtrl.handleInput(inst, id, '---', 3);

      const hrBlock = Object.values(inst.tree.blocks).find(b => b.type === 'thematic-break');
      expect(hrBlock).toBeDefined();

      // hr 后的空段落
      const paraBlock = Object.values(inst.tree.blocks).find(
        b => b.type === 'paragraph' && (b.text ?? '').trim() === ''
      );
      expect(paraBlock).toBeDefined();

      const result = handleBackspaceAtStart(inst, paraBlock!.id);
      // 不删除：mergeParagraph 中 hr 在保护列表 → 返回 null
      expect(result).toBeNull();
      expect(inst.tree.blocks[hrBlock!.id]).toBeDefined();
    });
  });

  describe('非空段落退格不删 hr', () => {
    it('非空段落前是 hr → 退格不删不并（保护）', () => {
      const inst = new EditorInstance('a');
      const id = paragraphId(inst);
      // 输入 --- 转 hr（自动创建尾随空行）
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
      // 输入 --- 转 hr（自动创建尾随空行）
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

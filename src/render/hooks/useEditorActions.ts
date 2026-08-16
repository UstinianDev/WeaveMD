// ============================================
// WeaveMD Editor v2 — useEditorActions
// ============================================
// 编辑器动作集：
// - commitTree 统一变更管线（setTree 先于 syncContent，顺序不可变）
// - applyBlockAction 统一块操作入口（执行 → 更新树 → 记录焦点/选区 → 同步内容）
// - applyMetaUpdate 块元数据更新助手
// - 16 个事件回调 + 块类型转换分派器（onConvertBlock）
// 消费 useDomRegistry / useContentSync / useFocusRestore 的返回值，
// 输出引用稳定（useMemo）的 handlers。

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useMemo } from 'react';

import {
  backspaceCtrl,
  clickCtrl,
  convertCtrl,
  enterCtrl,
  formatCtrl,
  inputCtrl,
  listCtrl,
  type InlineFormatStyle,
} from '@render/editor/controllers';
import type { EditorActionResult, EditorInstance } from '@render/editor/editorInstance';
import type { BlockMetaV2, BlockNodeV2, BlockTreeV2, ImageAlign } from '@render/editor/kernel';
import { deleteLeafRange, replaceLeafRange, setBlockText, updateMeta } from '@render/editor/kernel';
import { resolveSyntaxType } from '@render/editor/kernel/syntaxType';
import { setCursorAtOffset, setRangeAtOffset } from '@render/editor/kernel/selection';
import { useEditorStore } from '@render/stores/editorStore';
import type { BlockHandlers, BlockTypeOption } from '@render/components/Editor/v2/types';
import { canConvertBlock } from '@render/components/Editor/v2/types';
import type { PendingFocus, PendingRange } from './useFocusRestore';

interface EditorActionsOptions {
  instanceRef: RefObject<EditorInstance | null>;
  setTree: Dispatch<SetStateAction<BlockTreeV2>>;
  syncContent: () => void;
  getBlockEl: (blockId: string) => HTMLElement | undefined;
  forceSyncBlockDom: (instance: EditorInstance, blockId: string) => void;
  registerDom: (blockId: string, el: HTMLElement) => void;
  unregisterDom: (blockId: string) => void;
  getPendingRange: () => { start: number; end: number } | null;
  setPendingFocus: (focus: PendingFocus) => void;
  setPendingRange: (range: PendingRange) => void;
}

export interface EditorActionsResult {
  handlers: BlockHandlers;
  onConvertBlock: (blockId: string, target: BlockTypeOption) => void;
}

export function useEditorActions({
  instanceRef,
  setTree,
  syncContent,
  getBlockEl,
  forceSyncBlockDom,
  registerDom,
  unregisterDom,
  getPendingRange,
  setPendingFocus,
  setPendingRange,
}: EditorActionsOptions): EditorActionsResult {
  // 统一的变更管线：写入树 → 同步内容（setTree 先于 syncContent，顺序不可变）
  const commitTree = useCallback(
    (instance: EditorInstance) => {
      setTree(instance.tree);
      syncContent();
    },
    [syncContent]
  );

  // 统一的块操作入口：执行操作 → 更新树 → 记录焦点 → 同步内容。
  // 返回是否处理了事件（供 Tab 等决定是否 preventDefault）。
  const applyBlockAction = useCallback(
    (action: (instance: EditorInstance) => EditorActionResult | null): boolean => {
      const instance = instanceRef.current;
      if (!instance) return false;
      const prevTree = instance.tree;
      const result = action(instance);
      if (!result) return false;
      if (result.selection) {
        if (instance.tree === prevTree) {
          const el = getBlockEl(result.selection.blockId);
          if (el) setRangeAtOffset(el, result.selection.start, result.selection.end);
        } else {
          setPendingRange(result.selection);
        }
      } else if (result.focus) {
        if (instance.tree === prevTree) {
          // 树未变化（如空代码块 Enter/Backspace 仅移动光标）：立即恢复焦点，
          // 否则 setTree 同引用会跳过重渲染，焦点恢复 effect 不执行
          const el = getBlockEl(result.focus.blockId);
          if (el) setCursorAtOffset(el, result.focus.offset);
        } else {
          setPendingFocus(result.focus);
        }
      }
      commitTree(instance);
      return true;
    },
    [commitTree, getBlockEl, setPendingFocus, setPendingRange]
  );

  const onInput = useCallback(
    (blockId: string, text: string, cursorOffset: number) => {
      const instance = instanceRef.current;
      if (!instance) return { needRender: false };
      const result = inputCtrl.handleInput(instance, blockId, text, cursorOffset);
      if (result.needRender) {
        // 块转换后原块 id 失效且组件重挂载：焦点恢复必须走 EditorV2 层
        if (result.converted && result.focusBlockId) {
          setPendingFocus({
            blockId: result.focusBlockId,
            offset: result.cursorOffset ?? 0,
          });
        }
        setTree(instance.tree);
      }
      syncContent();
      return result;
    },
    [setPendingFocus, setTree, syncContent]
  );
  const onEnter = useCallback(
    (blockId: string, offset: number) => {
      applyBlockAction((instance) => enterCtrl.handleEnter(instance, blockId, offset));
    },
    [applyBlockAction]
  );
  const onBackspaceAtStart = useCallback(
    (blockId: string) => {
      applyBlockAction((instance) => backspaceCtrl.handleBackspaceAtStart(instance, blockId));
    },
    [applyBlockAction]
  );
  // 跨块选区删除（Backspace/Delete）：块树级删除选区内容
  const onDeleteRange = useCallback(
    (startBlockId: string, startOffset: number, endBlockId: string, endOffset: number) => {
      applyBlockAction((instance) => {
        const result = deleteLeafRange(
          instance.tree,
          startBlockId,
          startOffset,
          endBlockId,
          endOffset
        );
        if (!result) return null;
        instance.tree = result.tree;
        return {
          changedBlockIds: [startBlockId, endBlockId],
          focus: { blockId: result.focusBlockId, offset: result.focusOffset },
        };
      });
      // 按需渲染下 React 状态可能陈旧、memo 跳过重渲染，需按模型强制同步受影响块 DOM
      const instance = instanceRef.current;
      if (instance) {
        for (const blockId of [startBlockId, endBlockId]) {
          forceSyncBlockDom(instance, blockId);
        }
      }
    },
    [applyBlockAction, forceSyncBlockDom]
  );
  // 跨块选区文本替换（字符输入/粘贴）：块树级删除选区内容后，
  // 在起始块 focus 偏移处插入输入文本（浏览器原生删除跨块选区只改 DOM，
  // onInput 仅同步焦点块模型，其余块模型未更新 → 重渲染后内容"复活"）
  const onReplaceCrossBlock = useCallback(
    (
      startBlockId: string,
      startOffset: number,
      endBlockId: string,
      endOffset: number,
      insertText: string
    ) => {
      applyBlockAction((instance) => {
        const result = replaceLeafRange(
          instance.tree,
          startBlockId,
          startOffset,
          endBlockId,
          endOffset,
          insertText
        );
        if (!result) return null;
        instance.tree = result.tree;
        return {
          changedBlockIds: [result.focusBlockId],
          focus: { blockId: result.focusBlockId, offset: result.focusOffset },
        };
      });
    },
    [applyBlockAction]
  );
  const onTab = useCallback(
    (blockId: string) => {
      return applyBlockAction((instance) => listCtrl.handleTab(instance, blockId));
    },
    [applyBlockAction]
  );
  const onShiftTab = useCallback(
    (blockId: string) => {
      return applyBlockAction((instance) => listCtrl.handleShiftTab(instance, blockId));
    },
    [applyBlockAction]
  );
  const onToggleTask = useCallback(
    (listItemId: string) => {
      applyBlockAction((instance) => clickCtrl.toggleTaskChecked(instance, listItemId));
    },
    [applyBlockAction]
  );
  const onFormat = useCallback(
    (
      blockId: string,
      style: InlineFormatStyle,
      start: number,
      end: number,
      url?: string,
      restoreSelection?: boolean
    ) => {
      applyBlockAction((instance) =>
        formatCtrl.formatRange(instance, blockId, style, start, end, { url, restoreSelection })
      );
    },
    [applyBlockAction]
  );

  // SPEC-EDIT-FT2 4.5.4：橡皮擦——清除选区全部行内标记
  const onClearFormat = useCallback(
    (blockId: string, start: number, end: number, _restoreSelection?: boolean) => {
      applyBlockAction((instance) => formatCtrl.clearFormat(instance, blockId, start, end));
    },
    [applyBlockAction]
  );

  // 移除链接：光标/选区相交的链接还原为纯文本 label（formatCtrl.unlinkRange）
  const onUnlink = useCallback(
    (blockId: string, start: number, end: number) => {
      applyBlockAction((instance) => formatCtrl.unlinkRange(instance, blockId, start, end));
    },
    [applyBlockAction]
  );

  // K3b：ImageEditTool 确认 → 按 token 精确区间替换为 `![alt](src "title")`
  const onReplaceImage = useCallback(
    (
      blockId: string,
      imgStart: number,
      imgEnd: number,
      img: { src: string; alt: string; title?: string }
    ) => {
      applyBlockAction((instance) =>
        formatCtrl.replaceImage(instance, blockId, imgStart, imgEnd, img)
      );
    },
    [applyBlockAction]
  );

  // K6：图片直选插入——替换选区为 `![sel](escapedPath)`（formatCtrl.insertImageFromSelection）
  const onInsertImageFromSelection = useCallback(
    (blockId: string, start: number, end: number, src: string) => {
      applyBlockAction((instance) =>
        formatCtrl.insertImageFromSelection(instance, blockId, start, end, src)
      );
    },
    [applyBlockAction]
  );

  // K4：图片工具栏——对齐 / 内联 / 移除（formatCtrl 对应控制器）
  const onAlignImage = useCallback(
    (blockId: string, align: ImageAlign) => {
      applyBlockAction((instance) => formatCtrl.alignImage(instance, blockId, align));
    },
    [applyBlockAction]
  );

  const onMakeInline = useCallback(
    (blockId: string) => {
      applyBlockAction((instance) => formatCtrl.makeImageInline(instance, blockId));
    },
    [applyBlockAction]
  );

  const onRemoveImage = useCallback(
    (blockId: string, start: number, end: number) => {
      applyBlockAction((instance) => formatCtrl.removeImage(instance, blockId, start, end));
    },
    [applyBlockAction]
  );

  // 浮动工具栏：块类型转换（正文 ↔ H1-H6，仅根级 paragraph/heading）
  // 块元数据更新助手：updateMeta → setTree → 同步内容（消除重复模式）
  const applyMetaUpdate = useCallback(
    (blockId: string, meta: Partial<BlockMetaV2>) => {
      const instance = instanceRef.current;
      if (!instance) return;
      instance.tree = updateMeta(instance.tree, blockId, meta);
      commitTree(instance);
    },
    [commitTree]
  );

  // 浮动工具栏：块类型转换（正文 ↔ H1-H6，仅根级 paragraph/heading）——三分支拆分
  const convertToParagraph = useCallback(
    (instance: EditorInstance, blockId: string, block: BlockNodeV2) => {
      if (block.type === 'heading') {
        applyBlockAction((inst) => convertCtrl.convertBlockToParagraph(inst, blockId));
        return;
      }
      // 列表项内容 / 引用内容降级退出（convertCtrl 已覆盖 exitListItem/exitBlockquote）
      if (
        block.parentId &&
        (instance.tree.blocks[block.parentId]?.type === 'list-item' ||
          instance.tree.blocks[block.parentId]?.type === 'blockquote')
      ) {
        applyBlockAction((inst) => convertCtrl.convertBlockToParagraph(inst, blockId));
      }
    },
    [applyBlockAction]
  );

  const convertToHeading = useCallback(
    (
      instance: EditorInstance,
      blockId: string,
      block: BlockNodeV2,
      level: 1 | 2 | 3 | 4 | 5 | 6,
      isRootBlock: boolean
    ) => {
      if (block.type === 'heading') {
        applyMetaUpdate(blockId, { headingLevel: level });
      } else if (block.type === 'paragraph' && isRootBlock) {
        applyBlockAction((inst) =>
          convertCtrl.convertParagraphToBlock(inst, blockId, {
            type: 'heading',
            meta: { headingLevel: level },
            prefixLength: 0,
          })
        );
      }
    },
    [applyBlockAction, applyMetaUpdate]
  );

  // 列表 / 引用 / 代码块升格：仅根级段落
  const convertToStructure = useCallback(
    (
      instance: EditorInstance,
      blockId: string,
      target: BlockTypeOption,
      isRootBlock: boolean
    ) => {
      if (instance.tree.blocks[blockId]?.type === 'paragraph' && isRootBlock) {
        const conversionType = target as 'bullet-list' | 'ordered-list' | 'task-list' | 'blockquote' | 'code-block';
        applyBlockAction((inst) =>
          convertCtrl.convertParagraphToBlock(inst, blockId, {
            type: conversionType,
            prefixLength: 0,
          })
        );
      }
    },
    [applyBlockAction]
  );

  const onConvertBlock = useCallback(
    (blockId: string, target: BlockTypeOption) => {
      const instance = instanceRef.current;
      if (!instance) return;
      const block = instance.tree.blocks[blockId];
      if (!block) return;
      const isRootBlock = block.parentId === instance.tree.root.id;
      const current = resolveSyntaxType(instance.tree, blockId);
      // 矩阵前置校验：非法目标直接忽略（下拉已按 canConvertBlock 置灰，双保险）
      if (!canConvertBlock(current, target)) return;

      if (target === 'paragraph') {
        convertToParagraph(instance, blockId, block);
        return;
      }

      if (target.startsWith('h')) {
        const level = Number(target.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
        convertToHeading(instance, blockId, block, level, isRootBlock);
        return;
      }

      convertToStructure(instance, blockId, target, isRootBlock);
    },
    [convertToParagraph, convertToHeading, convertToStructure]
  );
  const onUndo = useCallback(() => {
    useEditorStore.getState().undo();
  }, []);
  const onRedo = useCallback(() => {
    useEditorStore.getState().redo();
  }, []);
  const onFenceLanguageChange = useCallback(
    (blockId: string, language: string) => {
      applyMetaUpdate(blockId, { fenceLanguage: language });
    },
    [applyMetaUpdate]
  );
  // M2：表格块编辑（单元格输入 / 增删行列）— setBlockText + setTree + syncContent，并入撤销栈。
  // 纯文本输入时不传 focus；增删行列（树重建）时由 TableBlock 局部 pendingCellRef 恢复光标，
  // 此处无需消费 focus（保持 setBlockText 决策，未修改块树结构）。
  const onTableEdit = useCallback(
    (blockId: string, text: string) => {
      const instance = instanceRef.current;
      if (!instance) return;
      instance.tree = setBlockText(instance.tree, blockId, text);
      commitTree(instance);
    },
    [commitTree]
  );
  const handlers: BlockHandlers = useMemo(
    () => ({
      onInput,
      onEnter,
      onBackspaceAtStart,
      onDeleteRange,
      onReplaceCrossBlock,
      onTab,
      onShiftTab,
      onFormat,
      onClearFormat,
      onUnlink,
      onReplaceImage,
      onInsertImageFromSelection,
      onAlignImage,
      onMakeInline,
      onRemoveImage,
      getPendingRange,
      onToggleTask,
      onUndo,
      onRedo,
      onFenceLanguageChange,
      onTableEdit,
      registerDom,
      unregisterDom,
    }),
    [
      onInput,
      onEnter,
      onBackspaceAtStart,
      onDeleteRange,
      onReplaceCrossBlock,
      onTab,
      onShiftTab,
      onFormat,
      onClearFormat,
      onUnlink,
      onReplaceImage,
      onInsertImageFromSelection,
      onAlignImage,
      onMakeInline,
      onRemoveImage,
      getPendingRange,
      onToggleTask,
      onUndo,
      onRedo,
      onFenceLanguageChange,
      onTableEdit,
      registerDom,
      unregisterDom,
    ]
  );

  return { handlers, onConvertBlock };
}

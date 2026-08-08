import type { BlockTreeV2 } from '../../../editor/kernel';
import type { InlineFormatStyle } from '../../../editor/controllers';
import type { SyntaxType } from '../../../editor/kernel/syntaxType';

// ============================================
// 块类型下拉选项（SPEC-EDIT-FT 4.3.2 / 4.3.3）
// ============================================
export type BlockTypeOption =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'code-block'
  | 'blockquote'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list';

export interface BlockTypeOptionDef {
  value: BlockTypeOption;
  label: string;
}

export const BLOCK_TYPE_OPTIONS: BlockTypeOptionDef[] = [
  { value: 'paragraph', label: '正文' },
  { value: 'h1', label: 'H1 一级标题' },
  { value: 'h2', label: 'H2 二级标题' },
  { value: 'h3', label: 'H3 三级标题' },
  { value: 'h4', label: 'H4 四级标题' },
  { value: 'h5', label: 'H5 五级标题' },
  { value: 'h6', label: 'H6 六级标题' },
  { value: 'code-block', label: '代码块' },
  { value: 'blockquote', label: '引用' },
  { value: 'bullet-list', label: '无序列表' },
  { value: 'ordered-list', label: '有序列表' },
  { value: 'task-list', label: '任务列表' },
];

const HEADING_TARGETS: BlockTypeOption[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const LIST_TARGETS: BlockTypeOption[] = ['bullet-list', 'ordered-list', 'task-list'];

/**
 * 转换能力矩阵：由当前块语法类型判定某下拉目标是否可切换。
 * 约定：仅启用既有 convertCtrl 支持的安全路径，其余置灰禁用。
 */
export function canConvertBlock(current: SyntaxType, target: BlockTypeOption): boolean {
  switch (current.type) {
    case 'paragraph':
      return (
        target === 'paragraph' ||
        HEADING_TARGETS.includes(target) ||
        LIST_TARGETS.includes(target) ||
        target === 'blockquote' ||
        target === 'code-block'
      );
    case 'heading':
      return target === 'paragraph' || HEADING_TARGETS.includes(target);
    case 'blockquote':
      return target === 'paragraph';
    case 'bullet-list':
    case 'ordered-list':
    case 'task-list':
      return target === 'paragraph';
    case 'code-block':
      return target === 'code-block';
    default:
      // thematic-break / table：下拉无对应选项，当前项回落 paragraph
      return target === 'paragraph';
  }
}

export interface InputEventResult {
  needRender: boolean;
  cursorOffset?: number;
}

/** 块组件统一回调集（由 EditorV2 提供） */
export interface BlockHandlers {
  onInput: (blockId: string, text: string, cursorOffset: number) => InputEventResult;
  onEnter: (blockId: string, offset: number) => void;
  onBackspaceAtStart: (blockId: string) => void;
  /** 跨块选区删除（Backspace/Delete） */
  onDeleteRange: (
    startBlockId: string,
    startOffset: number,
    endBlockId: string,
    endOffset: number
  ) => void;
  onTab: (blockId: string) => boolean;
  onShiftTab: (blockId: string) => boolean;
  onFormat: (
    blockId: string,
    style: InlineFormatStyle,
    start: number,
    end: number,
    url?: string,
    restoreSelection?: boolean
  ) => void;
  /** SPEC-EDIT-FT2 4.5.4：清除选区全部行内标记 */
  onClearFormat: (blockId: string, start: number, end: number, restoreSelection?: boolean) => void;
  getPendingRange?: () => { start: number; end: number } | null;
  onToggleTask: (listItemId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFenceLanguageChange: (blockId: string, language: string) => void;
  registerDom: (blockId: string, el: HTMLElement) => void;
  unregisterDom: (blockId: string) => void;
}

export interface BlockRendererProps {
  blockId: string;
  tree: BlockTreeV2;
  handlers: BlockHandlers;
}

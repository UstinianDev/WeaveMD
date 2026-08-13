import type { BlockTreeV2 } from '@render/editor/kernel';
import type { ImageAlign } from '@render/editor/kernel';
import type { InlineFormatStyle } from '@render/editor/controllers';
import type { SyntaxType } from '@render/editor/kernel/syntaxType';

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

/**
 * 图片点击选中态（K4）：点击渲染期 `img.inline-image`（data-start/data-end 为
 * kernel 计算的绝对偏移）后由 EditorV2 计算，驱动 FloatingToolbar 图片工具栏。
 * align/standalone 为选中时快照（tree 计算），动作执行后必须清空选中态防偏移漂移。
 */
export interface ImageSelection {
  blockId: string;
  /** 图片 token 绝对起始偏移（DOM data-start） */
  start: number;
  /** 图片 token 绝对结束偏移（DOM data-end，不含） */
  end: number;
  /** 当前对齐（image-block 经 parseImageBlockText；行内图恒 null） */
  align: ImageAlign | null;
  /** 是否独立成块（image-block 或整块即图片语法）——对齐/内联按钮可用前提 */
  standalone: boolean;
    /** 点击时 img.getBoundingClientRect() 快照（工具栏锚定） */
  rect: { top: number; left: number; width: number; height: number };
  /** R1：选中图片当前显示宽度（px）。独立图读 parsed.width；行内图读会话运行时 map。 */
  width?: number;
}

/** R1：行内图会话运行时宽度 map（G5）——key `${data-start}:${data-end}` → 宽度 px。
 *  由 EditorV2 持有并透传给块渲染（applyRuntimeWidths 注入 style），重载/会话结束即重置。 */
export type InlineWidthMap = Record<string, number>;
/** R1：按块收敛的宽度 map —— key blockId → 该块内 img 的 InlineWidthMap。 */
export type BlockWidthMap = Record<string, InlineWidthMap>;

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
  /** 跨块选区文本替换（字符输入/粘贴）：块树级删除选区后，在起始块 offset 处插入文本 */
  onReplaceCrossBlock: (
    startBlockId: string,
    startOffset: number,
    endBlockId: string,
    endOffset: number,
    insertText: string
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
  /** 移除链接：将光标/选区相交的链接还原为纯文本 label */
  onUnlink: (blockId: string, start: number, end: number) => void;
  /** K3b：按 image token 精确区间替换（ImageEditTool 确认） */
  onReplaceImage: (
    blockId: string,
    imgStart: number,
    imgEnd: number,
    img: { src: string; alt: string; title?: string }
  ) => void;
  /** K6：图片直选插入——替换 [start,end) 为 `![sel](src)`（空选区 → `![](src)`） */
  onInsertImageFromSelection: (blockId: string, start: number, end: number, src: string) => void;
  /** K4：对齐独立成块图片（wrapImageAlign 包裹/换向） */
  onAlignImage: (blockId: string, align: ImageAlign) => void;
  /** K4：内联图片（解除对齐包裹 → paragraph） */
  onMakeInline: (blockId: string) => void;
  /** K4：移除图片（image-block 整块删除；行内图删 [start,end) 区间） */
  onRemoveImage: (blockId: string, start: number, end: number) => void;
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
  /** R1：块渲染宽度 map（透传到叶子块） */
  blockWidthMap?: InlineWidthMap;
}

// ============================================
// WeaveMD Editor v2 — 浮动工具栏（marktext 风格）
// ============================================
// 文本选区非折叠时出现在选区上方（触发规则与 marktext 一致）：
// 最左侧为块类型下拉（正文 / H1-H6），其余为行内格式按钮
// （加粗 / 斜体 / 删除线 / 行内代码 / 链接 / 高亮）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { InlineFormatStyle } from '@render/editor/controllers';
import { MARKERS } from '@render/editor/controllers/formatCtrl';
import type { BlockTreeV2, ImageAlign } from '@render/editor/kernel';
import { findIntersectingLinks, isBoundedWrap, tokenizeInline } from '@render/editor/kernel';
import {
  getCursorOffsets,
  nearestContentSpan as kernelNearestContentSpan,
} from '@render/editor/kernel/selection';
import { resolveSyntaxType, resolveSyntaxTypesInRange } from '@render/editor/kernel/syntaxType';
import type { SyntaxType } from '@render/editor/kernel/syntaxType';
import { clamp } from '@render/editor/controllers/shared';
import {
  BLOCK_TYPE_OPTIONS,
  canConvertBlock,
  type BlockTypeOption,
  type ImageSelection,
} from './types';
import { createRafThrottle } from '@render/utils/rafThrottle';
import InsertUrlModal from './InsertUrlModal';
import ImageEditTool from './ImageEditTool';

export type { BlockTypeOption };

interface FloatingToolbarProps {
  /** 编辑器容器（判定选区是否在编辑器内） */
  editorContainerRef: React.RefObject<HTMLDivElement>;
  tree: BlockTreeV2;
  onFormat: (
    blockId: string,
    style: InlineFormatStyle,
    start: number,
    end: number,
    url?: string,
    restoreSelection?: boolean
  ) => void;
  onConvertBlock: (blockId: string, target: BlockTypeOption) => void;
  /** SPEC-EDIT-FT2 4.5.4：橡皮擦（清除选区行内标记） */
  onClearFormat?: (
    blockId: string,
    start: number,
    end: number,
    restoreSelection?: boolean
  ) => void;
  /** 移除链接：光标/选区相交的链接还原为纯文本 label */
  onUnlink?: (blockId: string, start: number, end: number) => void;
  /** K4：当前选中的图片（点击 img 后由 EditorV2 计算）——非空时渲染图片工具栏并压制文本工具栏 */
  imageSelection?: ImageSelection | null;
  /** K4：关闭图片工具栏（EditorV2 清空选中态） */
  onCloseImage?: () => void;
  /** K4：「修改图片」点击事件（弹层与预填由本组件自管） */
  onEditImage?: (sel: ImageSelection) => void;
  /** K4：对齐独立成块图片（居左/居中/居右） */
  onAlignImage?: (blockId: string, align: ImageAlign) => void;
  /** K4：内联图片（解除对齐包裹） */
  onMakeInline?: (blockId: string) => void;
  /** K4：移除图片（image-block 整块删除；行内图删区间） */
  onRemoveImage?: (blockId: string, start: number, end: number) => void;
  /** K6：图片按钮直选——替换 [start,end) 为 `![sel](src)` */
  onInsertImageFromSelection?: (blockId: string, start: number, end: number, src: string) => void;
  /** K6：图片按钮的本地文件选择器（window.weaveMD.dialog.pickImage，取消返回 null） */
  pickImage?: () => Promise<string | null>;
  /** K3b：ImageEditTool 确认——按 token 区间替换图片 */
  onReplaceImage?: (
    blockId: string,
    imgStart: number,
    imgEnd: number,
    img: { src: string; alt: string; title?: string }
  ) => void;
}

interface SelectionState {
  blockId: string;
  start: number;
  end: number;
  anchorText: string;
  /** 选区（含折叠光标）是否命中链接 token */
  inLink: boolean;
}

interface FormatButton {
  style: InlineFormatStyle;
  label: string;
  title: string;
  group: 'char' | 'object';
  className?: string;
  activeTest?: (text: string) => boolean;
}

/** SPEC-EDIT-FT2 4.6：字符格式组 */
const CHAR_BUTTONS: FormatButton[] = [
  {
    style: 'bold',
    label: 'B',
    title: '加粗',
    group: 'char',
    className: 'font-bold',
    activeTest: (t) => isBoundedWrap(t, ...MARKERS.bold),
  },
  {
    style: 'italic',
    label: 'I',
    title: '斜体',
    group: 'char',
    className: 'italic',
    activeTest: (t) => isBoundedWrap(t, ...MARKERS.italic),
  },
  {
    style: 'underline',
    label: 'U',
    title: '下划线',
    group: 'char',
    className: 'underline',
    activeTest: (t) => isBoundedWrap(t, ...MARKERS.underline),
  },
  {
    style: 'strike',
    label: 'S',
    title: '删除线',
    group: 'char',
    className: 'line-through',
    activeTest: (t) => isBoundedWrap(t, ...MARKERS.strike),
  },
  {
    style: 'code',
    label: '</>',
    title: '行内代码',
    group: 'char',
    activeTest: (t) => isBoundedWrap(t, ...MARKERS.code),
  },
  {
    style: 'highlight',
    label: 'H',
    title: '高亮',
    group: 'char',
    activeTest: (t) => isBoundedWrap(t, ...MARKERS.highlight),
  },
];

/** SPEC-EDIT-FT2 4.6：对象插入组（弹 URL 输入） */
const OBJECT_BUTTONS: FormatButton[] = [
  { style: 'link', label: '🔗', title: '链接', group: 'object' },
  { style: 'image', label: '🖼', title: '图片', group: 'object' },
  { style: 'math', label: '∑', title: '数学公式', group: 'object' },
];

/** 从选区节点向上找最近的 block-content 内容 span（限制在编辑器容器内） */
function nearestContentSpan(node: Node | null, container: HTMLElement): HTMLElement | null {
  const span = kernelNearestContentSpan(node);
  return span && container.contains(span) ? span : null;
}

/** 由 SyntaxType 映射为下拉选项（SPEC-EDIT-FT G3②）；无对应选项时回落 paragraph */
export function syntaxTypeToOption(st: SyntaxType): BlockTypeOption {
  switch (st.type) {
    case 'heading':
      return `h${st.level}` as BlockTypeOption;
    case 'code-block':
      return 'code-block';
    case 'blockquote':
      return 'blockquote';
    case 'bullet-list':
      return 'bullet-list';
    case 'ordered-list':
      return 'ordered-list';
    case 'task-list':
      return 'task-list';
    default:
      // paragraph / thematic-break / table
      return 'paragraph';
  }
}

/**
 * 跨块选区语法类型一致性判定（SPEC-EDIT-FT G1）。
 * 端点顺序无关：end 在 start 之前时按文档序重试；枚举区间内叶子全部同类型才一致。
 */
export function selectionSyntaxTypesConsistent(
  tree: BlockTreeV2,
  startLeafId: string,
  endLeafId: string
): boolean {
  let types = resolveSyntaxTypesInRange(tree, startLeafId, endLeafId);
  if (types === null) {
    types = resolveSyntaxTypesInRange(tree, endLeafId, startLeafId);
  }
  return types !== null && types.length > 0;
}

interface ToolbarButtonProps {
  title: string;
  label: string;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  onClick: () => void;
}

/**
 * 工具栏按钮：CHAR / OBJECT / 橡皮擦 / 图片工具栏 共用（SPEC-EDIT-FT2 4.6）。
 * active 时 accent 色 + bg-tertiary 驻留；hover 进 bg-tertiary；disabled 点击 no-op。
 */
function ToolbarButton({
  title,
  label,
  className,
  active = false,
  disabled = false,
  testId,
  onClick,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      data-testid={testId}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      className={'ft-btn ' + (className ?? '') + (active ? ' active' : '')}
      style={{
        color: active ? 'var(--accent)' : 'var(--text-sub)',
        backgroundColor: active ? 'var(--bg-tertiary)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = active ? 'var(--bg-tertiary)' : 'transparent';
      }}
    >
      {label}
    </button>
  );
}

/** 选区判定结果：hide=立即隐藏，delay-hide=延迟隐藏，show=显示并携带选区与位置 */
type ToolbarState =
  | { kind: 'hide' }
  | { kind: 'delay-hide' }
  | { kind: 'show'; selection: SelectionState; position: { top: number; left: number } };

/** 由当前选区计算工具栏状态（纯函数，供事件回调装配） */
function computeToolbarState(
  sel: Selection | null,
  container: HTMLElement,
  toolbarWidth: number,
  toolbarHeight: number,
  tree: BlockTreeV2
): ToolbarState {
  if (!sel || sel.rangeCount === 0) return { kind: 'hide' };
  const range = sel.getRangeAt(0);
  const anchorSpan = nearestContentSpan(sel.anchorNode, container);
  const focusSpan = nearestContentSpan(sel.focusNode, container);
  if (!anchorSpan || !focusSpan || !container.contains(range.commonAncestorContainer)) {
    return { kind: 'hide' };
  }
  const blockId = anchorSpan.getAttribute('data-block-id');
  const focusBlockId = focusSpan.getAttribute('data-block-id');
  if (!blockId || !focusBlockId) return { kind: 'hide' };
  // G1：跨块选区需全部叶子语法类型一致，否则隐藏
  if (blockId !== focusBlockId) {
    if (!selectionSyntaxTypesConsistent(tree, blockId, focusBlockId)) {
      return { kind: 'hide' };
    }
  }
  const offsets = getCursorOffsets(anchorSpan);
  const blockText = tree.blocks[blockId]?.text ?? '';
  const inLink = findIntersectingLinks(blockText, offsets.start, offsets.end).length > 0;
  if (sel.isCollapsed) {
    // 折叠光标仅在命中链接时显示（仅「移除链接」操作），否则维持延迟隐藏
    if (!inLink) return { kind: 'delay-hide' };
  } else {
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return { kind: 'delay-hide' };
  }
  const rect = range.getBoundingClientRect();
  const left = clamp(
    rect.left + rect.width / 2 - toolbarWidth / 2,
    8,
    window.innerWidth - toolbarWidth - 8
  );
  const top = clamp(rect.top - toolbarHeight - 8, 8, window.innerHeight - toolbarHeight - 8);
  return {
    kind: 'show',
    selection: {
      blockId,
      start: offsets.start,
      end: offsets.end,
      anchorText: anchorSpan.textContent ?? '',
      inLink,
    },
    position: { top, left },
  };
}

const FloatingToolbar: React.FC<FloatingToolbarProps> = ({
  editorContainerRef,
  tree,
  onFormat,
  onConvertBlock,
  onClearFormat,
  onUnlink,
  imageSelection,
  onCloseImage,
  onEditImage,
  onAlignImage,
  onMakeInline,
  onRemoveImage,
  onInsertImageFromSelection,
  pickImage,
  onReplaceImage,
}) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const [selection, setSelection] = useState<SelectionState | null>(null);
  // U5/K3b：链接按钮打开 InsertUrlModal；图片按钮不再走该 Modal
  const [insertModal, setInsertModal] = useState<{ style: 'link' } | null>(null);
  // K5：「修改图片」打开的 ImageEditTool 弹层状态（预填来自 imageSelection token）
  const [editImage, setEditImage] = useState<ImageSelection | null>(null);
  // Bug B（图片工具栏滚动锚定）：本地锚点 rect——滚动时重查 img.getBoundingClientRect()
  // 更新，使图片工具栏与「修改图片」弹窗跟随图片；初始/切换图片时同步自 imageSelection.rect。
  // 惰性初始化：挂载期 anchorRect === imageSelection.rect 同引用，同步 effect 触发 setState
  // 时 Object.is 相等被 React 跳过，避免引入挂载后重渲染（jsdom 下 toolbarRef 尺寸读取差异）。
  const [anchorRect, setAnchorRect] = useState<ImageSelection['rect'] | null>(
    () => imageSelection?.rect ?? null
  );
  const toolbarRef = useRef<HTMLDivElement>(null);
  // K3b：interactionGuard 包裹 ref（覆盖工具栏 + ImageEditTool）
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // SPEC-EDIT-DSF 4.3：rAF 节流与可见性去重（避免拖选期间每帧重复 setVisible）
  const latestSelectionRef = useRef<Selection | null>(null);
  const visibleRef = useRef(false);
  // SPEC-EDIT-FT3 4.3：格式/清除后工具栏驻留；点击工具栏外/滚动/Escape/键入退出
  const stickyRef = useRef(false);
  // 点击工具栏外 → hide 后，浏览器随后的 selectionchange 不得重显（消费一次）
  const suppressSelectionRef = useRef(false);

  const setVisibleGuarded = useCallback((value: boolean) => {
    if (visibleRef.current !== value) {
      visibleRef.current = value;
      setVisible(value);
    }
  }, []);

  /** FT3：隐藏并退出驻留语义（块转换/滚动/点击外部/Escape 共用） */
  const hideToolbar = useCallback(() => {
    setVisibleGuarded(false);
    stickyRef.current = false;
  }, [setVisibleGuarded]);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(
    (delay = 180) => {
      cancelHide();
      hideTimerRef.current = setTimeout(() => setVisibleGuarded(false), delay);
    },
    [cancelHide, setVisibleGuarded]
  );

  // Bug B：imageSelection 变化（点击/关闭/切换图片）时重置本地锚点。
  useEffect(() => {
    setAnchorRect(imageSelection?.rect ?? null);
  }, [imageSelection]);

  // 选区变化：非折叠且在编辑器内容块内 → 显示；收起/移出 → 延迟隐藏。
  // SPEC-EDIT-DSF 4.3：事件仅写入 latestSelectionRef 并调度一帧（rAF id 去重，
  // 已有待处理帧则复用），帧内才执行 computeToolbarState + setState → 渲染 ≤ 每帧一次。
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const flushSelection = () => {
      // U5/K3b：Modal / ImageEditTool 打开期间（输入框获焦会收起选区）不得隐藏工具栏
      if (insertModal !== null || editImage !== null) {
        cancelHide();
        return;
      }
      // K4：图片选中期间压制文本工具栏的 selectionchange 竞争（图片工具栏
      // 独立于文本选区渲染，直接由 imageSelection 驱动）
      if (imageSelection) {
        cancelHide();
        return;
      }
      // FT3：点击工具栏外触发的隐藏后，浏览器随后的 selectionchange 不得重显
      if (suppressSelectionRef.current) {
        suppressSelectionRef.current = false;
        return;
      }
      const state = computeToolbarState(
        latestSelectionRef.current,
        container,
        toolbarRef.current?.offsetWidth ?? 320,
        toolbarRef.current?.offsetHeight ?? 40,
        tree
      );
      if (state.kind === 'hide') {
        setVisibleGuarded(false);
        return;
      }
      if (state.kind === 'delay-hide') {
        scheduleHide();
        return;
      }
      cancelHide();
      setSelection(state.selection);
      setPosition(state.position);
      setVisibleGuarded(true);
    };

    const selectionThrottle = createRafThrottle(flushSelection);

    const handleSelectionChange = () => {
      latestSelectionRef.current = window.getSelection();
      selectionThrottle.schedule();
    };

    const handleScroll = () => {
      stickyRef.current = false;
      setVisibleGuarded(false);
      // Bug B：图片工具栏 /「修改图片」弹窗滚动时重锚定——重查 img 的 viewport rect，
      // 使工具栏与弹窗跟随图片（marktext 风格），而非停留在点击时的陈旧坐标。
      const selected = imageSelection ?? editImage;
      if (selected && container) {
        const blockEl = container.querySelector(`[data-block-id="${selected.blockId}"]`);
        const img = blockEl?.querySelector(
          `img.inline-image[data-start="${selected.start}"][data-end="${selected.end}"]`
        );
        if (img instanceof HTMLImageElement) {
          const r = img.getBoundingClientRect();
          setAnchorRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    container.addEventListener('scroll', handleScroll, true);
    return () => {
      selectionThrottle.cancel();
      document.removeEventListener('selectionchange', handleSelectionChange);
      container.removeEventListener('scroll', handleScroll, true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [editorContainerRef, cancelHide, scheduleHide, tree, setVisibleGuarded, insertModal, editImage, imageSelection]);

  // SPEC-EDIT-FT3 4.3：驻留退出条件——点击工具栏外任意位置（capture 阶段）与 Escape
  // K3b：守卫合并 insertModal / editImage（ImageEditTool 自处理自身交互），wrapRef 覆盖两者
  const isModalOpen = insertModal !== null || editImage !== null;
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // U5/K3b：Modal / ImageEditTool 打开期间点击自身或外部均由弹层处理，不隐工具栏
      if (isModalOpen) return;
      // K4：图片工具栏打开期间，点击工具栏外任意位置 → 关闭图片选中（恢复文本工具栏）
      if (imageSelection && !wrapRef.current?.contains(e.target as Node)) {
        onCloseImage?.();
        return;
      }
      if (!stickyRef.current) return;
      if (wrapRef.current?.contains(e.target as Node)) return;
      suppressSelectionRef.current = true;
      hideToolbar();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // U5/K3b：Modal / ImageEditTool 打开期间 Escape 由弹层自处理
      if (isModalOpen) return;
      // K4：Escape 关闭图片工具栏
      if (imageSelection) {
        onCloseImage?.();
        return;
      }
      if (visibleRef.current) hideToolbar();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [hideToolbar, isModalOpen, imageSelection, onCloseImage]);

  const currentType: BlockTypeOption = useMemo(() => {
    if (!selection) return 'paragraph';
    return syntaxTypeToOption(resolveSyntaxType(tree, selection.blockId));
  }, [selection, tree]);

  const currentSyntax: SyntaxType = useMemo(() => {
    if (!selection) return { type: 'paragraph' };
    return resolveSyntaxType(tree, selection.blockId);
  }, [selection, tree]);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const currentLabel =
    BLOCK_TYPE_OPTIONS.find((o) => o.value === currentType)?.label ?? '正文';

  useEffect(() => {
    if (!visible) setDropdownOpen(false);
  }, [visible]);

  const activeFormats = useMemo(() => {
    if (!selection) return new Set<InlineFormatStyle>();
    const set = new Set<InlineFormatStyle>();
    for (const button of [...CHAR_BUTTONS, ...OBJECT_BUTTONS]) {
      if (button.activeTest?.(selection.anchorText)) set.add(button.style);
    }
    return set;
  }, [selection]);

  // K6：图片直选——pickImage → 非空路径替换选区；取消/失败均隐藏工具栏（纯 no-op）
  const handleInsertImageClick = useCallback(async () => {
    const sel = selection;
    if (!sel) return;
    if (!pickImage) {
      console.warn('[FloatingToolbar] pickImage 未提供，图片插入为 no-op');
      hideToolbar();
      return;
    }
    let path: string | null = null;
    try {
      path = await pickImage();
    } catch (err) {
      console.warn('[FloatingToolbar] pickImage 失败，图片插入为 no-op', err);
    }
    hideToolbar();
    if (!path) return;
    onInsertImageFromSelection?.(sel.blockId, sel.start, sel.end, path);
  }, [selection, pickImage, onInsertImageFromSelection, hideToolbar]);

  const handleFormat = useCallback(
    (button: FormatButton) => {
      if (!selection) return;
      if (button.style === 'link') {
        // U5：link 打开 InsertUrlModal 取 URL（替换禁用环境不可用的 window.prompt）
        setInsertModal({ style: 'link' });
        return;
      }
      if (button.style === 'image') {
        // K6：图片按钮 → 直选文件并直接替换选区（取消 = no-op）
        void handleInsertImageClick();
        return;
      }
      onFormat(selection.blockId, button.style, selection.start, selection.end, undefined, true);
      // FT3：格式应用后驻留，不退出；由 restoreSelection 保持选区非折叠以维持显示
      stickyRef.current = true;
    },
    [selection, onFormat, handleInsertImageClick]
  );

  const handleClearFormat = useCallback(() => {
    if (!selection || !onClearFormat) return;
    onClearFormat(selection.blockId, selection.start, selection.end, true);
    stickyRef.current = true;
  }, [selection, onClearFormat]);

  const handleUnlink = useCallback(() => {
    if (!selection || !onUnlink) return;
    onUnlink(selection.blockId, selection.start, selection.end);
    // 移除链接后驻留，由 restoreSelection 维持选区非折叠
    stickyRef.current = true;
  }, [selection, onUnlink]);

  const handleBlockChange = useCallback(
    (target: BlockTypeOption) => {
      if (selection && target !== currentType) {
        onConvertBlock(selection.blockId, target);
      }
      // 块结构转换后工具栏不再适用：维持现状退出并清理 sticky
      stickyRef.current = false;
      setVisibleGuarded(false);
    },
    [selection, currentType, onConvertBlock, setVisibleGuarded]
  );

  // K4：图片工具栏动作——执行后关闭图片选中（防偏移漂移）
  const handleAlignImage = useCallback(
    (align: ImageAlign) => {
      if (!imageSelection) return;
      onAlignImage?.(imageSelection.blockId, align);
      onCloseImage?.();
    },
    [imageSelection, onAlignImage, onCloseImage]
  );

  const handleMakeInline = useCallback(() => {
    if (!imageSelection) return;
    onMakeInline?.(imageSelection.blockId);
    onCloseImage?.();
  }, [imageSelection, onMakeInline, onCloseImage]);

  const handleRemoveImage = useCallback(() => {
    if (!imageSelection) return;
    onRemoveImage?.(imageSelection.blockId, imageSelection.start, imageSelection.end);
    onCloseImage?.();
  }, [imageSelection, onRemoveImage, onCloseImage]);

  // K5：「修改图片」→ 通知选中态并打开 ImageEditTool（预填来自 imageSelection token）
  const handleEditImage = useCallback(() => {
    if (!imageSelection) return;
    onEditImage?.(imageSelection);
    setEditImage(imageSelection);
  }, [imageSelection, onEditImage]);

  // 预填：image-block 的 token 区间是绝对偏移，tokenizeInline 全文直接命中
  const editImagePrefill = useMemo(() => {
    if (!editImage) return null;
    const text = tree.blocks[editImage.blockId]?.text ?? '';
    const token = tokenizeInline(text).find(
      (t) => t.type === 'image' && t.start === editImage.start && t.end === editImage.end
    );
    if (!token) return null;
    return {
      src: token.href ?? '',
      alt: text.slice(token.contentStart, token.contentEnd),
      title: token.title ?? '',
    };
  }, [editImage, tree]);

  // 弹层锚定：图片下方（ImageEditTool 固定宽度 280 → 半宽 140）。
  // Bug B：优先用重锚定的 anchorRect（滚动后跟随图片），回退 editImage.rect。
  const editImagePosition = useMemo(() => {
    if (!editImage) return { top: 0, left: 0 };
    const rect = anchorRect ?? editImage.rect;
    return {
      top: rect.top + rect.height + 6,
      left: clamp(rect.left + rect.width / 2 - 140, 8, window.innerWidth - 280 - 8),
    };
  }, [editImage, anchorRect]);

  // 确认 → onReplaceImage（formatCtrl.replaceImage 按 token 区间替换，包裹自动保留）
  const handleEditConfirm = useCallback(
    (img: { src: string; alt: string; title: string }) => {
      if (!editImage) return;
      onReplaceImage?.(editImage.blockId, editImage.start, editImage.end, img);
      setEditImage(null);
      onCloseImage?.();
    },
    [editImage, onReplaceImage, onCloseImage]
  );

  const handleEditCancel = useCallback(() => {
    setEditImage(null);
  }, []);

  // 折叠光标命中链接：仅显示「移除链接」（其余格式按钮对空选区无意义）
  const showUnlinkOnly =
    visible && selection ? selection.start === selection.end && selection.inLink : false;

  return (
    <div ref={wrapRef}>
      {/* K4：图片工具栏——imageSelection 非空时替换文本工具栏（锚定图片 rect） */}
      {imageSelection && (
      <div
        ref={toolbarRef}
        className="floating-toolbar-v2 fixed z-[100] shadow-lg select-none"
        data-testid="image-toolbar"
        style={{
          top: `${clamp(
            (anchorRect ?? imageSelection.rect).top - (toolbarRef.current?.offsetHeight ?? 40) - 8,
            8,
            window.innerHeight - (toolbarRef.current?.offsetHeight ?? 40) - 8
          )}px`,
          left: `${clamp(
            (anchorRect ?? imageSelection.rect).left +
              (anchorRect ?? imageSelection.rect).width / 2 -
              (toolbarRef.current?.offsetWidth ?? 320) / 2,
            8,
            window.innerWidth - (toolbarRef.current?.offsetWidth ?? 320) - 8
          )}px`,
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
        }}
        onMouseEnter={cancelHide}
        onMouseLeave={() => scheduleHide(300)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ToolbarButton
          testId="image-toolbar-edit"
          title="修改图片"
          label="修改图片"
          onClick={handleEditImage}
        />
        <ToolbarButton
          testId="image-toolbar-inline"
          title="内联图片"
          label="内联图片"
          disabled={!imageSelection.standalone}
          onClick={handleMakeInline}
        />
        <div className="ft-divider" style={{ backgroundColor: 'var(--border-color)' }} />
        <ToolbarButton
          testId="image-toolbar-align-left"
          title="居左"
          label="居左"
          disabled={!imageSelection.standalone}
          active={imageSelection.align === 'left'}
          onClick={() => handleAlignImage('left')}
        />
        <ToolbarButton
          testId="image-toolbar-align-center"
          title="居中"
          label="居中"
          disabled={!imageSelection.standalone}
          active={imageSelection.align === 'center'}
          onClick={() => handleAlignImage('center')}
        />
        <ToolbarButton
          testId="image-toolbar-align-right"
          title="居右"
          label="居右"
          disabled={!imageSelection.standalone}
          active={imageSelection.align === 'right'}
          onClick={() => handleAlignImage('right')}
        />
        <div className="ft-divider" style={{ backgroundColor: 'var(--border-color)' }} />
        <ToolbarButton
          testId="image-toolbar-remove"
          title="移除图片"
          label="移除图片"
          onClick={handleRemoveImage}
        />
      </div>
      )}
      {!imageSelection && visible && selection && (
      <div
        ref={toolbarRef}
        className="floating-toolbar-v2 fixed z-[100] shadow-lg select-none"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
        }}
        onMouseEnter={cancelHide}
        onMouseLeave={() => scheduleHide(300)}
        onMouseDown={(e) => e.stopPropagation()}
      >
      {/* 块类型下拉：正文 / H1-H6 / 代码块 / 引用 / 列表（自定义面板，SPEC-EDIT-FT G3①） */}
      <div className="block-type-dropdown relative" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          title="块类型"
          className="block-type-trigger rounded border font-medium bg-transparent outline-none cursor-pointer whitespace-nowrap"
          style={{
            borderColor: 'var(--border-color)',
            color: 'var(--text-primary)',
          }}
          onClick={() => setDropdownOpen((o) => !o)}
        >
          {currentLabel}
        </button>
        {dropdownOpen && (
          <div
            className="block-type-menu absolute left-0 top-full mt-1 z-50 rounded-lg shadow-lg py-1 max-h-72 overflow-y-auto"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            {BLOCK_TYPE_OPTIONS.map((option) => {
              const disabled = !canConvertBlock(currentSyntax, option.value);
              const isCurrent = option.value === currentType;
              return (
                <button
                  key={option.value}
                  type="button"
                  data-value={option.value}
                  disabled={disabled}
                  className={`block-type-option w-full text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                    isCurrent ? 'font-bold' : ''
                  }`}
                  style={{
                    color: isCurrent ? 'var(--accent)' : 'var(--text-primary)',
                    backgroundColor: 'transparent',
                  }}
                  onClick={() => {
                    setDropdownOpen(false);
                    handleBlockChange(option.value);
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="ft-divider" style={{ backgroundColor: 'var(--border-color)' }} />

      {showUnlinkOnly ? (
        <ToolbarButton title="移除链接" label="解链" onClick={handleUnlink} />
      ) : (
        <>
          {CHAR_BUTTONS.map((button) => (
            <ToolbarButton
              key={button.style}
              title={button.title}
              label={button.label}
              className={button.className}
              active={activeFormats.has(button.style)}
              onClick={() => handleFormat(button)}
            />
          ))}

          <div className="ft-divider" style={{ backgroundColor: 'var(--border-color)' }} />

          {OBJECT_BUTTONS.map((button) => (
            <ToolbarButton
              key={button.style}
              title={button.title}
              label={button.label}
              onClick={() => handleFormat(button)}
            />
          ))}

          <div className="ft-divider" style={{ backgroundColor: 'var(--border-color)' }} />

          {/* 选区命中链接时提供移除链接；橡皮擦：清除选区全部行内标记 */}
          {selection.inLink && (
            <ToolbarButton title="移除链接" label="解链" onClick={handleUnlink} />
          )}
          <ToolbarButton title="橡皮擦" label="⌫" onClick={handleClearFormat} />
        </>
      )}
      </div>
      )}
      {/* U5：link URL 输入 Modal（open=false 时渲染 null；图片已走 K6 直选） */}
      <InsertUrlModal
        open={insertModal !== null}
        title="插入链接"
        onConfirm={(url) => {
          if (selection) {
            onFormat(selection.blockId, 'link', selection.start, selection.end, url, true);
            // FT3：确认插入后驻留，由 restoreSelection 维持选区非折叠
            stickyRef.current = true;
          }
          setInsertModal(null);
        }}
        onCancel={() => setInsertModal(null)}
      />
      {/* K5：「修改图片」弹层（open=false 时渲染 null；预填 imageSelection token 的
          src/alt/title，确认走 onReplaceImage——image-block 的 token 区间为绝对偏移，
          包裹自动保留；select Tab pickImage 直接应用） */}
      <ImageEditTool
        open={editImage !== null}
        position={editImagePosition}
        initialSrc={editImagePrefill?.src}
        initialAlt={editImagePrefill?.alt}
        initialTitle={editImagePrefill?.title}
        pickImage={window.weaveMD?.dialog.pickImage}
        onConfirm={handleEditConfirm}
        onCancel={handleEditCancel}
      />
    </div>
  );
};

export default FloatingToolbar;

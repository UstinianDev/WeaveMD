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
import { isBoundedWrap } from '@render/editor/kernel';
import { resolveSyntaxType } from '@render/editor/kernel/syntaxType';
import type { SyntaxType } from '@render/editor/kernel/syntaxType';
import {
  BLOCK_TYPE_OPTIONS,
  canConvertBlock,
  type BlockTypeOption,
  type ImageSelection,
} from './types';
import { computeToolbarState, syntaxTypeToOption, type LinkRect, type SelectionState } from './toolbarState';
import { createRafThrottle } from '@render/utils/rafThrottle';
import { readDocumentSelection } from '@render/editor/rewrite/selectionExport';
import { useEditorStore } from '@render/stores/editorStore';
import { useRewriteStore } from '@render/stores/rewriteStore';
import InsertUrlModal from './InsertUrlModal';
import ImageToolbar from './ImageToolbar';
import ToolbarButton from './ToolbarButton';

export type { BlockTypeOption };
// 兼容测试导入：纯函数已迁至 ./toolbarState，此处 re-export 维持
// FloatingToolbarV2.test.tsx 从 FloatingToolbar 导入这两个函数零改动。
export { syntaxTypeToOption, selectionSyntaxTypesConsistent } from './toolbarState';

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

/**
 * SPEC-EDIT-FT R4：从当前 DOM 选区上溯到编辑器内的 `a.inline-link` 链接元素，
 * 取其 getBoundingClientRect() 作为工具栏"链接正左方"定位的参考盒。
 * 折叠光标（startContainer=链接内容文本节点）与覆盖链接文本的选区统一走该路径。
 * 找不到链接（非链接命中 / 链接不在编辑器容器内）→ null，回落既有上方居中。
 */
function getLinkRect(sel: Selection | null, container: HTMLElement): LinkRect | null {
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer ?? sel.anchorNode;
  if (!node) return null;
  const el =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node.parentElement as Element | null);
  if (!el) return null;
  const link = el.closest('a.inline-link');
  if (!link || !container.contains(link)) return null;
  const r = link.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
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
  // K5：ImageToolbar 内部 ImageEditTool 弹层的打开态（经 onModalStateChange 上抛，
  // 风险 A——并入 isModalOpen 守卫，防止点击弹层内误关文本/图片工具栏）
  const [imageModalOpen, setImageModalOpen] = useState(false);
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
  // SPEC-EDIT-FT R4/G4：当前显示的工具栏是否为链接命中（inLink）——滚动时据此决定
  // 重锚定（link）还是沿用既有滚动隐藏（非 link）
  const linkSelectedRef = useRef(false);
  // 链接命中的上一次实际选区（DOM Selection），滚动重查链接 rect 时复用
  const linkHitSelectionRef = useRef<Selection | null>(null);
  // 鼠标拖选期间标记：mousedown（编辑器内）→ 隐藏工具栏且 selectionchange 不重显；
  // mouseup → 重算一次（"松开鼠标才出现浮动工具栏"）
  const mouseDownRef = useRef(false);

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

  // 统一计算并应用工具栏状态（flushSelection / scroll 重锚定共用）。
  // linkRect 由调用方按需传入（链接命中时来自 getLinkRect 的实时盒）。
  const recompute = useCallback(
    (sel: Selection | null, linkRect: LinkRect | null) => {
      const container = editorContainerRef.current;
      if (!container) return;
      const state = computeToolbarState(
        sel,
        container,
        toolbarRef.current?.offsetWidth ?? 320,
        toolbarRef.current?.offsetHeight ?? 40,
        tree,
        linkRect
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
      // SPEC-EDIT-FT R4：仅当显示态为链接命中（inLink）时记录"链接工具栏"，
      // 供滚动守卫重锚定判定；非链接工具栏不置位（回归边界不动）
      linkSelectedRef.current = state.selection.inLink;
      linkHitSelectionRef.current = state.selection.inLink ? sel : null;
      setSelection(state.selection);
      setPosition(state.position);
      setVisibleGuarded(true);
    },
    [editorContainerRef, tree, setVisibleGuarded, cancelHide, scheduleHide]
  );

  // 从最新选区统一刷新工具栏（selectionchange / mouseup 共用）：
  // Modal / ImageEditTool 打开、图片选中、suppress 消费均在此守卫。
  const flushSelection = useCallback(() => {
    // U5/K3b：Modal / ImageEditTool 打开期间（输入框获焦会收起选区）不得隐藏工具栏
    if (insertModal !== null || imageModalOpen) {
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
    const sel = latestSelectionRef.current;
    // SPEC-EDIT-FT R4：选区命中链接 → 取链接元素实时盒传入定位；否则 null（上方居中）。
    const container = editorContainerRef.current;
    if (!container) return;
    const linkRect = getLinkRect(sel, container);
    recompute(sel, linkRect);
  }, [editorContainerRef, insertModal, imageModalOpen, imageSelection, cancelHide, recompute]);

  const selectionThrottle = useMemo(
    () => createRafThrottle(flushSelection),
    [flushSelection]
  );

  // 选区变化：非折叠且在编辑器内容块内 → 显示；收起/移出 → 延迟隐藏。
  // 拖选期间（鼠标按下）仅记录选区、不显示——松开鼠标（mouseup）才出现浮动工具栏。
  // SPEC-EDIT-DSF 4.3：事件仅写入 latestSelectionRef 并调度一帧（rAF id 去重，
  // 已有待处理帧则复用），帧内才执行 computeToolbarState + setState → 渲染 ≤ 每帧一次。
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const handleSelectionChange = () => {
      latestSelectionRef.current = window.getSelection();
      if (mouseDownRef.current) return;
      selectionThrottle.schedule();
    };

    const handleScroll = () => {
      // SPEC-EDIT-FT G4：仅"链接工具栏"场景滚动 → 重查链接 rect 重定位（不隐藏）；
      // 且需工具栏当前仍可见（显式 Escape/外部点击隐藏后不得因滚动重显）。
      if (linkSelectedRef.current && visibleRef.current && linkHitSelectionRef.current) {
        const linkRect = getLinkRect(linkHitSelectionRef.current, container);
        recompute(linkHitSelectionRef.current, linkRect);
        return;
      }
      // 非链接场景保持既有"滚动隐藏"行为（回归边界不动）
      stickyRef.current = false;
      setVisibleGuarded(false);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    container.addEventListener('scroll', handleScroll, true);
    return () => {
      selectionThrottle.cancel();
      document.removeEventListener('selectionchange', handleSelectionChange);
      container.removeEventListener('scroll', handleScroll, true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [editorContainerRef, selectionThrottle, recompute, setVisibleGuarded]);

  // "松开鼠标才出现浮动工具栏"：mousedown（编辑器内，非工具栏）立即隐藏并标记拖选中，
  // 拖选期间 selectionchange 不重显；mouseup 以最新选区重算一次（低频事件，同步 flush）。
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      mouseDownRef.current = true;
      setVisibleGuarded(false);
    };
    const handleMouseUp = () => {
      mouseDownRef.current = false;
      latestSelectionRef.current = window.getSelection();
      selectionThrottle.flushNow();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [selectionThrottle, setVisibleGuarded]);

  // SPEC-EDIT-FT3 4.3：驻留退出条件——点击工具栏外任意位置（capture 阶段）与 Escape
  // K3b：守卫合并 insertModal / imageModalOpen（ImageEditTool 自处理自身交互，弹层态经
  // onModalStateChange 上抛并入此守卫），wrapRef 覆盖工具栏与 ImageToolbar 挂载点
  const isModalOpen = insertModal !== null || imageModalOpen;
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // U5/K3b：Modal / ImageEditTool 打开期间点击自身或外部均由弹层处理，不隐工具栏
      if (isModalOpen) return;
      // R1：图片选中框/四角缩放手柄（.image-resize-box）由 ImageResizeBox 自管拖拽，
      // 不属于工具栏/图片工具栏交互区——点击其手柄不应关闭图片选中（否则拖拽被终止）。
      const target = e.target as Element;
      if (target.closest?.('.image-resize-box')) return;
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

  /** 第 5 期「AI 改写」：读编辑器 content + DOM 选区 → 触发选区改写（批次 4 落地 store 行为） */
  const handleRewriteClick = useCallback(() => {
    const content = useEditorStore.getState().content;
    const sel = readDocumentSelection(content);
    if (!sel) return; // 选区为空 / 端点异常 → 禁用（保守 no-op）
    useRewriteStore.getState().startSelectionRewrite(content, sel);
    hideToolbar();
  }, [hideToolbar]);

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

  // Bug fix：折叠光标在链接内不再显示「块类型 | 解链」工具栏（点击链接内容不再弹工具栏）。
  // 解链改由选中链接文本后经非折叠工具栏的「移除链接」完成。
  // bug 4：代码块为 raw 纯文本，行内格式不渲染 → 字符/对象格式按钮禁用（仅块类型下拉可用）
  const isCodeBlock = currentSyntax.type === 'code-block';

  return (
    <div ref={wrapRef}>
      {/* K4：图片工具栏——imageSelection 非空时渲染 ImageToolbar 替换文本工具栏 */}
      {imageSelection && (
        <ImageToolbar
          imageSelection={imageSelection}
          editorContainerRef={editorContainerRef}
          tree={tree}
          onCloseImage={onCloseImage}
          onEditImage={onEditImage}
          onAlignImage={onAlignImage}
          onMakeInline={onMakeInline}
          onRemoveImage={onRemoveImage}
          onReplaceImage={onReplaceImage}
          onModalStateChange={setImageModalOpen}
        />
      )}
      {!imageSelection && visible && selection && (
      <div
        ref={toolbarRef}
        data-mixed={selection.mixedSyntax ? 'true' : undefined}
        className="floating-toolbar-v2 ft-toolbar fixed z-[100] shadow-lg select-none"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
        }}
        onMouseEnter={cancelHide}
        onMouseLeave={() => scheduleHide(300)}
        onMouseDown={(e) => e.stopPropagation()}
      >
      {/* A2 混合语法类型：仅「AI 改写」（行内格式/块类型对混合选区语义模糊，隐藏）
          非混合选区保留完整工具栏 —— 块类型下拉 + 行内格式 + AI 改写 + 解链/橡皮擦 */}
      {!selection.mixedSyntax && (
        <>
      {/* 块类型下拉：正文 / H1-H6 / 代码块 / 引用 / 列表（自定义面板，SPEC-EDIT-FT G3①） */}
      <div className="block-type-dropdown relative" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          title="块类型"
          className="block-type-trigger rounded border font-medium bg-transparent outline-none cursor-pointer whitespace-nowrap"
          onClick={() => setDropdownOpen((o) => !o)}
        >
          {currentLabel}
        </button>
        {dropdownOpen && (
          <div
            className="block-type-menu absolute left-0 top-full mt-1 z-50 rounded-lg shadow-lg py-1 max-h-72 overflow-y-auto"
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
                    isCurrent ? 'font-bold block-type-option--current' : ''
                  }`}
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

      <div className="ft-divider" />

      {CHAR_BUTTONS.map((button) => (
        <ToolbarButton
          key={button.style}
          title={button.title}
          label={button.label}
          className={button.className}
          active={activeFormats.has(button.style)}
          disabled={isCodeBlock}
          onClick={() => handleFormat(button)}
        />
      ))}

      <div className="ft-divider" />

      {OBJECT_BUTTONS.map((button) => (
        <ToolbarButton
          key={button.style}
          title={button.title}
          label={button.label}
          disabled={isCodeBlock}
          onClick={() => handleFormat(button)}
        />
      ))}

      <div className="ft-divider" />

      {/* 第 5 期「AI 改写」：选区态触发块级改写（选区为空时工具栏本身不显示） */}
      <ToolbarButton
        title="AI 改写"
        label="AI 改写"
        className="text-[var(--accent)]"
        onClick={handleRewriteClick}
      />

      <div className="ft-divider" />

      {/* 选区命中链接时提供移除链接；橡皮擦：清除选区全部行内标记 */}
      {selection.inLink && (
        <ToolbarButton title="移除链接" label="解链" onClick={handleUnlink} />
      )}
      <ToolbarButton
        title="橡皮擦"
        label="⌫"
        disabled={isCodeBlock}
        onClick={handleClearFormat}
      />
        </>
      )}
      {/* A2 混合语法类型：仅「AI 改写」入口（跨块类型不一致无法单点 resolve 块格式） */}
      {selection.mixedSyntax && (
        <span className="ft-mixed-hint px-2 text-[11px] italic opacity-70 select-none">
          跨块选区
        </span>
      )}
      {selection.mixedSyntax && (
        <ToolbarButton
          title="AI 改写"
          label="AI 改写"
          className="text-[var(--accent)]"
          onClick={handleRewriteClick}
        />
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
    </div>
  );
};

export default FloatingToolbar;

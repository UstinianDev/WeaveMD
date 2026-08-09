// ============================================
// WeaveMD Editor v2 — 浮动工具栏（marktext 风格）
// ============================================
// 文本选区非折叠时出现在选区上方（触发规则与 marktext 一致）：
// 最左侧为块类型下拉（正文 / H1-H6），其余为行内格式按钮
// （加粗 / 斜体 / 删除线 / 行内代码 / 链接 / 高亮）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { InlineFormatStyle } from '../../../editor/controllers';
import type { BlockTreeV2 } from '../../../editor/kernel';
import { isBoundedWrap } from '../../../editor/kernel';
import {
  getCursorOffsets,
  nearestContentSpan as kernelNearestContentSpan,
} from '../../../editor/kernel/selection';
import { resolveSyntaxType, resolveSyntaxTypesInRange } from '../../../editor/kernel/syntaxType';
import type { SyntaxType } from '../../../editor/kernel/syntaxType';
import {
  BLOCK_TYPE_OPTIONS,
  canConvertBlock,
  type BlockTypeOption,
} from './types';

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
}

interface SelectionState {
  blockId: string;
  start: number;
  end: number;
  anchorText: string;
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
    activeTest: (t) => isBoundedWrap(t, '**', '**'),
  },
  {
    style: 'italic',
    label: 'I',
    title: '斜体',
    group: 'char',
    className: 'italic',
    activeTest: (t) => isBoundedWrap(t, '*', '*'),
  },
  {
    style: 'underline',
    label: 'U',
    title: '下划线',
    group: 'char',
    className: 'underline',
    activeTest: (t) => isBoundedWrap(t, '<u>', '</u>'),
  },
  {
    style: 'strike',
    label: 'S',
    title: '删除线',
    group: 'char',
    className: 'line-through',
    activeTest: (t) => isBoundedWrap(t, '~~', '~~'),
  },
  {
    style: 'code',
    label: '</>',
    title: '行内代码',
    group: 'char',
    activeTest: (t) => isBoundedWrap(t, '`', '`'),
  },
  {
    style: 'highlight',
    label: 'H',
    title: '高亮',
    group: 'char',
    activeTest: (t) => isBoundedWrap(t, '==', '=='),
  },
];

/** SPEC-EDIT-FT2 4.6：对象插入组（弹 URL 输入） */
const OBJECT_BUTTONS: FormatButton[] = [
  { style: 'link', label: '🔗', title: '链接', group: 'object' },
  { style: 'image', label: '🖼', title: '图片', group: 'object' },
  { style: 'math', label: '∑', title: '数学公式', group: 'object' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

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

/** 选区判定结果：hide=立即隐藏，fade=延迟隐藏，show=显示并携带选区与位置 */
type ToolbarState =
  | { kind: 'hide' }
  | { kind: 'fade' }
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
  if (sel.isCollapsed) return { kind: 'fade' };
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
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return { kind: 'fade' };
  const offsets = getCursorOffsets(anchorSpan);
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
}) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // SPEC-EDIT-DSF 4.3：rAF 节流与可见性去重（避免拖选期间每帧重复 setVisible）
  const latestSelectionRef = useRef<Selection | null>(null);
  const rafIdRef = useRef<number | null>(null);
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

  // 选区变化：非折叠且在编辑器内容块内 → 显示；收起/移出 → 延迟隐藏。
  // SPEC-EDIT-DSF 4.3：事件仅写入 latestSelectionRef 并调度一帧（rAF id 去重，
  // 已有待处理帧则复用），帧内才执行 computeToolbarState + setState → 渲染 ≤ 每帧一次。
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const flushSelection = () => {
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
      if (state.kind === 'fade') {
        scheduleHide();
        return;
      }
      cancelHide();
      setSelection(state.selection);
      setPosition(state.position);
      setVisibleGuarded(true);
    };

    const handleSelectionChange = () => {
      latestSelectionRef.current = window.getSelection();
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        flushSelection();
      });
    };

    const handleScroll = () => {
      stickyRef.current = false;
      setVisibleGuarded(false);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    container.addEventListener('scroll', handleScroll, true);
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      document.removeEventListener('selectionchange', handleSelectionChange);
      container.removeEventListener('scroll', handleScroll, true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [editorContainerRef, cancelHide, scheduleHide, tree, setVisibleGuarded]);

  // SPEC-EDIT-FT3 4.3：驻留退出条件——点击工具栏外任意位置（capture 阶段）与 Escape
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!stickyRef.current) return;
      if (toolbarRef.current?.contains(e.target as Node)) return;
      suppressSelectionRef.current = true;
      hideToolbar();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (visibleRef.current) hideToolbar();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [hideToolbar]);

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

  const handleFormat = useCallback(
    (button: FormatButton) => {
      if (!selection) return;
      if (button.style === 'link' || button.style === 'image') {
        const url = window.prompt(
          button.style === 'link' ? '输入链接 URL' : '输入图片 URL'
        );
        if (url === null) return;
        onFormat(selection.blockId, button.style, selection.start, selection.end, url, true);
      } else {
        onFormat(selection.blockId, button.style, selection.start, selection.end, undefined, true);
      }
      // FT3：格式应用后驻留，不退出；由 restoreSelection 保持选区非折叠以维持显示
      stickyRef.current = true;
    },
    [selection, onFormat]
  );

  const handleClearFormat = useCallback(() => {
    if (!selection || !onClearFormat) return;
    onClearFormat(selection.blockId, selection.start, selection.end, true);
    stickyRef.current = true;
  }, [selection, onClearFormat]);

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

  if (!visible || !selection) return null;

  return (
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

      {CHAR_BUTTONS.map((button) => {
        const isActive = activeFormats.has(button.style);
        return (
          <button
            key={button.style}
            type="button"
            title={button.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleFormat(button);
            }}
            className={`ft-btn ${button.className ?? ''}`}
            style={{
              color: isActive ? 'var(--accent)' : 'var(--text-sub)',
              backgroundColor: isActive ? 'var(--bg-tertiary)' : 'transparent',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = isActive
                ? 'var(--bg-tertiary)'
                : 'transparent';
            }}
          >
            {button.label}
          </button>
        );
      })}

      <div className="ft-divider" style={{ backgroundColor: 'var(--border-color)' }} />

      {OBJECT_BUTTONS.map((button) => (
        <button
          key={button.style}
          type="button"
          title={button.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleFormat(button);
          }}
          className="ft-btn"
          style={{ color: 'var(--text-sub)', backgroundColor: 'transparent' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {button.label}
        </button>
      ))}

      <div className="ft-divider" style={{ backgroundColor: 'var(--border-color)' }} />

      {/* 橡皮擦：清除选区全部行内标记（SPEC-EDIT-FT2 4.5.4） */}
      <button
        type="button"
        title="橡皮擦"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleClearFormat();
        }}
        className="ft-btn"
        style={{ color: 'var(--text-sub)', backgroundColor: 'transparent' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        ⌫
      </button>
    </div>
  );
};

export default FloatingToolbar;

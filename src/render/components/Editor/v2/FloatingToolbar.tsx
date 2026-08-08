// ============================================
// WeaveMD Editor v2 — 浮动工具栏（marktext 风格）
// ============================================
// 文本选区非折叠时出现在选区上方（触发规则与 marktext 一致）：
// 最左侧为块类型下拉（正文 / H1-H6），其余为行内格式按钮
// （加粗 / 斜体 / 删除线 / 行内代码 / 链接 / 高亮）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { InlineFormatStyle } from '../../../editor/controllers';
import type { BlockTreeV2 } from '../../../editor/kernel';
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
    url?: string
  ) => void;
  onConvertBlock: (blockId: string, target: BlockTypeOption) => void;
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
  className?: string;
  activeTest?: (text: string) => boolean;
}

const FORMAT_BUTTONS: FormatButton[] = [
  {
    style: 'bold',
    label: 'B',
    title: '加粗',
    className: 'font-bold',
    activeTest: (t) => t.startsWith('**') && t.endsWith('**'),
  },
  {
    style: 'italic',
    label: 'I',
    title: '斜体',
    className: 'italic',
    activeTest: (t) => t.startsWith('*') && t.endsWith('*') && !t.startsWith('**'),
  },
  {
    style: 'strike',
    label: 'S',
    title: '删除线',
    className: 'line-through',
    activeTest: (t) => t.startsWith('~~') && t.endsWith('~~'),
  },
  {
    style: 'code',
    label: '</>',
    title: '行内代码',
    activeTest: (t) => t.startsWith('`') && t.endsWith('`'),
  },
  { style: 'link', label: '🔗', title: '链接' },
  {
    style: 'highlight',
    label: 'H',
    title: '高亮',
    activeTest: (t) => t.startsWith('==') && t.endsWith('=='),
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** 从选区节点向上找最近的 block-content 内容 span（限制在编辑器容器内） */
function nearestContentSpan(node: Node | null, container: HTMLElement): HTMLElement | null {
  const span = kernelNearestContentSpan(node);
  return span && container.contains(span) ? span : null;
}

/** 语法类型相等判定（heading 需 level 相等，其余同 type 即相等） */
function sameSyntaxType(a: SyntaxType, b: SyntaxType): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'heading' && b.type === 'heading') return a.level === b.level;
  return true;
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
  if (!types || types.length === 0) return false;
  const first = types[0];
  return types.every((t) => sameSyntaxType(t, first));
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

  const setVisibleGuarded = useCallback((value: boolean) => {
    if (visibleRef.current !== value) {
      visibleRef.current = value;
      setVisible(value);
    }
  }, []);

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

    const handleScroll = () => setVisibleGuarded(false);

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
    for (const button of FORMAT_BUTTONS) {
      if (button.activeTest?.(selection.anchorText)) set.add(button.style);
    }
    return set;
  }, [selection]);

  const handleFormat = useCallback(
    (button: FormatButton) => {
      if (!selection) return;
      if (button.style === 'link') {
        const url = window.prompt('输入链接 URL');
        if (url === null) return;
        onFormat(selection.blockId, 'link', selection.start, selection.end, url);
      } else {
        onFormat(selection.blockId, button.style, selection.start, selection.end);
      }
      setVisibleGuarded(false);
    },
    [selection, onFormat, setVisibleGuarded]
  );

  const handleBlockChange = useCallback(
    (target: BlockTypeOption) => {
      if (selection && target !== currentType) {
        onConvertBlock(selection.blockId, target);
      }
      setVisibleGuarded(false);
    },
    [selection, currentType, onConvertBlock, setVisibleGuarded]
  );

  if (!visible || !selection) return null;

  return (
    <div
      ref={toolbarRef}
      className="floating-toolbar-v2 fixed z-[100] flex items-center gap-0.5 px-1.5 py-1 rounded-lg shadow-lg select-none"
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
          className="block-type-trigger h-7 px-1.5 mr-1 rounded border text-xs font-medium bg-transparent outline-none cursor-pointer whitespace-nowrap"
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
            className="block-type-menu absolute left-0 top-full mt-1 z-50 rounded-lg shadow-lg py-1 min-w-[170px] max-h-72 overflow-y-auto"
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
                  className={`block-type-option w-full text-left px-3 py-1.5 text-xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
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

      <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

      {FORMAT_BUTTONS.map((button) => {
        const isActive = activeFormats.has(button.style);
        return (
          <button
            key={button.style}
            title={button.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleFormat(button);
            }}
            className={`w-8 h-7 flex items-center justify-center rounded text-xs transition-colors duration-100 ${button.className ?? ''}`}
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
    </div>
  );
};

export default FloatingToolbar;

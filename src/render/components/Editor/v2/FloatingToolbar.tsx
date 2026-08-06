// ============================================
// WeaveMD Editor v2 — 浮动工具栏（marktext 风格）
// ============================================
// 文本选区非折叠时出现在选区上方（触发规则与 marktext 一致）：
// 最左侧为块类型下拉（正文 / H1-H6），其余为行内格式按钮
// （加粗 / 斜体 / 删除线 / 行内代码 / 链接 / 高亮）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { InlineFormatStyle } from '../../../editor/controllers';
import type { BlockTreeV2 } from '../../../editor/kernel';
import { getCursorOffsets } from '../../../editor/kernel/selection';

export type BlockTypeOption = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

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

const BLOCK_OPTIONS: Array<{ value: BlockTypeOption; label: string }> = [
  { value: 'paragraph', label: '正文' },
  { value: 'h1', label: 'H1 一级标题' },
  { value: 'h2', label: 'H2 二级标题' },
  { value: 'h3', label: 'H3 三级标题' },
  { value: 'h4', label: 'H4 四级标题' },
  { value: 'h5', label: 'H5 五级标题' },
  { value: 'h6', label: 'H6 六级标题' },
];

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
function nearestContentSpan(
  node: Node | null,
  container: HTMLElement
): HTMLElement | null {
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  if (!el || !container.contains(el)) return null;
  return el.closest('span.block-content') as HTMLElement | null;
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

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(
    (delay = 180) => {
      cancelHide();
      hideTimerRef.current = setTimeout(() => setVisible(false), delay);
    },
    [cancelHide]
  );

  // 选区变化：非折叠且在编辑器内容块内 → 显示；收起/移出 → 延迟隐藏
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        setVisible(false);
        return;
      }
      if (sel.isCollapsed) {
        scheduleHide();
        return;
      }
      const range = sel.getRangeAt(0);
      const anchorSpan = nearestContentSpan(sel.anchorNode, container);
      const focusSpan = nearestContentSpan(sel.focusNode, container);
      if (!anchorSpan || !focusSpan || !container.contains(range.commonAncestorContainer)) {
        setVisible(false);
        return;
      }
      const blockId = anchorSpan.getAttribute('data-block-id');
      if (!blockId) {
        setVisible(false);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        scheduleHide();
        return;
      }
      const offsets = getCursorOffsets(anchorSpan);
      cancelHide();
      setSelection({
        blockId,
        start: offsets.start,
        end: offsets.end,
        anchorText: anchorSpan.textContent ?? '',
      });
      const toolbarWidth = toolbarRef.current?.offsetWidth ?? 320;
      const toolbarHeight = toolbarRef.current?.offsetHeight ?? 40;
      const left = clamp(
        rect.left + rect.width / 2 - toolbarWidth / 2,
        8,
        window.innerWidth - toolbarWidth - 8
      );
      const top = clamp(
        rect.top - toolbarHeight - 8,
        8,
        window.innerHeight - toolbarHeight - 8
      );
      setPosition({ top, left });
      setVisible(true);
    };

    const handleScroll = () => setVisible(false);

    document.addEventListener('selectionchange', handleSelectionChange);
    container.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      container.removeEventListener('scroll', handleScroll, true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [editorContainerRef, cancelHide, scheduleHide]);

  const currentType: BlockTypeOption = useMemo(() => {
    if (!selection) return 'paragraph';
    const block = tree.blocks[selection.blockId];
    if (!block) return 'paragraph';
    if (block.type === 'heading') {
      const level = Math.min(6, Math.max(1, block.meta?.headingLevel ?? 1));
      return `h${level}` as BlockTypeOption;
    }
    if (block.type === 'paragraph') return 'paragraph';
    return 'paragraph';
  }, [selection, tree]);

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
      setVisible(false);
    },
    [selection, onFormat]
  );

  const handleBlockChange = useCallback(
    (target: BlockTypeOption) => {
      if (selection && target !== currentType) {
        onConvertBlock(selection.blockId, target);
      }
      setVisible(false);
    },
    [selection, currentType, onConvertBlock]
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
      {/* 块类型下拉：正文 / H1-H6 */}
      <select
        className="h-7 px-1.5 mr-1 rounded border text-xs font-medium bg-transparent outline-none cursor-pointer"
        style={{
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)',
        }}
        value={currentType}
        title="块类型"
        onMouseDown={(e) => e.preventDefault()}
        onChange={(e) => handleBlockChange(e.target.value as BlockTypeOption)}
      >
        {BLOCK_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockId, BlockNode, BlockTree } from '../../services/blockTree';

interface ToolbarPosition {
  top: number;
  left: number;
}

interface BlockInfo {
  blockId: BlockId;
  block: BlockNode;
}

interface FloatingToolbarWYSIWYGProps {
  blockTree: BlockTree;
  content: string;
  onContentChange: (content: string) => void;
  onBlockTypeChange: (
    blockId: BlockId,
    newType: string,
    headingLevel?: number,
    orderedIndex?: number,
    checked?: boolean,
    fenceLanguage?: string
  ) => void;
  onShowMdSource: (blockId: BlockId) => void;
  isSourceCodeMode: boolean;
}

const STRUCTURE_OPTIONS = [
  { value: 'paragraph', label: '正文' },
  { value: 'heading-1', label: '一级标题' },
  { value: 'heading-2', label: '二级标题' },
  { value: 'heading-3', label: '三级标题' },
  { value: 'heading-4', label: '四级标题' },
  { value: 'heading-5', label: '五级标题' },
  { value: 'heading-6', label: '六级标题' },
  { value: 'unordered-list-item', label: '无序列表' },
  { value: 'ordered-list-item', label: '有序列表' },
  { value: 'task-list-item', label: '任务' },
  { value: 'code-fence', label: '代码块' },
  { value: 'blockquote', label: '引用' },
];

const FloatingToolbarWYSIWYG: React.FC<FloatingToolbarWYSIWYGProps> = ({
  blockTree,
  content: _content,
  onContentChange: _onContentChange,
  onBlockTypeChange,
  onShowMdSource,
  isSourceCodeMode,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<ToolbarPosition>({ top: 0, left: 0 });
  const [selectedBlockInfo, setSelectedBlockInfo] = useState<BlockInfo | null>(null);
  const [isStructureDropdownOpen, setIsStructureDropdownOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getBlockIdFromElement = useCallback((element: Node | null): BlockId | null => {
    if (!element) return null;
    const el =
      element.nodeType === Node.TEXT_NODE ? element.parentElement : (element as HTMLElement);
    if (!el) return null;
    const blockEl = el.closest('[data-block-id]');
    return blockEl ? (blockEl.getAttribute('data-block-id') as BlockId) : null;
  }, []);

  const isSelectionWithinSingleBlock = useCallback((): BlockInfo | null => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const startBlockId = getBlockIdFromElement(range.startContainer);
    const endBlockId = getBlockIdFromElement(range.endContainer);
    if (startBlockId && startBlockId === endBlockId) {
      const block = blockTree.blocks[startBlockId];
      if (block) return { blockId: startBlockId, block };
    }
    return null;
  }, [blockTree, getBlockIdFromElement]);

  useEffect(() => {
    if (isSourceCodeMode) {
      setIsVisible(false);
      return;
    }
    const handleSelectionChange = () => {
      if (isStructureDropdownOpen) return;
      const blockInfo = isSelectionWithinSingleBlock();
      if (!blockInfo) {
        setIsVisible(false);
        return;
      }
      const selection = window.getSelection();
      if (!selection) {
        setIsVisible(false);
        return;
      }
      const text = selection.toString() || '';
      if (!text.trim()) {
        setIsVisible(false);
        return;
      }
      setSelectedBlockInfo(blockInfo);
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const toolbarHeight = toolbarRef.current?.offsetHeight ?? 40;
      setPosition({ top: rect.top - toolbarHeight - 8, left: rect.left + rect.width / 2 });
      setIsVisible(true);
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [isSourceCodeMode, isSelectionWithinSingleBlock, isStructureDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!toolbarRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
          setIsVisible(false);
        }
        setIsStructureDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const wrapRangeWithTag = useCallback((tag: string, className?: string) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const el = document.createElement(tag);
    if (className) el.className = className;
    try {
      range.surroundContents(el);
    } catch {
      const frag = range.extractContents();
      el.appendChild(frag);
      range.insertNode(el);
    }
    const newRange = document.createRange();
    newRange.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }, []);

  const afterFormat = useCallback(() => {
    const container = document.getElementById('editor-content-area');
    if (container) container.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);

  const handleBold = useCallback(() => {
    document.execCommand('bold', false, undefined);
    afterFormat();
  }, [afterFormat]);

  const handleItalic = useCallback(() => {
    document.execCommand('italic', false, undefined);
    afterFormat();
  }, [afterFormat]);

  const handleUnderline = useCallback(() => {
    document.execCommand('underline', false, undefined);
    afterFormat();
  }, [afterFormat]);

  const handleHighlight = useCallback(() => {
    wrapRangeWithTag('mark');
    afterFormat();
  }, [wrapRangeWithTag, afterFormat]);

  const handleCode = useCallback(() => {
    wrapRangeWithTag('code', 'inline-code');
    afterFormat();
  }, [wrapRangeWithTag, afterFormat]);

  const handleLink = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const url = window.prompt('Enter URL:', 'https://');
    if (url === null) return;
    const href = url.trim() === '' ? 'url' : url.trim();
    wrapRangeWithTag('a', 'inline-link');
    const anchor = sel?.anchorNode?.parentElement?.closest('a.inline-link');
    if (anchor) {
      (anchor as HTMLAnchorElement).href = href;
      if (href === 'url') (anchor as HTMLAnchorElement).dataset.placeholder = 'true';
      anchor.addEventListener('click', (e) => {
        if ((e.currentTarget as HTMLElement).dataset.placeholder === 'true') e.preventDefault();
      });
    }
    afterFormat();
  }, [wrapRangeWithTag, afterFormat]);

  const handleComment = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.collapse(false);
    const marker = document.createElement('span');
    marker.className = 'comment-marker';
    marker.title = 'comment';
    marker.textContent = '[✎]';
    range.insertNode(marker);
    afterFormat();
  }, [afterFormat]);

  const handleStructureChange = useCallback(
    (value: string) => {
      if (!selectedBlockInfo) return;
      let blockType = value;
      let headingLevel: number | undefined;
      if (value.startsWith('heading-')) {
        headingLevel = parseInt(value.split('-')[1]);
        blockType = 'heading';
      }
      onBlockTypeChange(selectedBlockInfo.blockId, blockType, headingLevel, 1, false, 'plaintext');
      setIsStructureDropdownOpen(false);
      setIsVisible(false);
    },
    [selectedBlockInfo, onBlockTypeChange]
  );

  const handleShowMdSource = useCallback(() => {
    if (!selectedBlockInfo) return;
    onShowMdSource(selectedBlockInfo.blockId);
    setIsVisible(false);
  }, [selectedBlockInfo, onShowMdSource]);

  if (!isVisible || isSourceCodeMode) return null;

  const currentStructure =
    selectedBlockInfo?.block.type === 'heading'
      ? 'heading-' + selectedBlockInfo.block.headingLevel
      : selectedBlockInfo?.block.type;

  return (
    <React.Fragment>
      <div
        ref={toolbarRef}
        className="floating-toolbar-wysiwyg fixed z-[100] flex items-center gap-1 px-2 py-1 rounded-lg shadow-lg"
        style={{
          top: position.top + 'px',
          left: position.left + 'px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          transform: 'translateX(-50%)',
        }}
      >
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsStructureDropdownOpen(!isStructureDropdownOpen);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {STRUCTURE_OPTIONS.find((opt) => opt.value === currentStructure)?.label || '正文'}
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {isStructureDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-lg py-1 z-50 min-w-[120px]">
              {STRUCTURE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleStructureChange(option.value)}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-tertiary)]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />
        <button
          title="Bold"
          onClick={handleBold}
          className="w-7 h-6 flex items-center justify-center rounded text-xs font-bold"
          style={{ color: 'var(--text-sub)' }}
        >
          B
        </button>
        <button
          title="Italic"
          onClick={handleItalic}
          className="w-7 h-6 flex items-center justify-center rounded text-xs italic"
          style={{ color: 'var(--text-sub)' }}
        >
          I
        </button>
        <button
          title="Underline"
          onClick={handleUnderline}
          className="w-7 h-6 flex items-center justify-center rounded text-xs"
          style={{ color: 'var(--text-sub)', textDecoration: 'underline' }}
        >
          U
        </button>
        <button
          title="Highlight"
          onClick={handleHighlight}
          className="w-7 h-6 flex items-center justify-center rounded text-xs"
          style={{ color: 'var(--text-sub)' }}
        >
          H
        </button>
        <button
          title="Code"
          onClick={handleCode}
          className="w-7 h-6 flex items-center justify-center rounded text-xs font-mono"
          style={{ color: 'var(--text-sub)' }}
        >
          {'`'}
        </button>
        <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />
        <button
          title="Link"
          onClick={handleLink}
          className="w-7 h-6 flex items-center justify-center rounded text-xs"
          style={{ color: 'var(--text-sub)' }}
        >
          Link
        </button>
        <button
          title="Comment"
          onClick={handleComment}
          className="w-7 h-6 flex items-center justify-center rounded text-xs"
          style={{ color: 'var(--text-sub)' }}
        >
          Cm
        </button>
        <button
          title="MD Source"
          onClick={handleShowMdSource}
          className="w-7 h-6 flex items-center justify-center rounded text-xs"
          style={{ color: 'var(--text-sub)' }}
        >
          Src
        </button>
      </div>
    </React.Fragment>
  );
};

export default FloatingToolbarWYSIWYG;

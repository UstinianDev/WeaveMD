const fs = require('fs');
const path = require('path');

const content = `import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockTree, BlockId, BlockNode } from '../../services/blockTree';

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
  onBlockTypeChange: (blockId: BlockId, newType: string) => void;
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

const FORMAT_ACTIONS = [
  { label: 'B', title: 'Bold', wrapper: '**', pattern: /^\\\\*\\\\*(.+)\\\\*\\\\*$/ },
  { label: 'I', title: 'Italic', wrapper: '*', pattern: /^\\\\*(.+)\\\\*$/ },
  { label: 'U', title: 'Underline', wrapper: '<u>', endWrapper: '</u>', pattern: /^<u>(.+)<\\/u>$/ },
  { label: 'H', title: 'Highlight', wrapper: '==', pattern: /^==(.+)==$/ },
  { label: '</>', title: 'Code', wrapper: '\`', pattern: /^\`(.+)\`$/ },
];

const FloatingToolbarWYSIWYG: React.FC<FloatingToolbarWYSIWYGProps> = ({
  blockTree,
  content,
  onContentChange,
  onBlockTypeChange,
  onShowMdSource,
  isSourceCodeMode,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<ToolbarPosition>({ top: 0, left: 0 });
  const [selectedBlockInfo, setSelectedBlockInfo] = useState<BlockInfo | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [isStructureDropdownOpen, setIsStructureDropdownOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getBlockIdFromElement = useCallback((element: Node | null): BlockId | null => {
    if (!element) return null;
    const el = element as HTMLElement;
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
      if (block) {
        return { blockId: startBlockId, block };
      }
    }

    return null;
  }, [blockTree, getBlockIdFromElement]);

  const computeToolbarPosition = useCallback((): ToolbarPosition | null => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const toolbarHeight = toolbarRef.current?.offsetHeight ?? 40;
    const top = rect.top - toolbarHeight - 8;
    const left = rect.left + rect.width / 2;

    return { top, left };
  }, []);

  const clampToViewport = useCallback((pos: ToolbarPosition): ToolbarPosition => {
    const clamped = { ...pos };
    const toolbarWidth = toolbarRef.current?.offsetWidth ?? 320;
    const toolbarHeight = toolbarRef.current?.offsetHeight ?? 40;

    if (clamped.top < 8) {
      clamped.top = 8;
    }
    if (clamped.top + toolbarHeight > window.innerHeight - 8) {
      clamped.top = window.innerHeight - toolbarHeight - 8;
    }
    if (clamped.left < 8) {
      clamped.left = 8;
    }
    if (clamped.left + toolbarWidth > window.innerWidth - 8) {
      clamped.left = window.innerWidth - toolbarWidth - 8;
    }

    return clamped;
  }, []);

  useEffect(() => {
    if (isSourceCodeMode) {
      setIsVisible(false);
      return;
    }

    const handleSelectionChange = () => {
      if (isStructureDropdownOpen) return;

      const blockInfo = isSelectionWithinSingleBlock();
      if (!blockInfo) {
        hideTimerRef.current = setTimeout(() => setIsVisible(false), 200);
        return;
      }

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      const selection = window.getSelection();
      const text = selection?.toString() || '';
      if (!text.trim()) {
        hideTimerRef.current = setTimeout(() => setIsVisible(false), 200);
        return;
      }

      setSelectedBlockInfo(blockInfo);
      setSelectedText(text);

      const pos = computeToolbarPosition();
      if (pos) {
        setPosition(clampToViewport(pos));
        setIsVisible(true);
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [isSourceCodeMode, isSelectionWithinSingleBlock, computeToolbarPosition, clampToViewport, isStructureDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!toolbarRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setIsVisible(false);
        setIsStructureDropdownOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleFormat = useCallback((wrapper: string, endWrapper?: string, pattern?: RegExp) => {
    if (!selectedBlockInfo || !selectedText) return;

    const block = selectedBlockInfo.block;
    let newSourceLines = [...block.sourceLines];
    const lineIndex = 0;
    let line = newSourceLines[lineIndex] || '';

    const prefix = block.type === 'heading' ? '#'.repeat(block.headingLevel || 1) + ' ' : '';
    const textContent = line.replace(new RegExp(\`^\${prefix}\`), '');

    let newText: string;
    if (pattern && pattern.test(selectedText)) {
      newText = selectedText.replace(pattern, '$1');
    } else {
      const endW = endWrapper || wrapper;
      newText = \`\${wrapper}\${selectedText}\${endW}\`;
    }

    const newLineContent = textContent.replace(selectedText, newText);
    newSourceLines[lineIndex] = prefix + newLineContent;

    onContentChange(content.replace(block.sourceLines.join('\\n'), newSourceLines.join('\\n')));
  }, [selectedBlockInfo, selectedText, content, onContentChange]);

  const handleLink = useCallback(() => {
    if (!selectedBlockInfo || !selectedText) return;

    const block = selectedBlockInfo.block;
    let newSourceLines = [...block.sourceLines];
    const lineIndex = 0;
    let line = newSourceLines[lineIndex] || '';

    const prefix = block.type === 'heading' ? '#'.repeat(block.headingLevel || 1) + ' ' : '';
    const textContent = line.replace(new RegExp(\`^\${prefix}\`), '');

    let newText: string;
    if (/^\[.*\\]\(.*\)$/.test(selectedText)) {
      const match = selectedText.match(/^\[(.*)\\]\(.*\)$/);
      newText = match ? match[1] : selectedText;
    } else {
      newText = \`[\${selectedText}](url)\`;
    }

    const newLineContent = textContent.replace(selectedText, newText);
    newSourceLines[lineIndex] = prefix + newLineContent;

    onContentChange(content.replace(block.sourceLines.join('\\n'), newSourceLines.join('\\n')));
  }, [selectedBlockInfo, selectedText, content, onContentChange]);

  const handleComment = useCallback(() => {
    if (!selectedBlockInfo || !selectedText) return;

    const block = selectedBlockInfo.block;
    let newSourceLines = [...block.sourceLines];
    const lineIndex = 0;
    let line = newSourceLines[lineIndex] || '';

    const prefix = block.type === 'heading' ? '#'.repeat(block.headingLevel || 1) + ' ' : '';
    const textContent = line.replace(new RegExp(\`^\${prefix}\`), '');

    const newText = \`\${selectedText} ^[comment]\`;
    const newLineContent = textContent.replace(selectedText, newText);
    newSourceLines[lineIndex] = prefix + newLineContent;

    onContentChange(content.replace(block.sourceLines.join('\\n'), newSourceLines.join('\\n')));
  }, [selectedBlockInfo, selectedText, content, onContentChange]);

  const handleStructureChange = useCallback((value: string) => {
    if (!selectedBlockInfo) return;

    let blockType = value;
    let headingLevel: number | undefined;

    if (value.startsWith('heading-')) {
      headingLevel = parseInt(value.split('-')[1]);
      blockType = 'heading';
    }

    onBlockTypeChange(selectedBlockInfo.blockId, blockType);
    if (headingLevel !== undefined) {
      const block = selectedBlockInfo.block;
      const textContent = block.sourceLines.join('\\n').replace(/^#+\\s*/, '');
      const newContent = content.replace(block.sourceLines.join('\\n'), '#'.repeat(headingLevel) + ' ' + textContent);
      onContentChange(newContent);
    }

    setIsStructureDropdownOpen(false);
    setIsVisible(false);
  }, [selectedBlockInfo, content, onContentChange, onBlockTypeChange]);

  const handleShowMdSource = useCallback(() => {
    if (!selectedBlockInfo) return;
    onShowMdSource(selectedBlockInfo.blockId);
    setIsVisible(false);
  }, [selectedBlockInfo, onShowMdSource]);

  if (!isVisible || isSourceCodeMode) return null;

  const currentStructure = selectedBlockInfo?.block.type === 'heading'
    ? \`heading-\${selectedBlockInfo.block.headingLevel}\`
    : selectedBlockInfo?.block.type;

  return (
    <>
      <div
        ref={toolbarRef}
        className="floating-toolbar-wysiwyg fixed z-[100] flex items-center gap-0.5 px-1.5 py-1 rounded-lg shadow-lg select-none"
        style={{
          top: \`\${position.top}px\`,
          left: \`\${position.left}px\`,
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          transform: 'translateX(-50%)',
        }}
        onMouseEnter={() => {
          if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
          }
        }}
      >
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsStructureDropdownOpen(!isStructureDropdownOpen);
            }}
            className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors"
            style={{ color: 'var(--text-primary)' }}
          >
            {STRUCTURE_OPTIONS.find(opt => opt.value === currentStructure)?.label || '正文'}
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isStructureDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-lg py-1 z-50 min-w-[120px]">
              {STRUCTURE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleStructureChange(option.value)}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-tertiary)] transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

        {FORMAT_ACTIONS.map((action) => (
          <button
            key={action.label}
            title={action.title}
            onClick={() => handleFormat(action.wrapper, action.endWrapper, action.pattern)}
            className=\`w-8 h-7 flex items-center justify-center rounded text-xs font-medium transition-colors \${
              action.label === 'B' ? 'font-bold' : ''
            } \${action.label === 'I' ? 'italic' : ''}\`
            style={{ color: 'var(--text-sub)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            {action.label}
          </button>
        ))}

        <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

        <button
          title="Link"
          onClick={handleLink}
          className="w-8 h-7 flex items-center justify-center rounded text-xs transition-colors"
          style={{ color: 'var(--text-sub)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          Link
        </button>

        <button
          title="Comment"
          onClick={handleComment}
          className="w-8 h-7 flex items-center justify-center rounded text-xs transition-colors"
          style={{ color: 'var(--text-sub)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          Comment
        </button>

        <button
          title="MD Source"
          onClick={handleShowMdSource}
          className="w-8 h-7 flex items-center justify-center rounded text-xs transition-colors"
          style={{ color: 'var(--text-sub)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          Source
        </button>
      </div>
    </>
  );
};

export default FloatingToolbarWYSIWYG;
`;

fs.writeFileSync(path.join(__dirname, 'src/render/components/Editor/FloatingToolbarWYSIWYG.tsx'), content, 'utf-8');
console.log('File created successfully');

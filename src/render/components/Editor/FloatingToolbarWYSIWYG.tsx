import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { BlockId, BlockNode, BlockTree } from '../../services/blockTree';
import Input from '../Common/Input';
import Modal from '../Common/Modal';

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
  onPushUndo: () => void;
  onSyncToStore: () => void;
}

const STRUCTURE_OPTIONS = [
  { value: 'paragraph', labelKey: 'toolbar.paragraph' },
  { value: 'heading-1', labelKey: 'toolbar.heading1' },
  { value: 'heading-2', labelKey: 'toolbar.heading2' },
  { value: 'heading-3', labelKey: 'toolbar.heading3' },
  { value: 'heading-4', labelKey: 'toolbar.heading4' },
  { value: 'heading-5', labelKey: 'toolbar.heading5' },
  { value: 'heading-6', labelKey: 'toolbar.heading6' },
  { value: 'unordered-list-item', labelKey: 'toolbar.unorderedList' },
  { value: 'ordered-list-item', labelKey: 'toolbar.orderedList' },
  { value: 'task-list-item', labelKey: 'toolbar.task' },
  { value: 'code-fence', labelKey: 'toolbar.codeBlock' },
  { value: 'blockquote', labelKey: 'toolbar.quote' },
];

const FloatingToolbarWYSIWYG: React.FC<FloatingToolbarWYSIWYGProps> = ({
  blockTree,
  content: _content,
  onContentChange: _onContentChange,
  onBlockTypeChange,
  onShowMdSource,
  isSourceCodeMode,
  onPushUndo,
  onSyncToStore,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<ToolbarPosition>({ top: 0, left: 0 });
  const [selectedBlockInfo, setSelectedBlockInfo] = useState<BlockInfo | null>(null);
  const [isStructureDropdownOpen, setIsStructureDropdownOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkModalMode, setLinkModalMode] = useState<'insert' | 'edit'>('insert');
  const [linkUrlValue, setLinkUrlValue] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const linkTargetRangeRef = useRef<Range | null>(null);
  const linkTargetAnchorRef = useRef<HTMLAnchorElement | null>(null);
  const { t } = useI18n();

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
      if (isStructureDropdownOpen || isLinkModalOpen) {
        return;
      }
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
  }, [isSourceCodeMode, isSelectionWithinSingleBlock, isStructureDropdownOpen, isLinkModalOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isLinkModalOpen) return;
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
  }, [isLinkModalOpen]);

  const wrapRangeWithTag = useCallback((tag: string, className?: string): HTMLElement | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);

    // Clamp range to within .block-content span to prevent wrapping list
    // markers/checkboxes (select-none decorations). When a selection crosses
    // the decoration/content boundary, surroundContents throws and the fallback
    // (extractContents) splits + clones the decoration span, producing a
    // duplicate marker/checkbox inside the wrapping element and burying the
    // content span under an ancestor <a> that domToMarkdown cannot see.
    const startEl =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : (range.startContainer as Element | null);
    const blockEl = startEl?.closest('[data-block-id]') ?? null;
    const contentEl = blockEl?.querySelector('span.block-content') ?? null;
    if (contentEl) {
      if (range.startContainer !== contentEl && !contentEl.contains(range.startContainer)) {
        range.setStart(contentEl, 0);
      }
      if (range.endContainer !== contentEl && !contentEl.contains(range.endContainer)) {
        range.setEnd(contentEl, contentEl.childNodes.length);
      }
    }

    const el = document.createElement(tag);
    if (className) el.className = className;
    try {
      range.surroundContents(el);
    } catch {
      const frag = range.extractContents();
      el.appendChild(frag);
      range.insertNode(el);
    }

    // Cleanup: when the selection partially overlaps an existing same-tag
    // wrapper, surroundContents/extractContents splits the existing wrapper —
    // the in-range half ends up nested inside el, the out-of-range half is
    // left as an empty sibling. Unwrap nested same-tag elements (or remove
    // them if empty) and drop empty <a> siblings (extractContents residue).
    const nested = Array.from(el.querySelectorAll(tag.toLowerCase()));
    for (const n of nested) {
      const parent = n.parentNode;
      if (!parent) continue;
      while (n.firstChild) parent.insertBefore(n.firstChild, n);
      parent.removeChild(n);
    }
    if (tag.toLowerCase() === 'a' && el.parentNode) {
      const emptyAnchors = Array.from(el.parentNode.children).filter(
        (n): n is HTMLAnchorElement =>
          n.tagName === 'A' && (n.textContent ?? '').trim() === '' && n.childNodes.length === 0
      );
      for (const n of emptyAnchors) n.parentNode?.removeChild(n);
    }

    const newRange = document.createRange();
    newRange.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(newRange);
    return el;
  }, []);

  const afterFormat = useCallback(() => {
    onPushUndo();
    onSyncToStore();
  }, [onPushUndo, onSyncToStore]);

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
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const startEl =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : (range.commonAncestorContainer as HTMLElement);
    const existingMark = startEl?.closest('mark') || null;
    if (existingMark) {
      // unwrap: 移除 <mark> 包装
      const parent = existingMark.parentNode;
      while (existingMark.firstChild) {
        parent?.insertBefore(existingMark.firstChild, existingMark);
      }
      parent?.removeChild(existingMark);
      // 恢复选中
      const newRange = document.createRange();
      newRange.selectNodeContents(parent?.lastChild || parent || document.body);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      wrapRangeWithTag('mark');
    }
    afterFormat();
  }, [wrapRangeWithTag, afterFormat]);

  const handleCode = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const existingCode = (range.commonAncestorContainer as HTMLElement)?.parentElement?.closest(
      'code.inline-code'
    );
    if (existingCode) {
      const parent = existingCode.parentNode;
      while (existingCode.firstChild) {
        parent?.insertBefore(existingCode.firstChild, existingCode);
      }
      parent?.removeChild(existingCode);
    } else {
      wrapRangeWithTag('code', 'inline-code');
    }
    afterFormat();
  }, [wrapRangeWithTag, afterFormat]);

  const handleLink = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return;
    }
    const range = sel.getRangeAt(0);
    linkTargetRangeRef.current = range.cloneRange();
    const container = range.commonAncestorContainer;
    const containerEl =
      container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as HTMLElement);
    // 从选区容器向上查找已有链接（containerEl 本身可能即 anchor 或其子孙）
    const existingLink = containerEl?.closest('a.inline-link') || null;
    if (existingLink) {
      setLinkModalMode('edit');
      linkTargetAnchorRef.current = existingLink as HTMLAnchorElement;
      setLinkUrlValue(existingLink.getAttribute('href') || '');
    } else {
      setLinkModalMode('insert');
      linkTargetAnchorRef.current = null;
      setLinkUrlValue('');
    }
    // 工具栏立即隐藏，避免遮挡 Modal；Modal 独立渲染不受影响
    setIsVisible(false);
    setIsLinkModalOpen(true);
  }, []);

  const handleLinkConfirm = useCallback(() => {
    const mode = linkModalMode;
    const raw = linkUrlValue.trim();
    const hasScheme =
      raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('mailto:') ||
      raw.startsWith('#');
    const href = raw === '' ? '' : hasScheme ? raw : `https://${raw}`;

    if (mode === 'edit') {
      const anchor = linkTargetAnchorRef.current;
      if (anchor) {
        if (raw === '') {
          const parent = anchor.parentNode;
          while (anchor.firstChild) {
            parent?.insertBefore(anchor.firstChild, anchor);
          }
          parent?.removeChild(anchor);
        } else {
          anchor.setAttribute('href', href);
          if (anchor.dataset.placeholder) delete anchor.dataset.placeholder;
        }
      }
      afterFormat();
    } else {
      if (raw === '') {
        setIsLinkModalOpen(false);
        return;
      }
      const sel = window.getSelection();
      const savedRange = linkTargetRangeRef.current;
      if (sel && savedRange) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
        const anchor = wrapRangeWithTag('a', 'inline-link');
        if (anchor) {
          (anchor as HTMLAnchorElement).setAttribute('href', href);
        }
      }
      afterFormat();
    }
    setIsLinkModalOpen(false);
  }, [linkModalMode, linkUrlValue, wrapRangeWithTag, afterFormat]);

  const handleLinkCancel = useCallback(() => {
    setIsLinkModalOpen(false);
  }, []);

  // 显式移除链接：unwrap anchor，保留文本
  const handleLinkRemove = useCallback(() => {
    const anchor = linkTargetAnchorRef.current;
    if (anchor) {
      const parent = anchor.parentNode;
      while (anchor.firstChild) {
        parent?.insertBefore(anchor.firstChild, anchor);
      }
      parent?.removeChild(anchor);
      afterFormat();
    }
    setIsLinkModalOpen(false);
  }, [afterFormat]);

  const handleComment = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const endContainer = range.endContainer as HTMLElement;
    const endEl =
      endContainer.nodeType === Node.TEXT_NODE ? endContainer.parentElement : endContainer;
    const nextSibling = endEl?.nextElementSibling;
    if (nextSibling?.classList.contains('comment-marker')) {
      nextSibling.remove();
    } else {
      range.collapse(false);
      const marker = document.createElement('span');
      marker.className = 'comment-marker';
      marker.title = 'comment';
      marker.textContent = '[✎]';
      range.insertNode(marker);
    }
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

  const currentStructure =
    selectedBlockInfo?.block.type === 'heading'
      ? 'heading-' + selectedBlockInfo.block.headingLevel
      : selectedBlockInfo?.block.type;

  return (
    <React.Fragment>
      {isVisible && !isSourceCodeMode && (
        <div
          ref={toolbarRef}
          className="floating-toolbar-wysiwyg fixed z-[100] flex items-center gap-1 px-2.5 py-1.5 rounded-lg shadow-lg"
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
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-sm font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              {t(
                STRUCTURE_OPTIONS.find((opt) => opt.value === currentStructure)?.labelKey ||
                  'toolbar.paragraph'
              )}
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
                    className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-tertiary)]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />
          <button
            title={t('toolbar.bold')}
            onClick={handleBold}
            className="w-9 h-8 flex items-center justify-center rounded text-sm font-bold"
            style={{ color: 'var(--text-sub)' }}
          >
            B
          </button>
          <button
            title={t('toolbar.italic')}
            onClick={handleItalic}
            className="w-9 h-8 flex items-center justify-center rounded text-sm italic"
            style={{ color: 'var(--text-sub)' }}
          >
            I
          </button>
          <button
            title={t('toolbar.underline')}
            onClick={handleUnderline}
            className="w-9 h-8 flex items-center justify-center rounded text-sm"
            style={{ color: 'var(--text-sub)', textDecoration: 'underline' }}
          >
            U
          </button>
          <button
            title={t('toolbar.highlight')}
            onClick={handleHighlight}
            className="w-9 h-8 flex items-center justify-center rounded text-sm"
            style={{ color: 'var(--text-sub)' }}
          >
            H
          </button>
          <button
            title={t('toolbar.code')}
            onClick={handleCode}
            className="w-9 h-8 flex items-center justify-center rounded text-sm font-mono"
            style={{ color: 'var(--text-sub)' }}
          >
            {'`'}
          </button>
          <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />
          <button
            title={t('toolbar.link')}
            onClick={handleLink}
            className="w-9 h-8 flex items-center justify-center rounded text-sm"
            style={{ color: 'var(--text-sub)' }}
          >
            Link
          </button>
          <button
            title={t('toolbar.comment')}
            onClick={handleComment}
            className="w-9 h-8 flex items-center justify-center rounded text-sm"
            style={{ color: 'var(--text-sub)' }}
          >
            Cm
          </button>
          <button
            title={t('toolbar.mdSource')}
            onClick={handleShowMdSource}
            className="w-9 h-8 flex items-center justify-center rounded text-sm"
            style={{ color: 'var(--text-sub)' }}
          >
            Src
          </button>
        </div>
      )}
      <Modal
        isOpen={isLinkModalOpen}
        onClose={handleLinkCancel}
        title={t('toolbar.linkDialogTitle')}
        width={440}
        footer={
          <>
            {linkModalMode === 'edit' && (
              <button onClick={handleLinkRemove} className="px-4 py-2 rounded text-sm text-red-500">
                {t('toolbar.linkRemove')}
              </button>
            )}
            <button
              onClick={handleLinkCancel}
              className="px-4 py-2 rounded text-sm"
              style={{ color: 'var(--text-sub)' }}
            >
              {t('toolbar.cancel')}
            </button>
            <button
              onClick={handleLinkConfirm}
              className="px-4 py-2 rounded text-sm font-medium"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              {t('toolbar.confirm')}
            </button>
          </>
        }
      >
        <Input
          label={t('toolbar.linkUrlLabel')}
          value={linkUrlValue}
          onChange={setLinkUrlValue}
          placeholder={t('toolbar.linkUrlPlaceholder')}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleLinkConfirm();
            }
          }}
        />
      </Modal>
    </React.Fragment>
  );
};

export default FloatingToolbarWYSIWYG;

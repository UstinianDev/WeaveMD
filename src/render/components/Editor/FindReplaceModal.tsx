// ============================================
// WeaveMD — Find & Replace Modal
// ============================================
// Centered modal with macOS-style traffic-light dots,
// two tabs (Find / Replace), and full text search &
// replace logic operating on editor content.
// ============================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';

// ============================================
// Types
// ============================================

type SearchDirection = 'down' | 'up' | 'all';
type ActiveTab = 'find' | 'replace';

interface MatchResult {
  /** Byte offset of the match in the full content string */
  offset: number;
  /** The matched text (preserving original case) */
  text: string;
  /** 1-based line number */
  line: number;
  /** The full line text containing this match */
  lineText: string;
  /** Column position within the line (0-based) */
  col: number;
}

interface FindReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================
// Helpers
// ============================================

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findAllMatches(content: string, query: string, dir: SearchDirection): MatchResult[] {
  if (!query || !content) return [];

  const results: MatchResult[] = [];
  const lines = content.split('\n');
  let runningOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let from = 0;
    while (from < line.length) {
      const idx = line.toLowerCase().indexOf(query.toLowerCase(), from);
      if (idx === -1) break;
      results.push({
        offset: runningOffset + idx,
        text: line.substring(idx, idx + query.length),
        line: i + 1,
        lineText: line,
        col: idx,
      });
      from = idx + query.length;
    }
    runningOffset += line.length + 1; // +1 for \n
  }

  // For "up" direction, reverse the result order
  if (dir === 'up') {
    results.reverse();
  }

  return results;
}

// ============================================
// Component
// ============================================

const FindReplaceModal: React.FC<FindReplaceModalProps> = ({ isOpen, onClose }) => {
  // --- Store ---
  const content = useEditorStore((s) => s.content);
  const updateContent = useEditorStore((s) => s.updateContent);

  // --- Local state ---
  const [activeTab, setActiveTab] = useState<ActiveTab>('find');
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [direction, setDirection] = useState<SearchDirection>('down');
  const [highlightReading, setHighlightReading] = useState(true);
  const [matchIndex, setMatchIndex] = useState(0);

  // --- Derived: all matches in current content ---
  const matches = useMemo<MatchResult[]>(() => {
    if (!isOpen) return [];
    return findAllMatches(content, searchText, direction);
  }, [content, searchText, direction, isOpen]);

  // Current match (null if no matches)
  const currentMatch: MatchResult | null =
    matches.length > 0 ? matches[matchIndex % matches.length] : null;

  // --- Reset state when modal opens or search text changes ---
  useEffect(() => {
    if (isOpen) {
      setSearchText('');
      setReplaceText('');
      setMatchIndex(0);
      setActiveTab('find');
      setDirection('down');
      setHighlightReading(true);
    }
  }, [isOpen]);

  useEffect(() => {
    setMatchIndex(0);
  }, [searchText, direction]);

  // --- Actions ---

  const handleFindNext = useCallback(() => {
    if (matches.length === 0) return;
    setMatchIndex((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  const handleReplace = useCallback(() => {
    if (!currentMatch || !content || matches.length === 0) return;

    const before = content.substring(0, currentMatch.offset);
    const after = content.substring(currentMatch.offset + searchText.length);
    updateContent(before + replaceText + after);

    // Adjust index for removed matches
    if (matchIndex >= matches.length - 1) {
      setMatchIndex(Math.max(0, matches.length - 2));
    }
  }, [content, currentMatch, searchText, replaceText, updateContent, matchIndex, matches.length]);

  const handleReplaceAll = useCallback(() => {
    if (matches.length === 0 || !content || !searchText) return;

    const escaped = escapeRegExp(searchText);
    const regex = new RegExp(escaped, 'gi');
    const newContent = content.replace(regex, replaceText);
    updateContent(newContent);
    setMatchIndex(0);
  }, [content, searchText, replaceText, updateContent, matches.length]);

  // --- Render helpers ---

  const dots = (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span
        className="code-fence-window-dot code-fence-window-dot--close cursor-pointer"
        onClick={onClose}
        title="Close"
      />
      <span className="code-fence-window-dot code-fence-window-dot--minimize" />
      <span className="code-fence-window-dot code-fence-window-dot--zoom" />
    </div>
  );

  const matchInfo =
    matches.length > 0
      ? `${matchIndex + 1} / ${matches.length}`
      : searchText
        ? '0 matches'
        : '';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 modal-overlay-enter"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div
        className="relative modal-content-enter rounded-[12px] border shadow-modal overflow-hidden flex flex-col"
        style={{
          width: '480px',
          maxWidth: '90vw',
          backgroundColor: 'var(--modal-bg, var(--bg-secondary))',
          borderColor: 'var(--border-color)',
        }}
      >
        {/* ---- Header bar with dots + tabs ---- */}
        <div
          className="flex items-center px-4 py-3 gap-4 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          {dots}

          {/* Tab switcher */}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => setActiveTab('find')}
              className={`px-3 py-1 text-sm rounded-[6px] transition-colors ${
                activeTab === 'find'
                  ? 'text-white'
                  : ''
              }`}
              style={{
                backgroundColor: activeTab === 'find' ? 'var(--accent)' : 'transparent',
                color: activeTab === 'find' ? '#fff' : 'var(--text-sub)',
              }}
            >
              查找
            </button>
            <button
              onClick={() => setActiveTab('replace')}
              className={`px-3 py-1 text-sm rounded-[6px] transition-colors ${
                activeTab === 'replace'
                  ? 'text-white'
                  : ''
              }`}
              style={{
                backgroundColor: activeTab === 'replace' ? 'var(--accent)' : 'transparent',
                color: activeTab === 'replace' ? '#fff' : 'var(--text-sub)',
              }}
            >
              替换
            </button>
          </div>

          {/* Match counter */}
          <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
            {matchInfo}
          </span>
        </div>

        {/* ---- Body ---- */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Row 1: 查找内容 */}
          <div>
            <label
              className="text-xs font-medium mb-1.5 block"
              style={{ color: 'var(--text-sub)' }}
            >
              查找内容
            </label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="输入要查找的文本..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleFindNext();
                }
              }}
              className="w-full border rounded-input px-3 py-1.5 text-sm outline-none transition-colors"
              style={{
                backgroundColor: 'var(--input-bg, var(--bg-primary))',
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {/* Row 2: 搜索方向 */}
          <div>
            <label
              className="text-xs font-medium mb-1.5 block"
              style={{ color: 'var(--text-sub)' }}
            >
              搜索
            </label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as SearchDirection)}
              className="w-full border rounded-input px-3 py-1.5 text-sm outline-none cursor-pointer transition-colors"
              style={{
                backgroundColor: 'var(--input-bg, var(--bg-primary))',
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="down">向下</option>
              <option value="all">全部</option>
              <option value="up">向上</option>
            </select>
          </div>

          {/* Row 3 (Replace only): 替换为 */}
          {activeTab === 'replace' && (
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-sub)' }}
              >
                替换为
              </label>
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="替换文本..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleReplace();
                  }
                }}
                className="w-full border rounded-input px-3 py-1.5 text-sm outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--input-bg, var(--bg-primary))',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          )}

          {/* Match context preview */}
          {currentMatch && (
            <div
              className="rounded-input border p-3 text-xs font-mono"
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-sub)',
              }}
            >
              <div className="mb-1" style={{ color: 'var(--text-muted)' }}>
                Line {currentMatch.line}, Col {currentMatch.col + 1}
              </div>
              <div className="whitespace-pre-wrap break-all">
                {currentMatch.lineText.substring(0, currentMatch.col)}
                <mark
                  style={{
                    backgroundColor: highlightReading ? '#facc15' : 'var(--accent)',
                    color: '#000',
                    padding: '0 1px',
                    borderRadius: '2px',
                  }}
                >
                  {currentMatch.text}
                </mark>
                {currentMatch.lineText.substring(currentMatch.col + searchText.length)}
              </div>
            </div>
          )}
        </div>

        {/* ---- Footer ---- */}
        <div
          className="flex items-center gap-2 px-5 py-3 border-t"
          style={{ borderColor: 'var(--border-color)' }}
        >
          {/* Highlight toggle (Find tab) */}
          {activeTab === 'find' && (
            <label
              className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
              style={{ color: 'var(--text-sub)' }}
            >
              <input
                type="checkbox"
                checked={highlightReading}
                onChange={(e) => setHighlightReading(e.target.checked)}
                className="accent-[#facc15]"
              />
              阅读突出显示
            </label>
          )}

          <div className="flex-1" />

          {/* Replace tab buttons */}
          {activeTab === 'replace' && (
            <>
              <button
                onClick={handleReplace}
                disabled={!currentMatch}
                className="px-3 py-1.5 text-xs rounded-input transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#fff',
                }}
              >
                替换
              </button>
              <button
                onClick={handleReplaceAll}
                disabled={matches.length === 0}
                className="px-3 py-1.5 text-xs rounded-input transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                }}
              >
                全部替换
              </button>
            </>
          )}

          {/* Find Next (both tabs) */}
          <button
            onClick={handleFindNext}
            disabled={matches.length === 0}
            className="px-3 py-1.5 text-xs rounded-input transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
            }}
          >
            查找下一处
          </button>

          {/* Cancel */}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-input transition-colors"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-sub)',
            }}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
};

export default FindReplaceModal;

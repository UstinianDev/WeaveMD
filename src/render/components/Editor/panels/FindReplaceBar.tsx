// ============================================
// WeaveMD — Find & Replace Inline Bar (Typora-style)
// ============================================
// Inline search bar rendered inside the editor's
// DOM tree (NOT a modal overlay). This avoids the
// Monaco hidden textarea focus-release issue:
//
// When a block is active, its Monaco textarea stays
// in the DOM. Opening this bar transfers focus from
// the textarea to the search input via the browser's
// native focus mechanism — no DOM removal, no orphan
// textareas, no IME coordinate corruption.
//
// Key design points:
//   • Inline bar (no overlay, no fixed positioning)
//   • Slide-down via max-height + opacity transition
//   • macOS traffic-light dots (style reference from modal)
//   • Search options: case, whole word, regex
//   • 150ms debounce
//   • Regex validation with error display
//   • IME-safe uncontrolled inputs (defaultValue + key)
//   • No CSS transform animations (IME safe)
// ============================================
//
// Layout:
//   ┌─ FindReplaceBar (inside EditorView) ───────────────┐
//   │ ● ● ●  查找 替换  [search________] [Aa][W][.*] [◀][▶] 2/10 [✕] │
//   │                    [replace_______] [替换] [全部替换]  │
//   │                    第 3 行, 第 5 列  "text ██MATCH██" │
//   └─────────────────────────────────────────────────────┘
//
// ============================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findAllMatches,
  replaceAll,
  validateRegex,
  type MatchResult,
} from '../../../services/searchEngine';

// ============================================
// Types
// ============================================

type ActiveTab = 'find' | 'replace';

interface FindReplaceBarProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  onContentChange: (newContent: string) => void;
}

// ============================================
// macOS Traffic Light Dots Component
// ============================================

const MacOSTrafficLights: React.FC = () => (
  <div className="flex items-center gap-[7px] mr-3 flex-shrink-0">
    <span className="w-[12px] h-[12px] rounded-full" style={{ backgroundColor: '#ff5f57' }} />
    <span className="w-[12px] h-[12px] rounded-full" style={{ backgroundColor: '#febc2e' }} />
    <span className="w-[12px] h-[12px] rounded-full" style={{ backgroundColor: '#28c840' }} />
  </div>
);

// ============================================
// Component
// ============================================

const FindReplaceBar: React.FC<FindReplaceBarProps> = ({
  isOpen,
  onClose,
  content,
  onContentChange,
}) => {
  // ── Local state ────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('find');
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [isWholeWord, setIsWholeWord] = useState(false);
  const [isRegexp, setIsRegexp] = useState(false);
  const [matchIndex, setMatchIndex] = useState(-1);
  // Incremented when bar opens → forces uncontrolled inputs to remount empty
  const [resetKey, setResetKey] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Regex validation ───────────────────────
  const regexError = useMemo<string | null>(() => {
    if (!isRegexp || !searchText) return null;
    return validateRegex(searchText);
  }, [isRegexp, searchText]);

  // ── Search matches ─────────────────────────
  const rawMatches = useMemo<MatchResult[]>(() => {
    if (!searchText || regexError) return [];
    return findAllMatches(content, searchText, {
      isCaseSensitive,
      isWholeWord,
      isRegexp,
    });
  }, [content, searchText, isCaseSensitive, isWholeWord, isRegexp, regexError]);

  // Debounced matches — prevents rapid re-computation on every keystroke
  const [matches, setMatches] = useState<MatchResult[]>([]);

  useEffect(() => {
    if (!searchText) {
      setMatches([]);
      setMatchIndex(-1);
      return;
    }
    const timer = setTimeout(() => {
      setMatches(rawMatches);
      setMatchIndex((prev) =>
        rawMatches.length > 0 ? (prev < 0 ? 0 : Math.min(prev, rawMatches.length - 1)) : -1
      );
    }, 150);
    return () => clearTimeout(timer);
  }, [rawMatches, searchText]);

  // ── Current match ──────────────────────────
  const currentMatch: MatchResult | null =
    matchIndex >= 0 && matchIndex < matches.length ? matches[matchIndex] : null;

  const matchLabel = matches.length > 0 ? `${matchIndex + 1} / ${matches.length}` : '';

  // ── Open/Close lifecycle ───────────────────
  // When the bar opens:
  //   1. Reset all local state
  //   2. Increment resetKey to remount uncontrolled inputs
  //   3. Focus the search input (after React commits the re-render)
  // When the bar closes: nothing special needed
  useEffect(() => {
    if (isOpen) {
      setSearchText('');
      setReplaceText('');
      setMatchIndex(-1);
      setActiveTab('find');
      setIsCaseSensitive(false);
      setIsWholeWord(false);
      setIsRegexp(false);
      setMatches([]);
      setResetKey((k) => k + 1);

      // Focus the search input after React commits the resetKey re-render.
      // Double RAF: first waits for React commit + paint, second ensures
      // any cascading effects (CSS transition start, layout) have settled.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
        });
      });
    }
  }, [isOpen]);

  // ── Escape key to close ────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // ── Actions ────────────────────────────────

  const handleFindNext = useCallback(() => {
    if (matches.length === 0) return;
    setMatchIndex((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  const handleFindPrev = useCallback(() => {
    if (matches.length === 0) return;
    setMatchIndex((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const handleReplace = useCallback(() => {
    if (!currentMatch || !content || matches.length === 0 || !searchText) return;

    const before = content.substring(0, currentMatch.offset);
    const after = content.substring(currentMatch.offset + searchText.length);
    onContentChange(before + replaceText + after);

    if (matchIndex >= matches.length - 1) {
      setMatchIndex(Math.max(0, matches.length - 2));
    }
  }, [content, currentMatch, searchText, replaceText, onContentChange, matchIndex, matches.length]);

  const handleReplaceAll = useCallback(() => {
    if (matches.length === 0 || !content || !searchText) return;

    const newContent = replaceAll(content, searchText, replaceText, {
      isCaseSensitive,
      isWholeWord,
      isRegexp,
    });

    if (newContent !== null) {
      onContentChange(newContent);
      setMatchIndex(-1);
    }
  }, [
    content,
    searchText,
    replaceText,
    isCaseSensitive,
    isWholeWord,
    isRegexp,
    onContentChange,
    matches.length,
  ]);

  // ── Option toggle helper ───────────────────
  const toggleOption = useCallback((option: 'case' | 'word' | 'regex') => {
    switch (option) {
      case 'case':
        setIsCaseSensitive((p) => !p);
        break;
      case 'word':
        setIsWholeWord((p) => !p);
        break;
      case 'regex':
        setIsRegexp((p) => !p);
        break;
    }
  }, []);

  // ── Style helpers ──────────────────────────
  const optionBtnClass = (active: boolean) =>
    `w-7 h-7 flex items-center justify-center text-xs rounded transition-colors cursor-pointer select-none ${
      active ? 'text-white' : ''
    }`;

  const tabBtnClass = (isActive: boolean) =>
    `px-3 py-1.5 text-sm rounded-[6px] transition-colors cursor-pointer ${
      isActive ? 'text-white' : ''
    }`;

  // ── Render ─────────────────────────────────
  return (
    <div
      className="find-replace-bar flex-shrink-0 overflow-hidden"
      style={{
        maxHeight: isOpen ? '220px' : '0px',
        opacity: isOpen ? 1 : 0,
        transition: 'max-height 200ms ease-out, opacity 150ms ease-out',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: isOpen ? '1px solid var(--border-color)' : 'none',
      }}
    >
      {/* Inner container — always mounted when isOpen was ever true,
          but CSS hides it. We use a simple approach: render content
          only when open to avoid unnecessary DOM. */}
      {isOpen && (
        <div className="px-4 py-2">
          {/* ======================== */}
          {/* Row 1: Title + Tabs + Search + Options + Nav + Close */}
          {/* ======================== */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* macOS traffic-light dots */}
            <MacOSTrafficLights />

            {/* Find/Replace Tabs */}
            <button
              onClick={() => setActiveTab('find')}
              className={tabBtnClass(activeTab === 'find')}
              style={{
                backgroundColor: activeTab === 'find' ? 'var(--accent)' : 'transparent',
                color: activeTab === 'find' ? '#fff' : 'var(--text-sub)',
              }}
            >
              查找
            </button>
            <button
              onClick={() => setActiveTab('replace')}
              className={tabBtnClass(activeTab === 'replace')}
              style={{
                backgroundColor: activeTab === 'replace' ? 'var(--accent)' : 'transparent',
                color: activeTab === 'replace' ? '#fff' : 'var(--text-sub)',
              }}
            >
              替换
            </button>

            {/* Search input */}
            <div className="flex-1 min-w-[120px]">
              <input
                type="text"
                ref={searchInputRef}
                key={`search-${resetKey}`}
                defaultValue=""
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="查找..."
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) {
                      handleFindPrev();
                    } else {
                      handleFindNext();
                    }
                  }
                }}
                className="w-full border rounded-[6px] px-3 py-1.5 text-sm outline-none transition-colors no-drag"
                style={{
                  backgroundColor: 'var(--input-bg, var(--bg-primary))',
                  borderColor: regexError
                    ? 'var(--notification-error, #ef4444)'
                    : 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {/* Option toggles */}
            <div className="flex items-center gap-1">
              <span
                className={optionBtnClass(isCaseSensitive)}
                style={{
                  backgroundColor: isCaseSensitive ? 'var(--accent)' : 'var(--bg-primary)',
                  color: isCaseSensitive ? '#fff' : 'var(--text-sub)',
                }}
                onClick={() => toggleOption('case')}
                title="区分大小写"
              >
                Aa
              </span>
              <span
                className={optionBtnClass(isWholeWord)}
                style={{
                  backgroundColor: isWholeWord ? 'var(--accent)' : 'var(--bg-primary)',
                  color: isWholeWord ? '#fff' : 'var(--text-sub)',
                }}
                onClick={() => toggleOption('word')}
                title="全词匹配"
              >
                W
              </span>
              <span
                className={optionBtnClass(isRegexp)}
                style={{
                  backgroundColor: isRegexp ? 'var(--accent)' : 'var(--bg-primary)',
                  color: isRegexp ? '#fff' : 'var(--text-sub)',
                }}
                onClick={() => toggleOption('regex')}
                title="使用正则表达式"
              >
                .*
              </span>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleFindPrev}
                disabled={matches.length === 0}
                className="w-7 h-7 flex items-center justify-center text-xs rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-sub)',
                }}
                title="上一个 (Shift+Enter)"
              >
                ◀
              </button>
              <button
                onClick={handleFindNext}
                disabled={matches.length === 0}
                className="w-7 h-7 flex items-center justify-center text-xs rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-sub)',
                }}
                title="下一个 (Enter)"
              >
                ▶
              </button>
            </div>

            {/* Match counter */}
            {matchLabel && (
              <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                {matchLabel}
              </span>
            )}

            {/* Close button */}
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors cursor-pointer flex-shrink-0"
              style={{ color: 'var(--text-muted)' }}
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>

          {/* ======================== */}
          {/* Regex error */}
          {/* ======================== */}
          {regexError && (
            <div
              className="text-xs mt-1.5 px-3 py-1 rounded-[4px]"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: '#ef4444',
              }}
            >
              {regexError}
            </div>
          )}

          {/* ======================== */}
          {/* Row 2: Replace (only on replace tab) */}
          {/* ======================== */}
          {activeTab === 'replace' && (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 min-w-[120px]">
                <input
                  type="text"
                  key={`replace-${resetKey}`}
                  defaultValue=""
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="替换文本..."
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleReplace();
                    }
                  }}
                  className="w-full border rounded-[6px] px-3 py-1.5 text-sm outline-none transition-colors no-drag"
                  style={{
                    backgroundColor: 'var(--input-bg, var(--bg-primary))',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <button
                onClick={handleReplace}
                disabled={!currentMatch}
                className="px-3 py-1.5 text-xs rounded-[6px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
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
                className="px-3 py-1.5 text-xs rounded-[6px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
              >
                全部替换
              </button>
            </div>
          )}

          {/* ======================== */}
          {/* Row 3: Match Preview */}
          {/* ======================== */}
          {currentMatch && (
            <div
              className="mt-2 rounded-[6px] border p-2"
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderColor: 'var(--border-color)',
              }}
            >
              <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                第 {currentMatch.line} 行, 第 {currentMatch.col + 1} 列
              </div>
              <div className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">
                {currentMatch.lineText.substring(0, currentMatch.col)}
                <mark
                  style={{
                    backgroundColor: '#facc15',
                    color: '#000',
                    padding: '0 2px',
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
      )}
    </div>
  );
};

export default FindReplaceBar;

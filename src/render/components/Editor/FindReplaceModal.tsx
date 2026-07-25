// ============================================
// WeaveMD — Find & Replace Centered Modal
// ============================================
// Centered modal with macOS-style traffic-light
// dots (red/yellow/green) at top-left corner.
// Uses opacity-only animation (no CSS transform)
// to prevent Chromium IME coordinate issues.
//
// Key design points:
//   • Centered modal with semi-transparent overlay
//   • macOS terminal-style title bar dots
//   • Search options: case, whole word, regex
//   • 150ms debounce (like MarkText)
//   • Regex validation with error display
//   • IME-safe uncontrolled inputs (defaultValue + key)
//   • No CSS transform animations (IME safe)
// ============================================
//
// Layout:
//   ┌─── macOS Title Bar ──────────────────────────────┐
//   │ ● ● ●  查找与替换          2/10            [✕]   │
//   ├──────────────────────────────────────────────────┤
//   │ [查找] [替换]                                      │ ← Tabs
//   ├──────────────────────────────────────────────────┤
//   │ [search input________] [Aa][W][.*] [◀] [▶]       │ ← Search + options + nav
//   │ ● regex error (only when .* is active)            │ ← Error
//   │ [replace input________] [替换] [全部替换]           │ ← Replace (only on replace tab)
//   ├──────────────────────────────────────────────────┤
//   │ 第 3 行, 第 5 列                                   │ ← Preview
//   │ "text ██MATCH██ preview"                          │
//   └──────────────────────────────────────────────────┘
//
// ============================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findAllMatches,
  replaceAll,
  validateRegex,
  type MatchResult,
} from '../../services/searchEngine';
import { useEditorStore } from '../../stores/editorStore';

// ============================================
// Types
// ============================================

type ActiveTab = 'find' | 'replace';

interface FindReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================
// macOS Traffic Light Dots Component
// ============================================

const MacOSTrafficLights: React.FC = () => (
  <div className="flex items-center gap-[7px] mr-3">
    <span
      className="w-[12px] h-[12px] rounded-full"
      style={{ backgroundColor: '#ff5f57' }}
    />
    <span
      className="w-[12px] h-[12px] rounded-full"
      style={{ backgroundColor: '#febc2e' }}
    />
    <span
      className="w-[12px] h-[12px] rounded-full"
      style={{ backgroundColor: '#28c840' }}
    />
  </div>
);

// ============================================
// Component
// ============================================

const FindReplaceModal: React.FC<FindReplaceModalProps> = ({ isOpen, onClose }) => {
  // ── Store ──────────────────────────────────
  const content = useEditorStore((s) => s.content);
  const updateContent = useEditorStore((s) => s.updateContent);

  // ── Local state ────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('find');
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [isWholeWord, setIsWholeWord] = useState(false);
  const [isRegexp, setIsRegexp] = useState(false);
  const [matchIndex, setMatchIndex] = useState(-1);
  // Incremented on modal open → forces uncontrolled inputs to remount empty
  const [resetKey, setResetKey] = useState(0);

  // Fix B: Ref for explicit focus transfer after modal opens.
  // Double RAF ensures the input is mounted (with the correct resetKey) before focusing.
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Regex validation ───────────────────────
  const regexError = useMemo<string | null>(() => {
    if (!isRegexp || !searchText) return null;
    return validateRegex(searchText);
  }, [isRegexp, searchText]);

  // ── Search matches (debounced) ─────────────
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
    // For text changes: debounce 150ms
    const timer = setTimeout(() => {
      setMatches(rawMatches);
      setMatchIndex((prev) =>
        rawMatches.length > 0 ? Math.min(prev, rawMatches.length - 1) : -1,
      );
    }, 150);
    return () => clearTimeout(timer);
  }, [rawMatches, searchText]);

  // ── Current match ──────────────────────────
  const currentMatch: MatchResult | null =
    matchIndex >= 0 && matchIndex < matches.length ? matches[matchIndex] : null;

  const matchLabel = matches.length > 0 ? `${matchIndex + 1} / ${matches.length}` : '';

  // ── Reset on open ──────────────────────────
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

      // Fix B: Explicit focus transfer with double RAF.
      // When the modal opens while a block is active, the Monaco editor's
      // hidden textarea is being disposed (via useLayoutEffect cleanup in
      // ActiveBlockEditor). The autoFocus attribute on the search input may
      // not reliably take effect because:
      //   1. setResetKey above triggers a re-render that remounts the input
      //   2. The first render's autoFocus may be stolen by the cleanup
      //   3. After the remount, autoFocus should work — but as a safety net,
      //      we explicitly focus after both renders are complete.
      //
      // Double RAF: first waits for the resetKey re-render to be committed,
      // second ensures any cascading effects (Monaco dispose, layout shifts)
      // have settled before we call focus().
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
      if (e.key === 'Escape') onClose();
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
    if (!currentMatch || !content || matches.length === 0) return;

    const before = content.substring(0, currentMatch.offset);
    const after = content.substring(currentMatch.offset + searchText.length);
    updateContent(before + replaceText + after);

    // Adjust index after replacement
    if (matchIndex >= matches.length - 1) {
      setMatchIndex(Math.max(0, matches.length - 2));
    }
  }, [content, currentMatch, searchText, replaceText, updateContent, matchIndex, matches.length]);

  const handleReplaceAll = useCallback(() => {
    if (matches.length === 0 || !content || !searchText) return;

    const newContent = replaceAll(content, searchText, replaceText, {
      isCaseSensitive,
      isWholeWord,
      isRegexp,
    });

    if (newContent !== null) {
      updateContent(newContent);
      setMatchIndex(-1);
    }
  }, [content, searchText, replaceText, isCaseSensitive, isWholeWord, isRegexp, updateContent, matches.length]);

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

  // ── Option toggle button style ─────────────
  const optionBtnClass = (active: boolean) =>
    `w-7 h-7 flex items-center justify-center text-xs rounded transition-colors cursor-pointer select-none ${
      active ? 'text-white' : ''
    }`;

  // ── Tab button style ───────────────────────
  const tabBtnClass = (isActive: boolean) =>
    `px-3 py-1.5 text-sm rounded-[6px] transition-colors cursor-pointer ${
      isActive ? 'text-white' : ''
    }`;

  // ── Render: nothing when closed ────────────
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* ======================== */}
      {/* Overlay (click to close) */}
      {/* ======================== */}
      <div
        className="absolute inset-0 bg-black/50 modal-overlay-enter"
        onClick={onClose}
      />

      {/* ======================== */}
      {/* Content Panel */}
      {/* ======================== */}
      <div
        className="relative w-[520px] max-w-[90vw] max-h-[80vh] rounded-xl border shadow-lg modal-content-fade-in overflow-hidden flex flex-col no-drag"
        style={{
          backgroundColor: 'var(--modal-bg, var(--bg-secondary))',
          borderColor: 'var(--border-color)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* ======================== */}
        {/* macOS Title Bar */}
        {/* ======================== */}
        <div
          className="flex items-center px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border-color)' }}
        >
          {/* macOS traffic-light dots — top-left */}
          <MacOSTrafficLights />

          {/* Title */}
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            查找与替换
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Match counter */}
          {matchLabel && (
            <span className="text-xs mr-3" style={{ color: 'var(--text-muted)' }}>
              {matchLabel}
            </span>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
            title="关闭 (Esc)"
          >
            ✕
          </button>
        </div>

        {/* ======================== */}
        {/* Body (scrollable if needed) */}
        {/* ======================== */}
        <div className="flex-1 overflow-y-auto">
          {/* Tabs */}
          <div className="flex items-center px-4 pt-3 pb-0 gap-1">
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
          </div>

          {/* Search Input + Options */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              {/* Search input */}
              <div className="flex-1 relative">
                <input
                  type="text"
                  ref={searchInputRef}
                  key={`search-${resetKey}`}
                  defaultValue=""
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="输入要查找的文本..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleFindNext();
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

              {/* Navigation buttons */}
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
            </div>

            {/* Regex error message */}
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
          </div>

          {/* Replace Section */}
          {activeTab === 'replace' && (
            <div className="px-4 pb-2">
              <div className="flex items-center gap-2">
                <div className="flex-1">
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
            </div>
          )}

          {/* Match Preview */}
          {currentMatch && (
            <div
              className="mx-4 mb-3 rounded-[6px] border p-3"
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

          {/* Bottom padding */}
          {!currentMatch && <div className="h-2" />}
        </div>
      </div>
    </div>
  );
};

export default FindReplaceModal;

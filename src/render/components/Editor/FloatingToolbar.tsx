// ============================================
// WeaveMD — Floating Formatting Toolbar
// ============================================
// Appears above text selection in Monaco editors
// (SourceCodeEditor or ActiveBlockEditor).
//
// Provides quick formatting: Bold, Italic,
// Strikethrough, Inline Code, Link, Highlight,
// and Clear Formatting.
//
// Inspired by MarkText's InlineFormatToolbar.
// ============================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';

// ============================================
// Format Actions
// ============================================

interface FormatAction {
  label: string;
  title: string;
  wrapper: string; // markdown syntax to wrap selection with
  /** If true, checking starts from the outside of the selection */
  testPattern?: (text: string) => boolean;
}

const FORMAT_ACTIONS: FormatAction[] = [
  {
    label: 'B',
    title: 'Bold (Ctrl+B)',
    wrapper: '**',
    testPattern: (t) => t.startsWith('**') && t.endsWith('**'),
  },
  {
    label: 'I',
    title: 'Italic (Ctrl+I)',
    wrapper: '*',
    testPattern: (t) => t.startsWith('*') && t.endsWith('*') && !t.startsWith('**'),
  },
  {
    label: 'S',
    title: 'Strikethrough',
    wrapper: '~~',
    testPattern: (t) => t.startsWith('~~') && t.endsWith('~~'),
  },
  {
    label: '</>',
    title: 'Inline Code',
    wrapper: '`',
    testPattern: (t) => t.startsWith('`') && t.endsWith('`'),
  },
  {
    label: '🔗',
    title: 'Link',
    wrapper: '[]()',
  },
  {
    label: 'H',
    title: 'Highlight',
    wrapper: '==',
    testPattern: (t) => t.startsWith('==') && t.endsWith('=='),
  },
];

// ============================================
// Props
// ============================================

interface FloatingToolbarProps {
  /** Ref to the active Monaco editor, or null */
  editorRef: React.RefObject<editor.IStandaloneCodeEditor | null> | null;
  /** Whether any editor is currently focused */
  isEditorFocused: boolean;
}

// ============================================
// Helpers
// ============================================

interface ToolbarPosition {
  top: number;
  left: number;
}

function computePosition(editor: editor.IStandaloneCodeEditor): ToolbarPosition | null {
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) return null;

  // Get the range's bounding rect in the editor viewport
  const range = selection;
  const domNode = editor.getDomNode();
  if (!domNode) return null;

  // Get the position of the selection start in pixels
  // We use getScrolledVisiblePosition to get coordinates relative to the editor
  const startPos = editor.getScrolledVisiblePosition(range.getStartPosition());
  const endPos = editor.getScrolledVisiblePosition(range.getEndPosition());
  if (!startPos || !endPos) return null;

  const editorRect = domNode.getBoundingClientRect();

  // Position above the first line of the selection, centered horizontally
  const top = editorRect.top + startPos.top - 44; // 40px above + 4px gap
  const left = editorRect.left + startPos.left;

  return { top, left };
}

function clampToViewport(
  pos: ToolbarPosition,
  toolbarWidth: number,
  toolbarHeight: number
): ToolbarPosition {
  const clamped = { ...pos };

  // Don't go above viewport
  if (clamped.top < 8) {
    clamped.top = 8;
  }

  // Don't go below viewport
  if (clamped.top + toolbarHeight > window.innerHeight - 8) {
    clamped.top = window.innerHeight - toolbarHeight - 8;
  }

  // Don't overflow horizontally
  if (clamped.left < 8) {
    clamped.left = 8;
  }
  if (clamped.left + toolbarWidth > window.innerWidth - 8) {
    clamped.left = window.innerWidth - toolbarWidth - 8;
  }

  return clamped;
}

// ============================================
// Component
// ============================================

const FloatingToolbar: React.FC<FloatingToolbarProps> = ({ editorRef, isEditorFocused }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<ToolbarPosition>({ top: 0, left: 0 });
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ============================================
  // Selection Change Listener
  // ============================================

  useEffect(() => {
    const editor = editorRef?.current;
    if (!editor) {
      setIsVisible(false);
      return;
    }

    const disposable = editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) {
        // Collapsed selection — hide with delay for mouse transition
        hideTimerRef.current = setTimeout(() => setIsVisible(false), 200);
        return;
      }

      // Clear any pending hide timer
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      const model = editor.getModel();
      if (!model) return;

      const text = model.getValueInRange(selection);

      // Check active formats
      const formats = new Set<string>();
      for (const action of FORMAT_ACTIONS) {
        if (action.testPattern?.(text)) {
          formats.add(action.label);
        }
      }
      setActiveFormats(formats);

      // Compute position
      const pos = computePosition(editor);
      if (pos) {
        const toolbarWidth = toolbarRef.current?.offsetWidth ?? 280;
        const toolbarHeight = toolbarRef.current?.offsetHeight ?? 40;
        setPosition(clampToViewport(pos, toolbarWidth, toolbarHeight));
        setIsVisible(true);
      }
    });

    // Hide on scroll
    const hideOnScroll = () => setIsVisible(false);
    editor.onDidScrollChange(hideOnScroll);

    return () => {
      disposable.dispose();
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [editorRef]);

  // Hide when editor loses focus
  useEffect(() => {
    if (!isEditorFocused) {
      setIsVisible(false);
    }
  }, [isEditorFocused]);

  // ============================================
  // Format Action Handler
  // ============================================

  const handleFormat = useCallback(
    (action: FormatAction) => {
      const editor = editorRef?.current;
      if (!editor) return;

      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) return;

      const model = editor.getModel();
      if (!model) return;

      const text = model.getValueInRange(selection);

      // Handle Link specially — wrap with [text](url)
      if (action.label === '🔗') {
        let newText: string;
        if (/^\[.*\]\(.*\)$/.test(text)) {
          // Remove link formatting
          const match = text.match(/^\[(.*)\]\(.*\)$/);
          newText = match ? match[1] : text;
        } else {
          newText = `[${text}](url)`;
        }

        editor.executeEdits('floating-toolbar', [
          {
            range: selection,
            text: newText,
          },
        ]);

        // Select the "url" part for easy editing
        if (!/^\[.*\]\(.*\)$/.test(text)) {
          const startCol = selection.startColumn + text.length + 2; // after "](url"
          editor.setSelection({
            startLineNumber: selection.startLineNumber,
            startColumn: startCol,
            endLineNumber: selection.startLineNumber,
            endColumn: startCol + 3,
          });
        }
        return;
      }

      // For toggle formats: if already wrapped, unwrap
      if (action.testPattern?.(text)) {
        const wrapper = action.wrapper;
        const unwrapped = text.slice(wrapper.length, text.length - wrapper.length);
        editor.executeEdits('floating-toolbar', [
          {
            range: selection,
            text: unwrapped,
          },
        ]);
        return;
      }

      // Wrap with markdown syntax
      const wrapped = `${action.wrapper}${text}${action.wrapper}`;
      editor.executeEdits('floating-toolbar', [
        {
          range: selection,
          text: wrapped,
        },
      ]);

      // Re-select the inner text (excluding wrappers)
      const wrapperLen = action.wrapper.length;
      const newSelection = editor.getSelection();
      if (newSelection) {
        editor.setSelection({
          startLineNumber: newSelection.startLineNumber,
          startColumn: newSelection.startColumn + wrapperLen,
          endLineNumber: newSelection.endLineNumber,
          endColumn: newSelection.endColumn + wrapperLen,
        });
      }
    },
    [editorRef]
  );

  const handleClearFormatting = useCallback(() => {
    const editor = editorRef?.current;
    if (!editor) return;

    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) return;

    const model = editor.getModel();
    if (!model) return;

    let text = model.getValueInRange(selection);

    // Strip common markdown formatting
    // Bold
    text = text.replace(/^\*\*(.+)\*\*$/, '$1');
    // Italic (but not bold)
    text = text.replace(/^\*(.+)\*$/, '$1');
    // Strikethrough
    text = text.replace(/^~~(.+)~~$/, '$1');
    // Inline code
    text = text.replace(/^`(.+)`$/, '$1');
    // Highlight
    text = text.replace(/^==(.+)==$/, '$1');
    // Link
    text = text.replace(/^\[(.+)\]\(.*\)$/, '$1');

    editor.executeEdits('floating-toolbar', [
      {
        range: selection,
        text,
      },
    ]);
  }, [editorRef]);

  // ============================================
  // Render
  // ============================================

  if (!isVisible || !editorRef?.current) return null;

  return (
    <div
      ref={toolbarRef}
      className="floating-toolbar fixed z-[100] flex items-center gap-0.5 px-1.5 py-1 rounded-lg shadow-lg select-none"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
      }}
      onMouseEnter={() => {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      }}
      onMouseLeave={() => {
        // Small delay to allow clicking toolbar before hiding
        hideTimerRef.current = setTimeout(() => setIsVisible(false), 300);
      }}
    >
      {FORMAT_ACTIONS.map((action) => {
        const isActive = activeFormats.has(action.label);
        return (
          <button
            key={action.label}
            title={action.title}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleFormat(action);
            }}
            onMouseDown={(e) => e.preventDefault()} // prevent editor blur
            className={`w-8 h-7 flex items-center justify-center rounded text-xs font-medium transition-colors duration-100 ${
              action.label === 'B' ? 'font-bold' : ''
            } ${action.label === 'I' ? 'italic' : ''}`}
            style={{
              color: isActive ? 'var(--accent)' : 'var(--text-sub)',
              backgroundColor: isActive ? 'var(--accent)20' : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            {action.label}
          </button>
        );
      })}

      {/* Divider */}
      <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

      {/* Clear formatting */}
      <button
        title="Clear Formatting"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleClearFormatting();
        }}
        onMouseDown={(e) => e.preventDefault()}
        className="w-8 h-7 flex items-center justify-center rounded text-xs transition-colors duration-100"
        style={{ color: 'var(--text-sub)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        ✕
      </button>
    </div>
  );
};

export default FloatingToolbar;

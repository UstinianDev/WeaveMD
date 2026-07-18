// ============================================
// WeaveMD — Floating Toolbar (appears on text selection)
// NOTE: This component needs a full rewrite for the new
// block-based WYSIWYG architecture. For now it is disabled
// until the block-aware selection toolbar is implemented.
// ============================================

import React from 'react';

interface FloatingToolbarProps {
  editor: null;
  selection: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
  isEditorFocused: boolean;
}

// FloatingToolbar is temporarily disabled for the new block-based architecture.
// It needs a full rewrite to work with block-level selection instead of
// Monaco IStandaloneCodeEditor + Selection. Return null until rewritten.
const FloatingToolbar: React.FC<FloatingToolbarProps> = () => {
  return null;
};

export default FloatingToolbar;

// ============================================
// WeaveMD — Status Bar Component
// ============================================

import React, { useMemo } from 'react';
import { useEditorStore } from '../../stores/editorStore';

const StatusBar: React.FC = () => {
  const currentFile = useEditorStore((s) => s.currentFile);
  const content = useEditorStore((s) => s.content);
  const isDirty = useEditorStore((s) => s.isDirty);

  const counts = useMemo(() => ({
    words: content ? content.trim().split(/\s+/).filter(Boolean).length : 0,
    chars: content ? content.length : 0,
    lines: content ? content.split('\n').length : 0,
  }), [content]);

  return (
    <footer className="flex items-center justify-between h-6 bg-[#1A1A1A] border-t border-[#2D2D2D] px-3 flex-shrink-0">
      <div className="flex items-center gap-3 text-xs text-[#666666]">
        {currentFile ? (
          <>
            <span>{currentFile.name}</span>
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${isDirty ? 'bg-yellow-500' : 'bg-green-500'}`} />
              {isDirty ? 'Unsaved' : 'Saved'}
            </span>
          </>
        ) : (
          <span>No file open</span>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-[#666666]">
        <span>{counts.words} words</span>
        <span>{counts.chars} chars</span>
        <span>Ln {counts.lines}</span>
        <span>Markdown</span>
      </div>
    </footer>
  );
};

export default StatusBar;

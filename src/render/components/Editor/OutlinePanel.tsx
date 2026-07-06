// ============================================
// WeaveMD — Document Outline Panel
// ============================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OutlineItem } from '../../services/markdown';
import { extractOutline } from '../../services/markdown';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';

const INDENT_CLASSES = ['ml-0', 'ml-4', 'ml-8'] as const;
const FONT_CLASSES = ['text-sm font-semibold', 'text-xs', 'text-xs'] as const;

interface OutlinePanelProps {
  onNavigateToLine?: (lineNumber: number) => void;
}

const OutlineItemRow: React.FC<{
  item: OutlineItem;
  onNavigate: (lineNumber: number) => void;
  depth: number;
}> = ({ item, onNavigate, depth }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const hasChildren = item.children.length > 0;
  const indentClass = INDENT_CLASSES[Math.min(depth - 1, 2)];
  const fontSizeClass = FONT_CLASSES[Math.min(item.level - 1, 2)];
  const textColorClass = 'text-text-sub';

  return (
    <div>
      <button
        onClick={() => onNavigate(item.lineNumber)}
        className={`
          w-full flex items-center gap-1 text-left py-0.5 px-2
          hover:bg-bg-tertiary rounded transition-colors duration-150
          ${indentClass} ${fontSizeClass} ${textColorClass}
          border-l-2 border-transparent hover:border-accent
        `}
      >
        {hasChildren && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="text-text-muted hover:text-white flex-shrink-0"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        )}
        {!hasChildren && <span className="w-2.5 flex-shrink-0" />}
        <span className="truncate">{item.text}</span>
      </button>

      {isExpanded &&
        item.children.map((child) => (
          <OutlineItemRow
            key={child.id}
            item={child}
            onNavigate={onNavigate}
            depth={depth + 1}
          />
        ))}
    </div>
  );
};

const OutlinePanel: React.FC<OutlinePanelProps> = ({ onNavigateToLine }) => {
  const content = useEditorStore((s) => s.content);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);

  const isResizing = useRef(false);
  const setSidebarWidthRef = useRef(setSidebarWidth);
  setSidebarWidthRef.current = setSidebarWidth;
  const [collapsed, setCollapsed] = useState(false);

  const outline = useMemo(() => {
    if (!content) return [];
    return extractOutline(content);
  }, [content]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = Math.max(180, Math.min(400, e.clientX));
    setSidebarWidthRef.current(newWidth);
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(() => {
    isResizing.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [handleMouseMove, handleMouseUp]);

  // Cleanup event listeners and body styles on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [handleMouseMove, handleMouseUp]);

  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center pt-3 bg-bg-secondary border-r border-border flex-shrink-0 w-8">
        <button
          onClick={() => setCollapsed(false)}
          className="text-text-muted hover:text-white transition-colors"
          title="Expand outline"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <aside
      className="bg-bg-secondary border-r border-border flex-shrink-0 flex flex-col h-full relative"
      style={{ width: `${sidebarWidth}px` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs text-text-muted uppercase tracking-wider">Outline</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed(true)}
            className="text-text-muted hover:text-white transition-colors p-0.5"
            title="Collapse outline"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-2">
        {outline.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-text-muted">
              {content ? 'No headings found' : 'Open a file to see outline'}
            </p>
          </div>
        ) : (
          outline.map((item) => (
            <OutlineItemRow
              key={item.id}
              item={item}
              onNavigate={(lineNumber) => onNavigateToLine?.(lineNumber)}
              depth={1}
            />
          ))
        )}
      </div>

      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/50 transition-colors z-10"
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
};

export default OutlinePanel;

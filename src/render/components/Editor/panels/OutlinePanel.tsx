// ============================================
// WeaveMD — Document Outline Panel (Tab Container)
// ============================================

import React, { useMemo, useState } from 'react';
import { useI18n } from '@render/i18n';
import type { OutlineItem } from '@render/services/markdown';
import { extractOutline } from '@render/services/markdown';
import { useEditorStore } from '@render/stores/editorStore';
import { useFileTreeStore } from '@render/stores/fileTreeStore';
import { useUIStore } from '@render/stores/uiStore';
import FileTreePanel from './FileTreePanel';

const INDENT_CLASSES = ['ml-0', 'ml-4', 'ml-8'] as const;
const FONT_CLASSES = [
  'text-xl font-bold',
  'text-lg font-semibold',
  'text-base font-medium',
] as const;

interface OutlinePanelProps {
  onNavigateToHeading?: (lineNumber: number, headingIndex: number) => void;
  activeHeadingIndex?: number | null;
}

function buildHeadingIndexMap(items: OutlineItem[]): Map<string, number> {
  const map = new Map<string, number>();
  let index = 0;
  function walk(item: OutlineItem): void {
    map.set(item.id, index);
    index += 1;
    for (const child of item.children) {
      walk(child);
    }
  }
  for (const item of items) {
    walk(item);
  }
  return map;
}

const OutlineItemRow: React.FC<{
  item: OutlineItem;
  headingIndex: number;
  activeHeadingIndex: number | null;
  indexMap: Map<string, number>;
  onNavigate: (lineNumber: number, headingIndex: number) => void;
  depth: number;
}> = ({ item, headingIndex, activeHeadingIndex, indexMap, onNavigate, depth }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const hasChildren = item.children.length > 0;
  const indentClass = INDENT_CLASSES[Math.min(depth - 1, 2)];
  const fontSizeClass = FONT_CLASSES[Math.min(item.level - 1, 2)];
  const isActive = activeHeadingIndex === headingIndex;

  return (
    <div>
      <button
        onClick={() => onNavigate(item.lineNumber, headingIndex)}
        className={`
          w-full flex items-center gap-1 text-left py-1.5 px-2
          rounded transition-colors duration-150
          ${indentClass} ${fontSizeClass}
          ${isActive ? 'bg-bg-tertiary text-accent border-l-2 border-accent' : 'text-text-sub border-l-2 border-transparent hover:bg-bg-tertiary hover:border-accent'}
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
            headingIndex={indexMap.get(child.id) ?? 0}
            activeHeadingIndex={activeHeadingIndex}
            indexMap={indexMap}
            onNavigate={onNavigate}
            depth={depth + 1}
          />
        ))}
    </div>
  );
};

const OutlinePanel: React.FC<OutlinePanelProps> = ({
  onNavigateToHeading,
  activeHeadingIndex = null,
}) => {
  const { t } = useI18n();
  const content = useEditorStore((s) => s.content);
  const isOutlinePanelCollapsed = useUIStore((s) => s.isOutlinePanelCollapsed);
  const toggleOutlinePanel = useUIStore((s) => s.toggleOutlinePanel);
  const activeTab = useFileTreeStore((s) => s.activeTab);

  const outline = useMemo(() => {
    if (!content) return [];
    return extractOutline(content);
  }, [content]);

  const indexMap = useMemo(() => buildHeadingIndexMap(outline), [outline]);

  if (isOutlinePanelCollapsed) {
    return (
      <div className="h-full flex flex-col items-center pt-3 bg-bg-secondary border-r border-border flex-shrink-0 w-8">
        <button
          onClick={toggleOutlinePanel}
          className="text-text-muted hover:text-white transition-colors"
          title="Expand outline"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <aside className="bg-bg-secondary border-r border-border flex flex-col h-full w-full">
      {/* Tab Header */}
      <div
        className="flex items-center border-b px-3 py-2 gap-1"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <button
          onClick={() => useFileTreeStore.getState().setActiveTab('outline')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-sm transition-colors ${
            activeTab === 'outline'
              ? 'bg-accent/20 text-text-primary'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <span>📑</span>
          <span>{t('sidebar.outline')}</span>
        </button>
        <button
          onClick={() => useFileTreeStore.getState().setActiveTab('files')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-sm transition-colors ${
            activeTab === 'files'
              ? 'bg-accent/20 text-text-primary'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <span>📁</span>
          <span>{t('sidebar.files')}</span>
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'outline' ? (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-end px-3 py-1 border-b border-border">
            <button
              onClick={toggleOutlinePanel}
              className="text-text-muted hover:text-white transition-colors p-0.5"
              title="Collapse outline"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>

          {/* Outline List */}
          <div className="outline-scroll flex-1 overflow-y-auto py-2">
            {outline.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-sm text-text-muted">
                  {content ? 'No headings found' : 'Open a file to see outline'}
                </p>
              </div>
            ) : (
              outline.map((item) => (
                <OutlineItemRow
                  key={item.id}
                  item={item}
                  headingIndex={indexMap.get(item.id) ?? 0}
                  activeHeadingIndex={activeHeadingIndex}
                  indexMap={indexMap}
                  onNavigate={(lineNumber, headingIndex) =>
                    onNavigateToHeading?.(lineNumber, headingIndex)
                  }
                  depth={1}
                />
              ))
            )}
          </div>
        </>
      ) : (
        <FileTreePanel />
      )}
    </aside>
  );
};

export default OutlinePanel;

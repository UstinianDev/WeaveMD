// ============================================
// WeaveMD — Document Outline Panel (Tab Container)
// ============================================
// 重构：Tab Header 替换为 SidebarToolbar（含搜索、导入、导出、新建），
// 搜索框在工具栏下方展开，FileTreePanel 支持搜索过滤。

import React, { useCallback, useMemo, useState } from 'react';
import type { OutlineItem } from '@render/services/markdown';
import { extractOutline } from '@render/services/markdown';
import { useEditorStore } from '@render/stores/editorStore';
import { useFileTreeStore } from '@render/stores/fileTreeStore';
import { useUIStore } from '@render/stores/uiStore';
import { useNavbarActions } from '@render/hooks/useNavbarActions';
import FileTreePanel from './FileTreePanel';
import SidebarToolbar from './SidebarToolbar';
import FileSearchBar from './FileSearchBar';
import ImportMarkdownModal from './ImportMarkdownModal';
import CreatePanel from '@render/components/Navbar/CreatePanel';
import type { IFile } from '@shared/types';
import { createDiskFile } from '@render/services/fileOps';
import { useAuthStore } from '@render/stores/authStore';
import { useRecentStore } from '@render/stores/recentStore';

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
  const content = useEditorStore((s) => s.content);
  const isOutlinePanelCollapsed = useUIStore((s) => s.isOutlinePanelCollapsed);
  const toggleOutlinePanel = useUIStore((s) => s.toggleOutlinePanel);
  const isEditorCollapsed = useUIStore((s) => s.isEditorCollapsed);
  const activeTab = useFileTreeStore((s) => s.activeTab);
  const addFile = useFileTreeStore((s) => s.addFile);
  const loadFolderContents = useFileTreeStore((s) => s.loadFolderContents);
  const setActiveTab = useFileTreeStore((s) => s.setActiveTab);
  const openFile = useEditorStore((s) => s.openFile);
  const authUser = useAuthStore((s) => s.user);
  const { handleExport } = useNavbarActions();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [createPanelType, setCreatePanelType] = useState<'file' | 'folder' | null>(null);

  const outline = useMemo(() => {
    if (!content) return [];
    return extractOutline(content);
  }, [content]);

  const indexMap = useMemo(() => buildHeadingIndexMap(outline), [outline]);

  // 编辑区收起时，大纲 tab 无意义（无文档内容），强制切到文件 tab
  const effectiveTab = isEditorCollapsed ? 'files' : activeTab;

  // 工具栏回调
  const handleToggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) setSearchQuery('');
      return !prev;
    });
  }, []);

  const handleNewFile = useCallback(() => {
    setCreatePanelType('file');
  }, []);

  const handleNewFolder = useCallback(() => {
    setCreatePanelType('folder');
  }, []);

  const handleCreateConfirm = useCallback(
    async (name: string, parentPath: string) => {
      if (!authUser) return;
      try {
        if (createPanelType === 'file') {
          const filePath = parentPath
            ? `${parentPath.replace(/[/\\]$/, '')}/${name}`
            : name;
          const finalPath = filePath.endsWith('.md') ? filePath : `${filePath}.md`;
          await window.weaveMD.file.write(finalPath, '');
          const readResult = (await window.weaveMD.file.readDisk(finalPath)) as {
            success: boolean;
            data?: { path: string; name: string; content: string };
          };
          if (readResult.success && readResult.data) {
            const file: IFile = createDiskFile(authUser, readResult.data);
            openFile(file);
            useRecentStore.getState().touchRecent({
              id: file.id,
              path: readResult.data.path,
              name: readResult.data.name,
            });
            addFile({
              id: readResult.data.path,
              name: readResult.data.name,
              path: readResult.data.path,
              content: '',
            });
          }
        } else {
          const folderPath = parentPath
            ? `${parentPath.replace(/[/\\]$/, '')}/${name}`
            : name;
          await window.weaveMD.folder.createFolder(folderPath, '');
          const normalizedPath = folderPath.replace(/\\/g, '/');
          loadFolderContents(normalizedPath);
          setActiveTab('files');
        }
      } catch {
        // error
      } finally {
        setCreatePanelType(null);
      }
    },
    [authUser, createPanelType, openFile, addFile, loadFolderContents, setActiveTab]
  );

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
      {/* 工具栏 */}
      <SidebarToolbar
        isEditorCollapsed={isEditorCollapsed}
        searchOpen={searchOpen}
        onToggleSearch={handleToggleSearch}
        onImport={() => setImportOpen(true)}
        onExport={handleExport}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
      />

      {/* 搜索框 */}
      {searchOpen && (
        <FileSearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery('');
          }}
        />
      )}

      {/* Tab Content */}
      {effectiveTab === 'outline' ? (
        <>
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
        <FileTreePanel searchQuery={searchQuery} />
      )}

      {/* 导入模态框 */}
      {importOpen && <ImportMarkdownModal onClose={() => setImportOpen(false)} />}

      {/* 新建文件/文件夹面板 */}
      {createPanelType && (
        <CreatePanel
          type={createPanelType}
          onClose={() => setCreatePanelType(null)}
          onConfirm={(name, parentPath) => void handleCreateConfirm(name, parentPath)}
        />
      )}
    </aside>
  );
};

export default OutlinePanel;

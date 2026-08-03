// ============================================
// WeaveMD — File Tree Panel
// ============================================

import React, { useCallback } from 'react';
import type { IFile } from '../../../shared/types';
import { useI18n } from '../../i18n';
import { useEditorStore } from '../../stores/editorStore';
import { useFileTreeStore, type IFileNode, type IFolderNode } from '../../stores/fileTreeStore';

const FileTreePanel: React.FC = () => {
  const { t } = useI18n();
  const folders = useFileTreeStore((s) => s.folders);
  const looseFiles = useFileTreeStore((s) => s.looseFiles);
  const selectedIds = useFileTreeStore((s) => s.selectedIds);
  const toggleExpand = useFileTreeStore((s) => s.toggleExpand);
  const toggleSelect = useFileTreeStore((s) => s.toggleSelect);
  const removeFolder = useFileTreeStore((s) => s.removeFolder);
  const removeFile = useFileTreeStore((s) => s.removeFile);
  const openFile = useEditorStore((s) => s.openFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const currentFileId = useEditorStore((s) => s.currentFile?.id ?? null);

  // Open a file from disk into the editor
  const handleFileClick = useCallback(
    async (node: { id: string; name: string; path: string; content?: string }) => {
      // If content is already cached, use it; otherwise read from disk
      let content = node.content ?? '';
      if (!content) {
        try {
          const result = (await window.weaveMD.file.readDisk(node.path)) as unknown as {
            success: boolean;
            data?: { content: string };
          };
          if (result.success && result.data) {
            content = result.data.content;
          }
        } catch {
          // Fallback to empty content
        }
      }
      const now = new Date().toISOString();
      const iFile: IFile = {
        id: node.path,
        userId: '',
        name: node.name,
        content,
        createdAt: now,
        modifiedAt: now,
        deletedAt: null,
      };
      openFile(iFile);
    },
    [openFile]
  );

  // Trash handler: only clears from list, does NOT delete from disk.
  // If the trashed file is the current file, close the editor (show empty state).
  const handleTrashFile = useCallback(
    (fileId: string) => {
      // Only remove from list (looseFiles), not from disk
      removeFile(fileId);
      // If this was the current file, close editor to show empty state
      if (currentFileId === fileId) {
        closeFile();
      }
    },
    [removeFile, currentFileId, closeFile]
  );

  // Trash handler for root folder: only removes from list, does NOT delete from disk.
  const handleTrashFolder = useCallback(
    (folderId: string) => {
      removeFolder(folderId);
      // If current file is inside this folder, close editor
      if (currentFileId && currentFileId.startsWith(folderId)) {
        closeFile();
      }
    },
    [removeFolder, currentFileId, closeFile]
  );

  const renderNode = useCallback(
    (node: IFolderNode, depth: number) => {
      const indent = depth * 16;
      const isFolder = node.isDirectory;
      const isSelected = selectedIds.includes(node.id);
      const isActive = !isFolder && node.id === currentFileId;
      const hasChildren = node.children.length > 0;

      // Trash only shows on root folders (not sub-folders, not files inside folders)
      const showTrash = isFolder && node.isRoot;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-2 py-2.5 px-2 rounded hover:bg-white/5 cursor-pointer group ${
              isActive ? 'current-file-active' : ''
            } ${isSelected && !isActive ? 'bg-accent/20' : ''}`}
            style={{ paddingLeft: `${indent + 8}px` }}
            onClick={() => {
              toggleSelect(node.id);
              if (isFolder) {
                toggleExpand(node.id);
              } else {
                // Files inside folders: open in editor
                void handleFileClick(node);
              }
            }}
          >
            {isFolder ? (
              <span className="w-4 text-xs select-none text-text-muted">
                {node.expanded ? '▼' : '▶'}
              </span>
            ) : (
              <span className="w-4" />
            )}

            <span className="text-base select-none">
              {isFolder ? (node.expanded ? '📂' : '📁') : '📄'}
            </span>

            <span className="flex-1 text-base text-text-primary truncate select-none">
              {node.name}
            </span>

            {showTrash && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleTrashFolder(node.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-all"
                title={t('common.remove') || '移除'}
              >
                🗑️
              </button>
            )}
          </div>

          {isFolder && node.expanded && hasChildren && (
            <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
          )}
        </div>
      );
    },
    [selectedIds, currentFileId, toggleExpand, toggleSelect, handleFileClick, handleTrashFolder, t]
  );

  const renderLooseFile = useCallback(
    (file: IFileNode) => {
      const isSelected = selectedIds.includes(file.id);
      const isActive = file.id === currentFileId;
      return (
        <div
          key={file.id}
          className={`flex items-center gap-2 py-2.5 px-2 rounded hover:bg-white/5 cursor-pointer group ${
            isActive ? 'current-file-active' : ''
          } ${isSelected && !isActive ? 'bg-accent/20' : ''}`}
          onClick={() => {
            toggleSelect(file.id);
            void handleFileClick(file);
          }}
        >
          <span className="w-4" />
          <span className="text-base select-none">📄</span>
          <span className="flex-1 text-base text-text-primary truncate select-none">
            {file.name}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleTrashFile(file.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-all"
            title={t('common.remove') || '移除'}
          >
            🗑️
          </button>
        </div>
      );
    },
    [selectedIds, currentFileId, toggleSelect, handleFileClick, handleTrashFile, t]
  );

  if (folders.length === 0 && looseFiles.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-8 px-3">
        <p className="text-sm text-text-muted text-center">{t('sidebar.noFiles')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {/* 文件在上 */}
      {looseFiles.map((file) => renderLooseFile(file))}

      {/* 分隔线 */}
      {looseFiles.length > 0 && folders.length > 0 && (
        <div
          className="border-t border-border my-2"
          style={{ borderColor: 'var(--border-color)' }}
        />
      )}

      {/* 文件夹在下 */}
      {folders.map((folder) => (
        <div key={folder.id}>{renderNode(folder, 0)}</div>
      ))}
    </div>
  );
};

export default FileTreePanel;

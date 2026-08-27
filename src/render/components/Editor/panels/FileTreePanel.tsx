// ============================================
// WeaveMD — File Tree Panel
// ============================================

import React, { useCallback } from 'react';
import type { IFile } from '@shared/types';
import { useI18n } from '@render/i18n';
import { saveCurrentDraftIfNeeded } from '@render/services/saveCurrentDraft';
import { isWelcomeFile } from '@render/services/welcomeDocument';
import { useEditorStore } from '@render/stores/editorStore';
import { useFileTreeStore, type IFileNode, type IFolderNode } from '@render/stores/fileTreeStore';
import { touchRecent } from '@render/stores/recentStore';

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
      // 切换文件前先保存当前 dirty 草稿，避免未保存修改丢失（与 Navbar 打开路径一致）
      if (currentFileId && currentFileId !== node.id) {
        await saveCurrentDraftIfNeeded();
      }
      // 点击当前已打开文件：no-op，避免重新读盘覆盖未保存编辑
      if (currentFileId === node.id) {
        return;
      }
      // 欢迎文档为内存只读项（无磁盘路径）：用 node.content 直接打开，跳过 readDisk
      if (isWelcomeFile(node.id)) {
        const now = new Date().toISOString();
        openFile({
          id: node.id,
          userId: '',
          name: node.name,
          content: node.content ?? '',
          createdAt: now,
          modifiedAt: now,
          deletedAt: null,
        });
        return;
      }
      // 始终以磁盘为准重新读取，不信任 fileTreeStore 中可能陈旧的 content 缓存
      // DB 文件（AI 创建的 looseFiles）不在磁盘上，回退到 node.content
      let content = '';
      try {
        const result = (await window.weaveMD.file.readDisk(node.path)) as unknown as {
          success: boolean;
          data?: { content: string };
        };
        if (result.success && result.data) {
          content = result.data.content;
        }
      } catch {
        // 磁盘读取失败（文件不存在于磁盘），回退到缓存内容
      }
      // 磁盘无内容但 node 有缓存内容（DB 文件场景）：使用缓存
      if (!content && node.content) {
        content = node.content;
      }
      // 最终兜底：从 DB 读取（AI 创建的文件可能只存在于 DB 中）
      if (!content) {
        try {
          const dbResult = await window.weaveMD.file.get(node.id, '') as unknown as {
            success: boolean;
            data?: { content: string };
          };
          if (dbResult?.success && dbResult.data) {
            content = dbResult.data.content;
          }
        } catch { /* ignore */ }
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
      touchRecent({ id: iFile.id, path: node.path, name: node.name });
    },
    [currentFileId, openFile]
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
      const hasChildren = (node.children?.length ?? 0) > 0;

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

            <span className="flex-1 text-base text-text-primary truncate select-none font-semibold" style={{ fontFamily: 'Consolas, KaiTi, 楷体, STKaiti, system-ui' }}>
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
            <div>{(node.children ?? []).map((child) => renderNode(child, depth + 1))}</div>
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
          <span className="flex-1 text-base text-text-primary truncate select-none font-semibold" style={{ fontFamily: 'Consolas, KaiTi, 楷体, STKaiti, system-ui' }}>
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

// ============================================
// WeaveMD — File Tree Panel
// ============================================
// 增强版：支持右键菜单（重命名/删除）、双击切换文件、inline 重命名、搜索过滤。

import React, { useCallback, useState } from 'react';
import type { IFile } from '@shared/types';
import { useI18n } from '@render/i18n';
import { saveCurrentDraftIfNeeded } from '@render/services/saveCurrentDraft';
import { isWelcomeFile } from '@render/services/welcomeDocument';
import { useEditorStore } from '@render/stores/editorStore';
import { useFileTreeStore, type IFileNode, type IFolderNode } from '@render/stores/fileTreeStore';
import { touchRecent } from '@render/stores/recentStore';
import ContextMenu from './ContextMenu';
import RenameInput from './RenameInput';

interface FileTreePanelProps {
  /** 搜索过滤关键词 */
  searchQuery?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
  nodeName: string;
  nodePath: string;
  isDirectory: boolean;
}

const FileTreePanel: React.FC<FileTreePanelProps> = ({ searchQuery = '' }) => {
  const { t } = useI18n();
  const folders = useFileTreeStore((s) => s.folders);
  const looseFiles = useFileTreeStore((s) => s.looseFiles);
  const selectedIds = useFileTreeStore((s) => s.selectedIds);
  const toggleExpand = useFileTreeStore((s) => s.toggleExpand);
  const toggleSelect = useFileTreeStore((s) => s.toggleSelect);
  const removeFolder = useFileTreeStore((s) => s.removeFolder);
  const removeFileFromEverywhere = useFileTreeStore((s) => s.removeFileFromEverywhere);
  const renameNode = useFileTreeStore((s) => s.renameNode);
  const openFile = useEditorStore((s) => s.openFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const currentFileId = useEditorStore((s) => s.currentFile?.id ?? null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // 搜索过滤
  const matchesSearch = useCallback(
    (name: string) => {
      if (!searchQuery) return true;
      return name.toLowerCase().includes(searchQuery.toLowerCase());
    },
    [searchQuery]
  );

  // 递归检查文件夹是否包含匹配项
  const folderHasMatch = useCallback(
    (node: IFolderNode): boolean => {
      if (matchesSearch(node.name)) return true;
      return node.children.some((child) =>
        child.isDirectory ? folderHasMatch(child) : matchesSearch(child.name)
      );
    },
    [matchesSearch]
  );

  // 单击切换：已打开 → 关闭，未打开 → 打开
  const handleFileClick = useCallback(
    async (node: { id: string; name: string; path: string; content?: string }) => {
      // 点击当前已打开文件 → 关闭
      if (currentFileId === node.id) {
        await saveCurrentDraftIfNeeded();
        closeFile();
        return;
      }
      // 切换文件前先保存当前 dirty 草稿
      if (currentFileId) {
        await saveCurrentDraftIfNeeded();
      }
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
        // fallback
      }
      if (!content && node.content) {
        content = node.content;
      }
      if (!content) {
        try {
          const dbResult = (await window.weaveMD.file.get(node.id, '')) as unknown as {
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

  // 右键菜单
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string, nodeName: string, nodePath: string, isDirectory: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeId,
        nodeName,
        nodePath,
        isDirectory,
      });
    },
    []
  );

  // 重命名
  const handleRename = useCallback(
    async (oldPath: string, newName: string, isDirectory: boolean) => {
      try {
        const result = (await window.weaveMD.file.rename(oldPath, newName)) as unknown as {
          success: boolean;
          data?: { newPath: string };
          message?: string;
        };
        if (result.success && result.data) {
          // 更新 store
          renameNode(oldPath, newName);

          // 如果是当前打开的文件，更新 editorStore
          if (!isDirectory && currentFileId === oldPath) {
            const now = new Date().toISOString();
            const readResult = (await window.weaveMD.file.readDisk(result.data.newPath)) as unknown as {
              success: boolean;
              data?: { content: string };
            };
            if (readResult.success && readResult.data) {
              openFile({
                id: result.data.newPath,
                userId: '',
                name: newName,
                content: readResult.data.content,
                createdAt: now,
                modifiedAt: now,
                deletedAt: null,
              });
            }
          }
        }
      } catch {
        // error
      }
      setRenamingId(null);
    },
    [renameNode, currentFileId, openFile]
  );

  // 删除（右键菜单）
  const handleContextMenuDelete = useCallback(
    async (nodeId: string, nodePath: string, isDirectory: boolean) => {
      const confirmMsg = isDirectory
        ? t('sidebar.confirmDeleteFolder')
        : t('sidebar.confirmDeleteFile');
      if (!window.confirm(confirmMsg)) return;

      try {
        if (isDirectory) {
          await window.weaveMD.folder.deleteFolder(nodePath);
          removeFolder(nodeId);
          // 如果当前文件在该文件夹内，关闭
          if (currentFileId && currentFileId.startsWith(nodePath)) {
            await saveCurrentDraftIfNeeded();
            closeFile();
          }
        } else {
          await window.weaveMD.file.deleteDisk(nodePath);
          removeFileFromEverywhere(nodeId);
          if (currentFileId === nodePath) {
            await saveCurrentDraftIfNeeded();
            closeFile();
          }
        }
      } catch {
        // error
      }
    },
    [removeFolder, removeFileFromEverywhere, currentFileId, closeFile, t]
  );

  // 渲染节点（递归）
  const renderNode = useCallback(
    (node: IFolderNode, depth: number) => {
      const indent = depth * 16;
      const isFolder = node.isDirectory;
      const isSelected = selectedIds.includes(node.id);
      const isActive = !isFolder && node.id === currentFileId;
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isRenaming = renamingId === node.id;

      // 搜索过滤
      if (searchQuery) {
        if (isFolder) {
          if (!folderHasMatch(node)) return null;
        } else {
          if (!matchesSearch(node.name)) return null;
        }
      }

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-2 py-2.5 px-2 rounded hover:bg-white/5 cursor-pointer group ${
              isActive ? 'current-file-active' : ''
            } ${isSelected && !isActive ? 'bg-accent/20' : ''}`}
            style={{ paddingLeft: `${indent + 8}px` }}
            onClick={() => {
              if (isRenaming) return;
              toggleSelect(node.id);
              if (isFolder) {
                toggleExpand(node.id);
              } else {
                void handleFileClick(node);
              }
            }}
            onContextMenu={(e) =>
              handleContextMenu(e, node.id, node.name, node.path, isFolder)
            }
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

            {isRenaming ? (
              <RenameInput
                currentName={node.name}
                onConfirm={(newName) => handleRename(node.path, newName, isFolder)}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <span
                className="flex-1 text-base text-text-primary truncate select-none font-semibold"
                style={{ fontFamily: 'Consolas, KaiTi, 楷体, STKaiti, system-ui' }}
              >
                {node.name}
              </span>
            )}
          </div>

          {isFolder && node.expanded && hasChildren && (
            <div>{(node.children ?? []).map((child) => renderNode(child, depth + 1))}</div>
          )}
        </div>
      );
    },
    [selectedIds, currentFileId, toggleExpand, toggleSelect, handleFileClick, handleContextMenu, renamingId, handleRename, searchQuery, folderHasMatch, matchesSearch]
  );

  // 渲染独立文件
  const renderLooseFile = useCallback(
    (file: IFileNode) => {
      const isSelected = selectedIds.includes(file.id);
      const isActive = file.id === currentFileId;
      const isRenaming = renamingId === file.id;

      // 搜索过滤
      if (searchQuery && !matchesSearch(file.name)) return null;

      return (
        <div
          key={file.id}
          className={`flex items-center gap-2 py-2.5 px-2 rounded hover:bg-white/5 cursor-pointer group ${
            isActive ? 'current-file-active' : ''
          } ${isSelected && !isActive ? 'bg-accent/20' : ''}`}
          onClick={() => {
            if (isRenaming) return;
            toggleSelect(file.id);
            void handleFileClick(file);
          }}
          onContextMenu={(e) =>
            handleContextMenu(e, file.id, file.name, file.path, false)
          }
        >
          <span className="w-4" />
          <span className="text-base select-none">📄</span>
          {isRenaming ? (
            <RenameInput
              currentName={file.name}
              onConfirm={(newName) => handleRename(file.path, newName, false)}
              onCancel={() => setRenamingId(null)}
            />
          ) : (
            <span
              className="flex-1 text-base text-text-primary truncate select-none font-semibold"
              style={{ fontFamily: 'Consolas, KaiTi, 楷体, STKaiti, system-ui' }}
            >
              {file.name}
            </span>
          )}
        </div>
      );
    },
    [selectedIds, currentFileId, toggleSelect, handleFileClick, handleContextMenu, renamingId, handleRename, searchQuery, matchesSearch]
  );

  // 检查是否有可见内容
  const hasVisibleContent = searchQuery
    ? looseFiles.some((f) => matchesSearch(f.name)) || folders.some((f) => folderHasMatch(f))
    : folders.length > 0 || looseFiles.length > 0;

  if (!hasVisibleContent) {
    return (
      <div className="flex-1 flex items-center justify-center py-8 px-3">
        <p className="text-sm text-text-muted text-center">
          {searchQuery ? t('history.noMatching') : t('sidebar.noFiles')}
        </p>
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

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isDirectory={contextMenu.isDirectory}
          onRename={() => setRenamingId(contextMenu.nodeId)}
          onDelete={() =>
            handleContextMenuDelete(
              contextMenu.nodeId,
              contextMenu.nodePath,
              contextMenu.isDirectory
            )
          }
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default FileTreePanel;

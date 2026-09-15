// ============================================
// WeaveMD — File Tree Panel
// ============================================
// 增强版：支持右键菜单（重命名/删除）、双击切换文件、inline 重命名、搜索过滤。

import React, { useCallback, useState } from 'react';
import type { IFile } from '@shared/types';
import { useI18n } from '@render/i18n';
import Icon from '@render/components/Common/Icon';
import ConfirmDialog from '@render/components/Common/ConfirmDialog';
import { saveCurrentDraftIfNeeded } from '@render/services/saveCurrentDraft';
import { isWelcomeFile } from '@render/services/welcomeDocument';
import { useEditorStore } from '@render/stores/editorStore';
import { useFileTreeStore, type IFileNode, type IFolderNode } from '@render/stores/fileTreeStore';
import { touchRecent } from '@render/stores/recentStore';
import { EDITOR_FONT_FAMILY } from '@render/utils/fontConstants';
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

// ============================================
// FileTreeRow — 统一的文件/文件夹行组件
// ============================================

interface FileTreeRowProps {
  item: IFolderNode;
  depth: number;
  isActive: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  indentPx: number;
  onRowClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameConfirm: (newName: string) => void;
  onRenameCancel: () => void;
  /** 仅根文件夹：点击垃圾桶从文件树中移除（不删磁盘文件） */
  onRemoveRootFolder?: () => void;
}

const FileTreeRow: React.FC<FileTreeRowProps> = ({
  item,
  depth,
  isActive,
  isSelected,
  isRenaming,
  indentPx,
  onRowClick,
  onContextMenu,
  onRenameConfirm,
  onRenameCancel,
  onRemoveRootFolder,
}) => {
  const isFolder = item.isDirectory;
  const hasChildren = (item.children?.length ?? 0) > 0;

  return (
    <div
      key={item.id}
      className={`flex items-center gap-2 py-2.5 px-2 rounded hover:bg-white/5 cursor-pointer group ${
        isActive ? 'current-file-active' : ''
      } ${isSelected && !isActive ? 'bg-accent/20' : ''}`}
      style={{ paddingLeft: `${indentPx + 8}px` }}
      onClick={() => {
        if (isRenaming) return;
        onRowClick();
      }}
      onContextMenu={onContextMenu}
    >
      {isFolder ? (
        <span className="w-4 text-xs select-none text-text-muted">
          {item.expanded ? '▼' : '▶'}
        </span>
      ) : (
        <span className="w-4" />
      )}

      <span className="select-none text-text-muted">
        {isFolder ? (
          <Icon icon={item.expanded ? 'folder-open' : 'folder-outline'} size={16} />
        ) : (
          <Icon icon="file-outline" size={16} />
        )}
      </span>

      {isRenaming ? (
        <RenameInput
          currentName={item.name}
          onConfirm={onRenameConfirm}
          onCancel={onRenameCancel}
        />
      ) : (
        <>
          <span
            className="flex-1 text-base text-text-primary truncate select-none font-semibold"
            style={{ fontFamily: EDITOR_FONT_FAMILY }}
          >
            {item.name}
          </span>
          {/* 根文件夹垃圾桶：仅从文件树移除，不删磁盘文件 */}
          {item.isRoot && isFolder && onRemoveRootFolder && (
            <button
              type="button"
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-red-400 p-0.5 rounded"
              title={item.name + ' — 从文件树中移除'}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveRootFolder();
              }}
            >
              <Icon icon="delete" size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );
};

// ============================================
// FileTreePanel
// ============================================

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
  const isDirty = useEditorStore((s) => s.isDirty);
  const saveFile = useEditorStore((s) => s.saveFile);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{ id: string; name: string; path: string; content?: string } | null>(null);

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

  // 实际执行文件切换（无确认逻辑）
  const doSwitchFile = useCallback(
    async (node: { id: string; name: string; path: string; content?: string }) => {
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
      const fileId = node.path || node.id;
      touchRecent({ id: fileId, path: node.path, name: node.name });
      openFile({
        id: fileId,
        userId: '',
        name: node.name,
        content,
        createdAt: '',
        modifiedAt: '',
        deletedAt: null,
      });
    },
    [openFile]
  );

  // 单击切换
  const handleFileClick = useCallback(
    async (node: { id: string; name: string; path: string; content?: string }) => {
      if (currentFileId === node.id) {
        await saveCurrentDraftIfNeeded();
        closeFile();
        return;
      }
      if (currentFileId && isDirty) {
        setPendingSwitch(node);
        return;
      }
      await doSwitchFile(node);
    },
    [currentFileId, isDirty, closeFile, doSwitchFile]
  );

  const handleConfirmSave = useCallback(async () => {
    if (!pendingSwitch) return;
    await saveFile();
    await doSwitchFile(pendingSwitch);
    setPendingSwitch(null);
  }, [pendingSwitch, saveFile, doSwitchFile]);

  const handleConfirmDontSave = useCallback(async () => {
    if (!pendingSwitch) return;
    await doSwitchFile(pendingSwitch);
    setPendingSwitch(null);
  }, [pendingSwitch, doSwitchFile]);

  const handleConfirmCancel = useCallback(() => {
    setPendingSwitch(null);
  }, []);

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
          renameNode(oldPath, newName);
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

  // 渲染文件夹节点（递归）
  const renderNode = useCallback(
    (node: IFolderNode, depth: number) => {
      const isFolder = node.isDirectory;
      const isActive = !isFolder && node.id === currentFileId;
      const hasChildren = (node.children?.length ?? 0) > 0;

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
          <FileTreeRow
            item={node}
            depth={depth}
            isActive={isActive}
            isSelected={selectedIds.includes(node.id)}
            isRenaming={renamingId === node.id}
            indentPx={depth * 16}
            onRowClick={() => {
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
            onRenameConfirm={(newName) => handleRename(node.path, newName, isFolder)}
            onRenameCancel={() => setRenamingId(null)}
            onRemoveRootFolder={
              node.isRoot ? () => removeFolder(node.id) : undefined
            }
          />

          {isFolder && node.expanded && hasChildren && (
            <div>{(node.children ?? []).map((child) => renderNode(child, depth + 1))}</div>
          )}
        </div>
      );
    },
    [selectedIds, currentFileId, toggleExpand, toggleSelect, handleFileClick, handleContextMenu, renamingId, handleRename, searchQuery, folderHasMatch, matchesSearch, removeFolder]
  );

  // 渲染独立文件（使用统一的 FileTreeRow）
  const renderLooseFile = useCallback(
    (file: IFileNode) => {
      if (searchQuery && !matchesSearch(file.name)) return null;

      // 适配 IFileNode → IFolderNode 形状（isDirectory: false）
      const node: IFolderNode = {
        id: file.id,
        name: file.name,
        path: file.path,
        isDirectory: false,
        children: [],
        expanded: false,
        isRoot: false,
      };

      return (
        <FileTreeRow
          key={file.id}
          item={node}
          depth={0}
          isActive={file.id === currentFileId}
          isSelected={selectedIds.includes(file.id)}
          isRenaming={renamingId === file.id}
          indentPx={0}
          onRowClick={() => {
            toggleSelect(file.id);
            void handleFileClick(file);
          }}
          onContextMenu={(e) =>
            handleContextMenu(e, file.id, file.name, file.path, false)
          }
          onRenameConfirm={(newName) => handleRename(file.path, newName, false)}
          onRenameCancel={() => setRenamingId(null)}
        />
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

      {/* 切换文档确认对话框 */}
      <ConfirmDialog
        isOpen={!!pendingSwitch}
        title={t('dialog.unsavedChanges', '未保存的修改')}
        message={t('dialog.saveBeforeSwitch', '当前文档有未保存的修改，是否保存？')}
        confirmLabel={t('dialog.save', '保存')}
        destructiveLabel={t('dialog.dontSave', '不保存')}
        cancelLabel={t('dialog.cancel', '取消')}
        onConfirm={() => void handleConfirmSave()}
        onDestructive={() => void handleConfirmDontSave()}
        onCancel={handleConfirmCancel}
      />
    </div>
  );
};

export default FileTreePanel;
// ============================================
// WeaveMD — File Tree Panel
// ============================================

import React, { useCallback } from 'react';
import { useI18n } from '../../i18n';
import { useFileTreeStore, type IFolderNode } from '../../stores/fileTreeStore';

const FileTreePanel: React.FC = () => {
  const { t } = useI18n();
  const folders = useFileTreeStore((s) => s.folders);
  const toggleExpand = useFileTreeStore((s) => s.toggleExpand);
  const removeFolder = useFileTreeStore((s) => s.removeFolder);
  const removeFile = useFileTreeStore((s) => s.removeFile);

  const handleToggle = useCallback((id: string) => {
    toggleExpand(id);
  }, [toggleExpand]);

  const handleRemoveFolder = useCallback((id: string) => {
    removeFolder(id);
  }, [removeFolder]);

  const handleRemoveFile = useCallback((folderId: string, fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeFile(folderId, fileId);
  }, [removeFile]);

  const renderNode = useCallback((node: IFolderNode, depth: number, folderId: string) => {
    const indent = depth * 16;
    const isFolder = node.isDirectory;
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-2 py-2.5 px-2 rounded hover:bg-white/5 cursor-pointer group"
          style={{ paddingLeft: `${indent + 8}px` }}
          onClick={() => isFolder && handleToggle(node.id)}
        >
          {/* Expand/collapse arrow */}
          {isFolder ? (
            <span className="text-text-muted w-4 text-xs">
              {node.expanded ? '▼' : '▶'}
            </span>
          ) : (
            <span className="w-4" />
          )}

          {/* Icon */}
          <span className="text-base">
            {isFolder ? (node.expanded ? '📂' : '📁') : '📄'}
          </span>

          {/* Name */}
          <span className="flex-1 text-base text-text-primary truncate">
            {node.name}
          </span>

          {/* Trash icon */}
          {isFolder ? (
            node.isRoot && (
              <button
                onClick={(e) => { e.stopPropagation(); handleRemoveFolder(node.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-all"
                title={t('common.remove') || '移除'}
              >
                🗑️
              </button>
            )
          ) : (
            <button
              onClick={(e) => handleRemoveFile(folderId, node.id, e)}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-all"
              title={t('common.remove') || '移除'}
            >
              🗑️
            </button>
          )}
        </div>

        {/* Children */}
        {isFolder && node.expanded && hasChildren && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1, folderId))}
          </div>
        )}
      </div>
    );
  }, [handleToggle, handleRemoveFolder, handleRemoveFile, t]);

  if (folders.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-8 px-3">
        <p className="text-sm text-text-muted text-center">
          {t('sidebar.noFiles')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {folders.map((folder) => (
        <div key={folder.id}>
          {renderNode(folder, 0, folder.id)}
        </div>
      ))}
    </div>
  );
};

export default FileTreePanel;
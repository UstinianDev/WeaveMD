// ============================================
// WeaveMD — Import Markdown Modal
// ============================================
// 参照 Notus 原型图的导入 Markdown 模态框：
// 导入到下拉框 + 重名处理下拉框 + 拖拽区 + 选择文件/目录按钮 + 待导入文件列表。

import React, { useCallback, useState } from 'react';
import { useI18n } from '@render/i18n';
import Icon from '@render/components/Common/Icon';
import { useFileTreeStore } from '@render/stores/fileTreeStore';
import { useAuthStore } from '@render/stores/authStore';

interface ImportMarkdownModalProps {
  onClose: () => void;
}

type ConflictStrategy = 'skip' | 'overwrite' | 'rename';

interface PendingFile {
  name: string;
  path: string;
  isDirectory: boolean;
}

const ImportMarkdownModal: React.FC<ImportMarkdownModalProps> = ({ onClose }) => {
  const { t } = useI18n();
  const folders = useFileTreeStore((s) => s.folders);
  const addFile = useFileTreeStore((s) => s.addFile);
  const loadFolderContents = useFileTreeStore((s) => s.loadFolderContents);
  const user = useAuthStore((s) => s.user);

  const [targetFolder, setTargetFolder] = useState('');
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('skip');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [importing, setImporting] = useState(false);

  // 选择文件
  const handleSelectFiles = useCallback(async () => {
    try {
      const result = (await window.weaveMD.file.open()) as unknown as {
        success: boolean;
        data?: { path: string; name: string; content: string };
      };
      if (result.success && result.data) {
        setPendingFiles((prev) => {
          const exists = prev.some((f) => f.path === result.data!.path);
          if (exists) return prev;
          return [...prev, { name: result.data!.name, path: result.data!.path, isDirectory: false }];
        });
      }
    } catch {
      // ignore cancelled
    }
  }, []);

  // 选择目录
  const handleSelectDir = useCallback(async () => {
    try {
      const result = (await window.weaveMD.dialog.openFolder()) as unknown as {
        success: boolean;
        data?: { path: string };
      };
      if (result.success && result.data) {
        // 读取目录中的 .md 文件
        const readResult = (await window.weaveMD.folder.readFolder(result.data.path)) as unknown as {
          success: boolean;
          data?: Array<{ name: string; path: string; isDirectory: boolean }>;
        };
        if (readResult.success && readResult.data) {
          setPendingFiles((prev) => {
            const newFiles = readResult.data!.filter(
              (f) => !f.isDirectory && f.name.endsWith('.md')
            );
            const existing = new Set(prev.map((f) => f.path));
            const unique = newFiles.filter((f) => !existing.has(f.path));
            return [...prev, ...unique];
          });
        }
      }
    } catch {
      // ignore cancelled
    }
  }, []);

  // 拖拽处理
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 拖拽文件信息在 Electron 中需要通过 IPC 处理
    // 这里先用基础实现
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // 开始导入
  const handleImport = useCallback(async () => {
    if (pendingFiles.length === 0 || !user) return;
    setImporting(true);

    try {
      for (const file of pendingFiles) {
        // 读取源文件内容
        const readResult = (await window.weaveMD.file.readDisk(file.path)) as unknown as {
          success: boolean;
          data?: { content: string };
        };
        if (!readResult.success || !readResult.data) continue;

        const content = readResult.data.content;
        let targetPath = targetFolder
          ? `${targetFolder.replace(/[/\\]$/, '')}/${file.name}`
          : file.name;

        // 重名处理
        if (conflictStrategy === 'rename') {
          let counter = 1;
          const baseName = file.name.replace(/\.md$/, '');
          while (pendingFiles.some((f) => f.path === targetPath)) {
            targetPath = targetFolder
              ? `${targetFolder.replace(/[/\\]$/, '')}/${baseName}_${counter}.md`
              : `${baseName}_${counter}.md`;
            counter++;
          }
        }

        // 写入目标
        await window.weaveMD.file.write(targetPath, content);

        // 添加到文件树
        const readBack = (await window.weaveMD.file.readDisk(targetPath)) as unknown as {
          success: boolean;
          data?: { path: string; name: string; content: string };
        };
        if (readBack.success && readBack.data) {
          addFile({
            id: readBack.data.path,
            name: readBack.data.name,
            path: readBack.data.path,
            content: readBack.data.content,
          });
        }
      }

      // 如果目标是文件夹，刷新文件夹内容
      if (targetFolder) {
        await loadFolderContents(targetFolder);
      }

      onClose();
    } catch {
      // error handling
    } finally {
      setImporting(false);
    }
  }, [pendingFiles, user, targetFolder, conflictStrategy, addFile, loadFolderContents, onClose]);

  // 移除待导入文件
  const handleRemovePending = useCallback((path: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[520px] max-h-[80vh] flex flex-col rounded-xl shadow-2xl border"
        style={{
          backgroundColor: 'var(--bg-secondary, #1A1A1A)',
          borderColor: 'var(--border-color, #2D2D2D)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <h3 className="text-base font-semibold text-text-primary">{t('import.title')}</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          >
            <Icon icon="close" size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 导入到 */}
          <div>
            <label className="block text-sm text-text-sub mb-1.5">{t('import.importTo')}</label>
            <select
              value={targetFolder}
              onChange={(e) => setTargetFolder(e.target.value)}
              className="w-full bg-bg-tertiary text-text-primary text-sm px-3 py-2 rounded-lg border outline-none focus:border-accent"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <option value="">{t('import.rootDir')}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.path}>{f.name}</option>
              ))}
            </select>
          </div>

          {/* 重名处理 */}
          <div>
            <label className="block text-sm text-text-sub mb-1.5">{t('import.conflict')}</label>
            <select
              value={conflictStrategy}
              onChange={(e) => setConflictStrategy(e.target.value as ConflictStrategy)}
              className="w-full bg-bg-tertiary text-text-primary text-sm px-3 py-2 rounded-lg border outline-none focus:border-accent"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <option value="skip">{t('import.skipExisting')}</option>
              <option value="overwrite">{t('import.overwrite')}</option>
              <option value="rename">{t('import.renameConflict')}</option>
            </select>
          </div>

          {/* 拖拽上传区 */}
          <div
            className="border-2 border-dashed rounded-xl py-8 flex flex-col items-center gap-3 cursor-pointer hover:border-accent/50 transition-colors"
            style={{ borderColor: 'var(--border-color)' }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <Icon icon="file-upload" size={32} className="text-text-muted" />
            <p className="text-sm font-medium text-text-primary">{t('import.dragHint')}</p>
            <p className="text-xs text-text-muted">{t('import.dragSubHint')}</p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={handleSelectFiles}
                className="px-4 py-1.5 text-sm rounded-lg border hover:bg-accent/10 transition-colors"
                style={{
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              >
                {t('import.selectFile')}
              </button>
              <button
                onClick={handleSelectDir}
                className="px-4 py-1.5 text-sm rounded-lg border hover:bg-accent/10 transition-colors"
                style={{
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              >
                {t('import.selectDir')}
              </button>
            </div>
          </div>

          {/* 待导入文件列表 */}
          <div
            className="rounded-lg border p-3"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text-primary">{t('import.pendingFiles')}</span>
              <span className="text-xs text-text-muted">
                {t('import.fileCount').replace('{count}', String(pendingFiles.length))}
              </span>
            </div>
            {pendingFiles.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-3">{t('import.emptyHint')}</p>
            ) : (
              <div className="max-h-32 overflow-y-auto space-y-1">
                {pendingFiles.map((f) => (
                  <div key={f.path} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-bg-tertiary group">
                    <Icon icon="file-outline" size={14} className="text-text-muted flex-shrink-0" />
                    <span className="flex-1 text-sm text-text-primary truncate">{f.name}</span>
                    <button
                      onClick={() => handleRemovePending(f.path)}
                      className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all"
                    >
                      <Icon icon="close" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div
          className="flex items-center justify-end gap-3 px-5 py-3 border-t"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-text-sub hover:text-text-primary transition-colors"
          >
            {t('import.close')}
          </button>
          <button
            onClick={handleImport}
            disabled={pendingFiles.length === 0 || importing}
            className="px-4 py-1.5 text-sm rounded-lg bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/80 transition-colors"
          >
            {importing ? '...' : t('import.start')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportMarkdownModal;

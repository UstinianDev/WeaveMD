// ============================================
// WeaveMD — 多文件修订详情面板（Module 9）
// ============================================
// 居中模态框：左侧文件列表 + 右侧 diff 预览 + 应用/废弃按钮。
// 复用 diffLines（rewriteDiff）行级红删绿增；参考 FeedbackModal 样式风格。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import { diffLines } from '@render/filters/rewriteDiff';
import type { RewriteFileProposal } from '@render/stores/rewriteStore';

export interface RewriteDetailModalProps {
  files: RewriteFileProposal[];
  onClose: () => void;
  onApply: (fileName: string) => void;
  onDiscard: (fileName: string) => void;
  onApplyAll: () => void;
  onDiscardAll: () => void;
}

const RewriteDetailModal: React.FC<RewriteDetailModalProps> = ({
  files,
  onClose,
  onApply,
  onDiscard,
  onApplyAll,
  onDiscardAll,
}) => {
  const { t } = useI18n();
  const [selectedFile, setSelectedFile] = useState<string>(
    files.length > 0 ? files[0].fileName : ''
  );

  // 选中文件切换时，若当前选中被移除则回退到第一个
  useEffect(() => {
    if (files.length > 0 && !files.find((f) => f.fileName === selectedFile)) {
      setSelectedFile(files[0].fileName);
    }
  }, [files, selectedFile]);

  // Escape 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const currentFile = files.find((f) => f.fileName === selectedFile);
  const diffResult = currentFile ? diffLines(currentFile.originalMd, currentFile.rewrittenMd) : [];
  const delCount = diffResult.filter((l) => l.type === 'del').length;
  const insCount = diffResult.filter((l) => l.type === 'ins').length;

  const pendingCount = files.filter((f) => f.status === 'pending').length;

  const statusLabel = (status: RewriteFileProposal['status']) => {
    if (status === 'applied') return t('ai.rewrite.fileStatusApplied', '已应用');
    if (status === 'discarded') return t('ai.rewrite.fileStatusDiscarded', '已废弃');
    return null;
  };

  return (
    <div
      className="insert-url-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('ai.rewrite.detailTitle', '修订详情')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="insert-url-modal rewrite-detail-modal"
      >
        {/* 标题栏（macOS 三色圆点） */}
        <div className="insert-url-modal-header">
          <div className="insert-url-modal-dots" aria-hidden="true">
            <span className="insert-url-modal-dot insert-url-modal-dot--close" />
            <span className="insert-url-modal-dot insert-url-modal-dot--minimize" />
            <span className="insert-url-modal-dot insert-url-modal-dot--zoom" />
          </div>
          <span className="insert-url-modal-title">
            {t('ai.rewrite.detailTitle', '修订详情')}
          </span>
          <button
            type="button"
            className="insert-url-modal-close"
            aria-label={t('ai.rewrite.dismiss', '关闭')}
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        {/* 主体：左侧文件列表 + 右侧 diff */}
        <div className="flex flex-1 min-h-0 mt-3 gap-0">
          {/* 左侧文件列表（200px） */}
          <div className="w-[200px] shrink-0 border-r border-[var(--border-color)] overflow-y-auto">
            {files.map((f) => {
              const isSelected = f.fileName === selectedFile;
              const label = statusLabel(f.status);
              return (
                <button
                  type="button"
                  key={f.fileName}
                  onClick={() => setSelectedFile(f.fileName)}
                  className={`w-full text-left px-3 py-2 text-[13px] flex items-center justify-between gap-1 transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  <span className="truncate flex-1">{f.fileName}</span>
                  {label && (
                    <span
                      className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded ${
                        f.status === 'applied'
                          ? 'bg-green-500/15 text-green-600'
                          : 'bg-gray-500/15 text-gray-500'
                      }`}
                    >
                      {label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 右侧 diff 预览 */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {currentFile ? (
              <>
                {/* diff 头信息 */}
                <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-[var(--text-sub)]">
                    {currentFile.fileName} — {t('ai.rewrite.diff', '改动内容')}（&minus;{delCount} / +{insCount}）
                  </span>
                  {currentFile.status === 'pending' && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onDiscard(currentFile.fileName)}
                        className="text-[12px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-sub)] hover:bg-[var(--bg-quaternary)] transition-colors"
                      >
                        {t('ai.rewrite.discard', '废弃')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onApply(currentFile.fileName)}
                        className="text-[12px] px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                      >
                        {t('ai.rewrite.previewConfirm', '应用')}
                      </button>
                    </div>
                  )}
                </div>
                {/* diff 内容 */}
                <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[14px] space-y-0.5 bg-[var(--bg-primary)]/60">
                  {diffResult.map((ln, i) => (
                    <div
                      key={i}
                      data-type={ln.type}
                      className={[
                        'whitespace-pre-wrap px-1 rounded-sm',
                        ln.type === 'del' ? 'text-red-500 bg-red-500/10' : '',
                        ln.type === 'ins' ? 'text-green-600 bg-green-500/10' : '',
                        ln.type === 'same' ? 'text-[var(--text-muted)]' : '',
                      ].join(' ')}
                    >
                      {ln.type === 'del' ? '− ' : ln.type === 'ins' ? '+ ' : '  '}
                      {ln.line}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--text-muted)]">
                {t('ai.rewrite.noFiles', '暂无文件')}
              </div>
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="insert-url-modal-actions">
          <button
            type="button"
            className="insert-url-modal-btn"
            onClick={onDiscardAll}
            disabled={pendingCount === 0}
          >
            {t('ai.rewrite.discardAll', '全部废弃')}
          </button>
          <button
            type="button"
            className="insert-url-modal-btn insert-url-modal-btn--primary"
            onClick={onApplyAll}
            disabled={pendingCount === 0}
          >
            {t('ai.rewrite.applyAll', '全部应用')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RewriteDetailModal;

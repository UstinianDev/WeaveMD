// ============================================
// WeaveMD — 多文件补丁详情面板
// ============================================
// 居中模态框：左侧文件列表 + 右侧 diff 预览 + 应用/废弃按钮。
// 复用 diffLines（rewriteDiff）行级红删绿增；参考 EditBlocksDetailModal 样式。
// macOS 三色圆点标题栏（insert-url-modal CSS）。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import { diffLines } from '@render/filters/rewriteDiff';
import type { IPatchProposal, IPatchFile } from '@shared/ai/clarify';

export interface PatchDetailModalProps {
  proposals: IPatchProposal[];
  onClose: () => void;
  onApply: (id: string, fileIndex?: number) => void;
  onDiscard: (id: string, fileIndex?: number) => void;
}

/** 获取文件的简短显示名。 */
function getFileName(file: IPatchFile): string {
  const parts = file.filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? file.filePath;
}

/** 获取文件变更类型标记。 */
function getFileChangeType(file: IPatchFile): 'new' | 'delete' | 'modify' {
  if (!file.oldContent && file.newContent) return 'new';
  if (file.oldContent && !file.newContent) return 'delete';
  return 'modify';
}

/** 展平所有 pending 提案的文件为一个带 proposalId 的列表。 */
interface FlatFile {
  proposalId: string;
  fileIndex: number;
  file: IPatchFile;
}

function flattenFiles(proposals: IPatchProposal[]): FlatFile[] {
  const result: FlatFile[] = [];
  for (const p of proposals) {
    if (p.status !== 'pending') continue;
    p.files.forEach((f, i) => {
      result.push({ proposalId: p.id, fileIndex: i, file: f });
    });
  }
  return result;
}

const PatchDetailModal: React.FC<PatchDetailModalProps> = ({
  proposals,
  onClose,
  onApply,
  onDiscard,
}) => {
  const { t } = useI18n();
  const flatFiles = flattenFiles(proposals);

  const [selectedIndex, setSelectedIndex] = useState<number>(
    flatFiles.length > 0 ? 0 : -1
  );

  // 选中文件切换时，若当前选中超出范围则回退
  useEffect(() => {
    if (selectedIndex >= flatFiles.length && flatFiles.length > 0) {
      setSelectedIndex(0);
    }
  }, [flatFiles.length, selectedIndex]);

  // Escape 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const currentItem = selectedIndex >= 0 ? flatFiles[selectedIndex] : undefined;
  const diffResult = currentItem
    ? diffLines(currentItem.file.oldContent, currentItem.file.newContent)
    : [];
  const delCount = diffResult.filter((l) => l.type === 'del').length;
  const insCount = diffResult.filter((l) => l.type === 'ins').length;

  const pendingProposalCount = proposals.filter((p) => p.status === 'pending').length;

  const handleApplyAll = (): void => {
    proposals.forEach((p) => {
      if (p.status === 'pending') onApply(p.id);
    });
  };

  const handleDiscardAll = (): void => {
    proposals.forEach((p) => {
      if (p.status === 'pending') onDiscard(p.id);
    });
  };

  const changeTypeLabel = (changeType: 'new' | 'delete' | 'modify'): string => {
    if (changeType === 'new') return t('ai.patch.newFile', '新增');
    if (changeType === 'delete') return t('ai.patch.deleteFile', '删除');
    return t('ai.patch.modifyFile', '修改');
  };

  return (
    <div
      className="insert-url-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('ai.patch.detailTitle', '补丁详情')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="insert-url-modal rewrite-detail-modal">
        {/* 标题栏（macOS 三色圆点） */}
        <div className="insert-url-modal-header">
          <div className="insert-url-modal-dots" aria-hidden="true">
            <span className="insert-url-modal-dot insert-url-modal-dot--close" />
            <span className="insert-url-modal-dot insert-url-modal-dot--minimize" />
            <span className="insert-url-modal-dot insert-url-modal-dot--zoom" />
          </div>
          <span className="insert-url-modal-title">
            {t('ai.patch.detailTitle', '补丁详情')}
          </span>
          <button
            type="button"
            className="insert-url-modal-close"
            aria-label={t('ai.patch.close', '关闭')}
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        {/* 主体：左侧文件列表 + 右侧 diff */}
        <div className="flex flex-1 min-h-0 mt-3 gap-0">
          {/* 左侧文件列表（200px） */}
          <div className="w-[200px] shrink-0 border-r border-[var(--border-color)] overflow-y-auto">
            {flatFiles.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const changeType = getFileChangeType(item.file);
              const fileLines = diffLines(item.file.oldContent, item.file.newContent);
              const fDel = fileLines.filter((l) => l.type === 'del').length;
              const fIns = fileLines.filter((l) => l.type === 'ins').length;
              return (
                <button
                  type="button"
                  key={`${item.proposalId}-${item.fileIndex}`}
                  onClick={() => setSelectedIndex(idx)}
                  className={`w-full text-left px-3 py-2 text-[13px] flex flex-col gap-0.5 transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  <span className="truncate flex-1">{getFileName(item.file)}</span>
                  <span className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`px-1 py-0.5 rounded ${
                        changeType === 'new'
                          ? 'bg-blue-500/15 text-blue-400'
                          : changeType === 'delete'
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-yellow-500/15 text-yellow-400'
                      }`}
                    >
                      {changeTypeLabel(changeType)}
                    </span>
                    <span className="text-emerald-400">+{fIns}</span>
                    <span className="text-red-400">-{fDel}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* 右侧 diff 预览 */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {currentItem ? (
              <>
                {/* diff 头信息 */}
                <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-[var(--text-sub)]">
                    {getFileName(currentItem.file)} — {t('ai.patch.diff', '变更预览')}（&minus;{delCount} / +{insCount}）
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onDiscard(currentItem.proposalId, currentItem.fileIndex)}
                      className="text-[12px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-sub)] hover:bg-[var(--bg-quaternary)] transition-colors"
                    >
                      {t('ai.patch.discard', '废弃')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onApply(currentItem.proposalId, currentItem.fileIndex)}
                      className="text-[12px] px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                    >
                      {t('ai.patch.apply', '应用')}
                    </button>
                  </div>
                </div>
                {/* diff 内容 */}
                <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[14px] space-y-0.5 bg-[var(--bg-primary)]/60">
                  {diffResult.map((ln, i) => (
                    <div
                      key={i}
                      data-type={ln.type}
                      className={[
                        'whitespace-pre-wrap px-1 rounded-sm',
                        ln.type === 'del' ? 'text-red-400 bg-red-500/10' : '',
                        ln.type === 'ins' ? 'text-emerald-400 bg-emerald-500/10' : '',
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
                {t('ai.patch.noFiles', '暂无文件')}
              </div>
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="insert-url-modal-actions">
          <button
            type="button"
            className="insert-url-modal-btn"
            onClick={handleDiscardAll}
            disabled={pendingProposalCount === 0}
          >
            {t('ai.patch.discardAll', '全部废弃')}
          </button>
          <button
            type="button"
            className="insert-url-modal-btn insert-url-modal-btn--primary"
            onClick={handleApplyAll}
            disabled={pendingProposalCount === 0}
          >
            {t('ai.patch.applyAll', '全部应用')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PatchDetailModal;

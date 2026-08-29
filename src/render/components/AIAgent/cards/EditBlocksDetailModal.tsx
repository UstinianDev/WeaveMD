// ============================================
// WeaveMD — editBlocks 多文件修订详情面板
// ============================================
// 居中模态框：左侧文件列表 + 右侧 diff 预览 + 应用/废弃按钮。
// 复用 diffLines（rewriteDiff）行级红删绿增；参考 RewriteDetailModal 样式风格。
// macOS 三色圆点标题栏（insert-url-modal CSS）。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import { diffLines } from '@render/filters/rewriteDiff';
import type { EditBlocksProposal } from '@render/stores/agentStore';

export interface EditBlocksDetailModalProps {
  proposals: EditBlocksProposal[];
  onClose: () => void;
  onApply: (index: number) => void;
  onDiscard: (index: number) => void;
  onApplyAll: () => void;
  onDiscardAll: () => void;
}

/** 获取提案的显示标题。 */
function getProposalTitle(proposal: EditBlocksProposal, t: (key: string, fallback?: string) => string): string {
  const isFileRevision = proposal.toolName === 'preview_file_revision';
  const isCreateFile = proposal.toolName === 'createFile';
  if (isCreateFile) return `${t('ai.editBlocks.createFile', '创建文件')}: ${proposal.fileName ?? ''}`;
  if (isFileRevision) return proposal.fileName ?? proposal.fileId ?? t('ai.editBlocks.fileRevision', '文件修订');
  return t('ai.editBlocks.docRevision', '文档修订');
}

const EditBlocksDetailModal: React.FC<EditBlocksDetailModalProps> = ({
  proposals,
  onClose,
  onApply,
  onDiscard,
  onApplyAll,
  onDiscardAll,
}) => {
  const { t } = useI18n();
  // 只展示 pending 状态的提案索引
  const pendingIndices = proposals
    .map((p, i) => ({ p, i }))
    .filter((x) => x.p.status === 'pending');

  const [selectedIdx, setSelectedIdx] = useState<number>(
    pendingIndices.length > 0 ? pendingIndices[0].i : -1
  );

  // 选中文件切换时，若当前选中被移除则回退到第一个 pending
  useEffect(() => {
    const selected = proposals[selectedIdx];
    if (!selected || selected.status !== 'pending') {
      if (pendingIndices.length > 0) {
        setSelectedIdx(pendingIndices[0].i);
      }
    }
  }, [proposals, selectedIdx, pendingIndices]);

  // Escape 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const currentProposal = selectedIdx >= 0 ? proposals[selectedIdx] : undefined;
  const diffResult = currentProposal
    ? diffLines(currentProposal.originalContent, currentProposal.newContent)
    : [];
  const delCount = diffResult.filter((l) => l.type === 'del').length;
  const insCount = diffResult.filter((l) => l.type === 'ins').length;

  const pendingCount = pendingIndices.length;

  const statusLabel = (status: EditBlocksProposal['status']) => {
    if (status === 'applied') return t('ai.editBlocks.applied', '已应用');
    if (status === 'discarded') return t('ai.editBlocks.discarded', '已废弃');
    return null;
  };

  return (
    <div
      className="insert-url-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('ai.editBlocks.detailTitle', '修订详情')}
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
            {t('ai.editBlocks.detailTitle', '修订详情')}
          </span>
          <button
            type="button"
            className="insert-url-modal-close"
            aria-label={t('ai.editBlocks.close', '关闭')}
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        {/* 主体：左侧文件列表 + 右侧 diff */}
        <div className="flex flex-1 min-h-0 mt-3 gap-0">
          {/* 左侧文件列表（200px） */}
          <div className="w-[200px] shrink-0 border-r border-[var(--border-color)] overflow-y-auto">
            {proposals.map((p, idx) => {
              const isSelected = idx === selectedIdx;
              const label = statusLabel(p.status);
              // 计算每个提案的 diff 统计
              const lines = diffLines(p.originalContent, p.newContent);
              const pDel = lines.filter((l) => l.type === 'del').length;
              const pIns = lines.filter((l) => l.type === 'ins').length;
              return (
                <button
                  type="button"
                  key={idx}
                  onClick={() => setSelectedIdx(idx)}
                  className={`w-full text-left px-3 py-2 text-[13px] flex flex-col gap-0.5 transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  <span className="truncate flex-1">{getProposalTitle(p, t)}</span>
                  <span className="flex items-center gap-2 text-[11px]">
                    <span className="text-emerald-400">+{pIns}</span>
                    <span className="text-red-400">-{pDel}</span>
                    {label && (
                      <span
                        className={`ml-auto px-1.5 py-0.5 rounded ${
                          p.status === 'applied'
                            ? 'bg-green-500/15 text-green-400'
                            : 'bg-gray-500/15 text-gray-400'
                        }`}
                      >
                        {label}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 右侧 diff 预览 */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {currentProposal ? (
              <>
                {/* diff 头信息 */}
                <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-[var(--text-sub)]">
                    {getProposalTitle(currentProposal, t)} — {t('ai.editBlocks.diff', '变更预览')}（&minus;{delCount} / +{insCount}）
                  </span>
                  {currentProposal.status === 'pending' && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onDiscard(selectedIdx)}
                        className="text-[12px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-sub)] hover:bg-[var(--bg-quaternary)] transition-colors"
                      >
                        {t('ai.editBlocks.discard', '废弃')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onApply(selectedIdx)}
                        className="text-[12px] px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                      >
                        {t('ai.editBlocks.apply', '应用')}
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
                {t('ai.editBlocks.noProposals', '暂无修订')}
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
            {t('ai.editBlocks.discardAll', '全部废弃')}
          </button>
          <button
            type="button"
            className="insert-url-modal-btn insert-url-modal-btn--primary"
            onClick={onApplyAll}
            disabled={pendingCount === 0}
          >
            {t('ai.editBlocks.applyAll', '全部应用')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditBlocksDetailModal;

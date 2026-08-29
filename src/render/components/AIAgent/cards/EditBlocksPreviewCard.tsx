// ============================================
// WeaveMD — editBlocks / preview_file_revision 修订预览卡片
// ============================================
// Bug 2/3 修复：拦截 editBlocks 和 preview_file_revision 的直接写入，
// 改为显示 diff 预览卡片，用户确认后才应用。
// 复用 rewriteDiff 的行级 LCS 算法，红删绿增。
// 多文件时显示汇总卡片 + EditBlocksDetailModal 详情面板。

import React, { useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAgentStore, type EditBlocksProposal } from '@render/stores/agentStore';
import { diffLines } from '@render/filters/rewriteDiff';
import EditBlocksDetailModal from './EditBlocksDetailModal';
import Icon from '../../Common/Icon';

const EditBlocksPreviewCard: React.FC = () => {
  const { t } = useI18n();
  const proposals = useAgentStore((s) => s.editBlocksProposals);
  const applyProposal = useAgentStore((s) => s.applyEditBlocksProposal);
  const discardProposal = useAgentStore((s) => s.discardEditBlocksProposal);

  const [showDetailModal, setShowDetailModal] = useState(false);

  // 只显示 pending 状态的提案
  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  if (pendingProposals.length === 0) return null;

  // 多文件：汇总卡片
  if (pendingProposals.length > 1) {
    const totalCount = pendingProposals.length;
    const appliedCount = proposals.filter((p) => p.status === 'applied').length;
    const discardedCount = proposals.filter((p) => p.status === 'discarded').length;

    const handleApplyAll = (): void => {
      proposals.forEach((p, i) => {
        if (p.status === 'pending') applyProposal(i);
      });
    };

    const handleDiscardAll = (): void => {
      proposals.forEach((p, i) => {
        if (p.status === 'pending') discardProposal(i);
      });
    };

    return (
      <>
        <div className="mx-3 my-1 rounded-card border border-border bg-bg-tertiary/60 overflow-hidden shadow-sm">
          {/* header：汇总信息 + 操作按钮 */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-[13px] font-medium text-text-primary flex items-center gap-1.5">
              <Icon icon="file-edit" size={14} className="text-text-sub" />
              {t('ai.editBlocks.multiSummary', '{count} 个文件修订').replace('{count}', String(totalCount))}
              {appliedCount > 0 && (
                <span className="ml-2 text-emerald-400">
                  {t('ai.editBlocks.multiApplied', '已应用 {n}').replace('{n}', String(appliedCount))}
                </span>
              )}
              {discardedCount > 0 && (
                <span className="ml-2 text-gray-400">
                  {t('ai.editBlocks.multiDiscarded', '已废弃 {n}').replace('{n}', String(discardedCount))}
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowDetailModal(true)}
                className="text-[13px] px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
              >
                {t('ai.editBlocks.viewDetails', '查看详情')}
              </button>
              <button
                type="button"
                onClick={handleDiscardAll}
                className="text-[13px] px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
              >
                {t('ai.editBlocks.discardAll', '全部废弃')}
              </button>
              <button
                type="button"
                onClick={handleApplyAll}
                className="text-[13px] px-2.5 py-1 rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                {t('ai.editBlocks.applyAll', '全部应用')}
              </button>
            </div>
          </div>
        </div>

        {/* 详情面板 */}
        {showDetailModal && (
          <EditBlocksDetailModal
            proposals={proposals}
            onClose={() => setShowDetailModal(false)}
            onApply={(idx) => applyProposal(idx)}
            onDiscard={(idx) => discardProposal(idx)}
            onApplyAll={handleApplyAll}
            onDiscardAll={handleDiscardAll}
          />
        )}
      </>
    );
  }

  // 单文件：内联 diff 预览（保持原有行为）
  const proposal = pendingProposals[0];
  const globalIdx = proposals.indexOf(proposal);
  return (
    <EditBlocksItem
      proposal={proposal}
      onApply={() => applyProposal(globalIdx)}
      onDiscard={() => discardProposal(globalIdx)}
      t={t}
    />
  );
};

/** 单个修订提案的 diff 预览卡片。 */
const EditBlocksItem: React.FC<{
  proposal: EditBlocksProposal;
  onApply: () => void;
  onDiscard: () => void;
  t: (key: string, fallback?: string) => string;
}> = ({ proposal, onApply, onDiscard, t }) => {
  const [expanded, setExpanded] = useState(true);

  const lines = diffLines(proposal.originalContent, proposal.newContent);
  const delCount = lines.filter((l) => l.type === 'del').length;
  const insCount = lines.filter((l) => l.type === 'ins').length;

  const isFileRevision = proposal.toolName === 'preview_file_revision';
  const isCreateFile = proposal.toolName === 'createFile';
  const titleIcon = isCreateFile ? 'file-add' : isFileRevision ? 'file-edit' : 'file-edit';
  const titleText = isCreateFile
    ? `${t('ai.editBlocks.createFile', '创建文件')}: ${proposal.fileName ?? ''}`
    : isFileRevision
      ? `${proposal.fileName ?? proposal.fileId ?? t('ai.editBlocks.fileRevision', '文件修订')}`
      : `${t('ai.editBlocks.docRevision', '文档修订')}`;

  return (
    <div className="mx-3 my-1 rounded-card border border-border bg-bg-tertiary/60 overflow-hidden shadow-sm">
      {/* header：汇总信息 + 操作按钮 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[13px] font-medium text-text-primary flex items-center gap-1.5">
          <Icon icon={titleIcon} size={14} className="text-text-sub" />
          {titleText}
          <span className="ml-2 text-text-muted">
            (−{delCount} / +{insCount})
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDiscard}
            className="text-[13px] px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
          >
            {t('ai.editBlocks.discard', '废弃')}
          </button>
          <button
            type="button"
            onClick={onApply}
            className="text-[13px] px-2.5 py-1 rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            {t('ai.editBlocks.apply', '应用')}
          </button>
        </div>
      </div>

      {/* diff 预览（可折叠） */}
      <div className="border-b border-border">
        <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary/40">
          <span className="text-[13px] font-medium text-text-sub">
            {t('ai.editBlocks.diff', '变更预览')}（−{delCount} / +{insCount}）
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[12px] px-2 py-0.5 rounded-input text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            {expanded
              ? t('ai.editBlocks.collapse', '折叠')
              : t('ai.editBlocks.expand', '展开')}
          </button>
        </div>
        {expanded && (
          <div className="px-3 py-2 font-mono text-[14px] space-y-0.5 max-h-48 overflow-y-auto bg-bg-primary/60">
            {lines.slice(0, 200).map((ln, i) => (
              <div
                key={i}
                className={[
                  'whitespace-pre-wrap px-1 rounded-sm',
                  ln.type === 'del' ? 'text-red-400 bg-red-500/10' : '',
                  ln.type === 'ins' ? 'text-emerald-400 bg-emerald-500/10' : '',
                  ln.type === 'same' ? 'text-text-muted' : '',
                ].join(' ')}
              >
                {ln.type === 'del' ? '− ' : ln.type === 'ins' ? '+ ' : '  '}
                {ln.line}
              </div>
            ))}
            {lines.length > 200 && (
              <div className="text-text-muted text-[12px] py-1">
                {t('ai.editBlocks.truncated', '... 共 {count} 行，已截断').replace('{count}', String(lines.length))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EditBlocksPreviewCard;

// ============================================
// WeaveMD — 多文件 patch 预览卡片
// ============================================
// 从 useAgentStore 读取 patchProposals 状态。
// 单文件：内联 diff 预览 + 应用/废弃按钮。
// 多文件：汇总卡片（文件数 + 查看详情/全部应用/全部废弃）+ PatchDetailModal。
// 红删绿增样式（diffLines from rewriteDiff）。

import React, { useState } from 'react';
import { useI18n } from '@render/i18n';
import { diffLines } from '@render/filters/rewriteDiff';
import Icon from '../../Common/Icon';
import PatchDetailModal from './PatchDetailModal';
import type { IPatchProposal, IPatchFile } from '@shared/ai/clarify';

/** 从 useAgentStore 选取 patchProposals 的选择器签名。 */
interface PatchPreviewCardProps {
  proposals: IPatchProposal[];
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

const PatchPreviewCard: React.FC<PatchPreviewCardProps> = ({
  proposals,
  onApply,
  onDiscard,
}) => {
  const { t } = useI18n();
  const [showDetailModal, setShowDetailModal] = useState(false);

  // 只显示 pending 状态的提案
  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  if (pendingProposals.length === 0) return null;

  // 多文件（多提案或单提案含多文件）：汇总卡片
  const shouldShowSummary =
    pendingProposals.length > 1 ||
    (pendingProposals.length === 1 && pendingProposals[0].files.length > 1);

  if (shouldShowSummary) {
    const totalFiles = pendingProposals.reduce((sum, p) => sum + p.files.length, 0);
    const appliedCount = proposals.filter((p) => p.status === 'applied').length;
    const discardedCount = proposals.filter((p) => p.status === 'discarded').length;

    const handleApplyAll = (): void => {
      pendingProposals.forEach((p) => onApply(p.id));
    };

    const handleDiscardAll = (): void => {
      pendingProposals.forEach((p) => onDiscard(p.id));
    };

    return (
      <>
        <div className="mx-3 my-1 rounded-card border border-border bg-bg-tertiary/60 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-[13px] font-medium text-text-primary flex items-center gap-1.5">
              <Icon icon="file-sync" size={14} className="text-text-sub" />
              {t('ai.patch.multiSummary', '{count} 个文件补丁').replace('{count}', String(totalFiles))}
              {appliedCount > 0 && (
                <span className="ml-2 text-emerald-400">
                  {t('ai.patch.multiApplied', '已应用 {n}').replace('{n}', String(appliedCount))}
                </span>
              )}
              {discardedCount > 0 && (
                <span className="ml-2 text-gray-400">
                  {t('ai.patch.multiDiscarded', '已废弃 {n}').replace('{n}', String(discardedCount))}
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowDetailModal(true)}
                className="text-[13px] px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
              >
                {t('ai.patch.viewDetails', '查看详情')}
              </button>
              <button
                type="button"
                onClick={handleDiscardAll}
                className="text-[13px] px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
              >
                {t('ai.patch.discardAll', '全部废弃')}
              </button>
              <button
                type="button"
                onClick={handleApplyAll}
                className="text-[13px] px-2.5 py-1 rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                {t('ai.patch.applyAll', '全部应用')}
              </button>
            </div>
          </div>
        </div>

        {showDetailModal && (
          <PatchDetailModal
            proposals={proposals}
            onClose={() => setShowDetailModal(false)}
            onApply={onApply}
            onDiscard={onDiscard}
          />
        )}
      </>
    );
  }

  // 单文件：内联 diff 预览
  const proposal = pendingProposals[0];
  const file = proposal.files[0];
  if (!file) return null;

  return (
    <PatchInlineItem
      proposalId={proposal.id}
      file={file}
      onApply={() => onApply(proposal.id, 0)}
      onDiscard={() => onDiscard(proposal.id, 0)}
      t={t}
    />
  );
};

/** 单个补丁文件的内联 diff 预览卡片。 */
const PatchInlineItem: React.FC<{
  proposalId: string;
  file: IPatchFile;
  onApply: () => void;
  onDiscard: () => void;
  t: (key: string, fallback?: string) => string;
}> = ({ file, onApply, onDiscard, t }) => {
  const [expanded, setExpanded] = useState(true);

  const lines = diffLines(file.oldContent, file.newContent);
  const delCount = lines.filter((l) => l.type === 'del').length;
  const insCount = lines.filter((l) => l.type === 'ins').length;
  const changeType = getFileChangeType(file);

  const changeLabel =
    changeType === 'new'
      ? t('ai.patch.newFile', '新增文件')
      : changeType === 'delete'
        ? t('ai.patch.deleteFile', '删除文件')
        : t('ai.patch.modifyFile', '修改文件');

  return (
    <div className="mx-3 my-1 rounded-card border border-border bg-bg-tertiary/60 overflow-hidden shadow-sm">
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[13px] font-medium text-text-primary flex items-center gap-1.5">
          <Icon icon={changeType === 'new' ? 'file-add' : 'file-edit'} size={14} className="text-text-sub" />
          {getFileName(file)}
          <span className="ml-1 text-text-muted text-[11px]">{changeLabel}</span>
          <span className="ml-2 text-text-muted">(−{delCount} / +{insCount})</span>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDiscard}
            className="text-[13px] px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
          >
            {t('ai.patch.discard', '废弃')}
          </button>
          <button
            type="button"
            onClick={onApply}
            className="text-[13px] px-2.5 py-1 rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            {t('ai.patch.apply', '应用')}
          </button>
        </div>
      </div>

      {/* diff 预览（可折叠） */}
      <div className="border-b border-border">
        <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary/40">
          <span className="text-[13px] font-medium text-text-sub">
            {t('ai.patch.diff', '变更预览')}（−{delCount} / +{insCount}）
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[12px] px-2 py-0.5 rounded-input text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            {expanded ? t('ai.patch.collapse', '折叠') : t('ai.patch.expand', '展开')}
          </button>
        </div>
        {expanded && (
          <div className="px-3 py-2 font-mono text-[14px] space-y-0.5 max-h-48 overflow-y-auto bg-bg-primary/60">
            {lines.slice(0, 200).map((ln, i) => (
              <div
                key={i}
                data-type={ln.type}
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
                {t('ai.patch.truncated', '... 共 {count} 行，已截断').replace('{count}', String(lines.length))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PatchPreviewCard;

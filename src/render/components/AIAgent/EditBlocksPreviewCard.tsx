// ============================================
// WeaveMD — editBlocks / preview_file_revision 修订预览卡片
// ============================================
// Bug 2/3 修复：拦截 editBlocks 和 preview_file_revision 的直接写入，
// 改为显示 diff 预览卡片，用户确认后才应用。
// 复用 rewriteDiff 的行级 LCS 算法，红删绿增。

import React, { useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAgentStore, type EditBlocksProposal } from '@render/stores/agentStore';
import { diffLines } from '@render/filters/rewriteDiff';

const EditBlocksPreviewCard: React.FC = () => {
  const { t } = useI18n();
  const proposals = useAgentStore((s) => s.editBlocksProposals);
  const applyProposal = useAgentStore((s) => s.applyEditBlocksProposal);
  const discardProposal = useAgentStore((s) => s.discardEditBlocksProposal);

  // 只显示 pending 状态的提案
  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  if (pendingProposals.length === 0) return null;

  return (
    <div className="space-y-1">
      {pendingProposals.map((proposal) => {
        const globalIdx = proposals.indexOf(proposal);
        return (
          <EditBlocksItem
            key={globalIdx}
            proposal={proposal}
            onApply={() => applyProposal(globalIdx)}
            onDiscard={() => discardProposal(globalIdx)}
            t={t}
          />
        );
      })}
    </div>
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
  const [showDetail, setShowDetail] = useState(false);

  const lines = diffLines(proposal.originalContent, proposal.newContent);
  const delCount = lines.filter((l) => l.type === 'del').length;
  const insCount = lines.filter((l) => l.type === 'ins').length;

  const isFileRevision = proposal.toolName === 'preview_file_revision';
  const isCreateFile = proposal.toolName === 'createFile';
  const title = isCreateFile
    ? `📄 ${t('ai.editBlocks.createFile', '创建文件')}: ${proposal.fileName ?? ''}`
    : isFileRevision
      ? `✏️ ${proposal.fileName ?? proposal.fileId ?? t('ai.editBlocks.fileRevision', '文件修订')}`
      : `📝 ${t('ai.editBlocks.docRevision', '文档修订')}`;

  return (
    <div className="mx-3 my-1 rounded-card border border-border bg-bg-tertiary/60 overflow-hidden shadow-sm">
      {/* header：汇总信息 + 操作按钮 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[13px] font-medium text-text-primary">
          {title}
          <span className="ml-2 text-text-muted">
            (−{delCount} / +{insCount})
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="text-[13px] px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
          >
            {showDetail
              ? t('ai.editBlocks.hideDetails', '收起详情')
              : t('ai.editBlocks.viewDetails', '查看详情')}
          </button>
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
                  ln.type === 'del' ? 'text-red-500 bg-red-500/10' : '',
                  ln.type === 'ins' ? 'text-green-600 bg-green-500/10' : '',
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

      {/* 居中详情面板（点击"查看详情"时显示完整 diff） */}
      {showDetail && (
        <EditBlocksDetailModal
          proposal={proposal}
          lines={lines}
          delCount={delCount}
          insCount={insCount}
          onClose={() => setShowDetail(false)}
          onApply={onApply}
          t={t}
        />
      )}
    </div>
  );
};

/** 居中全屏 diff 详情面板。 */
const EditBlocksDetailModal: React.FC<{
  proposal: EditBlocksProposal;
  lines: Array<{ type: 'same' | 'del' | 'ins'; line: string }>;
  delCount: number;
  insCount: number;
  onClose: () => void;
  onApply: () => void;
  t: (key: string, fallback?: string) => string;
}> = ({ proposal, lines, delCount, insCount, onClose, onApply, t }) => {
  const isFileRevision = proposal.toolName === 'preview_file_revision';
  const isCreateFile = proposal.toolName === 'createFile';
  const title = isCreateFile
    ? `${t('ai.editBlocks.createFile', '创建文件')}: ${proposal.fileName ?? ''}`
    : isFileRevision
      ? proposal.fileName ?? proposal.fileId ?? t('ai.editBlocks.fileRevision', '文件修订')
      : t('ai.editBlocks.docRevision', '文档修订');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-card border border-border shadow-xl w-[80vw] max-w-[900px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-medium text-text-primary">{title}</span>
            <span className="text-[13px] text-green-600">+{insCount}</span>
            <span className="text-[13px] text-red-500">−{delCount}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] text-text-muted hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        {/* diff 内容 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[14px] space-y-0.5 bg-bg-primary/60">
          {lines.map((ln, i) => (
            <div
              key={i}
              className={[
                'whitespace-pre-wrap px-2 py-0.5 rounded-sm',
                ln.type === 'del' ? 'text-red-500 bg-red-500/10' : '',
                ln.type === 'ins' ? 'text-green-600 bg-green-500/10' : '',
                ln.type === 'same' ? 'text-text-muted' : '',
              ].join(' ')}
            >
              {ln.type === 'del' ? '− ' : ln.type === 'ins' ? '+ ' : '  '}
              {ln.line}
            </div>
          ))}
        </div>

        {/* 操作栏 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] px-3 py-1.5 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
          >
            {t('ai.editBlocks.close', '关闭')}
          </button>
          <button
            type="button"
            onClick={() => { onApply(); onClose(); }}
            className="text-[13px] px-3 py-1.5 rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            {t('ai.editBlocks.apply', '应用')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditBlocksPreviewCard;

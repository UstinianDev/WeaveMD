// ============================================
// WeaveMD — editBlocks / preview_file_revision 修订预览卡片（薄壳）
// ============================================
// 从 agentStore 读取 editBlocksProposals 状态，error/stale 逻辑保留于此，
// diff 渲染委托给 DiffSummaryCard 统一组件。
// 多文件详情面板（EditBlocksDetailModal）保留于此。
//
// R6 更新：DiffSummaryCard 内部 useDiffSummaryHandlers hook 处理
// apply/discard/dismiss + staleness 检测，薄壳不再传递这些回调。

import React, { useState } from 'react';
import { useAgentStore } from '@render/stores/agentStore';
import DiffSummaryCard, { type DiffSummarySource } from './DiffSummaryCard';
import EditBlocksDetailModal from './EditBlocksDetailModal';

const EditBlocksPreviewCard: React.FC = () => {
  const proposals = useAgentStore((s) => s.editBlocksProposals);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const applyProposal = useAgentStore((s) => s.applyEditBlocksProposal);
  const discardProposal = useAgentStore((s) => s.discardEditBlocksProposal);

  const [showDetailModal, setShowDetailModal] = useState(false);

  // 流式传输期间不显示卡片，避免用户在回答未完成时误触
  if (isStreaming) return null;
  // 无提案时不显示
  if (proposals.length === 0) return null;

  const source: DiffSummarySource = { kind: 'editBlocks', data: proposals };

  return (
    <>
      <DiffSummaryCard
        source={source}
        onViewDetails={() => setShowDetailModal(true)}
      />

      {/* 多文件详情面板 */}
      {showDetailModal && (
        <EditBlocksDetailModal
          proposals={proposals}
          onClose={() => setShowDetailModal(false)}
          onApply={(idx) => applyProposal(idx)}
          onDiscard={(idx) => discardProposal(idx)}
          onApplyAll={() => {
            proposals.forEach((p, i) => {
              if (p.status === 'pending') applyProposal(i);
            });
          }}
          onDiscardAll={() => {
            proposals.forEach((p, i) => {
              if (p.status === 'pending') discardProposal(i);
            });
          }}
        />
      )}
    </>
  );
};

export default EditBlocksPreviewCard;
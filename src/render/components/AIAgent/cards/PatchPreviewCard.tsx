// ============================================
// WeaveMD — 多文件 patch 预览卡片（薄壳）
// ============================================
// 从 agentStore 读取 patchProposals 状态，error/stale 逻辑保留于此，
// diff 渲染委托给 DiffSummaryCard 统一组件。
// 多文件详情面板（PatchDetailModal）保留于此。
//
// R6 更新：转为 store-connected 组件（从 agentStore 直读），
// DiffSummaryCard 内部 useDiffSummaryHandlers hook 处理
// apply/discard/dismiss + staleness 检测，薄壳不再接收外部回调。

import React, { useMemo, useState } from 'react';
import { useAgentStore } from '@render/stores/agentStore';
import DiffSummaryCard, { type DiffSummarySource } from './DiffSummaryCard';
import PatchDetailModal from './PatchDetailModal';

const PatchPreviewCard: React.FC = () => {
  const proposals = useAgentStore((s) => s.patchProposals);
  const applyPatchProposal = useAgentStore((s) => s.applyPatchProposal);
  const discardPatchProposal = useAgentStore((s) => s.discardPatchProposal);

  const [showDetailModal, setShowDetailModal] = useState(false);

  // 只显示 pending 状态的提案
  const pendingProposals = useMemo(
    () => proposals.filter((p) => p.status === 'pending'),
    [proposals],
  );

  // 判断是否为"多文件"（多提案或单提案含多文件）
  const isMultiple = useMemo(
    () =>
      pendingProposals.length > 1 ||
      (pendingProposals.length === 1 && pendingProposals[0].files.length > 1),
    [pendingProposals],
  );

  if (pendingProposals.length === 0) return null;

  const source: DiffSummarySource = { kind: 'patch', data: pendingProposals };

  return (
    <>
      <DiffSummaryCard
        source={source}
        onViewDetails={
          isMultiple ? () => setShowDetailModal(true) : undefined
        }
      />

      {showDetailModal && (
        <PatchDetailModal
          proposals={proposals}
          onClose={() => setShowDetailModal(false)}
          onApply={(id, fileIndex) => void applyPatchProposal(id, fileIndex)}
          onDiscard={(id, fileIndex) => discardPatchProposal(id, fileIndex)}
        />
      )}
    </>
  );
};

export default PatchPreviewCard;
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
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const applyPatchProposal = useAgentStore((s) => s.applyPatchProposal);
  const discardPatchProposal = useAgentStore((s) => s.discardPatchProposal);

  const [showDetailModal, setShowDetailModal] = useState(false);

  // 流式传输期间不显示卡片
  if (isStreaming) return null;
  if (proposals.length === 0) return null;

  const source: DiffSummarySource = { kind: 'patch', data: proposals };

  return (
    <>
      <DiffSummaryCard
        source={source}
        onViewDetails={() => setShowDetailModal(true)}
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
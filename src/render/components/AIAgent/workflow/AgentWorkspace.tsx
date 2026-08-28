// ============================================
// WeaveMD — Agent 工作区视图
// ============================================
// 整合执行段、变更集、控制面板的统一工作区视图（A12）。
// 可嵌入 AgentTab 侧栏或作为独立面板。

import React from 'react';
import type { IAgentToolCall, AIProcessStatus } from '@shared/ai';
import ExecutionSegments from './ExecutionSegments';
import AgentControlPanel from './AgentControlPanel';

interface AgentWorkspaceProps {
  processStatus: AIProcessStatus;
  toolCalls: IAgentToolCall[];
  roundsUsed?: number;
  maxRounds?: number;
}

const AgentWorkspace: React.FC<AgentWorkspaceProps> = ({
  processStatus,
  toolCalls,
  roundsUsed,
  maxRounds,
}) => {
  return (
    <div className="space-y-4 p-4">
      {/* 控制面板 */}
      <AgentControlPanel
        processStatus={processStatus}
        toolCalls={toolCalls}
        roundsUsed={roundsUsed}
        maxRounds={maxRounds}
      />

      {/* 执行段可视化 */}
      {toolCalls.length > 0 && (
        <div className="p-3 rounded-card border border-border bg-bg-secondary/50">
          <ExecutionSegments toolCalls={toolCalls} />
        </div>
      )}
    </div>
  );
};

export default AgentWorkspace;

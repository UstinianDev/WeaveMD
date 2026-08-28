// ============================================
// WeaveMD — Agent 控制面板
// ============================================
// 展示 Agent 运行状态、工具策略、资源上下文（A12）。
// 紧凑型面板，嵌入 AgentTab 侧栏或底部。

import React, { useMemo } from 'react';
import type { IAgentToolCall, AIProcessStatus } from '@shared/ai';

interface AgentControlPanelProps {
  processStatus: AIProcessStatus;
  toolCalls: IAgentToolCall[];
  roundsUsed?: number;
  maxRounds?: number;
}

/** 状态文案映射。 */
const STATUS_LABELS: Record<AIProcessStatus, string> = {
  idle: '空闲',
  thinking: '思考中',
  tool_calling: '调用工具',
  generating_cards: '生成卡片',
  waiting_input: '等待输入',
  reading_file: '读取文件',
  user_answered: '已回答',
  generating_rewrite: '生成改写',
  batch_processed: '批量处理',
};

/** 状态颜色映射。 */
const STATUS_COLORS: Record<AIProcessStatus, string> = {
  idle: 'text-text-muted',
  thinking: 'text-blue-400',
  tool_calling: 'text-yellow-400',
  generating_cards: 'text-purple-400',
  waiting_input: 'text-orange-400',
  reading_file: 'text-cyan-400',
  user_answered: 'text-green-400',
  generating_rewrite: 'text-pink-400',
  batch_processed: 'text-green-400',
};

const AgentControlPanel: React.FC<AgentControlPanelProps> = ({
  processStatus,
  toolCalls,
  roundsUsed = 0,
  maxRounds = 12,
}) => {
  // 工具调用统计
  const stats = useMemo(() => {
    let success = 0;
    let failed = 0;
    for (const tc of toolCalls) {
      if (tc.status === 'ok') success++;
      else if (tc.status === 'error') failed++;
    }
    return { total: toolCalls.length, success, failed };
  }, [toolCalls]);

  const statusLabel = STATUS_LABELS[processStatus] ?? '未知';
  const statusColor = STATUS_COLORS[processStatus] ?? 'text-text-muted';

  return (
    <div className="space-y-3 p-3 rounded-card border border-border bg-bg-secondary/50">
      {/* 状态行 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${processStatus === 'idle' ? 'bg-text-muted' : 'bg-[var(--accent)] animate-pulse'}`} />
          <span className={`text-[13px] font-medium ${statusColor}`}>{statusLabel}</span>
        </div>
        <span className="text-[11px] text-text-muted">
          轮次 {roundsUsed}/{maxRounds}
        </span>
      </div>

      {/* 轮次进度条 */}
      <div className="w-full h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
          style={{ width: `${Math.min(100, (roundsUsed / maxRounds) * 100)}%` }}
        />
      </div>

      {/* 工具调用统计 */}
      {stats.total > 0 && (
        <div className="flex items-center gap-3 text-[12px] text-text-muted">
          <span>工具调用：{stats.total}</span>
          {stats.success > 0 && <span className="text-green-400">成功 {stats.success}</span>}
          {stats.failed > 0 && <span className="text-red-400">失败 {stats.failed}</span>}
        </div>
      )}
    </div>
  );
};

export default AgentControlPanel;

// ============================================
// WeaveMD — 批量操作卡片
// ============================================
// 展示批量文件操作的汇总信息（U5）。

import React from 'react';
import Icon from '../Common/Icon';

interface BatchOperation {
  type: 'create' | 'modify' | 'delete' | 'rename';
  filePath: string;
  newPath?: string;
  status: 'pending' | 'applied' | 'failed';
  error?: string;
}

interface BatchOperationCardProps {
  operations: BatchOperation[];
  isApplying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

/** 操作类型图标。 */
const TYPE_ICONS: Record<string, string> = {
  create: 'file-add',
  modify: 'file-edit',
  delete: 'delete',
  rename: 'folder-move',
};

/** 操作类型颜色。 */
const TYPE_COLORS: Record<string, string> = {
  create: 'text-green-400',
  modify: 'text-yellow-400',
  delete: 'text-red-400',
  rename: 'text-blue-400',
};

/** 状态颜色。 */
const STATUS_COLORS: Record<string, string> = {
  pending: 'text-text-muted',
  applied: 'text-green-400',
  failed: 'text-red-400',
};

const BatchOperationCard: React.FC<BatchOperationCardProps> = ({
  operations,
  isApplying,
  onApply,
  onDiscard,
}) => {
  if (operations.length === 0) return null;

  const pendingCount = operations.filter((op) => op.status === 'pending').length;
  const appliedCount = operations.filter((op) => op.status === 'applied').length;
  const failedCount = operations.filter((op) => op.status === 'failed').length;

  return (
    <div className="rounded-card border border-border bg-bg-secondary/50 p-3 space-y-3 glow-card">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-primary">
          批量操作
        </span>
        <span className="text-[11px] text-text-muted">
          {operations.length} 个操作
        </span>
      </div>

      {/* 统计 */}
      <div className="flex items-center gap-3 text-[11px]">
        {pendingCount > 0 && <span className="text-text-muted">待处理 {pendingCount}</span>}
        {appliedCount > 0 && <span className="text-green-400">已应用 {appliedCount}</span>}
        {failedCount > 0 && <span className="text-red-400">失败 {failedCount}</span>}
      </div>

      {/* 操作列表 */}
      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {operations.map((op, index) => (
          <div
            key={index}
            className="flex items-center gap-2 px-2 py-1.5 rounded bg-bg-tertiary/50 text-[12px]"
          >
            <Icon icon={TYPE_ICONS[op.type] ?? 'file-outline'} size={14} />
            <span className={`font-mono ${TYPE_COLORS[op.type]}`}>
              {op.type === 'rename' ? `${op.filePath} → ${op.newPath}` : op.filePath}
            </span>
            <span className={`ml-auto ${STATUS_COLORS[op.status]}`}>
              <Icon
                icon={op.status === 'applied' ? 'check' : op.status === 'failed' ? 'close' : 'schedule'}
                size={12}
              />
            </span>
          </div>
        ))}
      </div>

      {/* 操作按钮 */}
      {pendingCount > 0 && (
        <div className="flex justify-end gap-2 pt-1 border-t border-border">
          <button
            type="button"
            onClick={onDiscard}
            disabled={isApplying}
            className="px-2.5 py-1 text-[12px] rounded-input border border-border text-text-sub hover:bg-bg-tertiary disabled:opacity-40 transition-colors"
          >
            丢弃
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={isApplying}
            className="px-2.5 py-1 text-[12px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {isApplying ? '应用中...' : '全部应用'}
          </button>
        </div>
      )}
    </div>
  );
};

export default BatchOperationCard;

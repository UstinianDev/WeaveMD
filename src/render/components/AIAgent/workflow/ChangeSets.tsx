// ============================================
// WeaveMD — 变更集展示组件
// ============================================
// 展示 Agent 任务中的文件变更（A5）。
// 显示变更类型、文件路径、状态。

import React from 'react';

export interface ChangeSetItem {
  type: 'create' | 'modify' | 'delete' | 'rename';
  filePath: string;
  newPath?: string;
  status: 'pending' | 'applied' | 'rolled_back';
}

interface ChangeSetsProps {
  changes: ChangeSetItem[];
}

/** 变更类型图标。 */
const TYPE_ICONS: Record<string, string> = {
  create: '+',
  modify: '~',
  delete: '-',
  rename: '→',
};

/** 变更类型颜色。 */
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
  rolled_back: 'text-red-400',
};

const ChangeSets: React.FC<ChangeSetsProps> = ({ changes }) => {
  if (changes.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[12px] text-text-muted font-medium uppercase tracking-wide">
        文件变更
      </div>
      <div className="space-y-1">
        {changes.map((change, index) => {
          const icon = TYPE_ICONS[change.type] ?? '?';
          const typeColor = TYPE_COLORS[change.type] ?? 'text-text-muted';
          const statusColor = STATUS_COLORS[change.status] ?? 'text-text-muted';

          return (
            <div
              key={index}
              className="flex items-center gap-2 px-2 py-1 rounded bg-bg-tertiary/50 text-[12px]"
            >
              <span className={`font-mono font-bold ${typeColor}`}>{icon}</span>
              <span className="flex-1 truncate text-text-primary">
                {change.filePath}
                {change.type === 'rename' && change.newPath && (
                  <span className="text-text-muted"> → {change.newPath}</span>
                )}
              </span>
              <span className={`text-[11px] ${statusColor}`}>
                {change.status === 'applied' ? '已应用' : change.status === 'rolled_back' ? '已回滚' : '待确认'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ChangeSets;

// ============================================
// WeaveMD — Agent 任务变更集
// ============================================
// 跟踪 Agent 任务中的文件变更（创建/修改/删除）。
// 用于变更集展示（A5）和回滚支持。

export type ChangeType = 'create' | 'modify' | 'delete' | 'rename';

export interface FileChange {
  type: ChangeType;
  filePath: string;
  /** rename 时的新路径。 */
  newPath?: string;
  /** 修改前的内容快照（用于回滚）。 */
  beforeContent?: string;
  /** 修改后的内容。 */
  afterContent?: string;
  timestamp: number;
}

export interface ChangeSet {
  id: string;
  conversationId: string;
  changes: FileChange[];
  createdAt: number;
  status: 'pending' | 'applied' | 'rolled_back';
}

/** 创建新的变更集。 */
export function createChangeSet(conversationId: string): ChangeSet {
  return {
    id: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    changes: [],
    createdAt: Date.now(),
    status: 'pending',
  };
}

/** 向变更集添加变更。 */
export function addChange(
  changeSet: ChangeSet,
  change: Omit<FileChange, 'timestamp'>
): ChangeSet {
  return {
    ...changeSet,
    changes: [...changeSet.changes, { ...change, timestamp: Date.now() }],
  };
}

/** 标记变更集为已应用。 */
export function markApplied(changeSet: ChangeSet): ChangeSet {
  return { ...changeSet, status: 'applied' };
}

/** 标记变更集为已回滚。 */
export function markRolledBack(changeSet: ChangeSet): ChangeSet {
  return { ...changeSet, status: 'rolled_back' };
}

/** 获取变更集摘要（用于 UI 展示）。 */
export function getChangeSetSummary(changeSet: ChangeSet): {
  created: number;
  modified: number;
  deleted: number;
  renamed: number;
  total: number;
} {
  let created = 0;
  let modified = 0;
  let deleted = 0;
  let renamed = 0;

  for (const change of changeSet.changes) {
    switch (change.type) {
      case 'create': created++; break;
      case 'modify': modified++; break;
      case 'delete': deleted++; break;
      case 'rename': renamed++; break;
    }
  }

  return {
    created,
    modified,
    deleted,
    renamed,
    total: changeSet.changes.length,
  };
}

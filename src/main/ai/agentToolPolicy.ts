// ============================================
// WeaveMD — Agent 工具策略
// ============================================
// 管理 Agent 工具的权限策略（哪些工具可用、使用限制等）。
// 用于工具策略控制（A7）。

export type ToolPolicyAction = 'allow' | 'deny' | 'limit';

export interface ToolPolicyRule {
  toolName: string;
  action: ToolPolicyAction;
  /** limit 模式下的最大调用次数。 */
  maxCalls?: number;
  /** 规则描述（用于 UI 展示）。 */
  description?: string;
}

export interface ToolPolicy {
  /** 默认动作（未匹配规则时）。 */
  defaultAction: ToolPolicyAction;
  /** 规则列表（按优先级排序）。 */
  rules: ToolPolicyRule[];
}

/** 默认策略：所有工具允许。 */
const DEFAULT_POLICY: ToolPolicy = {
  defaultAction: 'allow',
  rules: [
    // 文件操作工具需要用户确认
    { toolName: 'createFile', action: 'allow', description: '创建文件（需确认）' },
    { toolName: 'createFolder', action: 'allow', description: '创建文件夹（需确认）' },
    { toolName: 'renameFile', action: 'allow', description: '重命名文件（需确认）' },
    { toolName: 'moveFile', action: 'allow', description: '移动文件（需确认）' },
    { toolName: 'deleteFile', action: 'allow', description: '删除文件（需确认）' },
    // 搜索工具限制调用次数
    { toolName: 'web_search', action: 'limit', maxCalls: 5, description: '联网搜索（限 5 次）' },
    { toolName: 'searchKB', action: 'limit', maxCalls: 10, description: '知识库检索（限 10 次）' },
  ],
};

/** 获取当前策略（简化实现：返回默认策略）。 */
export function getToolPolicy(): ToolPolicy {
  return DEFAULT_POLICY;
}

/** 检查工具是否允许使用。 */
export function isToolAllowed(
  toolName: string,
  callCount: number,
  policy: ToolPolicy = DEFAULT_POLICY
): { allowed: boolean; reason?: string } {
  const rule = policy.rules.find((r) => r.toolName === toolName);

  if (!rule) {
    return { allowed: policy.defaultAction === 'allow' };
  }

  switch (rule.action) {
    case 'allow':
      return { allowed: true };
    case 'deny':
      return { allowed: false, reason: `工具 ${toolName} 被禁用` };
    case 'limit':
      if (rule.maxCalls && callCount >= rule.maxCalls) {
        return { allowed: false, reason: `工具 ${toolName} 已达调用上限（${rule.maxCalls} 次）` };
      }
      return { allowed: true };
  }
}

/** 获取工具策略摘要（用于 UI 展示）。 */
export function getToolPolicySummary(policy: ToolPolicy): {
  allowed: string[];
  denied: string[];
  limited: Array<{ name: string; maxCalls: number }>;
} {
  const allowed: string[] = [];
  const denied: string[] = [];
  const limited: Array<{ name: string; maxCalls: number }> = [];

  for (const rule of policy.rules) {
    switch (rule.action) {
      case 'allow':
        allowed.push(rule.toolName);
        break;
      case 'deny':
        denied.push(rule.toolName);
        break;
      case 'limit':
        limited.push({ name: rule.toolName, maxCalls: rule.maxCalls ?? 0 });
        break;
    }
  }

  return { allowed, denied, limited };
}

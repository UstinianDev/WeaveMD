// ============================================
// WeaveMD — 执行段可视化组件
// ============================================
// 展示 Agent 执行过程中的工具调用段（A4）。
// 每个段显示：工具名、状态、耗时。

import React, { useMemo } from 'react';
import type { IAgentToolCall } from '@shared/ai';

interface ExecutionSegmentsProps {
  toolCalls: IAgentToolCall[];
}

/** 状态颜色映射。 */
const STATUS_COLORS: Record<string, string> = {
  ok: 'text-green-400 bg-green-400/10',
  error: 'text-red-400 bg-red-400/10',
  running: 'text-yellow-400 bg-yellow-400/10',
};

/** 状态图标。 */
const STATUS_ICONS: Record<string, string> = {
  ok: '✓',
  error: '✗',
  running: '⟳',
};

/** 工具名简称映射（减少视觉噪音）。 */
const TOOL_SHORT_NAMES: Record<string, string> = {
  listFiles: '列出文件',
  readFile: '读取文件',
  searchKB: '知识库检索',
  runSkill: '运行技能',
  editBlocks: '改写建议',
  createFile: '创建文件',
  createFolder: '创建文件夹',
  renameFile: '重命名',
  moveFile: '移动文件',
  deleteFile: '删除文件',
  web_search: '联网搜索',
  research_search: '研究搜索',
  ask_question_card: '提问',
  preview_patch_files: '补丁预览',
  analyze_folder: '分析目录',
  check_links: '检查链接',
  get_task_activity: '任务活动',
};

const ExecutionSegments: React.FC<ExecutionSegmentsProps> = ({ toolCalls }) => {
  // 按轮次分组
  const grouped = useMemo(() => {
    const groups = new Map<number, IAgentToolCall[]>();
    for (const tc of toolCalls) {
      const round = tc.loopIndex ?? 0;
      if (!groups.has(round)) groups.set(round, []);
      groups.get(round)!.push(tc);
    }
    return groups;
  }, [toolCalls]);

  if (toolCalls.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[12px] text-text-muted font-medium uppercase tracking-wide">
        执行过程
      </div>
      {Array.from(grouped.entries()).map(([round, calls]) => (
        <div key={round} className="space-y-1">
          <div className="text-[11px] text-text-muted">轮次 {round + 1}</div>
          <div className="flex flex-wrap gap-1.5">
            {calls.map((tc) => {
              const status = tc.status ?? 'running';
              const colorClass = STATUS_COLORS[status] ?? STATUS_COLORS.running;
              const icon = STATUS_ICONS[status] ?? STATUS_ICONS.running;
              const shortName = TOOL_SHORT_NAMES[tc.name] ?? tc.name;

              return (
                <div
                  key={tc.toolCallId}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[12px] ${colorClass}`}
                  title={`${tc.name}: ${status}${tc.errorDesc ? ` (${tc.errorDesc})` : ''}`}
                >
                  <span className="text-[10px]">{icon}</span>
                  <span>{shortName}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ExecutionSegments;

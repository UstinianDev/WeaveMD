// ============================================
// WeaveMD — Agent 循环日志列表
// ============================================
// 展示 Agent 循环的详细日志（U8）。

import React, { useMemo } from 'react';
import type { IAgentToolCall } from '@shared/ai';
import Icon from '../Common/Icon';

interface AgentLoopLogListProps {
  toolCalls: IAgentToolCall[];
}

/** 工具名中文映射。 */
const TOOL_NAMES: Record<string, string> = {
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

/** 状态颜色。 */
const STATUS_COLORS: Record<string, string> = {
  ok: 'text-green-400',
  error: 'text-red-400',
};

/** 状态图标。 */
const STATUS_ICONS: Record<string, string> = {
  ok: 'check',
  error: 'close',
};

const AgentLoopLogList: React.FC<AgentLoopLogListProps> = ({ toolCalls }) => {
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
    <div className="space-y-3">
      <div className="text-[12px] text-text-muted font-medium uppercase tracking-wide">
        工具调用日志
      </div>

      {Array.from(grouped.entries()).map(([round, calls]) => (
        <div key={round} className="space-y-1.5">
          <div className="text-[11px] text-text-muted font-medium">
            轮次 {round + 1}
          </div>

          <div className="space-y-1">
            {calls.map((tc) => {
              const status = tc.status ?? 'ok';
              const statusColor = STATUS_COLORS[status] ?? 'text-text-muted';
              const statusIcon = STATUS_ICONS[status] ?? '?';
              const toolName = TOOL_NAMES[tc.name] ?? tc.name;

              return (
                <div
                  key={tc.toolCallId}
                  className="flex items-start gap-2 px-2 py-1.5 rounded bg-bg-tertiary/50 text-[12px]"
                >
                  <span className={`mt-0.5 ${statusColor}`}><Icon icon={statusIcon} size={12} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary">{toolName}</span>
                      <span className="text-[10px] text-text-muted">{tc.name}</span>
                    </div>
                    {tc.errorDesc && (
                      <p className="text-[11px] text-red-400 mt-0.5 truncate">
                        {tc.errorDesc}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AgentLoopLogList;

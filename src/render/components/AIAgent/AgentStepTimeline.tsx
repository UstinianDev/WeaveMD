// ============================================
// WeaveMD — Agent 分步可视化时间线
// ============================================
// 参考 Notus AgentLoopLogList + ToolChainStep，按 loopIndex 分组工具调用，
// 每轮可折叠，thinking 文本用 <details> 折叠展示。
// 纯展示组件：传入 toolCalls 数组，内部按 loopIndex 分组渲染。

import React, { useState } from 'react';
import type { IAgentToolCall } from '@shared/ai';
import { useI18n } from '@render/i18n';

interface AgentStepTimelineProps {
  toolCalls: IAgentToolCall[];
  /** 当前是否正在流式（运行中自动展开最新轮）。 */
  isStreaming?: boolean;
}

/** 格式化工具耗时：≥1s 显示秒，<1s 显示毫秒。 */
function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

/** 截断字符串。 */
function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}

/** 简要参数预览：尝试格式化 JSON，否则原样截断。 */
function summarizeArgs(args: string): string {
  if (!args) return '';
  try {
    const parsed: unknown = JSON.parse(args);
    const pretty = JSON.stringify(parsed);
    if (pretty === undefined) return truncate(args, 100);
    return truncate(pretty, 100);
  } catch {
    return truncate(args, 100);
  }
}

/** 工具名中文映射（常用工具）。 */
function getToolLabel(name: string, t: (key: string, fb?: string) => string): string {
  const map: Record<string, string> = {
    searchKB: t('ai.tool.name.searchKB', '知识库检索'),
    editBlocks: t('ai.tool.name.editBlocks', '编辑文档'),
    listFiles: t('ai.tool.name.listFiles', '列出文件'),
    readFile: t('ai.tool.name.readFile', '读取文件'),
    runSkill: t('ai.tool.name.runSkill', '运行技能'),
    createFile: t('ai.tool.name.createFile', '创建文件'),
    createFolder: t('ai.tool.name.createFolder', '创建文件夹'),
  };
  return map[name] ?? name;
}

/** 按 loopIndex 分组工具调用。 */
function groupByLoop(toolCalls: IAgentToolCall[]): Map<number, IAgentToolCall[]> {
  const groups = new Map<number, IAgentToolCall[]>();
  for (const call of toolCalls) {
    const key = call.loopIndex ?? 0;
    const arr = groups.get(key);
    if (arr) {
      arr.push(call);
    } else {
      groups.set(key, [call]);
    }
  }
  return groups;
}

/** 单个工具调用行。 */
const ToolCallRow: React.FC<{ call: IAgentToolCall; t: (key: string, fb?: string) => string }> = ({
  call,
  t,
}) => {
  const [expanded, setExpanded] = useState(false);
  const isError = call.status === 'error';
  const resultText = isError ? call.errorDesc ?? call.result ?? '' : call.result ?? '';
  const hasThinking = !!call.thinking;

  return (
    <div className="space-y-1">
      {/* 工具调用行：状态图标 + 工具名 + 耗时 */}
      <div className="flex items-center gap-2 text-[13px]">
        {/* 状态图标 */}
        <span
          className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
            isError
              ? 'bg-red-500/15 text-red-500'
              : 'bg-green-500/15 text-green-600'
          }`}
        >
          {isError ? '✕' : '✓'}
        </span>
        {/* 工具名 */}
        <span className="font-mono font-medium text-text-primary truncate">
          {getToolLabel(call.name, t)}
        </span>
        {/* 参数摘要 */}
        <span className="text-text-muted truncate flex-1 min-w-0">
          {summarizeArgs(call.args)}
        </span>
      </div>

      {/* thinking 折叠块 */}
      {hasThinking && (
        <details className="ml-6 text-[12px] text-text-sub leading-relaxed">
          <summary className="cursor-pointer hover:text-text-primary transition-colors select-none">
            {t('ai.step.viewThinking', '查看本轮思考文本')}
          </summary>
          <div className="mt-1 whitespace-pre-wrap bg-bg-tertiary/40 rounded-md px-2.5 py-1.5 border border-border">
            {call.thinking}
          </div>
        </details>
      )}

      {/* 结果折叠 */}
      {resultText && (
        <div className="ml-6">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-[12px] text-text-muted hover:text-text-primary transition-colors"
          >
            {expanded ? t('ai.tool.collapse', '收起') : t('ai.tool.expand', '展开')}
          </button>
          {expanded && (
            <div className="mt-1 text-[12px] break-words whitespace-pre-wrap bg-bg-secondary rounded-md px-2.5 py-1.5 border border-border">
              {isError ? (
                <span className="text-red-500">{resultText}</span>
              ) : (
                <span>{resultText}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** 单轮步骤卡片。 */
const RoundStep: React.FC<{
  roundIndex: number;
  calls: IAgentToolCall[];
  isLast: boolean;
  isStreaming: boolean;
  t: (key: string, fb?: string) => string;
}> = ({ roundIndex, calls, isLast, isStreaming, t }) => {
  // 最后一轮且正在流式时默认展开，否则折叠
  const [expanded, setExpanded] = useState(isLast && isStreaming);

  // 流式状态下最后一轮自动展开
  React.useEffect(() => {
    if (isLast && isStreaming) {
      setExpanded(true);
    }
  }, [isLast, isStreaming]);

  const hasError = calls.some((c) => c.status === 'error');
  const toolNames = calls.map((c) => getToolLabel(c.name, t)).join('、');

  return (
    <div
      className={`rounded-card border overflow-hidden transition-colors ${
        hasError ? 'border-red-500/20 bg-red-500/5' : 'border-border bg-bg-tertiary/40'
      }`}
    >
      {/* 轮次标题栏（可点击折叠/展开） */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 text-[13px] hover:bg-bg-tertiary/60 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* 展开/折叠箭头 */}
          <span
            className={`flex-shrink-0 text-text-muted transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          >
            ▶
          </span>
          <span className="font-medium text-text-primary">
            {t('ai.step.round', '第 {n} 轮').replace('{n}', String(roundIndex + 1))}
          </span>
          <span className="text-text-muted truncate">
            {toolNames}
          </span>
        </div>
        <span className="text-text-sub flex-shrink-0">
          {calls.length} {t('ai.step.toolCount', '个工具')}
        </span>
      </button>

      {/* 展开的工具调用列表 */}
      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-border/50">
          {calls.map((call) => (
            <ToolCallRow key={call.toolCallId} call={call} t={t} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Agent 分步可视化时间线主组件。 */
const AgentStepTimeline: React.FC<AgentStepTimelineProps> = ({
  toolCalls,
  isStreaming = false,
}) => {
  const { t } = useI18n();

  if (toolCalls.length === 0) return null;

  const groups = groupByLoop(toolCalls);
  const sortedRounds = Array.from(groups.entries()).sort(([a], [b]) => a - b);

  return (
    <div className="space-y-1.5">
      {sortedRounds.map(([roundIndex, calls], i) => (
        <RoundStep
          key={roundIndex}
          roundIndex={roundIndex}
          calls={calls}
          isLast={i === sortedRounds.length - 1}
          isStreaming={isStreaming}
          t={t}
        />
      ))}
    </div>
  );
};

export default AgentStepTimeline;

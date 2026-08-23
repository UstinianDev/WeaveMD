// ============================================
// WeaveMD — 工具调用轨迹展示组件
// ============================================
// 渲染单次 Agent 工具调用：工具名 + 参数摘要（JSON 截断）+ 执行状态色标
// （ok 绿 / error 红）+ 结果折叠展开。i18n 键 ai.tool.*。
// 纯展示组件：一次性传入单条 tool call（含其流式回显），结果段可折叠。

import React, { useState } from 'react';
import type { IAgentToolCall } from '@shared/ai';
import { useI18n } from '@render/i18n';

interface ToolCallTraceProps {
  call: IAgentToolCall;
  /** 工具调用耗时（毫秒），可选 */
  duration?: number;
}

const ARGS_PREVIEW_LIMIT = 120;

/** 截断任意字符串（保留头部，避免长参数刷屏）。 */
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
    if (pretty === undefined) return truncate(args, ARGS_PREVIEW_LIMIT);
    return truncate(pretty, ARGS_PREVIEW_LIMIT);
  } catch {
    return truncate(args, ARGS_PREVIEW_LIMIT);
  }
}

/** 格式化工具耗时：≥1s 显示秒，<1s 显示毫秒。 */
function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

const ToolCallTrace: React.FC<ToolCallTraceProps> = ({ call, duration }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const isError = call.status === 'error';
  const resultText = isError
    ? call.errorDesc ?? call.result ?? ''
    : call.result ?? '';

  return (
    <div
      className={`rounded-card border px-3 py-2 text-[15px] space-y-1.5 shadow-sm transition-colors ${
        isError ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-bg-tertiary/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[13px] font-medium text-text-primary truncate">
            {call.name}
            {duration !== undefined && duration > 0 && (
              <span className="ml-1.5 font-normal text-text-sub">
                · {formatDuration(duration)}
              </span>
            )}
          </span>
          <span
            className={`flex-shrink-0 text-[12px] px-1.5 py-0.5 rounded-full border ${
              isError
                ? 'bg-red-500/15 text-red-500 border-red-500/20'
                : 'bg-green-500/15 text-green-600 border-green-500/20'
            }`}
          >
            {t(isError ? 'ai.tool.statusError' : 'ai.tool.statusOk')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex-shrink-0 text-[13px] text-text-muted hover:text-text-primary transition-colors"
        >
          {expanded ? t('ai.tool.collapse') : t('ai.tool.expand')}
        </button>
      </div>

      {/* 参数摘要 */}
      <div className="text-[13px] text-text-sub break-words whitespace-pre-wrap">
        {truncate(summarizeArgs(call.args), ARGS_PREVIEW_LIMIT)}
      </div>

      {/* 折叠的结果区 */}
      {expanded && (
        <div className="text-[13px] break-words whitespace-pre-wrap bg-bg-secondary rounded-md px-2.5 py-1.5 border border-border">
          {isError && resultText ? (
            <span className="text-red-500">{resultText || t('ai.tool.resultError')}</span>
          ) : resultText ? (
            <span>{resultText}</span>
          ) : (
            <span className="text-text-muted">{t('ai.tool.noResult')}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCallTrace;

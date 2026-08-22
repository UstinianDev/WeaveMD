// ============================================
// WeaveMD — AI 消息气泡（单条消息渲染）
// ============================================
// user / assistant / tool 三类 + 打字指示。
// 铁律（SECURITY）：禁止 dangerouslySetInnerHTML —— assistant 用 <MarkdownMessage>
// （aiMarkdown HAST→React 安全渲染），tool 用 <ToolCallTrace/>，user 保持纯文本。
// assistant refsJson（IKbSearchResult 数组）渲染「[来源: 文件名 · 块]」链接，点击 openFile。

import React from 'react';
import type { AIMessageRole, IAgentToolCall } from '@shared/ai';
import type { IFile } from '@shared/types';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useEditorStore } from '@render/stores/editorStore';
import MarkdownMessage from './MarkdownMessage';
import ToolCallTrace from './ToolCallTrace';

interface AIMessageBubbleProps {
  role: AIMessageRole;
  content: string;
  isStreaming?: boolean;
  /** tool 角色的调用轨迹列表（流式累积，供 ToolCallTrace 渲染）。 */
  toolCalls?: IAgentToolCall[];
  /** assistant 的出处 JSON 字符串（IKbSearchResult[]），可为 null。 */
  refsJson?: string | null;
}

interface ParsedSource {
  fileName: string;
  fileId: string | null;
  chunkLabel?: string;
  /** 出处行号（sourceRef.line，尽力滚动用；缺失或超范围则仅 openFile）。 */
  line?: number;
}

/** 解析 refsJson 中每条出处：取 fileName 与 sourceRef 里的 fileId / line。 */
function parseRefsJson(json: string | null | undefined): ParsedSource[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const sources: ParsedSource[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const fileName = typeof rec.fileName === 'string' ? rec.fileName : undefined;
      if (!fileName) continue;
      let fileId: string | null = null;
      let chunkLabel: string | undefined;
      let line: number | undefined;
      const rawRef = rec.sourceRef;
      if (typeof rawRef === 'string') {
        try {
          const refObj = JSON.parse(rawRef) as Record<string, unknown>;
          if (typeof refObj.fileId === 'string') fileId = refObj.fileId;
          if (typeof refObj.seq === 'number') chunkLabel = String(refObj.seq);
          if (typeof refObj.line === 'number' && refObj.line > 0) line = refObj.line;
        } catch {
          fileId = null;
        }
      } else if (rec.fileId && typeof rec.fileId === 'string') {
        fileId = rec.fileId;
      }
      sources.push({ fileName, fileId, chunkLabel, line });
    }
    return sources;
  } catch {
    return [];
  }
}

/**
 * 打开来源文档后尽力对齐出处行：按行号在滚动视口内比例滚动。
 * 无行号 / 视口不可用 / 辅助失败一律静默（仅已 openFile，不阻塞）。
 * 不改编辑器内核；用 DOM 度量近似定位。
 */
function tryScrollEditorToLine(line: number, totalLines: number): void {
  if (!Number.isFinite(line) || !Number.isFinite(totalLines) || totalLines <= 0) return;
  const ratio = Math.max(0, Math.min(1, (line - 1) / totalLines));
  // 等待内容渲染一个宏任务周期后再滚动
  window.setTimeout(() => {
    try {
      const container = document.querySelector<HTMLElement>('.editor-scroll-container');
      if (!container) return;
      container.scrollTo({ top: Math.max(0, ratio * container.scrollHeight), behavior: 'smooth' });
    } catch {
      /* 尽力而为，任何失败仅保留 openFile 结果 */
    }
  }, 60);
}

const ROLE_LABEL: Record<AIMessageRole, string> = {
  user: 'You',
  assistant: 'AI',
  tool: 'Tool',
};

const AIMessageBubble: React.FC<AIMessageBubbleProps> = ({
  role,
  content,
  isStreaming = false,
  toolCalls = [],
  refsJson = null,
}) => {
  const { t } = useI18n();

  if (role === 'user') {
    return (
      <div className="flex justify-end px-3 py-1">
        <div
          className="max-w-[85%] rounded-2xl rounded-tr-md px-3.5 py-2 text-[15px] leading-relaxed bg-[var(--accent)] text-white shadow-sm"
          style={{ fontFamily: "'Consolas', 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}
        >
          <div className="whitespace-pre-wrap break-words">{content}</div>
        </div>
      </div>
    );
  }

  const isTool = role === 'tool';
  const sources = role === 'assistant' ? parseRefsJson(refsJson) : [];

  const handleOpenSource = (source: ParsedSource) => {
    if (!source.fileId) return;
    const userId = useAuthStore.getState().user?.id ?? '';
    // getFile 走既有文件 API（尽力而为；失败不阻塞）
    void window.weaveMD.file.get(source.fileId, userId).then((res) => {
      const d = res as { success?: boolean; data?: IFile };
      if (d.success !== false && d.data) {
        useEditorStore.getState().openFile(d.data);
        // 出处行号尽力滚动；无行号/超范围只 openFile，不阻塞
        if (source.line) {
          const total = d.data.content.split('\n').length;
          tryScrollEditorToLine(source.line, total);
        }
      }
    });
  };

  return (
    <div className="flex px-3 py-1">
      <div className="max-w-[92%] space-y-1">
        <div className="text-[12px] font-medium text-text-muted">{ROLE_LABEL[role]}</div>

        {isTool ? (
          /* 工具轨迹：一次 tool 消息可能含多次调用（流式累积） */
          <div className="space-y-1.5">
            {toolCalls.length > 0
              ? toolCalls.map((c) => <ToolCallTrace key={c.toolCallId} call={c} />)
              : content && (
                  <div className="rounded-2xl rounded-tl-md px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap break-words bg-bg-tertiary shadow-sm">
                    {content}
                  </div>
                )}
          </div>
        ) : (
          <div
            className={`rounded-2xl rounded-tl-md px-3 py-1.5 text-[15px] leading-normal break-words bg-bg-secondary border border-[var(--border-color)] shadow-sm ai-markdown`}
          >
            {isStreaming && !content ? (
              <span className="inline-block w-2 h-4 animate-pulse text-text-muted">▍</span>
            ) : (
              <MarkdownMessage content={content} />
            )}
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 animate-pulse text-text-muted">▍</span>
            )}
          </div>
        )}

        {/* 出处来源链接：[来源: 文件名 · 块] */}
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {sources.map((source, index) => {
              const clickable = !!source.fileId;
              const template = source.chunkLabel
                ? t('ai.refs.chunk')
                : t('ai.refs.file');
              const label = template
                .split('{fileName}')
                .join(source.fileName)
                .split('{chunk}')
                .join(source.chunkLabel ?? '');
              return clickable ? (
                <button
                  key={`${source.fileName}-${index}`}
                  type="button"
                  onClick={() => handleOpenSource(source)}
                  className="text-[13px] px-2 py-0.5 rounded-md bg-bg-tertiary border border-border text-text-sub hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
                >
                  {label}
                </button>
              ) : (
                <span
                  key={`${source.fileName}-${index}`}
                  className="text-[13px] px-2 py-0.5 rounded-md bg-bg-tertiary border border-border text-text-muted"
                >
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AIMessageBubble;

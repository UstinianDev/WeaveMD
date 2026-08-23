// ============================================
// WeaveMD — 文件操作预览卡片（Module 13）
// ============================================
// AI 文件操作工具（createFile / createFolder）的预览确认卡片。
// 铁律一：AI 无直接落盘能力——工具仅产 proposal，用户确认后才落盘。
// 每个 pending 提案显示为卡片：标题/路径/内容预览 + 应用/废弃按钮。
// 已应用/已废弃的提案显示状态标签。

import React from 'react';
import { useI18n } from '@render/i18n';
import type { FileOpProposal } from '@render/stores/agentStore';

interface FileOpPreviewCardProps {
  proposals: FileOpProposal[];
  onApply: (index: number) => void;
  onDiscard: (index: number) => void;
}

/** 截取前 maxLen 字符，超出时加省略号 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

const FileOpPreviewCard: React.FC<FileOpPreviewCardProps> = ({
  proposals,
  onApply,
  onDiscard,
}) => {
  const { t } = useI18n();

  if (proposals.length === 0) return null;

  return (
    <div className="mx-3 my-1 space-y-1.5">
      {proposals.map((p, idx) => {
        const isCreateFile = p.type === 'createFile';
        const title = isCreateFile
          ? t('ai.fileOp.createFile', '新建文件') + `：${p.fileName ?? ''}`
          : t('ai.fileOp.createFolder', '新建文件夹') + `：${p.folderName ?? ''}`;
        const path = p.parentPath
          ? p.parentPath + '/' + (p.fileName ?? p.folderName ?? '')
          : p.fileName ?? p.folderName ?? '';

        return (
          <div
            key={`${p.type}-${idx}`}
            className="rounded-card border border-border bg-bg-tertiary/60 overflow-hidden shadow-sm"
          >
            {/* header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[15px]">
                  {isCreateFile ? '📄' : '📁'}
                </span>
                <span className="text-[13px] font-medium text-text-primary truncate">
                  {title}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {p.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      onClick={() => onDiscard(idx)}
                      className="text-[12px] px-2 py-0.5 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
                    >
                      {t('ai.fileOp.discard', '废弃')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onApply(idx)}
                      className="text-[12px] px-2.5 py-0.5 rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                    >
                      {t('ai.fileOp.apply', '应用')}
                    </button>
                  </>
                )}
                {p.status === 'applied' && (
                  <span className="text-[12px] px-2 py-0.5 rounded-input bg-green-500/10 text-green-600 border border-green-500/20">
                    {t('ai.fileOp.applied', '已创建')}
                  </span>
                )}
                {p.status === 'discarded' && (
                  <span className="text-[12px] px-2 py-0.5 rounded-input bg-bg-primary/40 text-text-muted border border-border">
                    {t('ai.fileOp.discarded', '已废弃')}
                  </span>
                )}
              </div>
            </div>

            {/* 路径 */}
            <div className="px-3 py-1.5 text-[12px] text-text-muted border-b border-border">
              {t('ai.fileOp.path', '路径')}：{path}
            </div>

            {/* 内容预览（仅文件类型） */}
            {isCreateFile && p.content !== undefined && (
              <div className="px-3 py-2">
                <div className="text-[12px] text-text-sub mb-1">
                  {t('ai.fileOp.contentPreview', '内容预览')}
                </div>
                <pre className="text-[13px] font-mono text-text-muted bg-bg-primary/60 rounded-sm px-2 py-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words">
                  {truncate(p.content, 200)}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default FileOpPreviewCard;

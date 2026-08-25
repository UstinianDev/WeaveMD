// ============================================
// WeaveMD — 文件修订差异弹窗
// ============================================
// 展示文件修订之间的差异（U3）。

import React from 'react';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface FileRevisionDiffDialogProps {
  open: boolean;
  fileName: string;
  diff: DiffLine[];
  addedCount: number;
  removedCount: number;
  onApply?: () => void;
  onClose: () => void;
}

/** 差异行颜色。 */
const LINE_COLORS: Record<string, string> = {
  added: 'bg-green-500/10 text-green-400',
  removed: 'bg-red-500/10 text-red-400',
  unchanged: 'text-text-muted',
};

/** 差异行前缀。 */
const LINE_PREFIXES: Record<string, string> = {
  added: '+',
  removed: '-',
  unchanged: ' ',
};

const FileRevisionDiffDialog: React.FC<FileRevisionDiffDialogProps> = ({
  open,
  fileName,
  diff,
  addedCount,
  removedCount,
  onApply,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-3xl max-h-[80vh] rounded-card border border-border bg-bg-secondary flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">
              文件修订差异
            </h3>
            <p className="text-[12px] text-text-muted mt-0.5">{fileName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 统计信息 */}
        <div className="px-4 py-2 border-b border-border flex items-center gap-3 text-[12px]">
          {addedCount > 0 && (
            <span className="text-green-400">+{addedCount} 行</span>
          )}
          {removedCount > 0 && (
            <span className="text-red-400">-{removedCount} 行</span>
          )}
        </div>

        {/* 差异内容 */}
        <div className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed">
          {diff.length === 0 ? (
            <p className="text-text-muted text-center py-8">无差异</p>
          ) : (
            <div className="space-y-0">
              {diff.map((line, index) => (
                <div
                  key={index}
                  className={`flex ${LINE_COLORS[line.type]}`}
                >
                  <span className="w-12 text-right pr-2 text-text-muted select-none">
                    {line.oldLineNum ?? ''}
                  </span>
                  <span className="w-12 text-right pr-2 text-text-muted select-none">
                    {line.newLineNum ?? ''}
                  </span>
                  <span className="w-4 text-center select-none">
                    {LINE_PREFIXES[line.type]}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all">
                    {line.content}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        {onApply && (
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-[13px] rounded-input border border-border text-text-sub hover:bg-bg-tertiary transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onApply}
              className="px-3.5 py-1.5 text-[13px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
            >
              应用修订
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileRevisionDiffDialog;

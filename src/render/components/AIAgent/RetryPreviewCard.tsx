// ============================================
// WeaveMD — 重试预览卡片
// ============================================
// 展示重试操作的预览信息（U4）。

import React from 'react';

interface RetryPreviewCardProps {
  /** 原始操作描述。 */
  originalAction: string;
  /** 失败原因。 */
  errorReason: string;
  /** 重试次数。 */
  retryCount: number;
  /** 最大重试次数。 */
  maxRetries: number;
  /** 是否正在重试。 */
  isRetrying: boolean;
  /** 重试回调。 */
  onRetry: () => void;
  /** 取消回调。 */
  onCancel: () => void;
}

const RetryPreviewCard: React.FC<RetryPreviewCardProps> = ({
  originalAction,
  errorReason,
  retryCount,
  maxRetries,
  isRetrying,
  onRetry,
  onCancel,
}) => {
  const canRetry = retryCount < maxRetries;

  return (
    <div className="rounded-card border border-border bg-bg-secondary/50 p-3 space-y-2">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <span className="text-[14px]">⚠️</span>
        <span className="text-[13px] font-medium text-text-primary">
          操作失败
        </span>
      </div>

      {/* 操作描述 */}
      <p className="text-[12px] text-text-muted">{originalAction}</p>

      {/* 错误原因 */}
      <div className="px-2 py-1.5 rounded bg-red-500/10 border border-red-500/20">
        <p className="text-[12px] text-red-400">{errorReason}</p>
      </div>

      {/* 重试信息 */}
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>重试次数：{retryCount}/{maxRetries}</span>
        {!canRetry && <span className="text-red-400">已达最大重试次数</span>}
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 text-[12px] rounded-input border border-border text-text-sub hover:bg-bg-tertiary transition-colors"
        >
          取消
        </button>
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="px-2.5 py-1 text-[12px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {isRetrying ? '重试中...' : '重试'}
          </button>
        )}
      </div>
    </div>
  );
};

export default RetryPreviewCard;

// ============================================
// WeaveMD — 改写预览卡片（薄壳）
// ============================================
// 从 rewriteStore 读取状态，error/stale banner 逻辑保留于此，
// diff 渲染委托给 DiffSummaryCard 统一组件。
// 多文件修订详情面板（RewriteDetailModal）保留于此。
//
// R6 更新：DiffSummaryCard 内部 useDiffSummaryHandlers hook 处理
// apply/discard/dismiss + staleness 检测，薄壳不再传递这些回调。
// staleBanner 仍由薄壳显式传递（保证 staleRejected 时初始渲染正确显示）。

import React, { useMemo, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useRewriteStore, type RewriteFileProposal } from '@render/stores/rewriteStore';
import { diffLines } from '@render/filters/rewriteDiff';
import DiffSummaryCard, { type DiffSummarySource } from './DiffSummaryCard';
import RewriteDetailModal from './RewriteDetailModal';
import Icon from '../../Common/Icon';

const RewritePreviewCard: React.FC = () => {
  const { t } = useI18n();
  const pendingRewrite = useRewriteStore((s) => s.pendingRewrite);
  const pendingMultiRewrite = useRewriteStore((s) => s.pendingMultiRewrite);
  const rewriting = useRewriteStore((s) => s.rewriting);
  const rewriteError = useRewriteStore((s) => s.rewriteError);
  const staleRejected = useRewriteStore((s) => s.staleRejected);
  const dismissRewriteBanner = useRewriteStore((s) => s.dismissRewriteBanner);
  const applyFileRewrite = useRewriteStore((s) => s.applyFileRewrite);
  const discardFileRewrite = useRewriteStore((s) => s.discardFileRewrite);
  const applyAllRewrites = useRewriteStore((s) => s.applyAllRewrites);
  const discardAllRewrites = useRewriteStore((s) => s.discardAllRewrites);

  const [showDetailModal, setShowDetailModal] = useState(false);

  // AI 改动说明：有 aiComment 直接用，否则根据 diff 统计自动生成回退文案
  const comment = useMemo(() => {
    if (pendingRewrite?.aiComment) return pendingRewrite.aiComment;
    if (!pendingRewrite) return undefined;
    const { originalMd, rewrittenMd } = pendingRewrite;
    const lines = diffLines(originalMd, rewrittenMd);
    const delCount = lines.filter((l) => l.type === 'del').length;
    const insCount = lines.filter((l) => l.type === 'ins').length;
    if (delCount > 0 && insCount > 0) {
      return `删除了 ${delCount} 行，新增了 ${insCount} 行内容。`;
    }
    if (delCount > 0) {
      return `删除了 ${delCount} 行内容。`;
    }
    if (insCount > 0) {
      return `新增了 ${insCount} 行内容。`;
    }
    return undefined;
  }, [pendingRewrite]);

  // ── 改写进行中 ──
  if (rewriting) {
    return (
      <div className="px-4 py-2 text-[13px] text-text-muted">
        {t('ai.rewrite.rewriting', '正在改写...')}
      </div>
    );
  }

  // ── 无提案提示条（R16） ──
  const banner = (content: React.ReactNode, className: string) => (
    <div
      className={`px-4 py-2 text-[13px] ${className} rounded-md flex items-center justify-between gap-2`}
    >
      <span>{content}</span>
      <button
        type="button"
        aria-label={t('ai.rewrite.dismiss', '关闭')}
        onClick={() => dismissRewriteBanner()}
        className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
      >
        <Icon icon="close" size={15} />
      </button>
    </div>
  );

  if (!pendingRewrite && !pendingMultiRewrite) {
    if (staleRejected) {
      return banner(
        t('ai.rewrite.staleRejected'),
        'text-red-500 bg-red-500/10 border border-red-500/20',
      );
    }
    if (rewriteError === 'no-change') {
      return banner(t('ai.rewrite.noChange'), 'text-text-sub');
    }
    if (rewriteError === 'locate-failed') {
      return banner(
        t('ai.rewrite.locateFailed'),
        'text-amber-600 bg-amber-500/10 border border-amber-500/20',
      );
    }
    if (rewriteError === 'no-document') {
      return banner(
        t('ai.rewrite.noDocument'),
        'text-amber-600 bg-amber-500/10 border border-amber-500/20',
      );
    }
    if (rewriteError) {
      return banner(
        t('ai.rewrite.failure'),
        'text-red-500 bg-red-500/10 border border-red-500/20',
      );
    }
    return null;
  }

  // ── 构建 DiffSummarySource ──
  const source: DiffSummarySource = pendingMultiRewrite
    ? { kind: 'rewrite', data: pendingMultiRewrite }
    : { kind: 'rewrite', data: pendingRewrite! };

  return (
    <>
      <DiffSummaryCard
        source={source}
        staleBanner={staleRejected ? t('ai.rewrite.staleRejected') : null}
        comment={comment}
        onViewDetails={() => setShowDetailModal(true)}
      />

      {/* 详情面板：单文件 / 多文件均支持 */}
      {showDetailModal && (pendingMultiRewrite || pendingRewrite) && (
        <RewriteDetailModal
          files={
            pendingMultiRewrite
              ?? (pendingRewrite
                ? ([{
                    fileName: '当前文档',
                    originalMd: pendingRewrite.originalMd,
                    rewrittenMd: pendingRewrite.rewrittenMd,
                    status: 'pending' as const,
                    contentHash: pendingRewrite.contentHash,
                  }] as RewriteFileProposal[])
                : [])
          }
          onClose={() => setShowDetailModal(false)}
          onApply={(fn) => {
            if (pendingMultiRewrite) {
              applyFileRewrite(fn);
            }
          }}
          onDiscard={(fn) => {
            if (pendingMultiRewrite) {
              discardFileRewrite(fn);
            }
          }}
          onApplyAll={() => {
            if (pendingMultiRewrite) {
              applyAllRewrites();
            } else {
              // 单文件：直接调 applyRewrite（DiffSummaryCard 内部 hook 处理）
              useRewriteStore.getState().applyRewrite();
            }
          }}
          onDiscardAll={() => {
            if (pendingMultiRewrite) {
              discardAllRewrites();
            } else {
              useRewriteStore.getState().clearRewrite();
            }
          }}
        />
      )}
    </>
  );
};

export default RewritePreviewCard;
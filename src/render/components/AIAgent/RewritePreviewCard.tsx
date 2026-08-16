// ============================================
// WeaveMD — 改写预览卡片（第 5 期批次 4）
// ============================================
// 读 rewriteStore.pendingRewrite，展示行级红删绿增 diff（diffLines）+ 改写后整段
// renderAIMarkdownSafe 安全富文本；确认 → applyRewrite（唯一写入点，入 undo 栈），
// 取消 → clearRewrite。各状态提示：rewriting / staleRejected / no-change / locate-failed / failure。
// 无 dangerouslySetInnerHTML（复用 aiMarkdown 白名单渲染）。

import React from 'react';
import { useI18n } from '@render/i18n';
import { useRewriteStore } from '@render/stores/rewriteStore';
import { renderAIMarkdownSafe } from '@render/services/aiMarkdown';
import { diffLines } from '@render/filters/rewriteDiff';

const RewritePreviewCard: React.FC = () => {
  const { t } = useI18n();
  const pendingRewrite = useRewriteStore((s) => s.pendingRewrite);
  const rewriting = useRewriteStore((s) => s.rewriting);
  const rewriteError = useRewriteStore((s) => s.rewriteError);
  const staleRejected = useRewriteStore((s) => s.staleRejected);
  const applyRewrite = useRewriteStore((s) => s.applyRewrite);
  const clearRewrite = useRewriteStore((s) => s.clearRewrite);
  const dismissRewriteBanner = useRewriteStore((s) => s.dismissRewriteBanner);

  // 改写进行中
  if (rewriting) {
    return (
      <div className="px-4 py-2 text-xs text-text-muted">
        {t('ai.rewrite.rewriting', '正在改写...')}
      </div>
    );
  }

  // 无提案提示条统一布局：文案 + 末尾 ✕ dismiss（R16）
  const banner = (content: React.ReactNode, className: string) => (
    <div
      className={`px-4 py-2 text-xs ${className} rounded-md flex items-center justify-between gap-2`}
    >
      <span>{content}</span>
      <button
        type="button"
        aria-label={t('ai.rewrite.dismiss', '关闭')}
        onClick={() => dismissRewriteBanner()}
        className="shrink-0 text-sm leading-none opacity-70 hover:opacity-100 transition-opacity"
      >
        ✕
      </button>
    </div>
  );

  // 无提案时：错误 / 无变化 / 无法定位提示（短暂状态条）
  if (!pendingRewrite) {
    if (staleRejected) {
      return banner(
        t('ai.rewrite.staleRejected'),
        'text-red-500 bg-red-500/10 border border-red-500/20'
      );
    }
    if (rewriteError === 'no-change') {
      return banner(t('ai.rewrite.noChange'), 'text-text-sub');
    }
    if (rewriteError === 'locate-failed') {
      return banner(
        t('ai.rewrite.locateFailed'),
        'text-amber-600 bg-amber-500/10 border border-amber-500/20'
      );
    }
    if (rewriteError === 'no-document') {
      // A1c：整篇写但未打开文档 → 引导先打开文档，不产生空写
      return banner(
        t('ai.rewrite.noDocument'),
        'text-amber-600 bg-amber-500/10 border border-amber-500/20'
      );
    }
    if (rewriteError) {
      return banner(
        t('ai.rewrite.failure'),
        'text-red-500 bg-red-500/10 border border-red-500/20'
      );
    }
    return null;
  }

  // 有提案：预览卡片（stale 时也在卡内显示拒绝提示）
  const { originalMd, rewrittenMd } = pendingRewrite;
  const lines = diffLines(originalMd, rewrittenMd);

  return (
    <div className="mx-3 my-1 rounded-card border border-border bg-bg-tertiary/60 overflow-hidden shadow-sm">
      {staleRejected && (
        <div className="px-3 pt-2 text-[11px] text-red-500">{t('ai.rewrite.staleRejected')}</div>
      )}
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-text-primary">{t('ai.rewrite.previewTitle')}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => clearRewrite()}
            className="text-xs px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
          >
            {t('ai.rewrite.previewCancel')}
          </button>
          <button
            type="button"
            onClick={() => applyRewrite()}
            disabled={staleRejected}
            className="text-xs px-2.5 py-1 rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {t('ai.rewrite.previewConfirm')}
          </button>
        </div>
      </div>

      {/* body：行级红删绿增 diff */}
      <div className="px-3 py-2 font-mono text-xs space-y-0.5 max-h-40 overflow-y-auto bg-bg-primary/60">
        {lines.map((ln, i) => (
          <div
            key={i}
            data-type={ln.type}
            className={[
              'whitespace-pre-wrap px-1 rounded-sm',
              ln.type === 'del' ? 'text-red-500 bg-red-500/10' : '',
              ln.type === 'ins' ? 'text-green-600 bg-green-500/10' : '',
              ln.type === 'same' ? 'text-text-muted' : '',
            ].join(' ')}
          >
            {ln.type === 'del' ? '− ' : ln.type === 'ins' ? '+ ' : '  '}
            {ln.line}
          </div>
        ))}
      </div>

      {/* 改写后整段安全渲染 */}
      <div className="px-3 py-2 border-t border-border text-sm text-text-primary">
        {renderAIMarkdownSafe(rewrittenMd)}
      </div>
    </div>
  );
};

export default RewritePreviewCard;

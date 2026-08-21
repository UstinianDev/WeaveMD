// ============================================
// WeaveMD — 改写预览卡片（第 5 期批次 4）
// ============================================
// 读 rewriteStore.pendingRewrite，展示行级红删绿增 diff（diffLines）+ 改写后整段
// renderAIMarkdownSafe 安全富文本；确认 → applyRewrite（唯一写入点，入 undo 栈），
// 取消 → clearRewrite。各状态提示：rewriting / staleRejected / no-change / locate-failed / failure。
// 无 dangerouslySetInnerHTML（复用 aiMarkdown 白名单渲染）。

import React, { useState } from 'react';
import { useI18n } from '@render/i18n';
import { useRewriteStore } from '@render/stores/rewriteStore';
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

  // R7: diff 折叠状态（默认展开）
  const [diffExpanded, setDiffExpanded] = useState(true);

  // 改写进行中
  if (rewriting) {
    return (
      <div className="px-4 py-2 text-[13px] text-text-muted">
        {t('ai.rewrite.rewriting', '正在改写...')}
      </div>
    );
  }

  // 无提案提示条统一布局：文案 + 末尾 ✕ dismiss（R16）
  const banner = (content: React.ReactNode, className: string) => (
    <div
      className={`px-4 py-2 text-[13px] ${className} rounded-md flex items-center justify-between gap-2`}
    >
      <span>{content}</span>
      <button
        type="button"
        aria-label={t('ai.rewrite.dismiss', '关闭')}
        onClick={() => dismissRewriteBanner()}
        className="shrink-0 text-[15px] leading-none opacity-70 hover:opacity-100 transition-opacity"
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

  // R7: diff 统计
  const delCount = lines.filter((l) => l.type === 'del').length;
  const insCount = lines.filter((l) => l.type === 'ins').length;

  return (
    <div className="mx-3 my-1 rounded-card border border-border bg-bg-tertiary/60 overflow-hidden shadow-sm">
      {staleRejected && (
        <div className="px-3 pt-2 text-[12px] text-red-500">{t('ai.rewrite.staleRejected')}</div>
      )}
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[13px] font-medium text-text-primary">{t('ai.rewrite.previewTitle')}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => clearRewrite()}
            className="text-[13px] px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
          >
            {t('ai.rewrite.previewCancel')}
          </button>
          <button
            type="button"
            onClick={() => applyRewrite()}
            disabled={staleRejected}
            className="text-[13px] px-2.5 py-1 rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {t('ai.rewrite.previewConfirm')}
          </button>
        </div>
      </div>

      {/* R7: diff 区域（可折叠，字体放大） */}
      <div className="border-b border-border">
        <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary/40">
          <span className="text-[13px] font-medium text-text-sub">
            {t('ai.rewrite.diff')}（−{delCount} / +{insCount}）
          </span>
          <button
            type="button"
            onClick={() => setDiffExpanded((prev) => !prev)}
            className="text-[12px] px-2 py-0.5 rounded-input text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            {diffExpanded ? t('ai.rewrite.collapse') : t('ai.rewrite.expand')}
          </button>
        </div>
        {diffExpanded && (
          <div className="px-3 py-2 font-mono text-[15px] space-y-0.5 max-h-60 overflow-y-auto bg-bg-primary/60">
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
        )}
      </div>

      {/* R7: AI 改动说明 */}
      <div className="px-3 py-2 border-t border-border">
        <span className="text-[13px] font-medium text-text-sub">{t('ai.rewrite.aiComment')}</span>
        <p className="text-[14px] text-text-primary mt-1">
          {delCount > 0 && insCount > 0
            ? `删除了 ${delCount} 行，新增了 ${insCount} 行内容。`
            : delCount > 0
              ? `删除了 ${delCount} 行内容。`
              : insCount > 0
                ? `新增了 ${insCount} 行内容。`
                : '无变化。'}
        </p>
      </div>
    </div>
  );
};

export default RewritePreviewCard;

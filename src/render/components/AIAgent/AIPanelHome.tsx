// ============================================
// WeaveMD — AI 面板主界面 home 视图（R2~R6）
// ============================================
// 居中大图标 + "What can I do for you?" + RECENT 区块（左标题/右 View All>）
// + 最近 3 会话（updatedAt 倒序，标题=summary 或模式兜底，日期=月/日）+ 空态 +
// 底部共享 AIPanelComposer（发送即自动建会话并入 session 视图）。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useMemo } from 'react';
import type { IAIConversation } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAgentStore } from '@render/stores/agentStore';
import AIPanelComposer from './AIPanelComposer';

interface AIPanelHomeProps {
  /** 点击最近会话 → loadConversation + 进 session 视图。 */
  onOpenConversation: (id: string) => void;
  /** RECENT「View All」→ 全部会话列表视图（此处暂进 home 全列，范围外分页）——需求 R4 仅列出即可。 */
  onViewAll: () => void;
  /** home 发送后自动建会话并入 session 视图。 */
  onCreateSession: () => void;
}

/** 最近会话按 updatedAt 倒序取前 3 项。export 供测试/CSS 覆写。 */
export function recentConversations(list: IAIConversation[], limit = 3): IAIConversation[] {
  return [...list]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, limit);
}

/** 日期 yyyy-MM-dd → 「M月D日」（如 7月28日）；解析失败原样返回。 */
export function formatRecentDate(iso: string | undefined, t: (key: string, fb?: string) => string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return t('ai.home.date', `${d.getMonth() + 1}月${d.getDate()}日`)
    .split('{m}')
    .join(String(d.getMonth() + 1))
    .split('{d}')
    .join(String(d.getDate()));
}

const AIPanelHome: React.FC<AIPanelHomeProps> = ({
  onOpenConversation,
  onViewAll,
  onCreateSession,
}) => {
  const { t } = useI18n();
  const activeMode = useAgentStore((s) => s.activeMode);
  const conversations = useAgentStore((s) => s.conversations);

  const recent = useMemo(() => recentConversations(conversations), [conversations]);

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <div className="chat-scroll flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {/* 居中大图标 + 文案（R2/R3） */}
        <div className="flex flex-col items-center text-center pt-4 space-y-2">
          <span className="text-5xl" aria-hidden>
            📔
          </span>
          <p className="text-base font-medium text-text-primary">{t('ai.home.cta')}</p>
        </div>

        {/* RECENT 区块（R4/R5） */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t('ai.home.recent')}
            </span>
            <button
              type="button"
              onClick={onViewAll}
              className="text-xs text-text-muted hover:text-[var(--accent)] transition-colors"
            >
              {t('ai.home.viewAll')}{' '}
              <span aria-hidden>
                {t('ai.home.viewAllArrow', '>')}
              </span>
            </button>
          </div>

          {recent.length === 0 ? (
            <p className="text-sm text-text-muted py-6 text-center">{t('ai.home.noRecent')}</p>
          ) : (
            <div className="space-y-1.5">
              {recent.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid="home-recent-item"
                  onClick={() => onOpenConversation(c.id)}
                  className="block w-full text-left rounded-card border border-border bg-bg-secondary/40 px-3 py-2 hover:border-[var(--accent)] hover:bg-bg-tertiary transition-colors"
                >
                  <span className="block truncate text-sm text-text-primary">
                    {c.summary || (activeMode === 'agent' ? t('ai.tab.agent') : t('ai.tab.chat'))}
                  </span>
                  <span className="block text-xs text-text-muted mt-0.5">
                    {formatRecentDate(c.updatedAt, t)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部共享 composer：发送即建会话并入 session（onCreateSession） */}
      <AIPanelComposer onCompose={onCreateSession} />
    </div>
  );
};

export default AIPanelHome;

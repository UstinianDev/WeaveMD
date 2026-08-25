// ============================================
// WeaveMD — AI 面板主界面 home 视图（R2~R6）
// ============================================
// 居中大图标 + "What can I do for you?" + RECENT 区块（左标题/右 View All>）
// + 最近 3 会话（updatedAt 倒序，标题=summary 或模式兜底，日期=月/日）+ 空态 +
// 底部共享 AIPanelComposer（发送即自动建会话并入 session 视图）。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useCallback, useMemo, useState } from 'react';
import type { IAIConversation } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAgentStore } from '@render/stores/agentStore';
import AIPanelComposer from './AIPanelComposer';

interface AIPanelHomeProps {
  /** 受控草稿（M4）：由 AIAgentPanel 持有，home 与 session 共享。 */
  draft: string;
  /** 受控草稿变更回调。 */
  setDraft: (value: string) => void;
  /** 发送成功后清空草稿 + 清除 IndexedDB 记录（R6）。 */
  onSend?: () => void;
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
  draft,
  setDraft,
  onSend,
  onOpenConversation,
  onViewAll,
  onCreateSession,
}) => {
  const { t } = useI18n();
  const activeMode = useAgentStore((s) => s.activeMode);
  const conversations = useAgentStore((s) => s.conversations);
  const deleteConversation = useAgentStore((s) => s.deleteConversation);

  // 阶段 2：对话搜索
  const [searchQuery, setSearchQuery] = useState('');

  // 按搜索词过滤会话（匹配 summary）
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) =>
      (c.summary ?? '').toLowerCase().includes(q)
    );
  }, [conversations, searchQuery]);

  const recent = useMemo(() => recentConversations(filteredConversations), [filteredConversations]);

  // R1: 删除会话（确认后删除）
  const handleDelete = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
      e.stopPropagation();
      if (window.confirm(t('ai.home.deleteConfirm'))) {
        void deleteConversation(id);
      }
    },
    [deleteConversation, t]
  );

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

        {/* 阶段 2：对话搜索框 */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('ai.home.searchPlaceholder', '搜索会话...')}
            className="w-full bg-bg-primary border border-border rounded-input px-3 py-1.5 text-[13px] text-text-primary placeholder-text-muted outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {/* RECENT 区块（R4/R5） */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold uppercase tracking-wide text-text-muted">
              {t('ai.home.recent')}
            </span>
            <button
              type="button"
              onClick={onViewAll}
              className="text-[13px] text-text-muted hover:text-[var(--accent)] transition-colors"
            >
              {t('ai.home.viewAll')}{' '}
              <span aria-hidden>
                {t('ai.home.viewAllArrow', '>')}
              </span>
            </button>
          </div>

          {recent.length === 0 ? (
            <p className="text-[15px] text-text-muted py-6 text-center">{t('ai.home.noRecent')}</p>
          ) : (
            <div className="space-y-1.5">
              {recent.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid="home-recent-item"
                  onClick={() => onOpenConversation(c.id)}
                  className="flex items-center w-full text-left rounded-card border border-border bg-bg-secondary/40 px-3 py-2 hover:border-[var(--accent)] hover:bg-bg-tertiary transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <span className="block truncate text-[15px] text-text-primary">
                      {c.summary || (activeMode === 'agent' ? t('ai.tab.agent') : t('ai.tab.chat'))}
                    </span>
                    <span className="block text-[13px] text-text-muted mt-0.5">
                      {formatRecentDate(c.updatedAt, t)}
                    </span>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    data-testid="home-recent-delete"
                    title={t('ai.home.delete')}
                    onClick={(e) => handleDelete(e, c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleDelete(e, c.id); }}
                    className="shrink-0 w-6 h-6 flex items-center justify-center text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                  >
                    🗑
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部共享 composer：发送即清空草稿（R6: + 清除 IndexedDB）+ 建会话并入 session（onCreateSession） */}
      <AIPanelComposer
        value={draft}
        onChange={setDraft}
        onSend={onSend}
        onCompose={onCreateSession}
      />
    </div>
  );
};

export default AIPanelHome;

// ============================================
// WeaveMD — @ Mention 三维补全列表
// ============================================
// 输入 @ 弹出文件/目录/技能三维补全列表。
// 替代原有 CompletionMenu 中 @ 分支，支持文件和目录引用。
// 键盘导航：↑↓ 选择，Enter 确认，Esc 关闭。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentSkillInfo, IMentionItem } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';

interface MentionListProps {
  open: boolean;
  query: string;
  onSelect: (item: IMentionItem) => void;
  onClose: () => void;
}

/** 从文件列表 API 获取文件/目录 mention 项。 */
async function fetchMentionItems(userId: string): Promise<IMentionItem[]> {
  try {
    const fileRes = await window.weaveMD?.file.list(userId);
    if (!fileRes || !(fileRes as { success: boolean; data?: unknown[] }).success) return [];
    const files = (fileRes as { success: boolean; data: Array<{ id: string; name: string }> }).data;
    return files.map((f) => ({
      type: 'file' as const,
      id: f.id,
      name: f.name,
      path: f.name,
      description: `文件: ${f.name}`,
    }));
  } catch {
    return [];
  }
}

/** 从技能列表 API 获取技能 mention 项。 */
async function fetchSkillItems(userId: string): Promise<IMentionItem[]> {
  try {
    const res = await window.weaveMD?.ai.listSkills(userId);
    if (!res?.success || !res.data) return [];
    return res.data.map((s: AgentSkillInfo) => ({
      type: 'skill' as const,
      id: s.name,
      name: s.name,
      description: s.description,
    }));
  } catch {
    return [];
  }
}

const MentionList: React.FC<MentionListProps> = ({ open, query, onSelect, onClose }) => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const [items, setItems] = useState<IMentionItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 加载文件和技能数据
  useEffect(() => {
    if (!open) return;
    const userId = user?.id ?? '';
    if (!userId) return;

    const load = async (): Promise<void> => {
      const [fileItems, skillItems] = await Promise.all([
        fetchMentionItems(userId),
        fetchSkillItems(userId),
      ]);
      // 文件 + 技能（目录暂不支持，后续可扩展）
      setItems([...fileItems, ...skillItems]);
    };
    void load();
  }, [open, user?.id]);

  // 按 query 过滤
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.description ?? '').toLowerCase().includes(q) ||
        (it.path ?? '').toLowerCase().includes(q)
    );
  }, [items, query]);

  // 重置 activeIndex
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[activeIndex];
        if (item) onSelect(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [open, filtered, activeIndex, onSelect, onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, handleKeyDown]);

  // 滚动到可见区域
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open || filtered.length === 0) return null;

  /** 类型图标。 */
  const getTypeIcon = (type: IMentionItem['type']): string => {
    switch (type) {
      case 'file': return '📄';
      case 'folder': return '📁';
      case 'skill': return '⚡';
    }
  };

  /** 类型标签颜色。 */
  const getTypeColor = (type: IMentionItem['type']): string => {
    switch (type) {
      case 'file': return 'text-blue-400';
      case 'folder': return 'text-yellow-400';
      case 'skill': return 'text-purple-400';
    }
  };

  return (
    <div
      ref={listRef}
      className="absolute left-0 bottom-full mb-1 z-50 max-h-60 w-72 overflow-y-auto rounded-card border border-border bg-bg-secondary shadow-dropdown"
      role="listbox"
      aria-label={t('ai.mention.title', '@ 引用')}
    >
      <div className="px-3 pt-2 pb-1 text-[11px] text-text-muted font-medium">
        {t('ai.mention.title', '@ 引用')}
      </div>
      {filtered.map((item, idx) => (
        <button
          key={`${item.type}-${item.id}`}
          type="button"
          role="option"
          aria-selected={idx === activeIndex}
          onClick={() => onSelect(item)}
          className={`flex items-center gap-2 w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
            idx === activeIndex
              ? 'bg-[var(--accent)]/15 text-text-primary'
              : 'text-text-sub hover:bg-bg-tertiary'
          }`}
        >
          <span className="text-[14px] leading-none">{getTypeIcon(item.type)}</span>
          <div className="flex-1 min-w-0">
            <div className="truncate font-medium">{item.name}</div>
            {item.description && (
              <div className={`truncate text-[11px] ${getTypeColor(item.type)}`}>
                {item.description}
              </div>
            )}
          </div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${getTypeColor(item.type)} bg-bg-tertiary`}>
            {item.type === 'file' ? '文件' : item.type === 'folder' ? '目录' : '技能'}
          </span>
        </button>
      ))}
    </div>
  );
};

export default MentionList;

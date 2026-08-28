// ============================================
// WeaveMD — @ Mention 三维补全列表
// ============================================
// 输入 @ 弹出文件/目录/技能三维补全列表。
// 替代原有 CompletionMenu 中 @ 分支，支持文件和目录引用。
// 键盘导航：↑↓ 选择，Enter 确认，Esc 关闭。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IMentionItem } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useFileTreeStore, type IFolderNode } from '@render/stores/fileTreeStore';
import Icon from '../Common/Icon';

interface MentionListProps {
  open: boolean;
  query: string;
  onSelect: (item: IMentionItem) => void;
  onClose: () => void;
}

/** 递归扁平化文件夹树为 IMentionItem[]。 */
function flattenFolders(nodes: IFolderNode[]): IMentionItem[] {
  const result: IMentionItem[] = [];
  for (const n of nodes) {
    if (n.isDirectory) {
      result.push({
        type: 'folder',
        id: n.id,
        name: n.name,
        path: n.path,
        description: `目录: ${n.name}`,
      });
    }
    if (n.children.length > 0) {
      result.push(...flattenFolders(n.children));
    }
  }
  return result;
}


const MentionList: React.FC<MentionListProps> = ({ open, query, onSelect, onClose }) => {
  const { t } = useI18n();
  const looseFiles = useFileTreeStore((s) => s.looseFiles);
  const folders = useFileTreeStore((s) => s.folders);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 从 store 实时同步当前目录文件区（排除欢迎文档）+ 文件夹
  const items = useMemo<IMentionItem[]>(() => {
    const fileItems: IMentionItem[] = looseFiles
      .filter((f) => !f.id.startsWith('welcome://'))
      .map((f) => ({
        type: 'file' as const,
        id: f.id,
        name: f.name,
        path: f.path,
        description: `文件: ${f.name}`,
      }));
    const folderItems = flattenFolders(folders);
    return [...fileItems, ...folderItems];
  }, [looseFiles, folders]);

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

  /** 类型 Iconify 图标。 */
  const getTypeIconify = (type: IMentionItem['type']): string => {
    switch (type) {
      case 'file': return 'file-outline';
      case 'folder': return 'folder-outline';
      case 'skill': return 'lightning';
    }
  };

  /** 类型图标背景色。 */
  const getTypeBg = (type: IMentionItem['type']): string => {
    switch (type) {
      case 'file': return 'bg-[#2563eb]/10 text-[#2563eb]';
      case 'folder': return 'bg-amber-500/10 text-amber-500';
      case 'skill': return 'bg-emerald-500/10 text-emerald-500';
    }
  };

  /** 类型标签颜色。 */
  const getTypeColor = (type: IMentionItem['type']): string => {
    switch (type) {
      case 'file': return 'text-[#2563eb]';
      case 'folder': return 'text-amber-500';
      case 'skill': return 'text-emerald-500';
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
          className={`flex items-center gap-2.5 w-full text-left px-3 py-2 text-[13px] transition-colors ${
            idx === activeIndex
              ? 'bg-[var(--accent)]/10 text-text-primary'
              : 'text-text-sub hover:bg-bg-tertiary'
          }`}
        >
          <span className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${getTypeBg(item.type)}`}>
            <Icon icon={getTypeIconify(item.type)} size={14} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="truncate font-medium">{item.name}</div>
            {item.description && (
              <div className="truncate text-[11px] text-text-muted">
                {item.description}
              </div>
            )}
          </div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getTypeColor(item.type)} bg-bg-tertiary`}>
            {item.type === 'file' ? '文件' : item.type === 'folder' ? '目录' : '技能'}
          </span>
        </button>
      ))}
    </div>
  );
};

export default MentionList;

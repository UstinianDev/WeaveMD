// ============================================
// WeaveMD — @mention 补全下拉列表组件（TipTap Suggestion 渲染）
// ============================================
// 由 mentionSuggestion.ts 的 ReactRenderer 挂载，
// 显示文件/文件夹列表，支持键盘导航和选中。

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { MdOutlineFilePresent, MdOutlineFolder } from 'react-icons/md';
import type { MentionOption } from './mentionSuggestion';

interface MentionSuggestionListProps {
  items: MentionOption[];
  command: (item: MentionOption) => void;
}

export interface MentionSuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const MentionSuggestionList = forwardRef<MentionSuggestionListRef, MentionSuggestionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }): boolean => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) return null;

    const getTypeBg = (type: MentionOption['type']): string =>
      type === 'folder'
        ? 'bg-amber-500/10 text-amber-500'
        : 'bg-[var(--accent)]/10 text-[var(--accent)]';

    return (
      <div
        ref={listRef}
        className="w-72 max-h-60 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-[var(--shadow-dropdown)] py-1"
        role="listbox"
      >
        <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          @ 引用
        </div>
        {items.map((item, idx) => (
          <button
            key={`${item.type}-${item.id}`}
            type="button"
            role="option"
            aria-selected={idx === selectedIndex}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(idx)}
            className={`flex items-center gap-2.5 w-full text-left px-3 py-2 text-[13px] transition-colors ${
              idx === selectedIndex
                ? 'bg-[var(--accent)]/10 text-[var(--text-primary)]'
                : 'text-[var(--text-sub)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            <span className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${getTypeBg(item.type)}`}>
              {item.type === 'folder' ? <MdOutlineFolder size={14} /> : <MdOutlineFilePresent size={14} />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium">{item.name}</div>
              {item.description && (
                <div className="truncate text-[11px] text-[var(--text-muted)]">{item.description}</div>
              )}
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getTypeBg(item.type)} bg-[var(--bg-tertiary)]`}>
              {item.type === 'folder' ? '目录' : '文件'}
            </span>
          </button>
        ))}
      </div>
    );
  },
);

MentionSuggestionList.displayName = 'MentionSuggestionList';

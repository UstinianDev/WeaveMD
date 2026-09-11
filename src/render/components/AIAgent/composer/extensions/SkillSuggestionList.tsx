// ============================================
// WeaveMD — /skill 补全下拉列表组件（TipTap Suggestion 渲染）
// ============================================
// 由 skillSuggestion.ts 的 ReactRenderer 挂载，
// 显示技能列表，支持键盘导航和选中。

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import type { AgentSkillInfo } from '@shared/ai';
import { MdOutlineElectricBolt } from 'react-icons/md';

interface SkillSuggestionListProps {
  items: AgentSkillInfo[];
  command: (item: AgentSkillInfo) => void;
}

export interface SkillSuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SkillSuggestionList = forwardRef<SkillSuggestionListRef, SkillSuggestionListProps>(
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

    return (
      <div
        ref={listRef}
        className="w-64 max-h-56 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-[var(--shadow-dropdown)] py-1"
        role="listbox"
      >
        <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          技能
        </div>
        {items.map((item, idx) => (
          <button
            key={item.name}
            type="button"
            role="option"
            aria-selected={idx === selectedIndex}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(idx)}
            className={`flex items-start gap-2.5 w-full text-left px-3 py-2 text-[13px] transition-colors ${
              idx === selectedIndex
                ? 'bg-[var(--accent)]/10 text-[var(--text-primary)]'
                : 'text-[var(--text-sub)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            <span className="shrink-0 mt-0.5 w-6 h-6 rounded-md flex items-center justify-center bg-[var(--accent)]/10 text-[var(--accent)]">
              <MdOutlineElectricBolt size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">/{item.name}</span>
              {item.description && (
                <span className="block text-[11px] text-[var(--text-muted)] truncate mt-0.5">{item.description}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    );
  },
);

SkillSuggestionList.displayName = 'SkillSuggestionList';

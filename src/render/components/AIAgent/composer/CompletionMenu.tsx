// ============================================
// WeaveMD — Composer 自动补全菜单（第 7 期 B1）
// ============================================
// 输入 `/`（运行技能）或 `@`（引用目标）时，在 composer textarea 上方弹出。
// 纯展示 + 键盘/外部点击协议：↑/↓ 由父级（AgentTab textarea onKeyDown）驱动 active，
// Enter 确认、Esc 关闭、点击外部关闭由本组件在 document 上监听处理；
// 选中回调（onSelect）与关闭回调（onClose）均由父级注入，本组件无业务耦合。

import React, { useEffect, useRef } from 'react';
import Icon from '../../Common/Icon';

/** 补全菜单项：label/description 供展示，value 唯一，insertText 为注入 composer 的前缀文本。 */
export interface CompletionMenuItem {
  value: string;
  label: string;
  description?: string;
  insertText: string;
}

export interface CompletionMenuProps {
  open: boolean;
  /** 触发补全的前缀字符。 */
  trigger: '/' | '@';
  /** 菜单标题（i18n 由父级注入）。 */
  title: string;
  items: CompletionMenuItem[];
  /** 当前高亮项下标（父级维护）。 */
  activeIndex: number;
  /** 键盘 ↑/↓ 移动（dir: -1 上 / 1 下，父级做循环取模）。 */
  onMove: (dir: 1 | -1) => void;
  /** 确认选中菜单项。 */
  onSelect: (item: CompletionMenuItem) => void;
  /** 关闭菜单（Esc / 外部点击）。 */
  onClose: () => void;
}

const CompletionMenu: React.FC<CompletionMenuProps> = ({
  open,
  trigger,
  title,
  items,
  activeIndex,
  onMove,
  onSelect,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // 键盘导航：↑/↓ 移动、Enter 确认、Esc 关闭（document 级监听，焦点保持在 textarea）
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onMove(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onMove(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const active = items[activeIndex];
        if (active) onSelect(active);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    // 点击外部关闭（mousedown，含菜单自身点击的回退入口统一由父级 onSelect 处理）
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // capture 阶段监听：优先于 textarea 的上屏/发送处理（React 事件委托在 root，document capture 在其前触发）
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [open, items, activeIndex, onMove, onSelect, onClose]);

  if (!open || items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      role="listbox"
      data-testid="completion-menu"
      className="absolute left-0 bottom-full mb-1 w-full z-50 rounded-card border border-border bg-bg-secondary shadow-dropdown py-1 max-h-56 overflow-y-auto"
    >
      <div className="px-3 pt-1.5 pb-1 text-[12px] font-medium uppercase tracking-wide text-text-muted">{title}</div>
      {items.map((item, idx) => {
        const isActive = idx === activeIndex;
        return (
          <button
            key={item.value}
            type="button"
            role="option"
            aria-current={isActive}
            data-value={item.value}
            onMouseDown={(e) => {
              e.preventDefault(); // 保持 textarea 焦点，防止 blur 触发外部点击关闭
            }}
            onClick={() => onSelect(item)}
            className={`flex items-start gap-2.5 w-full text-left px-3 py-2 text-[14px] transition-colors ${
              isActive
                ? 'bg-[var(--accent)]/10 text-text-primary'
                : 'text-text-sub hover:bg-bg-tertiary'
            }`}
          >
            <span className="shrink-0 mt-0.5 w-6 h-6 rounded-md flex items-center justify-center bg-[var(--accent)]/10 text-[var(--accent)]">
              <Icon icon={trigger === '/' ? 'lightning' : 'globe'} size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{item.label}</span>
              {item.description && (
                <span className="block text-[12px] text-text-muted truncate mt-0.5">{item.description}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default CompletionMenu;

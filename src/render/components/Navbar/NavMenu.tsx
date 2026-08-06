// ============================================
// WeaveMD — Navbar Menu Wrapper
// ============================================
// 统一导航栏菜单的 trigger 样式与 Dropdown 组装，
// 消除各菜单组件重复的 trigger JSX。

import React from 'react';
import { useI18n } from '../../i18n';
import Dropdown, { type DropdownItem } from '../Common/Dropdown';

interface NavMenuProps {
  /** i18n key，渲染为 "文件 ▾"；与 trigger 二选一 */
  label?: string;
  /** 自定义触发器内容（如 MoreMenu 的 ⋮） */
  trigger?: React.ReactNode;
  items: DropdownItem[];
  width?: number;
  position?: 'bottom-left' | 'bottom-right';
  /** 附加到统一 trigger span 的类名 */
  triggerClassName?: string;
}

const NavMenu: React.FC<NavMenuProps> = ({
  label,
  trigger,
  items,
  width = 200,
  position,
  triggerClassName = '',
}) => {
  const { t } = useI18n();
  const content = trigger ?? (label ? <>{t(label)} ▾</> : null);

  return (
    <Dropdown
      trigger={
        <span
          className={`navbar-menu-trigger text-[var(--navbar-text-primary,#FFFFFF)] hover:text-[var(--accent)] transition-colors cursor-pointer select-none ${triggerClassName}`}
        >
          {content}
        </span>
      }
      items={items}
      width={width}
      position={position}
    />
  );
};

export default NavMenu;

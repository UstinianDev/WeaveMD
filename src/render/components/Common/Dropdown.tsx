// ============================================
// WeaveMD — Reusable Dropdown Component
// ============================================

import React, { useState, useRef, useEffect } from 'react';

export interface DropdownItem {
  label?: string;
  onClick?: () => void;
  type?: 'item' | 'divider' | 'submenu';
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  children?: DropdownItem[];
}

interface DropdownProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  position?: 'bottom-left' | 'bottom-right';
  width?: number;
}

const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  items,
  position = 'bottom-left',
  width = 200,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const positionClass = position === 'bottom-right' ? 'right-0' : 'left-0';

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
        {trigger}
      </div>

      {isOpen && (
        <div
          className={`no-drag absolute ${positionClass} top-full mt-1 border rounded-[8px] shadow-dropdown z-50 py-1 overflow-hidden`}
          data-dropdown-panel
          style={{
            width: `${width}px`,
            backgroundColor: 'var(--bg-secondary)',
            borderColor: 'var(--border-color)',
          }}
        >
          {items.map((item, index) => {
            if (item.type === 'divider') {
              return (
                <div
                  key={index}
                  className="h-px my-1"
                  style={{ backgroundColor: 'var(--border-color)' }}
                />
              );
            }

            return (
              <button
                key={index}
                onClick={() => {
                  if (!item.disabled && item.onClick) {
                    item.onClick();
                    if (!item.children) setIsOpen(false);
                  }
                }}
                disabled={item.disabled}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors duration-150"
                style={{
                  color: item.danger ? '#EF4444' : 'var(--text-primary)',
                  opacity: item.disabled ? 0.4 : 1,
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled) {
                    e.currentTarget.style.backgroundColor = item.danger
                      ? 'rgba(239, 68, 68, 0.1)'
                      : 'var(--bg-tertiary)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {item.icon && (
                  <span
                    className="w-4 h-4 flex items-center justify-center"
                    style={{ color: 'var(--text-sub)' }}
                  >
                    {item.icon}
                  </span>
                )}
                <span className="flex-1 text-left">{item.label}</span>
                {item.shortcut && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {item.shortcut}
                  </span>
                )}
                {item.children && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Dropdown;

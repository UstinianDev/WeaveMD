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
          className={`absolute ${positionClass} top-full mt-1 bg-[#1A1A1A] border border-[#2D2D2D] rounded-[8px] shadow-dropdown z-50 py-1 overflow-hidden`}
          style={{ width: `${width}px` }}
        >
          {items.map((item, index) => {
            if (item.type === 'divider') {
              return <div key={index} className="h-px bg-[#2D2D2D] my-1" />;
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
                className={`
                  w-full flex items-center gap-3 px-3 py-2 text-sm
                  transition-colors duration-150
                  ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                  ${item.danger ? 'text-red-400 hover:bg-red-400/10' : 'text-[#FFFFFF] hover:bg-[#2D2D2D]'}
                `}
              >
                {item.icon && <span className="w-4 h-4 flex items-center justify-center text-[#999999]">{item.icon}</span>}
                <span className="flex-1 text-left">{item.label}</span>
                {item.shortcut && (
                  <span className="text-xs text-[#666666]">{item.shortcut}</span>
                )}
                {item.children && (
                  <span className="text-[#666666]">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

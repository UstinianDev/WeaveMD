// ============================================
// WeaveMD — Icon Button（通用图标按钮）
// ============================================

import React from 'react';

interface IconButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

const IconButton: React.FC<IconButtonProps> = ({
  onClick,
  disabled = false,
  title,
  className = '',
  children,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-8 h-8 flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${className}`}
    style={{ color: 'var(--navbar-text-sub, #999999)' }}
    title={title}
  >
    {children}
  </button>
);

export default IconButton;

// ============================================
// WeaveMD Editor v2 — 工具栏按钮（共享）
// ============================================
// CHAR / OBJECT / 橡皮擦 / 图片工具栏 共用（SPEC-EDIT-FT2 4.6）。
// active 时 accent 色 + bg-tertiary 驻留；hover 进 bg-tertiary；disabled 点击 no-op。
// 从 FloatingToolbar.tsx / ImageToolbar.tsx 提取，消除两处重复定义（SPEC-REFACTOR）。
// 注意：active/hover 色由内联 style 驱动（FloatingToolbarV2 测试断言
// style.color === 'var(--accent)'），重构时不得改为纯 CSS 类。

import React from 'react';

export interface ToolbarButtonProps {
  title: string;
  label: string;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  onClick: () => void;
}

function ToolbarButton({
  title,
  label,
  className,
  active = false,
  disabled = false,
  testId,
  onClick,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      data-testid={testId}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      className={'ft-btn ' + (className ?? '') + (active ? ' active' : '')}
      style={{
        color: active ? 'var(--accent)' : 'var(--text-sub)',
        backgroundColor: active ? 'var(--bg-tertiary)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = active ? 'var(--bg-tertiary)' : 'transparent';
      }}
    >
      {label}
    </button>
  );
}

export default ToolbarButton;

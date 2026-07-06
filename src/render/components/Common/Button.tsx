// ============================================
// WeaveMD — Reusable Button Component
// ============================================

import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  type?: 'button' | 'submit';
  className?: string;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[#7C3AED] text-white hover:bg-[#6D28D9] active:bg-[#5B21B6] border-transparent',
  secondary:
    'bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:brightness-110 active:brightness-125 border-transparent',
  ghost:
    'bg-transparent text-[var(--text-sub)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] active:brightness-110 border-transparent',
  danger:
    'bg-red-600/20 text-red-400 hover:bg-red-600/30 active:bg-red-600/40 border-red-600/30 hover:border-red-500',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-[6px]',
  md: 'h-10 px-4 text-sm rounded-input',
  lg: 'h-11 px-6 text-base rounded-input',
};

const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  type = 'button',
  className = '',
}) => {
  return (
    <button
      type={type}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-2
        font-medium border
        transition-all duration-150
        select-none outline-none
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${fullWidth ? 'w-full' : ''}
        ${disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary
        ${className}
      `}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
};

export default Button;

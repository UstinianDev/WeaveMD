// ============================================
// WeaveMD — Reusable Input Component
// ============================================

import React, { useState } from 'react';

interface InputProps {
  label?: string;
  type?: 'text' | 'password' | 'email' | 'number';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  showPasswordToggle?: boolean;
  rightIcon?: React.ReactNode;
  onRightIconClick?: () => void;
  leftIcon?: React.ReactNode;
  className?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** 显示密码开关变化回调（visible=true 表示密码可见），供四小人物"偷看"动画驱动。 */
  onVisibilityToggle?: (visible: boolean) => void;
}

const Input: React.FC<InputProps> = ({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  hint,
  disabled = false,
  autoFocus = false,
  showPasswordToggle = false,
  rightIcon,
  onRightIconClick,
  leftIcon,
  className = '',
  onFocus,
  onBlur,
  onKeyDown,
  onVisibilityToggle,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const inputType =
    showPasswordToggle && type === 'password' ? (showPassword ? 'text' : 'password') : type;

  const isPassword = showPasswordToggle && type === 'password';

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label className="text-sm text-text-sub font-medium" style={{ fontFamily: 'Consolas, monospace' }}>{label}</label>}

      <div
        className={`
          relative flex items-center h-12 rounded-input border
          transition-colors duration-150
          ${isFocused ? 'border-accent shadow-[0_0_0_2px_rgba(124,58,237,0.2)]' : 'border-border'}
          ${error ? 'border-red-500' : ''}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          bg-[var(--input-bg,#0F0F0F)]
        `}
      >
        {leftIcon && <span className="pl-3 text-text-sub flex-shrink-0">{leftIcon}</span>}

        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => {
            setIsFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setIsFocused(false);
            onBlur?.();
          }}
          onKeyDown={onKeyDown}
          className="
            flex-1 h-full bg-transparent text-base text-text-primary
            placeholder-text-muted px-4 outline-none
            disabled:cursor-not-allowed
            font-sans
          "
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => {
              const next = !showPassword;
              setShowPassword(next);
              onVisibilityToggle?.(next);
            }}
            className="pr-3 text-text-sub hover:text-text-primary transition-colors flex-shrink-0"
            tabIndex={-1}
          >
            {showPassword ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
        )}

        {rightIcon && !isPassword && (
          <button
            type="button"
            onClick={onRightIconClick}
            className="pr-3 text-text-sub hover:text-text-primary transition-colors flex-shrink-0"
            tabIndex={-1}
          >
            {rightIcon}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-400" style={{ fontFamily: 'Consolas, monospace' }}>{error}</p>}
      {hint && !error && <p className="text-sm text-text-muted" style={{ fontFamily: 'Consolas, monospace' }}>{hint}</p>}
    </div>
  );
};

export default Input;

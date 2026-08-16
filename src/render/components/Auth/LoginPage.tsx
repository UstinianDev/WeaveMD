// ============================================
// WeaveMD — Login Page Component
// Right-side form with mascot interaction support
// ============================================

import React, { useState, useRef, useEffect } from 'react';
import Input from '@render/components/Common/Input';
import Button from '@render/components/Common/Button';
import { useAuthStore } from '@render/stores/authStore';
import { useI18n } from '@render/i18n';
import {
  getRememberedCredentials,
  saveRememberedCredentials,
  clearRememberedCredentials,
} from '@render/utils/crypto';
import type { IpcResponse, LoginResponse } from '@shared/types';
import type { MascotState } from './InteractiveMascot';

interface LoginPageProps {
  onSwitchToRegister: () => void;
  onCreateNewAccount: () => void;
  prefillUsername?: string;
  onMascotStateChange: (state: MascotState) => void;
  onPasswordVisibleChange: (visible: boolean) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({
  onSwitchToRegister,
  onCreateNewAccount,
  prefillUsername,
  onMascotStateChange,
  onPasswordVisibleChange,
}) => {
  const { t } = useI18n();
  const [username, setUsername] = useState(prefillUsername || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const login = useAuthStore((s) => s.login);
  const recentAccounts = useAuthStore((s) => s.recentAccounts);
  const loadRecentAccounts = useAuthStore((s) => s.loadRecentAccounts);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadRecentAccounts();

    const remembered = getRememberedCredentials();
    if (remembered) {
      setUsername(remembered.username);
      setPassword(remembered.password);
      setRememberMe(true);
    }
  }, [loadRecentAccounts]);

  // Update mascot state based on focus and typing
  useEffect(() => {
    if (error) {
      onMascotStateChange('error');
    } else if (focusedField === 'username' && username.length > 0) {
      onMascotStateChange('typing');
    } else if (focusedField === 'username') {
      onMascotStateChange('focus-username');
    } else if (focusedField === 'password') {
      onMascotStateChange('focus-password');
    } else {
      onMascotStateChange('idle');
    }
  }, [focusedField, username, error, onMascotStateChange]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSubmit = async () => {
    setError('');

    if (!username.trim()) {
      setError(t('auth.enterUsernameRequired'));
      onMascotStateChange('error');
      return;
    }
    if (!password) {
      setError(t('auth.enterPasswordRequired'));
      onMascotStateChange('error');
      return;
    }

    setLoading(true);
    onMascotStateChange('hover-submit');
    try {
      const result = (await window.weaveMD.auth.login(
        username.trim(),
        password,
        rememberMe
      )) as IpcResponse<LoginResponse>;

      if (result.success && result.data) {
        const { token, user } = result.data;

        if (rememberMe) {
          saveRememberedCredentials(username.trim(), password);
        } else {
          clearRememberedCredentials();
        }

        onMascotStateChange('success');
        // Brief delay to show success state before navigating
        await new Promise((r) => setTimeout(r, 600));
        login(user, token);
      } else {
        setError(t('auth.loginError', result.message || 'Login failed'));
        onMascotStateChange('error');
      }
    } catch {
      setError(t('auth.connectionError'));
      onMascotStateChange('error');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRecent = (account: string) => {
    setUsername(account);
    setPassword('');
    setShowDropdown(false);
    setError('');
    setTimeout(() => {
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
      passwordInput?.focus();
    }, 50);
  };

  return (
    <div className="w-full max-w-[380px]">
      {/* Logo & Header */}
      <div className="mb-8">
        <span className="text-3xl">📔</span>
        <h1 className="text-2xl font-bold text-gray-900 mt-3">{t('app.name')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('auth.welcome')}</p>
        <p className="text-xs text-gray-400 mt-0.5">{t('auth.signInPrompt')}</p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Username with dropdown */}
      <div className="relative mb-4" ref={dropdownRef}>
        <Input
          label={t('auth.username')}
          value={username}
          onChange={(v) => {
            setUsername(v);
            setError('');
          }}
          placeholder={t('auth.enterUsername')}
          autoFocus={!prefillUsername}
          disabled={loading}
          onFocus={() => {
            setFocusedField('username');
            if (recentAccounts.length > 0) setShowDropdown(true);
          }}
          onBlur={() => setFocusedField(null)}
          rightIcon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          }
          onRightIconClick={() => setShowDropdown(!showDropdown)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
        />

        {/* Recent accounts dropdown */}
        {showDropdown && recentAccounts.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
            <p className="text-xs text-gray-400 px-3 py-2 border-b border-gray-100">
              {t('auth.recentAccounts')}
            </p>
            {recentAccounts.map((account) => (
              <button
                key={account}
                className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-purple-50 hover:text-purple-700 transition-colors"
                onClick={() => handleSelectRecent(account)}
              >
                {account}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Password */}
      <div className="mb-2">
        <Input
          label={t('auth.password')}
          type="password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            setError('');
          }}
          placeholder={t('auth.enterPassword')}
          showPasswordToggle
          disabled={loading}
          onFocus={() => setFocusedField('password')}
          onBlur={() => setFocusedField(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
          onVisibilityToggle={onPasswordVisibleChange}
        />
      </div>

      {/* Remember me */}
      <label className="flex items-center gap-2 mb-6 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 bg-transparent accent-purple-600 cursor-pointer"
        />
        <span className="text-xs text-gray-500">{t('auth.rememberMe')}</span>
      </label>

      {/* Login button */}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={loading}
        onClick={handleSubmit}
        onMouseEnter={() => !loading && onMascotStateChange('hover-submit')}
        onMouseLeave={() => !loading && onMascotStateChange('idle')}
      >
        {t('auth.login')}
      </Button>

      {/* Links */}
      <div className="mt-6 text-center space-y-2">
        <p>
          <button
            onClick={onCreateNewAccount}
            className="text-sm text-purple-600 hover:text-purple-800 transition-colors font-medium"
          >
            {t('auth.createNew')}
          </button>
        </p>
        <p>
          <button
            onClick={onSwitchToRegister}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            {t('auth.noAccount')}
          </button>
        </p>
      </div>

      {/* Quick account switch pills */}
      {recentAccounts.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-2">{t('auth.quickSwitch')}</p>
          <div className="flex flex-wrap gap-2">
            {recentAccounts.slice(0, 5).map((account) => (
              <button
                key={account}
                onClick={() => handleSelectRecent(account)}
                className="px-3 py-1 text-xs text-gray-500 bg-gray-100 rounded-full hover:bg-purple-100 hover:text-purple-700 transition-colors"
              >
                {account}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginPage;

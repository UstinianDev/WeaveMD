// ============================================
// WeaveMD — Login Page Component
// ============================================

import React, { useState, useRef, useEffect } from 'react';
import Input from '../Common/Input';
import Button from '../Common/Button';
import { useAuthStore } from '../../stores/authStore';
import { getRememberedCredentials, saveRememberedCredentials, clearRememberedCredentials } from '../../utils/crypto';
import type { IpcResponse, LoginResponse } from '../../../shared/types';

interface LoginPageProps {
  onSwitchToRegister: () => void;
  onCreateNewAccount: () => void;
  prefillUsername?: string;
}

const LoginPage: React.FC<LoginPageProps> = ({
  onSwitchToRegister,
  onCreateNewAccount,
  prefillUsername,
}) => {
  const [username, setUsername] = useState(prefillUsername || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const login = useAuthStore((s) => s.login);
  const recentAccounts = useAuthStore((s) => s.recentAccounts);
  const loadRecentAccounts = useAuthStore((s) => s.loadRecentAccounts);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadRecentAccounts();

    // Try to load remembered credentials
    const remembered = getRememberedCredentials();
    if (remembered) {
      setUsername(remembered.username);
      setPassword(remembered.password);
      setRememberMe(true);
    }
  }, [loadRecentAccounts]);

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
      setError('Please enter your username');
      return;
    }
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      const result = (await window.weaveMD.auth.login(
        username.trim(),
        password,
        rememberMe
      )) as IpcResponse<LoginResponse>;

      if (result.success && result.data) {
        const { token, user } = result.data;

        // Handle remember-me
        if (rememberMe) {
          saveRememberedCredentials(username.trim(), password);
        } else {
          clearRememberedCredentials();
        }

        login(user, token);
      } else {
        setError(result.message || 'Login failed');
      }
    } catch (err) {
      setError('Cannot connect to authentication service');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRecent = (account: string) => {
    setUsername(account);
    setPassword('');
    setShowDropdown(false);
    setError('');
    // Focus the password field
    setTimeout(() => {
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
      passwordInput?.focus();
    }, 50);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg-primary p-4">
      <div className="w-full max-w-[420px] bg-bg-secondary rounded-card p-8 shadow-modal">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-4xl">📔</span>
          <h1 className="text-2xl font-bold text-white mt-3">WeaveMD</h1>
          <p className="text-sm text-text-sub mt-1">Welcome back</p>
          <p className="text-xs text-text-muted mt-0.5">Sign in to continue your work</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-input text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Username with dropdown */}
        <div className="relative mb-4" ref={dropdownRef}>
          <Input
            label="Username"
            value={username}
            onChange={(v) => {
              setUsername(v);
              setError('');
            }}
            placeholder="Enter your username"
            autoFocus={!prefillUsername}
            disabled={loading}
            rightIcon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            }
            onRightIconClick={() => setShowDropdown(!showDropdown)}
            onFocus={() => {
              if (recentAccounts.length > 0) setShowDropdown(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />

          {/* Recent accounts dropdown */}
          {showDropdown && recentAccounts.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-bg-secondary border border-border rounded-input shadow-dropdown z-20 max-h-48 overflow-y-auto">
              <p className="text-xs text-text-muted px-3 py-2 border-b border-border">
                Recent accounts
              </p>
              {recentAccounts.map((account) => (
                <button
                  key={account}
                  className="w-full text-left px-3 py-2 text-sm text-text-sub hover:bg-bg-tertiary hover:text-white transition-colors"
                  onClick={() => handleSelectRecent(account)}
                >
                  {account}
                </button>
              ))}
            </div>
          )}

          {showDropdown && recentAccounts.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-bg-secondary border border-border rounded-input shadow-dropdown z-20">
              <p className="text-xs text-text-muted px-3 py-2">No recent accounts</p>
            </div>
          )}
        </div>

        {/* Password */}
        <div className="mb-2">
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              setError('');
            }}
            placeholder="Enter your password"
            showPasswordToggle
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />
        </div>

        {/* Remember me */}
        <label className="flex items-center gap-2 mb-6 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="w-4 h-4 rounded border-border bg-transparent accent-[#7C3AED] cursor-pointer"
          />
          <span className="text-xs text-text-sub">Remember password</span>
        </label>

        {/* Login button */}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          onClick={handleSubmit}
        >
          Log in
        </Button>

        {/* Links */}
        <div className="mt-6 text-center space-y-2">
          <p>
            <button
              onClick={onCreateNewAccount}
              className="text-sm text-accent-secondary hover:text-accent transition-colors"
            >
              Create New Account
            </button>
          </p>
          <p>
            <button
              onClick={onSwitchToRegister}
              className="text-sm text-text-muted hover:text-text-sub transition-colors"
            >
              Don&apos;t have an account? Register
            </button>
          </p>
        </div>

        {/* Quick account switch pills */}
        {recentAccounts.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-text-muted mb-2">Quick switch</p>
            <div className="flex flex-wrap gap-2">
              {recentAccounts.slice(0, 5).map((account) => (
                <button
                  key={account}
                  onClick={() => handleSelectRecent(account)}
                  className="px-3 py-1 text-xs text-text-sub bg-bg-tertiary rounded-full hover:bg-accent hover:text-white transition-colors"
                >
                  {account}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginPage;

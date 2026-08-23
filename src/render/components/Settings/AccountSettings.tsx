// ============================================
// WeaveMD — Account Settings
// ============================================

import React, { useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useUIStore } from '@render/stores/uiStore';

const AccountSettings: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const recentAccounts = useAuthStore((s) => s.recentAccounts);
  const loadRecentAccounts = useAuthStore((s) => s.loadRecentAccounts);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSwitchAccount, setShowSwitchAccount] = useState(false);
  const [switchPassword, setSwitchPassword] = useState('');
  const [switchUsername, setSwitchUsername] = useState('');
  const [switchError, setSwitchError] = useState('');
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    loadRecentAccounts();
  }, [loadRecentAccounts]);

  const handleLogout = () => {
    setIsLoggingOut(true);
    logout();
    setSettingsOpen(false);
    setIsLoggingOut(false);
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setIsDeleting(true);
    try {
      const result = (await window.weaveMD.account.delete(user.id)) as { success: boolean };
      if (result.success) {
        logout();
        setSettingsOpen(false);
      }
    } catch {
      logout();
      setSettingsOpen(false);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSwitchToAccount = (username: string) => {
    if (username === user?.username) {
      setShowSwitchAccount(false);
      return;
    }
    setSwitchUsername(username);
    setSwitchPassword('');
    setSwitchError('');
  };

  const handleConfirmSwitch = async () => {
    if (!switchPassword) {
      setSwitchError('请输入密码');
      return;
    }
    setIsSwitching(true);
    setSwitchError('');
    try {
      const result = (await window.weaveMD.auth.login(switchUsername, switchPassword, false)) as {
        success: boolean;
        data?: { token: string; user: { id: string; username: string; createdAt: string; lastLogin: string | null } };
        message?: string;
      };
      if (result.success && result.data) {
        logout();
        useAuthStore.getState().login(result.data.user, result.data.token);
        setSettingsOpen(false);
      } else {
        setSwitchError(result.message || '登录失败');
      }
    } catch {
      setSwitchError('无法连接到认证服务');
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">{t('settings.account')}</h2>

      {/* Account info */}
      <div className="p-4 bg-[var(--bg-primary)] rounded-input border border-[var(--border-color)]">
        <p className="text-[15px] text-[var(--text-sub)]">
          {`${t('settings.accountInfo')}: `}
          <span className="text-[var(--text-primary)] font-semibold">@{user?.username}</span>
        </p>
        <p className="text-[13px] text-[var(--text-muted)] mt-1">{t('settings.manageAccount')}</p>
      </div>

      {!showSwitchAccount ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowSwitchAccount(true)}
            className="w-full px-3 py-2 text-[15px] rounded-input border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            {t('settings.switchAccount')}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full px-3 py-2 text-[15px] rounded-input border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            {t('settings.logOut')}
          </button>
          {showDeleteConfirm ? (
            <div className="p-3 bg-red-600/10 border border-red-600/30 rounded-input">
              <p className="text-[14px] text-red-400 mb-3">{t('settings.confirmDelete')}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="flex-1 px-3 py-1.5 text-[14px] rounded-input border border-[var(--border-color)] text-[var(--text-sub)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  {t('settings.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={isDeleting}
                  className="flex-1 px-3 py-1.5 text-[14px] rounded-input bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  {t('settings.confirmDeleteBtn')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full px-3 py-2 text-[15px] rounded-input border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              {t('settings.deleteAccount')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-[var(--text-primary)]">{t('auth.recentAccounts')}</h3>
            <button
              type="button"
              onClick={() => { setShowSwitchAccount(false); setSwitchUsername(''); setSwitchPassword(''); setSwitchError(''); }}
              className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              {t('settings.cancel')}
            </button>
          </div>
          {recentAccounts.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)] text-center py-4">{t('auth.noRecent')}</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {recentAccounts.map((account) => (
                <button
                  key={account}
                  type="button"
                  onClick={() => handleSwitchToAccount(account)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-input text-[14px] transition-colors text-left ${
                    account === user?.username
                      ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--text-primary)]'
                      : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-sub)] border border-transparent'
                  }`}
                >
                  <span className="w-7 h-7 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-[13px] font-semibold text-[var(--accent)]">
                    {account.charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1">@{account}</span>
                  {account === user?.username && <span className="text-[12px] text-[var(--accent)]">当前</span>}
                </button>
              ))}
            </div>
          )}
          {switchUsername && (
            <div className="p-3 bg-[var(--bg-primary)] rounded-input border border-[var(--border-color)] space-y-2">
              <p className="text-[13px] text-[var(--text-sub)]">
                输入 <span className="text-[var(--text-primary)] font-semibold">@{switchUsername}</span> 的密码以切换
              </p>
              <input
                type="password"
                value={switchPassword}
                onChange={(e) => setSwitchPassword(e.target.value)}
                placeholder="输入密码"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmSwitch(); }}
                className="w-full border rounded-input px-3 py-1.5 text-[14px] outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
              />
              {switchError && <p className="text-[13px] text-red-400">{switchError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setSwitchUsername(''); setSwitchPassword(''); setSwitchError(''); }} disabled={isSwitching} className="flex-1 px-3 py-1.5 text-[14px] rounded-input border border-[var(--border-color)] text-[var(--text-sub)] hover:bg-[var(--bg-tertiary)] transition-colors">取消</button>
                <button type="button" onClick={handleConfirmSwitch} disabled={isSwitching} className="flex-1 px-3 py-1.5 text-[14px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">{isSwitching ? '切换中...' : '切换'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AccountSettings;

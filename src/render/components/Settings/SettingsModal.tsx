// ============================================
// WeaveMD — Settings Modal
// ============================================

import React, { useEffect, useState } from 'react';
import type { LanguageType, ThemeType } from '@shared/types';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useUIStore } from '@render/stores/uiStore';
import Button from '@render/components/Common/Button';
import Modal from '@render/components/Common/Modal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const LANGUAGES: { value: LanguageType; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
];

const THEMES: { value: ThemeType; label: string; description: string; colors: { bg: string; accent: string; nav: string } }[] = [
  { value: 'light-header', label: 'Default', description: '明亮清爽', colors: { bg: '#FFFFFF', accent: '#2563EB', nav: '#FFFFFF' } },
  { value: 'notus', label: 'Warm Earth', description: '暖色陶土', colors: { bg: '#FAF9F5', accent: '#C15F3C', nav: '#1C1917' } },
];

type SettingsTab = 'system' | 'account';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const theme = useUIStore((s) => s.theme);
  const language = useUIStore((s) => s.language);
  const setTheme = useUIStore((s) => s.setTheme);
  const setLanguage = useUIStore((s) => s.setLanguage);
  const closeModal = useUIStore((s) => s.closeModal);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const recentAccounts = useAuthStore((s) => s.recentAccounts);
  const loadRecentAccounts = useAuthStore((s) => s.loadRecentAccounts);

  const [activeTab, setActiveTab] = useState<SettingsTab>('system');
  const [selectedTheme, setSelectedTheme] = useState<ThemeType>(theme);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageType>(language);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSwitchAccount, setShowSwitchAccount] = useState(false);
  const [switchPassword, setSwitchPassword] = useState('');
  const [switchUsername, setSwitchUsername] = useState('');
  const [switchError, setSwitchError] = useState('');
  const [isSwitching, setIsSwitching] = useState(false);

  const TABS: { key: SettingsTab; label: string }[] = [
    { key: 'system', label: t('settings.system') },
    { key: 'account', label: t('settings.account') },
  ];

  useEffect(() => {
    if (isOpen) {
      setSelectedTheme(theme);
      setSelectedLanguage(language);
      setShowDeleteConfirm(false);
      setShowSwitchAccount(false);
      setSwitchPassword('');
      setSwitchUsername('');
      setSwitchError('');
      loadRecentAccounts();
    }
  }, [isOpen, theme, language, loadRecentAccounts]);

  const handleSave = async () => {
    setTheme(selectedTheme);
    setLanguage(selectedLanguage);
    // Persist to backend
    if (user) {
      window.weaveMD.settings
        .update(user.id, {
          theme: selectedTheme,
          language: selectedLanguage,
        })
        .catch(() => {});
    }
    closeModal();
  };

  const handleCancel = () => {
    closeModal();
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      // Clear local state
      logout();
      closeModal();
    } catch {
      // Still logout even if IPC fails
      logout();
      closeModal();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setIsDeleting(true);
    try {
      const result = (await window.weaveMD.account.delete(user.id)) as {
        success: boolean;
        message: string;
      };
      if (result.success) {
        logout();
        closeModal();
      }
    } catch {
      // Still logout even on IPC error to clear local state
      logout();
      closeModal();
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSwitchToAccount = async (username: string) => {
    // If switching to the same account, just close the switch panel
    if (username === user?.username) {
      setShowSwitchAccount(false);
      return;
    }

    // Show password input for the selected account
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
        data?: {
          token: string;
          user: { id: string; username: string; createdAt: string; lastLogin: string | null };
        };
        message?: string;
      };

      if (result.success && result.data) {
        // Logout current user first
        logout();
        // Login with new account
        useAuthStore.getState().login(result.data.user, result.data.token);
        closeModal();
      } else {
        setSwitchError(result.message || '登录失败');
      }
    } catch {
      setSwitchError('无法连接到认证服务');
    } finally {
      setIsSwitching(false);
    }
  };

  const handleCancelSwitch = () => {
    setShowSwitchAccount(false);
    setSwitchUsername('');
    setSwitchPassword('');
    setSwitchError('');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('settings.title')}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={handleCancel}>
            {t('settings.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSave}>
            {t('settings.save')}
          </Button>
        </>
      }
    >
      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[var(--bg-primary)] rounded-input p-0.5">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-1.5 text-sm rounded-[6px] transition-colors ${
              activeTab === tab.key
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-sub)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'system' && (
        <div className="space-y-6">
          {/* Language */}
          <div>
            <label className="text-sm text-[var(--text-primary)] font-medium mb-2 block">
              {t('settings.language')}
            </label>
            <div className="space-y-1">
              {LANGUAGES.map((lang) => (
                <label
                  key={lang.value}
                  className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="language"
                    value={lang.value}
                    checked={selectedLanguage === lang.value}
                    onChange={() => setSelectedLanguage(lang.value)}
                    className="accent-[#7C3AED]"
                  />
                  <span className="text-sm text-[var(--text-sub)]">{lang.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div>
            <label className="text-sm text-[var(--text-primary)] font-medium mb-2 block">
              {t('settings.theme')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              {THEMES.map((th) => {
                const isSelected = selectedTheme === th.value;
                return (
                  <button
                    key={th.value}
                    onClick={() => setSelectedTheme(th.value)}
                    className="relative flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left hover:shadow-md"
                    style={{
                      borderColor: isSelected ? '#2563EB' : 'var(--border-color)',
                      backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.06)' : 'transparent',
                    }}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#2563EB] flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}
                    <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 shadow-sm flex flex-col">
                      <div className="h-[40%] w-full" style={{ backgroundColor: th.colors.nav }} />
                      <div className="flex-1 w-full flex items-center justify-center" style={{ backgroundColor: th.colors.bg }}>
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: th.colors.accent }} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-semibold block truncate" style={{ color: isSelected ? '#2563EB' : 'var(--text-primary)' }}>{th.label}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">{th.description}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'account' && (
        <div className="space-y-4">
          <div className="p-4 bg-[var(--bg-primary)] rounded-input border border-[var(--border-color)]">
            <p className="text-sm text-[var(--text-sub)]">
              {`${t('settings.accountInfo')}: `}
              <span className="text-[var(--text-primary)] font-semibold">@{user?.username}</span>
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{t('settings.manageAccount')}</p>
          </div>

          {/* Switch Account Section */}
          {!showSwitchAccount ? (
            <div className="space-y-2">
              <Button variant="secondary" fullWidth onClick={() => setShowSwitchAccount(true)}>
                {t('settings.switchAccount')}
              </Button>
              {/* Logout Button */}
              <Button variant="danger" fullWidth onClick={handleLogout} loading={isLoggingOut}>
                {t('settings.logOut')}
              </Button>
              {/* Delete Account Button */}
              {showDeleteConfirm ? (
                <div className="p-3 bg-red-600/10 border border-red-600/30 rounded-input">
                  <p className="text-sm text-red-400 mb-3">{t('settings.confirmDelete')}</p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                    >
                      {t('settings.cancel')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      fullWidth
                      onClick={handleDeleteAccount}
                      loading={isDeleting}
                    >
                      {t('settings.confirmDeleteBtn')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" fullWidth onClick={() => setShowDeleteConfirm(true)}>
                  {t('settings.deleteAccount')}
                </Button>
              )}
            </div>
          ) : (
            /* Switch Account Panel */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">
                  {t('auth.recentAccounts')}
                </h3>
                <button
                  onClick={handleCancelSwitch}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {t('settings.cancel')}
                </button>
              </div>

              {/* Recent accounts list */}
              {recentAccounts.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] text-center py-4">
                  {t('auth.noRecent')}
                </p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {recentAccounts.map((account) => (
                    <button
                      key={account}
                      onClick={() => handleSwitchToAccount(account)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-input text-sm transition-colors text-left ${
                        account === user?.username
                          ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--text-primary)]'
                          : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-sub)] border border-transparent'
                      }`}
                    >
                      <span className="w-7 h-7 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-xs font-semibold text-[var(--accent)]">
                        {account.charAt(0).toUpperCase()}
                      </span>
                      <span className="flex-1">@{account}</span>
                      {account === user?.username && (
                        <span className="text-xs text-[var(--accent)]">当前</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Password input for selected account */}
              {switchUsername && (
                <div className="p-3 bg-[var(--bg-primary)] rounded-input border border-[var(--border-color)] space-y-2">
                  <p className="text-xs text-[var(--text-sub)]">
                    输入{' '}
                    <span className="text-[var(--text-primary)] font-semibold">
                      @{switchUsername}
                    </span>{' '}
                    的密码以切换
                  </p>
                  <input
                    type="password"
                    value={switchPassword}
                    onChange={(e) => setSwitchPassword(e.target.value)}
                    placeholder="输入密码"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmSwitch();
                      if (e.key === 'Escape') handleCancelSwitch();
                    }}
                    className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                    style={{
                      backgroundColor: 'var(--input-bg)',
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  {switchError && <p className="text-xs text-red-400">{switchError}</p>}
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={handleCancelSwitch}
                      disabled={isSwitching}
                    >
                      取消
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      fullWidth
                      onClick={handleConfirmSwitch}
                      loading={isSwitching}
                    >
                      切换
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default SettingsModal;

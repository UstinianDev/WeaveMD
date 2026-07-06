// ============================================
// WeaveMD — Settings Modal
// ============================================

import React, { useState, useEffect } from 'react';
import Modal from '../Common/Modal';
import Button from '../Common/Button';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import type { ThemeType, LanguageType } from '../../../shared/types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const LANGUAGES: { value: LanguageType; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
];

const THEMES: { value: ThemeType; label: string; preview: string }[] = [
  { value: 'light-header', label: 'Light with Light Header', preview: 'bg-white border' },
  { value: 'light', label: 'Light', preview: 'bg-white border' },
  { value: 'dark', label: 'Dark', preview: 'bg-[#0F0F0F]' },
  { value: 'high-contrast', label: 'High Contrast', preview: 'bg-black' },
  { value: 'custom', label: 'Custom', preview: 'bg-gradient-to-r from-[#7C3AED] to-[#6366F1]' },
];

type SettingsTab = 'system' | 'account';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'account', label: 'Account' },
];

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const theme = useUIStore((s) => s.theme);
  const language = useUIStore((s) => s.language);
  const setTheme = useUIStore((s) => s.setTheme);
  const setLanguage = useUIStore((s) => s.setLanguage);
  const closeModal = useUIStore((s) => s.closeModal);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [activeTab, setActiveTab] = useState<SettingsTab>('system');
  const [selectedTheme, setSelectedTheme] = useState<ThemeType>(theme);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageType>(language);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedTheme(theme);
      setSelectedLanguage(language);
    }
  }, [isOpen, theme, language]);

  const handleSave = () => {
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            Save
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
              Language
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
              Theme
            </label>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setSelectedTheme(t.value)}
                  className={`flex items-center gap-3 p-3 rounded-input border transition-colors text-left ${
                    selectedTheme === t.value
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border-color)] hover:border-[var(--accent-secondary)]'
                  }`}
                >
                  <div className={`w-8 h-8 rounded border border-[var(--border-color)] ${t.preview}`} />
                  <span className="text-sm text-[var(--text-sub)]">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'account' && (
        <div className="space-y-4">
          <div className="p-4 bg-[var(--bg-primary)] rounded-input border border-[var(--border-color)]">
            <p className="text-sm text-[var(--text-sub)]">
              Current account:{' '}
              <span className="text-[var(--text-primary)] font-semibold">
                @{user?.username}
              </span>
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Manage your account data</p>
          </div>
          <div className="space-y-2">
            <Button variant="secondary" fullWidth onClick={() => {}}>
              Switch Account
            </Button>
            <Button variant="secondary" fullWidth onClick={() => {}}>
              Export Account Data
            </Button>
            {/* Logout Button */}
            <Button
              variant="danger"
              fullWidth
              onClick={handleLogout}
              loading={isLoggingOut}
            >
              Log Out
            </Button>
            <Button variant="danger" fullWidth onClick={() => {}}>
              Delete Account
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default SettingsModal;

// ============================================
// WeaveMD — System Settings (Theme + Language)
// ============================================

import React, { useEffect, useState } from 'react';
import type { LanguageType, ThemeType } from '@shared/types';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useUIStore } from '@render/stores/uiStore';

const LANGUAGES: { value: LanguageType; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
];

const THEMES: { value: ThemeType; label: string; description: string; colors: { bg: string; accent: string; nav: string } }[] = [
  { value: 'light-header', label: 'Default', description: '明亮清爽', colors: { bg: '#FFFFFF', accent: '#2563EB', nav: '#FFFFFF' } },
  { value: 'notus', label: 'Warm Earth', description: '暖色陶土', colors: { bg: '#FAF9F5', accent: '#C15F3C', nav: '#1C1917' } },
];

const SystemSettings: React.FC = () => {
  const { t } = useI18n();
  const theme = useUIStore((s) => s.theme);
  const language = useUIStore((s) => s.language);
  const setTheme = useUIStore((s) => s.setTheme);
  const setLanguage = useUIStore((s) => s.setLanguage);
  const user = useAuthStore((s) => s.user);

  const [selectedTheme, setSelectedTheme] = useState<ThemeType>(theme);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageType>(language);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSelectedTheme(theme);
    setSelectedLanguage(language);
  }, [theme, language]);

  const handleSave = () => {
    setTheme(selectedTheme);
    setLanguage(selectedLanguage);
    if (user) {
      window.weaveMD.settings
        .update(user.id, { theme: selectedTheme, language: selectedLanguage })
        .catch(() => {});
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">{t('settings.system')}</h2>

      {/* Language */}
      <div>
        <label className="text-[15px] text-[var(--text-primary)] font-medium mb-2 block">
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
              <span className="text-[15px] text-[var(--text-sub)]">{lang.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Theme */}
      <div>
        <label className="text-[15px] text-[var(--text-primary)] font-medium mb-2 block">
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
                {/* Checkmark badge */}
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#2563EB] flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
                {/* Theme preview — simulated navbar + content */}
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

      {/* Save */}
      <div className="flex items-center gap-3">
        {saved && <p className="text-[13px] text-green-500">{t('settings.save')}</p>}
        <button
          type="button"
          onClick={handleSave}
          className="px-3.5 py-1 text-[15px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          {t('settings.save')}
        </button>
      </div>
    </div>
  );
};

export default SystemSettings;

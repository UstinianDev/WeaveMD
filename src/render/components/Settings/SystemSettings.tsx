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

const THEMES: { value: ThemeType; label: string; preview: string }[] = [
  { value: 'light-header', label: 'Light with Light Header', preview: 'bg-white border' },
  { value: 'light', label: 'Light', preview: 'bg-white border' },
  { value: 'dark', label: 'Dark', preview: 'bg-[#0F0F0F]' },
  { value: 'high-contrast', label: 'High Contrast', preview: 'bg-black' },
  { value: 'custom', label: 'Custom', preview: 'bg-gradient-to-r from-[#7C3AED] to-[#6366F1]' },
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
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((th) => (
            <button
              key={th.value}
              onClick={() => setSelectedTheme(th.value)}
              className={`flex items-center gap-3 p-3 rounded-input border transition-colors text-left ${
                selectedTheme === th.value
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border-color)] hover:border-[var(--accent-secondary)]'
              }`}
            >
              <div className={`w-8 h-8 rounded border border-[var(--border-color)] ${th.preview}`} />
              <span className="text-[14px] text-[var(--text-sub)]">{th.label}</span>
            </button>
          ))}
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

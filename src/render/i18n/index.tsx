// ============================================
// WeaveMD — i18n Context Provider
// Simple i18n without external dependencies
// ============================================

import React, { createContext, useContext, useCallback } from 'react';
import { useUIStore } from '../stores/uiStore';
import type { LanguageType } from '../../shared/types';
import en from './en.json';
import zhCN from './zh-CN.json';
import zhTW from './zh-TW.json';

type Translations = Record<string, string>;

const translations: Record<LanguageType, Translations> = {
  en: en as Translations,
  'zh-CN': zhCN as Translations,
  'zh-TW': zhTW as Translations,
};

interface I18nContextType {
  t: (key: string, fallback?: string) => string;
  language: LanguageType;
  setLanguage: (lang: LanguageType) => void;
}

const I18nContext = createContext<I18nContextType>({
  t: (key, fallback) => fallback || key,
  language: 'zh-CN',
  setLanguage: () => {},
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const language = useUIStore((s) => s.language);
  const setLanguageStore = useUIStore((s) => s.setLanguage);

  const t = useCallback(
    (key: string, fallback?: string): string => {
      const dict = translations[language] || translations['zh-CN'];
      return dict[key] || fallback || key;
    },
    [language]
  );

  const setLanguage = useCallback(
    (lang: LanguageType) => {
      setLanguageStore(lang);
    },
    [setLanguageStore]
  );

  return (
    <I18nContext.Provider value={{ t, language, setLanguage }}>{children}</I18nContext.Provider>
  );
};

export function useI18n(): I18nContextType {
  return useContext(I18nContext);
}

export default I18nContext;

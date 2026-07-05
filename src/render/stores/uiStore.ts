// ============================================
// WeaveMD — UI Store (Zustand)
// ============================================

import { create } from 'zustand';
import type { ThemeType, LanguageType, PageWidth } from '../../shared/types';

interface UIStore {
  theme: ThemeType;
  language: LanguageType;
  sidebarWidth: number;
  isSidebarOpen: boolean;
  pageWidth: PageWidth;
  activeModal: string | null;
  isLoading: boolean;
  isSplashComplete: boolean;
  isHistoryPanelOpen: boolean;

  setTheme: (theme: ThemeType) => void;
  setLanguage: (language: LanguageType) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setPageWidth: (width: PageWidth) => void;
  openModal: (modal: string) => void;
  closeModal: () => void;
  setLoading: (loading: boolean) => void;
  setSplashComplete: (complete: boolean) => void;
  toggleHistoryPanel: () => void;
  persistSettings: () => void;
  loadSettings: () => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  theme: 'dark',
  language: 'zh-CN',
  sidebarWidth: 240,
  isSidebarOpen: true,
  pageWidth: 'default',
  activeModal: null,
  isLoading: false,
  isSplashComplete: false,
  isHistoryPanelOpen: false,

  setTheme: (theme) => {
    set({ theme });
    get().persistSettings();
  },

  setLanguage: (language) => {
    set({ language });
    get().persistSettings();
  },

  setSidebarWidth: (width) => {
    set({ sidebarWidth: width });
    get().persistSettings();
  },

  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),

  setPageWidth: (pageWidth) => set({ pageWidth }),

  openModal: (modal) => set({ activeModal: modal }),

  closeModal: () => set({ activeModal: null }),

  setLoading: (isLoading) => set({ isLoading }),

  setSplashComplete: (complete) => set({ isSplashComplete: complete }),

  toggleHistoryPanel: () =>
    set((s) => ({ isHistoryPanelOpen: !s.isHistoryPanelOpen })),

  persistSettings: () => {
    const { theme, language, sidebarWidth } = get();
    localStorage.setItem(
      'weavemd_ui',
      JSON.stringify({ theme, language, sidebarWidth })
    );
  },

  loadSettings: () => {
    try {
      const stored = localStorage.getItem('weavemd_ui');
      if (stored) {
        const { theme, language, sidebarWidth } = JSON.parse(stored);
        set({ theme: theme || 'dark', language: language || 'zh-CN', sidebarWidth: sidebarWidth || 240 });
      }
    } catch {
      // Use defaults
    }
  },
}));

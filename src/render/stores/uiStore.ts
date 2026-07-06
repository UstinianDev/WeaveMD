// ============================================
// WeaveMD — UI Store (Zustand)
// ============================================

import { create } from 'zustand';
import type { LanguageType, PageWidth, ThemeType } from '../../shared/types';

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
  isPreviewMode: boolean;

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
  togglePreviewMode: () => void;
  persistSettings: () => void;
  loadSettings: () => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  theme: 'light-header',
  language: 'zh-CN',
  sidebarWidth: 240,
  isSidebarOpen: true,
  pageWidth: 'default',
  activeModal: null,
  isLoading: false,
  isSplashComplete: false,
  isHistoryPanelOpen: false,
  isPreviewMode: true,

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

  toggleHistoryPanel: () => set((s) => ({ isHistoryPanelOpen: !s.isHistoryPanelOpen })),

  togglePreviewMode: () => {
    set((s) => ({ isPreviewMode: !s.isPreviewMode }));
    get().persistSettings();
  },

  persistSettings: () => {
    const { theme, language, sidebarWidth, isPreviewMode } = get();
    localStorage.setItem(
      'weavemd_ui',
      JSON.stringify({ theme, language, sidebarWidth, isPreviewMode })
    );
  },

  loadSettings: () => {
    try {
      const stored = localStorage.getItem('weavemd_ui');
      if (stored) {
        const { theme, language, sidebarWidth, isPreviewMode } = JSON.parse(stored);
        set({
          theme: theme || 'light-header',
          language: language || 'zh-CN',
          sidebarWidth: sidebarWidth || 240,
          isPreviewMode: isPreviewMode || false,
        });
      }
    } catch {
      // Use defaults
    }
  },
}));

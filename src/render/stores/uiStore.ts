// ============================================
// WeaveMD — UI Store (Zustand)
// ============================================

import { create } from 'zustand';
import type { LanguageType, PageWidth, ThemeType } from '../../shared/types';
import {
  initialMarkdownBlockState,
  transitionMarkdownBlockState,
  type BlockInfo,
  type MarkdownBlockState,
  type MarkdownBlockStateEvent,
} from '../services/markdownBlockDetector';

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
  markdownBlockState: MarkdownBlockState;
  editorDraftFlusher: (() => void | Promise<void>) | null;

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
  setMarkdownBlockState: (state: MarkdownBlockState) => void;
  transitionMarkdownBlockState: (
    blocks: BlockInfo[],
    event: MarkdownBlockStateEvent
  ) => MarkdownBlockState;
  resetMarkdownBlockState: () => void;
  setEditorDraftFlusher: (flusher: (() => void | Promise<void>) | null) => void;
  flushEditorDraft: () => Promise<void>;
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
  markdownBlockState: initialMarkdownBlockState,
  editorDraftFlusher: null,

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

  setMarkdownBlockState: (markdownBlockState) => set({ markdownBlockState }),

  transitionMarkdownBlockState: (blocks, event) => {
    const nextState = transitionMarkdownBlockState(blocks, get().markdownBlockState, event);
    set({ markdownBlockState: nextState });
    return nextState;
  },

  resetMarkdownBlockState: () => set({ markdownBlockState: initialMarkdownBlockState }),

  setEditorDraftFlusher: (editorDraftFlusher) => set({ editorDraftFlusher }),

  flushEditorDraft: async () => {
    await get().editorDraftFlusher?.();
  },

  persistSettings: () => {
    const { theme, language, sidebarWidth } = get();
    localStorage.setItem('weavemd_ui', JSON.stringify({ theme, language, sidebarWidth }));
  },

  loadSettings: () => {
    try {
      const stored = localStorage.getItem('weavemd_ui');
      if (stored) {
        const { theme, language, sidebarWidth } = JSON.parse(stored);
        set({
          theme: theme || 'light-header',
          language: language || 'zh-CN',
          sidebarWidth: sidebarWidth || 240,
        });
      }
    } catch {
      // Use defaults
    }
  },
}));

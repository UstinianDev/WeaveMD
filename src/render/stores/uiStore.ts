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
  isSourceCodeMode: boolean;
  isFindReplaceOpen: boolean;
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
  toggleSourceCodeMode: () => void;
  toggleFindReplace: () => void;
  setMarkdownBlockState: (state: MarkdownBlockState) => void;
  setMdSourceBlockId: (blockId: string | null) => void;
  clearMdSourceBlockId: () => void;
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
  isSourceCodeMode: false,
  isFindReplaceOpen: false,
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

  openModal: (modal) => {
    // ---- Fix C: Global orphan Monaco textarea cleanup ----
    // Before opening any modal, proactively remove orphan Monaco hidden
    // textareas that may have leaked from a previously active block editor.
    //
    // Root cause: Monaco uses hidden <textarea> elements (class .ime-text-area,
    // .inputarea) to capture keyboard input and IME composition. If a block
    // editor's cleanup runs asynchronously (useEffect) after React already
    // removed the container DOM, the blur() call is a no-op and the textarea
    // may already be removed. However, in some edge cases (rapid Ctrl+F,
    // React StrictMode double-invoke, @monaco-editor/react timing), orphan
    // textareas can survive. They intercept keyboard events globally and
    // cause IME candidate windows to appear at stale screen positions.
    //
    // This guard runs SYNCHRONOUSLY before set({ activeModal }) — ensuring
    // that any modal's autoFocus input won't compete with a ghost textarea.
    if (typeof document !== 'undefined') {
      document
        .querySelectorAll('textarea.ime-text-area, textarea.inputarea')
        .forEach((el) => {
          const monacoRoot = el.closest('.monaco-editor');
          if (!monacoRoot || !document.body.contains(monacoRoot)) {
            (el as HTMLTextAreaElement).blur();
            el.remove();
          }
        });
    }
    set({ activeModal: modal });
  },

  closeModal: () => set({ activeModal: null }),

  setLoading: (isLoading) => set({ isLoading }),

  setSplashComplete: (complete) => set({ isSplashComplete: complete }),

  toggleHistoryPanel: () => set((s) => ({ isHistoryPanelOpen: !s.isHistoryPanelOpen })),

  toggleSourceCodeMode: () => set((s) => ({ isSourceCodeMode: !s.isSourceCodeMode })),

  toggleFindReplace: () => set((s) => ({ isFindReplaceOpen: !s.isFindReplaceOpen })),

  setMarkdownBlockState: (markdownBlockState) => set({ markdownBlockState }),

  setMdSourceBlockId: (blockId) =>
    set((state) => ({
      markdownBlockState: {
        ...state.markdownBlockState,
        mdSourceBlockId: blockId,
      },
    })),

  clearMdSourceBlockId: () =>
    set((state) => ({
      markdownBlockState: {
        ...state.markdownBlockState,
        mdSourceBlockId: null,
      },
    })),

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

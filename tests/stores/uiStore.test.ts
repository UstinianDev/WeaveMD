// ============================================
// WeaveMD — UI Store Tests
// ============================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialMarkdownBlockState } from '../../src/render/services/markdownBlockDetector';
import { useUIStore } from '../../src/render/stores/uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState({
      theme: 'dark',
      language: 'zh-CN',
      sidebarWidth: 240,
      isSidebarOpen: true,
      pageWidth: 'default',
      activeModal: null,
      isLoading: false,
      isSplashComplete: false,
      isHistoryPanelOpen: false,
      markdownBlockState: initialMarkdownBlockState,
    });
    localStorage.clear();
  });

  it('should start with default state', () => {
    const state = useUIStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.language).toBe('zh-CN');
    expect(state.sidebarWidth).toBe(240);
    expect(state.isSidebarOpen).toBe(true);
  });

  it('should set theme', () => {
    useUIStore.getState().setTheme('light');
    expect(useUIStore.getState().theme).toBe('light');
  });

  it('should set language', () => {
    useUIStore.getState().setLanguage('en');
    expect(useUIStore.getState().language).toBe('en');
  });

  it('should toggle sidebar', () => {
    expect(useUIStore.getState().isSidebarOpen).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().isSidebarOpen).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().isSidebarOpen).toBe(true);
  });

  it('should set page width', () => {
    useUIStore.getState().setPageWidth('full');
    expect(useUIStore.getState().pageWidth).toBe('full');
  });

  it('should open and close modal', () => {
    expect(useUIStore.getState().activeModal).toBeNull();
    useUIStore.getState().openModal('settings');
    expect(useUIStore.getState().activeModal).toBe('settings');
    useUIStore.getState().closeModal();
    expect(useUIStore.getState().activeModal).toBeNull();
  });

  it('should set sidebar width', () => {
    useUIStore.getState().setSidebarWidth(300);
    expect(useUIStore.getState().sidebarWidth).toBe(300);
  });

  it('should persist settings to localStorage', () => {
    useUIStore.getState().setTheme('light');
    useUIStore.getState().setLanguage('en');
    useUIStore.getState().setSidebarWidth(300);

    const stored = JSON.parse(localStorage.getItem('weavemd_ui') || '{}');
    expect(stored.theme).toBe('light');
    expect(stored.language).toBe('en');
    expect(stored.sidebarWidth).toBe(300);
    expect(stored).not.toHaveProperty('isPreviewMode');
  });

  it('should load settings from localStorage', () => {
    localStorage.setItem(
      'weavemd_ui',
      JSON.stringify({ theme: 'light', language: 'en', sidebarWidth: 320 })
    );

    useUIStore.getState().loadSettings();
    expect(useUIStore.getState().theme).toBe('light');
    expect(useUIStore.getState().language).toBe('en');
    expect(useUIStore.getState().sidebarWidth).toBe(320);
  });

  it('should toggle history panel', () => {
    expect(useUIStore.getState().isHistoryPanelOpen).toBe(false);
    useUIStore.getState().toggleHistoryPanel();
    expect(useUIStore.getState().isHistoryPanelOpen).toBe(true);
  });

  it('should set markdown block state directly', () => {
    const nextState = {
      activeBlockId: 'heading:1-1',
      lastExitedBlockId: null,
      continuousInputBlockId: 'heading:1-1',
      activeSource: 'input' as const,
      mdSourceBlockId: null,
    };

    useUIStore.getState().setMarkdownBlockState(nextState);
    expect(useUIStore.getState().markdownBlockState).toEqual(nextState);
  });

  it('should transition markdown block state through the store', () => {
    const blocks = [
      {
        id: 'heading:1-1',
        type: 'heading' as const,
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 8,
        syntaxMarkers: [],
        metadata: { headingLevel: 1 },
      },
      {
        id: 'paragraph:3-3',
        type: 'paragraph' as const,
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: 15,
        syntaxMarkers: [],
      },
    ];

    const afterInput = useUIStore.getState().transitionMarkdownBlockState(blocks, {
      type: 'input',
      position: { lineNumber: 1, column: 2 },
    });
    expect(afterInput.activeBlockId).toBe('heading:1-1');
    expect(useUIStore.getState().markdownBlockState.continuousInputBlockId).toBe('heading:1-1');

    const afterMouseMove = useUIStore.getState().transitionMarkdownBlockState(blocks, {
      type: 'cursorMove',
      source: 'mouse',
      position: { lineNumber: 3, column: 4 },
    });
    expect(afterMouseMove).toEqual({
      activeBlockId: 'paragraph:3-3',
      lastExitedBlockId: 'heading:1-1',
      continuousInputBlockId: null,
      activeSource: 'mouse',
      mdSourceBlockId: null,
    });
  });

  it('should reset markdown block state', () => {
    useUIStore.getState().setMarkdownBlockState({
      activeBlockId: 'paragraph:3-3',
      lastExitedBlockId: 'heading:1-1',
      continuousInputBlockId: 'paragraph:3-3',
      activeSource: 'keyboard',
      mdSourceBlockId: null,
    });

    useUIStore.getState().resetMarkdownBlockState();
    expect(useUIStore.getState().markdownBlockState).toEqual(initialMarkdownBlockState);
  });

  it('should set and clear md source block id', () => {
    useUIStore.getState().setMdSourceBlockId('paragraph:3-3');
    expect(useUIStore.getState().markdownBlockState.mdSourceBlockId).toBe('paragraph:3-3');

    useUIStore.getState().clearMdSourceBlockId();
    expect(useUIStore.getState().markdownBlockState.mdSourceBlockId).toBeNull();
  });

  it('should flush the registered editor draft callback', async () => {
    const flusher = vi.fn();

    useUIStore.getState().setEditorDraftFlusher(flusher);
    await useUIStore.getState().flushEditorDraft();

    expect(flusher).toHaveBeenCalledTimes(1);
    useUIStore.getState().setEditorDraftFlusher(null);
    await expect(useUIStore.getState().flushEditorDraft()).resolves.toBeUndefined();
  });
});

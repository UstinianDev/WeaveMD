// ============================================
// WeaveMD — UI Store Tests
// ============================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '@render/stores/uiStore';

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

  it('should flush the registered editor draft callback', async () => {
    const flusher = vi.fn();

    useUIStore.getState().setEditorDraftFlusher(flusher);
    await useUIStore.getState().flushEditorDraft();

    expect(flusher).toHaveBeenCalledTimes(1);
    useUIStore.getState().setEditorDraftFlusher(null);
    await expect(useUIStore.getState().flushEditorDraft()).resolves.toBeUndefined();
  });
});

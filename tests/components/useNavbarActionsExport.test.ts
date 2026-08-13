import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as React from 'react';
import type { ReactNode } from 'react';
import { I18nProvider } from '@render/i18n';
import { useNavbarActions } from '@render/hooks/useNavbarActions';
import { useEditorStore } from '@render/stores/editorStore';
import { useUIStore } from '@render/stores/uiStore';
import type { IFile } from '@shared/types';
import type { ExportResult } from '@main/export/types';

interface I18nProps {
  children: ReactNode;
}

// Mock the async markdown renderer used by handleExport.
vi.mock('@render/services/markdown', () => ({
  renderMarkdownToHtml: vi.fn(async (content: string) => `<p>${content}</p>`),
}));

import { renderMarkdownToHtml } from '@render/services/markdown';

const MOCK_FILE: IFile = {
  id: 'file-1',
  userId: 'user-1',
  name: 'My Report.md',
  content: '# Old',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

const exportFileMock = vi.mocked(window.weaveMD.export.file);

beforeEach(() => {
  vi.clearAllMocks();
  exportFileMock.mockResolvedValue({ success: true, data: {} } satisfies ExportResult);

  useEditorStore.setState({ currentFile: null, content: '', isDirty: false });
  useUIStore.setState({ editorDraftFlusher: null });
});

afterEach(() => {
  useEditorStore.setState({ currentFile: null, content: '' });
});

const Wrapper = (props: I18nProps) => React.createElement(I18nProvider, null, props.children);

const renderHookWithI18n = () =>
  renderHook(() => useNavbarActions(), {
    wrapper: Wrapper,
  });

describe('useNavbarActions.handleExport', () => {
  it('returns early without a current file (no IPC call)', async () => {
    const { result } = renderHookWithI18n();
    await act(async () => {
      await result.current.handleExport('md');
    });
    expect(exportFileMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('flushes draft, uses latest content, and calls export.file with derived basename', async () => {
    const flushSpy = vi.fn(async () => {});
    useUIStore.setState({ editorDraftFlusher: flushSpy });
    useEditorStore.setState({ currentFile: MOCK_FILE, content: '# Fresh' });

    const { result } = renderHookWithI18n();
    await act(async () => {
      await result.current.handleExport('pdf');
    });

    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(renderMarkdownToHtml).toHaveBeenCalledWith('# Fresh');
    expect(exportFileMock).toHaveBeenCalledTimes(1);
    expect(exportFileMock).toHaveBeenCalledWith({
      format: 'pdf',
      content: '# Fresh',
      html: '<p># Fresh</p>',
      filename: 'My Report',
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('sets errorMessage on non-cancelled failure', async () => {
    useEditorStore.setState({ currentFile: MOCK_FILE, content: '# x' });
    exportFileMock.mockResolvedValue({ success: false, error: 'boom' } satisfies ExportResult);

    const { result } = renderHookWithI18n();
    await act(async () => {
      await result.current.handleExport('doc');
    });

    expect(result.current.errorMessage).toBeTruthy();
    expect(result.current.errorMessage).not.toBe('');
    expect(result.current.isLoading).toBe(false);
  });

  it('silently no-ops when the user cancels the save dialog', async () => {
    useEditorStore.setState({ currentFile: MOCK_FILE, content: '# x' });
    exportFileMock.mockResolvedValue({
      success: false,
      error: 'cancelled',
    } satisfies ExportResult);

    const { result } = renderHookWithI18n();
    await act(async () => {
      await result.current.handleExport('md');
    });

    expect(result.current.errorMessage).toBe('');
    expect(result.current.isLoading).toBe(false);
  });

  it('shows a truncation banner when data.truncatedPx is present on success', async () => {
    useEditorStore.setState({ currentFile: MOCK_FILE, content: '# long' });
    exportFileMock.mockResolvedValue({
      success: true,
      data: { truncatedPx: 15000 },
    } satisfies ExportResult);

    const { result } = renderHookWithI18n();
    await act(async () => {
      await result.current.handleExport('png');
    });

    expect(result.current.errorMessage).toContain('15000');
    expect(result.current.isLoading).toBe(false);
  });
});

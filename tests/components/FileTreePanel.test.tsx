// ============================================
// WeaveMD — FileTreePanel 切换保存测试
// ============================================
// 覆盖：切换文件前保存当前 dirty 草稿、点击当前文件 no-op、始终以磁盘为准（陈旧缓存不生效）

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@render/i18n';
import FileTreePanel from '@render/components/Editor/panels/FileTreePanel';
import { useEditorStore } from '@render/stores/editorStore';
import { useFileTreeStore } from '@render/stores/fileTreeStore';
import { useUIStore } from '@render/stores/uiStore';
import type { IFile } from '@shared/types';

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

const diskA: IFile = {
  id: '/disk/a.md',
  userId: '',
  name: 'a.md',
  content: '# A original',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    currentFile: null,
    content: '',
    isDirty: false,
    undoStack: [],
    redoStack: [],
  });
  useFileTreeStore.setState({ folders: [], looseFiles: [], selectedIds: [] });
  useUIStore.setState({ editorDraftFlusher: null });
  vi.mocked(window.weaveMD.file.readDisk).mockResolvedValue({
    success: true,
    data: { content: '# B disk content' },
  });
  vi.mocked(window.weaveMD.file.write).mockResolvedValue({ success: true });
});

afterEach(() => {
  useEditorStore.setState({ currentFile: null, content: '', isDirty: false });
  cleanup();
});

describe('FileTreePanel.handleFileClick', () => {
  it('在切换文件前保存当前 dirty 草稿，再从磁盘加载目标文件', async () => {
    useEditorStore.setState({
      currentFile: diskA,
      content: '# A edited',
      isDirty: true,
    });
    useFileTreeStore.setState({
      looseFiles: [{ id: '/disk/b.md', name: 'b.md', path: '/disk/b.md' }],
    });

    render(
      <Wrapper>
        <FileTreePanel />
      </Wrapper>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('b.md'));
    });

    // 先落盘当前文件 A（含未保存编辑），再读盘 B
    expect(window.weaveMD.file.write).toHaveBeenCalledWith('/disk/a.md', '# A edited');
    expect(window.weaveMD.file.readDisk).toHaveBeenCalledWith('/disk/b.md');
    expect(useEditorStore.getState().currentFile?.id).toBe('/disk/b.md');
    expect(useEditorStore.getState().content).toBe('# B disk content');
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it('点击当前已打开文件触发关闭（toggle），先保存再关闭', async () => {
    useEditorStore.setState({
      currentFile: diskA,
      content: '# A edited',
      isDirty: true,
    });
    useFileTreeStore.setState({
      looseFiles: [{ id: '/disk/a.md', name: 'a.md', path: '/disk/a.md' }],
    });

    render(
      <Wrapper>
        <FileTreePanel />
      </Wrapper>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('a.md'));
    });

    // 点击已打开文件 → 先保存 dirty 草稿，再关闭
    expect(window.weaveMD.file.write).toHaveBeenCalledWith('/disk/a.md', '# A edited');
    expect(window.weaveMD.file.readDisk).not.toHaveBeenCalled();
    expect(useEditorStore.getState().currentFile).toBeNull();
  });

  it('始终以磁盘为准读取目标文件，忽略 fileTreeStore 陈旧缓存', async () => {
    useEditorStore.setState({ currentFile: null, content: '', isDirty: false });
    // b.md 有旧缓存 content，但磁盘最新为 mock 的 '# B disk content'
    useFileTreeStore.setState({
      looseFiles: [
        { id: '/disk/b.md', name: 'b.md', path: '/disk/b.md', content: '# STALE CACHE' },
      ],
    });

    render(
      <Wrapper>
        <FileTreePanel />
      </Wrapper>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('b.md'));
    });

    expect(window.weaveMD.file.readDisk).toHaveBeenCalledWith('/disk/b.md');
    expect(useEditorStore.getState().content).toBe('# B disk content');
  });
});

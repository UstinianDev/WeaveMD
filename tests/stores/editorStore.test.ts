// ============================================
// WeaveMD — Editor Store Tests
// ============================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveCurrentDraftIfNeeded } from '@render/services/saveCurrentDraft';
import { useEditorStore } from '@render/stores/editorStore';
import type { IFile } from '@shared/types';

const mockFile: IFile = {
  id: 'file-1',
  userId: 'user-1',
  name: 'test.md',
  content: '# Hello World',
  createdAt: '2024-01-01',
  modifiedAt: '2024-01-01',
  deletedAt: null,
};

describe('editorStore', () => {
  beforeEach(() => {
    useEditorStore.setState({
      currentFile: null,
      content: '',
      isDirty: false,
      undoStack: [],
      redoStack: [],
    });
    vi.clearAllMocks();
  });

  it('should start with empty state', () => {
    const state = useEditorStore.getState();
    expect(state.currentFile).toBeNull();
    expect(state.content).toBe('');
    expect(state.isDirty).toBe(false);
  });

  it('should open a file and set content', () => {
    useEditorStore.getState().openFile(mockFile);

    const state = useEditorStore.getState();
    expect(state.currentFile).toEqual(mockFile);
    expect(state.content).toBe('# Hello World');
    expect(state.isDirty).toBe(false);
  });

  it('should mark dirty on content update', () => {
    useEditorStore.getState().openFile(mockFile);
    useEditorStore.getState().updateContent('# Updated Content');

    const state = useEditorStore.getState();
    expect(state.content).toBe('# Updated Content');
    expect(state.isDirty).toBe(true);
  });

  it('should push previous content to undo stack on update', () => {
    useEditorStore.getState().openFile(mockFile);
    useEditorStore.getState().updateContent('# Change 1');
    useEditorStore.getState().updateContent('# Change 2');

    const state = useEditorStore.getState();
    expect(state.undoStack).toHaveLength(2);
    expect(state.undoStack[0]).toBe('# Hello World');
    expect(state.undoStack[1]).toBe('# Change 1');
  });

  it('should undo and redo content changes', () => {
    useEditorStore.getState().openFile(mockFile);
    useEditorStore.getState().updateContent('# Change 1');

    // Undo
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().content).toBe('# Hello World');
    expect(useEditorStore.getState().redoStack).toHaveLength(1);

    // Redo
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().content).toBe('# Change 1');
    expect(useEditorStore.getState().redoStack).toHaveLength(0);
  });

  it('should close file and reset state', () => {
    useEditorStore.getState().openFile(mockFile);
    useEditorStore.getState().updateContent('# Modified');
    useEditorStore.getState().closeFile();

    const state = useEditorStore.getState();
    expect(state.currentFile).toBeNull();
    expect(state.content).toBe('');
    expect(state.isDirty).toBe(false);
    expect(state.undoStack).toHaveLength(0);
  });

  it('should not push duplicate content to undo stack', () => {
    useEditorStore.getState().openFile(mockFile);
    useEditorStore.getState().updateContent('# Hello World'); // Same content

    expect(useEditorStore.getState().undoStack).toHaveLength(0);
  });

  it('should save the current file and mark it clean', async () => {
    vi.mocked(window.weaveMD.file.save).mockResolvedValue({
      success: true,
      data: {
        ...mockFile,
        content: '# Saved content',
        modifiedAt: '2026-07-07T00:00:00.000Z',
      },
    });

    useEditorStore.getState().openFile(mockFile);
    useEditorStore.getState().updateContent('# Saved content');

    const saved = await useEditorStore.getState().saveFile();

    const state = useEditorStore.getState();
    expect(saved).toBe(true);
    expect(window.weaveMD.file.save).toHaveBeenCalledWith('file-1', '# Saved content', 'user-1');
    expect(state.isDirty).toBe(false);
    expect(state.currentFile?.content).toBe('# Saved content');
    expect(state.currentFile?.modifiedAt).toBe('2026-07-07T00:00:00.000Z');
  });

  it('should skip saving when no file is open', async () => {
    const saved = await useEditorStore.getState().saveFile();
    expect(saved).toBe(false);
    expect(window.weaveMD.file.save).not.toHaveBeenCalled();
  });

  it('should write disk files to disk and mark clean', async () => {
    vi.mocked(window.weaveMD.file.write).mockResolvedValue({ success: true });
    const diskFile: IFile = { ...mockFile, id: '/docs/a.md' };

    useEditorStore.getState().openFile(diskFile);
    useEditorStore.getState().updateContent('# Saved to disk');

    const saved = await useEditorStore.getState().saveFile();

    const state = useEditorStore.getState();
    expect(saved).toBe(true);
    expect(window.weaveMD.file.write).toHaveBeenCalledWith('/docs/a.md', '# Saved to disk');
    expect(state.isDirty).toBe(false);
    expect(state.currentFile?.content).toBe('# Saved to disk');
  });

  it('should return false and keep dirty when disk write fails', async () => {
    vi.mocked(window.weaveMD.file.write).mockResolvedValue({ success: false });
    useEditorStore.getState().openFile({ ...mockFile, id: '/docs/a.md' });
    useEditorStore.getState().updateContent('# Changed');

    const saved = await useEditorStore.getState().saveFile();

    expect(saved).toBe(false);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('should save current draft when dirty before switching', async () => {
    vi.mocked(window.weaveMD.file.save).mockResolvedValue({
      success: true,
      data: {
        ...mockFile,
        content: '# Modified',
        modifiedAt: '2026-07-07T00:00:00.000Z',
      },
    });

    useEditorStore.getState().openFile(mockFile);
    useEditorStore.getState().updateContent('# Modified');

    const result = await saveCurrentDraftIfNeeded();

    expect(result).toBe(true);
    expect(window.weaveMD.file.save).toHaveBeenCalledWith('file-1', '# Modified', 'user-1');
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it('should skip save when current file is clean', async () => {
    useEditorStore.getState().openFile(mockFile);

    const result = await saveCurrentDraftIfNeeded();

    expect(result).toBe(true);
    expect(window.weaveMD.file.save).not.toHaveBeenCalled();
  });
});

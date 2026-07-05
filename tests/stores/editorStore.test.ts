// ============================================
// WeaveMD — Editor Store Tests
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../src/render/stores/editorStore';
import type { IFile } from '../../src/shared/types';

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
});

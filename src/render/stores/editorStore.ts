// ============================================
// WeaveMD — Editor Store (Zustand)
// ============================================

import { create } from 'zustand';
import type { IFile } from '../../shared/types';

interface EditorStore {
  currentFile: IFile | null;
  content: string;
  isDirty: boolean;
  undoStack: string[];
  redoStack: string[];

  openFile: (file: IFile) => void;
  updateContent: (content: string) => void;
  saveFile: () => void;
  closeFile: () => void;
  undo: () => void;
  redo: () => void;
  pushUndo: (content: string) => void;
  markClean: () => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  currentFile: null,
  content: '',
  isDirty: false,
  undoStack: [],
  redoStack: [],

  openFile: (file) => {
    set({
      currentFile: file,
      content: file.content,
      isDirty: false,
      undoStack: [],
      redoStack: [],
    });
  },

  updateContent: (content) => {
    const { undoStack, content: prevContent } = get();
    if (content !== prevContent) {
      set({
        content,
        isDirty: true,
        undoStack: [...undoStack.slice(-49), prevContent],
        redoStack: [],
      });
    }
  },

  saveFile: async () => {
    const { currentFile, content } = get();
    if (!currentFile) return;

    try {
      const result = (await window.weaveMD.file.save(
        currentFile.id,
        content,
        currentFile.userId
      )) as unknown as {
        success: boolean;
        data?: { id: string; name: string; content: string; createdAt: string; modifiedAt: string };
      };
      if (result.success) {
        set({
          isDirty: false,
          currentFile: result.data
            ? {
                ...currentFile,
                content: result.data.content,
                modifiedAt: result.data.modifiedAt,
              }
            : { ...currentFile, content, modifiedAt: new Date().toISOString() },
        });
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  },

  closeFile: () => {
    set({
      currentFile: null,
      content: '',
      isDirty: false,
      undoStack: [],
      redoStack: [],
    });
  },

  undo: () => {
    const { undoStack, content } = get();
    if (undoStack.length === 0) return;

    const prevContent = undoStack[undoStack.length - 1];
    // #region debug-point link-list:dp5-undo
    fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'link-reload-lost',
        runId: 'pre',
        hypothesisId: 'H2-A',
        location: 'editorStore.ts:undo',
        msg: '[DEBUG] undo restoring content',
        data: {
          undoStackLength: undoStack.length,
          prevContent: prevContent.slice(0, 500),
          currentContent: content.slice(0, 500),
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    set({
      content: prevContent,
      isDirty: true,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, content],
    });
  },

  redo: () => {
    const { redoStack, content } = get();
    if (redoStack.length === 0) return;

    const nextContent = redoStack[redoStack.length - 1];
    set({
      content: nextContent,
      isDirty: true,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, content],
    });
  },

  pushUndo: (content) => {
    set((state) => ({
      undoStack: [...state.undoStack.slice(-49), content],
      redoStack: [],
    }));
  },

  markClean: () => set({ isDirty: false }),
}));

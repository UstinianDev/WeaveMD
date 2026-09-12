// ============================================
// WeaveMD — Editor Store (Zustand)
// ============================================

import { create } from 'zustand';
import type { IFile } from '@shared/types';
import { isWelcomeFile } from '@render/services/welcomeDocument';

interface EditorStore {
  currentFile: IFile | null;
  content: string;
  isDirty: boolean;
  undoStack: string[];
  redoStack: string[];

  openFile: (file: IFile) => void;
  updateContent: (content: string) => void;
  saveFile: () => Promise<boolean>;
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

  saveFile: async (): Promise<boolean> => {
    const { currentFile, content } = get();
    console.log('[saveFile] 开始保存，currentFile:', currentFile?.id, 'content length:', content?.length);

    if (!currentFile) {
      console.log('[saveFile] 没有打开的文件，返回 false');
      return false;
    }

    // 欢迎文档为内存只读项：不写盘 / 不写 DB，短路放最前（id 含 `/`，否则会误判为磁盘文件）
    if (isWelcomeFile(currentFile.id)) {
      console.log('[saveFile] 欢迎文档，跳过保存');
      set({ isDirty: false });
      return true;
    }

    try {
      // 判断文件类型：检查 id 是否包含路径分隔符（磁盘文件）
      const hasPathSeparator = currentFile.id && (currentFile.id.includes('/') || currentFile.id.includes('\\'));
      console.log('[saveFile] 文件 id:', currentFile.id, '包含路径分隔符:', hasPathSeparator);

      // 策略1：如果 id 包含路径分隔符，作为磁盘文件保存
      if (hasPathSeparator) {
        console.log('[saveFile] 作为磁盘文件保存，路径:', currentFile.id);
        const writeResult = (await window.weaveMD.file.write(currentFile.id, content)) as unknown as {
          success?: boolean;
        };
        console.log('[saveFile] 磁盘写入结果:', writeResult);

        if (!writeResult || writeResult.success === false) {
          console.error('Failed to save file: disk write returned failure');
          return false;
        }
        set({
          isDirty: false,
          currentFile: { ...currentFile, content, modifiedAt: new Date().toISOString() },
        });
        console.log('[saveFile] 磁盘文件保存成功');
        return true;
      }

      // 策略2：尝试 DB 保存（id 是 UUID 或文件名）
      console.log('[saveFile] 尝试 DB 保存，fileId:', currentFile.id);
      const result = (await window.weaveMD.file.save(
        currentFile.id,
        content,
        currentFile.userId
      )) as unknown as {
        success: boolean;
        data?: { id: string; name: string; content: string; createdAt: string; modifiedAt: string };
      };
      console.log('[saveFile] DB保存结果:', result);

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
        console.log('[saveFile] DB文件保存成功');
        return true;
      }

      // 策略3：DB 保存失败，尝试将文件写入磁盘（兜底方案）
      // 这种情况可能是 AI 创建的文件，id 是文件名而不是路径
      console.log('[saveFile] DB 保存失败，尝试将文件写入磁盘（兜底方案）');
      const diskPath = currentFile.name;
      const writeResult = (await window.weaveMD.file.write(diskPath, content)) as unknown as {
        success?: boolean;
      };
      console.log('[saveFile] 兜底磁盘写入结果:', writeResult);

      if (writeResult && writeResult.success !== false) {
        // 更新文件 id 为磁盘路径
        set({
          isDirty: false,
          currentFile: { ...currentFile, id: diskPath, content, modifiedAt: new Date().toISOString() },
        });
        console.log('[saveFile] 兜底磁盘保存成功，新 id:', diskPath);
        return true;
      }

      console.log('[saveFile] 所有保存策略都失败');
      return false;
    } catch (error) {
      console.error('Failed to save file:', error);
      return false;
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

// ============================================
// WeaveMD — History Store (Zustand)
// ============================================

import { create } from 'zustand';
import type { IFile } from '../../shared/types';

interface HistoryStore {
  files: IFile[];
  searchQuery: string;
  activeHistoryFileId: string | null;

  loadHistory: (userId: string) => Promise<void>;
  searchHistory: (query: string) => void;
  openHistoryFile: (fileId: string) => void;
  deleteHistoryFile: (fileId: string) => Promise<void>;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  files: [],
  searchQuery: '',
  activeHistoryFileId: null,

  loadHistory: async (userId: string) => {
    try {
      const result = await window.weaveMD.file.list(userId);
      if (result && typeof result === 'object' && 'data' in result) {
        const data = (result as { data: IFile[] }).data;
        set({ files: data || [] });
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  },

  searchHistory: (query: string) => {
    set({ searchQuery: query });
  },

  openHistoryFile: (fileId: string) => {
    set({ activeHistoryFileId: fileId });
  },

  deleteHistoryFile: async (fileId: string) => {
    try {
      let userId = '';
      try {
        const userStr = localStorage.getItem('weavemd_user');
        userId = userStr ? JSON.parse(userStr).id : '';
      } catch {
        userId = '';
      }
      await window.weaveMD.file.delete(fileId, userId);
      set((state) => ({
        files: state.files.filter((f) => f.id !== fileId),
        activeHistoryFileId:
          state.activeHistoryFileId === fileId ? null : state.activeHistoryFileId,
      }));
    } catch (error) {
      console.error('Failed to delete file:', error);
    }
  },

  clearHistory: () => {
    set({ files: [], searchQuery: '', activeHistoryFileId: null });
  },
}));

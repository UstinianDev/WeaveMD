// ============================================
// WeaveMD — Auth Store (Zustand)
// ============================================

import { create } from 'zustand';
import type { IUserPublic } from '@shared/types';
import { useEditorStore } from './editorStore';
import { useHistoryStore } from './historyStore';

interface AuthStore {
  user: IUserPublic | null;
  token: string | null;
  isAuthenticated: boolean;
  recentAccounts: string[];

  setUser: (user: IUserPublic) => void;
  setToken: (token: string) => void;
  login: (user: IUserPublic, token: string) => void;
  logout: () => void;
  setRecentAccounts: (accounts: string[]) => void;
  addRecentAccount: (username: string) => void;
  loadRecentAccounts: () => void;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  recentAccounts: [],

  setUser: (user) => set({ user }),

  setToken: (token) => set({ token }),

  login: (user, token) => {
    localStorage.setItem('weavemd_token', token);
    localStorage.setItem('weavemd_user', JSON.stringify(user));
    set({ user, token, isAuthenticated: true });

    // Add to recent accounts
    get().addRecentAccount(user.username);
  },

  logout: () => {
    // Clear editor and history stores to prevent cross-account data leakage
    useEditorStore.getState().closeFile();
    useHistoryStore.getState().clearHistory();

    localStorage.removeItem('weavemd_token');
    localStorage.removeItem('weavemd_user');
    set({ user: null, token: null, isAuthenticated: false });
  },

  setRecentAccounts: (accounts) => set({ recentAccounts: accounts }),

  addRecentAccount: (username) => {
    const { recentAccounts } = get();
    const filtered = recentAccounts.filter((a) => a !== username);
    const updated = [username, ...filtered].slice(0, 10);
    localStorage.setItem('weavemd_recent_accounts', JSON.stringify(updated));
    set({ recentAccounts: updated });
  },

  loadRecentAccounts: () => {
    try {
      const stored = localStorage.getItem('weavemd_recent_accounts');
      if (stored) {
        set({ recentAccounts: JSON.parse(stored) });
      }
    } catch {
      // Ignore parse errors
    }
  },
}));

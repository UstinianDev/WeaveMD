// ============================================
// WeaveMD — Recent (编辑历史/最近打开) Store（Zustand + persist）
// ============================================
// 编辑历史 = 最近打开文件列表，按 lastOpenedAt 时间倒序、重启保留。
// 与 DB 全量 historyStore（HistoryPanel 搜索/删除面板）解耦：
//   - recentStore → 顶部「编辑历史」菜单（最近打开，persist）
//   - historyStore → HistoryPanel（DB 文件列表搜索/删除）

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface RecentFileEntry {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
}

export interface RecentFileInput {
  id: string;
  path: string;
  name: string;
}

/** 最近打开列表上限 */
export const RECENT_MAX = 20;

interface RecentState {
  recent: RecentFileEntry[];
  touchRecent: (file: RecentFileInput) => void;
  removeRecent: (id: string) => void;
  clearRecent: () => void;
}

export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      recent: [],

      // 按 id 去重重置顶（lastOpenedAt = now），超上限剔除最旧
      touchRecent: (file) =>
        set((state) => {
          const now = new Date().toISOString();
          const entry: RecentFileEntry = {
            id: file.id,
            path: file.path,
            name: file.name,
            lastOpenedAt: now,
          };
          const withoutDup = state.recent.filter((f) => f.id !== file.id);
          const next: RecentFileEntry[] = [entry, ...withoutDup].slice(0, RECENT_MAX);
          return { recent: next };
        }),

      removeRecent: (id) =>
        set((state) => ({ recent: state.recent.filter((f) => f.id !== id) })),

      clearRecent: () => set({ recent: [] }),
    }),
    {
      name: 'weavemd_recent',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ recent: s.recent }),
    }
  )
);

/** 供测试：获取时间倒序的最近列表 */
export function getRecentList(): RecentFileEntry[] {
  const { recent } = useRecentStore.getState();
  return [...recent].sort(
    (a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
  );
}

/** 记录一次打开（去重置顶、上限裁剪）。供 useNavbarActions/FileTreePanel/handleOpenFile 等调用 */
export function touchRecent(file: RecentFileInput): void {
  useRecentStore.getState().touchRecent(file);
}

/** 移除指定 id 的最近项 */
export function removeRecent(id: string): void {
  useRecentStore.getState().removeRecent(id);
}

/** 清空最近列表 */
export function clearRecent(): void {
  useRecentStore.getState().clearRecent();
}

/** 供测试：重置内存态（并清掉持久化存储，避免测试间污染） */
export function resetRecentStore(): void {
  useRecentStore.setState({ recent: [] });
  try {
    window.localStorage.removeItem('weavemd_recent');
  } catch {
    // noop
  }
}

// ============================================
// WeaveMD — File Tree Store (Zustand)
// ============================================

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface IFolderNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children: IFolderNode[];
  expanded: boolean;
  isRoot: boolean;
}

export interface IFileNode {
  id: string;
  name: string;
  path: string;
  content?: string;
}

interface FileTreeState {
  folders: IFolderNode[];
  looseFiles: IFileNode[];
  activeTab: 'outline' | 'files';
  isLoading: boolean;
  error: string | null;
  selectedIds: string[];
}

interface FileTreeActions {
  setActiveTab: (tab: 'outline' | 'files') => void;
  addFolder: (folder: IFolderNode) => void;
  removeFolder: (folderId: string) => void;
  addFile: (file: IFileNode) => void;
  removeFile: (fileId: string) => void;
  removeFileFromEverywhere: (fileId: string) => void;
  removeNodeFromTree: (folderId: string, nodeId: string) => void;
  toggleExpand: (folderId: string) => void;
  loadFolderContents: (path: string) => Promise<void>;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  clearAll: () => void;
  getSelectedFolder: () => IFolderNode | null;
  /** 重启恢复：磁盘失效路径剔除并返回移除项，有效 folder 实读重建 */
  restore: () => Promise<{ removed: string[] }>;
}

/** restore() 结果，供 MainPage 汇总后 setErrorMessage 提示 */
export interface RestoreSummary {
  /** 因磁盘失效被剔除的路径（文件或文件夹） */
  removed: string[];
}

function removeFromTree(nodes: IFolderNode[], targetId: string): IFolderNode[] {
  return nodes
    .filter((n) => n.id !== targetId)
    .map((n) => ({ ...n, children: removeFromTree(n.children, targetId) }));
}

function toggleInTree(nodes: IFolderNode[], targetId: string): IFolderNode[] {
  return nodes.map((n) => {
    if (n.id === targetId) {
      return { ...n, expanded: !n.expanded };
    }
    return { ...n, children: toggleInTree(n.children, targetId) };
  });
}

function sortNodes(nodes: IFolderNode[]): IFolderNode[] {
  return [...(nodes ?? [])]
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((n) => ({ ...n, children: sortNodes(n.children ?? []) }));
}

function sortLooseFiles(files: IFileNode[]): IFileNode[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name));
}

/** 仅保留路径结构，剔除 content（磁盘只存路径，不存内容） */
function stripContent(nodes: IFolderNode[]): IFolderNode[] {
  return (nodes ?? []).map((n) => ({
    id: n.id,
    name: n.name,
    path: n.path,
    isDirectory: n.isDirectory,
    expanded: n.expanded,
    isRoot: n.isRoot,
    children: stripContent(n.children ?? []),
  }));
}

/** 欢迎文档不持久化：内容不入盘、节点不入 localStorage（重启后重新注入带完整内容） */
function isPersistableLooseFile(f: IFileNode): boolean {
  return !f.id.startsWith('welcome://');
}

function stripLooseContent(files: IFileNode[]): Array<Omit<IFileNode, 'content'>> {
  return files
    .filter(isPersistableLooseFile)
    .map((f) => ({ id: f.id, name: f.name, path: f.path }));
}

/** persist 需要持久化的切片（不含 content） */
interface PersistedFileTreeState {
  folders: IFolderNode[];
  looseFiles: IFileNode[];
  activeTab: 'outline' | 'files';
  selectedIds: string[];
}

export const useFileTreeStore = create<FileTreeState & FileTreeActions>()(
  persist(
    (set, get) => ({
  folders: [],
  looseFiles: [],
  activeTab: 'files',
  isLoading: false,
  error: null,
  selectedIds: [],

  setActiveTab: (tab) => set({ activeTab: tab }),

  addFolder: (folder) =>
    set((state) => ({
      folders: sortNodes([...state.folders, folder]),
    })),

  removeFolder: (folderId) =>
    set((state) => ({
      folders: state.folders
        .filter((f) => f.id !== folderId)
        .map((f) => ({ ...f, children: removeFromTree(f.children, folderId) })),
      selectedIds: state.selectedIds.filter((sid) => sid !== folderId),
    })),

  addFile: (file) =>
    set((state) => ({
      looseFiles: sortLooseFiles([...state.looseFiles, file]),
    })),

  removeFile: (fileId) =>
    set((state) => ({
      looseFiles: state.looseFiles.filter((f) => f.id !== fileId),
      selectedIds: state.selectedIds.filter((sid) => sid !== fileId),
    })),

  removeFileFromEverywhere: (fileId) =>
    set((state) => ({
      looseFiles: state.looseFiles.filter((f) => f.id !== fileId),
      folders: state.folders.map((folder) => ({
        ...folder,
        children: removeFromTree(folder.children, fileId),
      })),
      selectedIds: state.selectedIds.filter((sid) => sid !== fileId),
    })),

  removeNodeFromTree: (folderId, nodeId) =>
    set((state) => ({
      folders: state.folders.map((folder) => {
        if (folder.id === folderId) {
          return { ...folder, children: removeFromTree(folder.children, nodeId) };
        }
        return folder;
      }),
      selectedIds: state.selectedIds.filter((sid) => sid !== nodeId),
    })),

  toggleExpand: (folderId) =>
    set((state) => ({
      folders: state.folders.map((folder) => {
        if (folder.id === folderId) {
          return { ...folder, expanded: !folder.expanded };
        }
        return { ...folder, children: toggleInTree(folder.children, folderId) };
      }),
    })),

  loadFolderContents: async (path) => {
    set({ isLoading: true, error: null });
    try {
      const result = (await window.weaveMD.folder.readFolder(path)) as unknown as {
        success: boolean;
        data: Array<{ name: string; path: string; isDirectory: boolean }>;
      };

      if (!result.success) {
        throw new Error('Failed to read folder contents');
      }

      const normalizedPath = path.replace(/\\/g, '/');

      const pathToNode = new Map<string, IFolderNode>();

      const rootName = normalizedPath.split(/[\\/]/).pop() || normalizedPath;
      const rootFolder: IFolderNode = {
        id: normalizedPath,
        name: rootName,
        path: normalizedPath,
        isDirectory: true,
        children: [],
        expanded: true,
        isRoot: true,
      };
      pathToNode.set(normalizedPath, rootFolder);

      const sortedItems = [...result.data].sort((a, b) => a.path.length - b.path.length);

      for (const item of sortedItems) {
        const node: IFolderNode = {
          id: item.path,
          name: item.name,
          path: item.path,
          isDirectory: item.isDirectory,
          children: [],
          expanded: false,
          isRoot: false,
        };
        pathToNode.set(item.path, node);

        const parentPath = item.path.substring(0, item.path.lastIndexOf('/'));
        const parent = pathToNode.get(parentPath) || pathToNode.get(path);
        if (parent) {
          parent.children.push(node);
        } else {
          rootFolder.children.push(node);
        }
      }

      set((state) => {
        const existingFolders = state.folders.filter((f) => f.path !== normalizedPath);
        rootFolder.children = sortNodes(rootFolder.children);
        return {
          folders: sortNodes([...existingFolders, rootFolder]),
          isLoading: false,
        };
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  toggleSelect: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((sid) => sid !== id)
        : [...state.selectedIds, id],
    })),

  clearSelection: () => set({ selectedIds: [] }),

  getSelectedFolder: () => {
    const state = get();

    // Recursively search for a selected folder node (root or nested)
    const findInNodes = (nodes: IFolderNode[]): IFolderNode | null => {
      for (const node of nodes) {
        if (node.isDirectory && state.selectedIds.includes(node.id)) {
          return node;
        }
        const found = findInNodes(node.children);
        if (found) return found;
      }
      return null;
    };

    return findInNodes(state.folders);
  },

  clearAll: () => set({ folders: [], looseFiles: [], selectedIds: [], error: null }),

  restore: async (): Promise<RestoreSummary> => {
    const { looseFiles, folders } = get();
    const removed: string[] = [];
    const remainingLoose: IFileNode[] = [];

    // looseFile：readDisk 失败则剔除并记录移除项；welcome:// 遗留节点一并剔除（由注入重建，不入盘）
    for (const file of looseFiles) {
      if (file.id.startsWith('welcome://')) continue;
      try {
        const r = (await window.weaveMD.file.readDisk(file.path)) as unknown as {
          success: boolean;
        };
        if (r.success) {
          remainingLoose.push(file);
        } else {
          removed.push(file.path);
        }
      } catch {
        removed.push(file.path);
      }
    }

    // root folder：readFolder 失败剔除；成功则丢弃 persisted 子节点，用 loadFolderContents 实读重建
    for (const folder of folders) {
      if (!folder.isRoot) continue;
      let folderOk = false;
      try {
        const r = (await window.weaveMD.folder.readFolder(folder.path)) as unknown as {
          success: boolean;
        };
        folderOk = r.success;
      } catch {
        folderOk = false;
      }
      if (folderOk) {
        // 实读重建（丢弃 persisted 子节点，避免磁盘漂移脏数据）
        await get().loadFolderContents(folder.path);
      } else {
        removed.push(folder.path);
      }
    }

    // 汇总最终文件夹：基于当前 state（loadFolderContents 已写入重建 root），再剔除失效 root
    const finalFolders = get().folders.filter(
      (f) => !removed.includes(f.path) || f.isRoot === false
    );

    set({
      looseFiles: remainingLoose,
      folders: finalFolders,
      selectedIds: [],
      error: null,
    });
    return { removed };
  },
}),
    {
      name: 'weavemd_filetree',
      storage: createJSONStorage(() => localStorage),
      version: 0,
      partialize: (s): PersistedFileTreeState => ({
        folders: stripContent(s.folders),
        looseFiles: stripLooseContent(s.looseFiles),
        activeTab: s.activeTab,
        selectedIds: s.selectedIds,
      }),
    }
  )
);

/** 供测试：重置内存态（并清掉持久化存储，避免测试间污染） */
export function resetFileTreeStore(): void {
  useFileTreeStore.setState({
    folders: [],
    looseFiles: [],
    activeTab: 'files',
    isLoading: false,
    error: null,
    selectedIds: [],
  });
  try {
    window.localStorage.removeItem('weavemd_filetree');
  } catch {
    // noop
  }
}

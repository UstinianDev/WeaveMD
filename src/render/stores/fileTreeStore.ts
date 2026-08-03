// ============================================
// WeaveMD — File Tree Store (Zustand)
// ============================================

import { create } from 'zustand';

export interface IFolderNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children: IFolderNode[];
  expanded: boolean;
  isRoot: boolean;
}

interface FileTreeState {
  folders: IFolderNode[];
  activeTab: 'outline' | 'files';
  isLoading: boolean;
  error: string | null;
}

interface FileTreeActions {
  setActiveTab: (tab: 'outline' | 'files') => void;
  addFolder: (folder: IFolderNode) => void;
  removeFolder: (folderId: string) => void;
  removeFile: (folderId: string, fileId: string) => void;
  toggleExpand: (folderId: string) => void;
  loadFolderContents: (path: string) => Promise<void>;
  clearAll: () => void;
}

/** Recursively remove a node by id from a tree */
function removeFromTree(nodes: IFolderNode[], targetId: string): IFolderNode[] {
  return nodes
    .filter((n) => n.id !== targetId)
    .map((n) => ({ ...n, children: removeFromTree(n.children, targetId) }));
}

/** Recursively toggle expansion of a node by id in a tree */
function toggleInTree(nodes: IFolderNode[], targetId: string): IFolderNode[] {
  return nodes.map((n) => {
    if (n.id === targetId) {
      return { ...n, expanded: !n.expanded };
    }
    return { ...n, children: toggleInTree(n.children, targetId) };
  });
}

export const useFileTreeStore = create<FileTreeState & FileTreeActions>((set, _get) => ({
  folders: [],
  activeTab: 'files',
  isLoading: false,
  error: null,

  setActiveTab: (tab) => set({ activeTab: tab }),

  addFolder: (folder) =>
    set((state) => ({
      folders: [...state.folders, folder],
    })),

  removeFolder: (folderId) =>
    set((state) => ({
      folders: state.folders.filter((f) => f.id !== folderId),
    })),

  removeFile: (_folderId, fileId) =>
    set((state) => ({
      folders: state.folders.map((folder) => ({
        ...folder,
        children: removeFromTree(folder.children, fileId),
      })),
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

      // Normalize path separator to '/' for consistent tree building
      const normalizedPath = path.replace(/\\/g, '/');

      // Build hierarchical tree from flat list using path prefixes
      const pathToNode = new Map<string, IFolderNode>();

      // Create root node
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

      // Sort by path to ensure parents are processed before children
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

        // Find parent by checking which existing path is a prefix
        const parentPath = item.path.substring(0, item.path.lastIndexOf('/'));
        const parent = pathToNode.get(parentPath) || pathToNode.get(path);
        if (parent) {
          parent.children.push(node);
        } else {
          rootFolder.children.push(node);
        }
      }

      set((state) => ({
        folders: [...state.folders.filter((f) => f.path !== normalizedPath), rootFolder],
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  clearAll: () => set({ folders: [], error: null }),
}));

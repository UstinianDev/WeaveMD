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
  return [...nodes]
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((n) => ({ ...n, children: sortNodes(n.children) }));
}

function sortLooseFiles(files: IFileNode[]): IFileNode[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name));
}

export const useFileTreeStore = create<FileTreeState & FileTreeActions>((set, _get) => ({
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
    const state = _get();

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
}));

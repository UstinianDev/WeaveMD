// ============================================
// WeaveMD — Navbar Actions Hook
// ============================================
// 顶部导航栏的全部业务逻辑（store 订阅 + 文件/文件夹操作 + 快捷键处理函数），
// 从 TopBar 组件中提取，使组件只负责编排与渲染。

import { useCallback, useState } from 'react';

import type { IFile } from '../../../shared/types';
import { createDiskFile } from '../../services/fileOps';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/authStore';
import { useEditorStore } from '../../stores/editorStore';
import { useFileTreeStore } from '../../stores/fileTreeStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useUIStore } from '../../stores/uiStore';

interface DialogPathResult {
  success: boolean;
  data?: { path: string };
}

interface ReadDiskResult {
  success: boolean;
  data?: { path: string; name: string; content: string };
}

export function useNavbarActions() {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const { t } = useI18n();

  // --- Stores ---
  const user = useAuthStore((s) => s.user);
  const currentFile = useEditorStore((s) => s.currentFile);
  const openFile = useEditorStore((s) => s.openFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const saveFile = useEditorStore((s) => s.saveFile);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);

  const openModal = useUIStore((s) => s.openModal);
  const toggleHistoryPanel = useUIStore((s) => s.toggleHistoryPanel);
  const flushEditorDraft = useUIStore((s) => s.flushEditorDraft);

  const setActiveTab = useFileTreeStore((s) => s.setActiveTab);
  const loadFolderContents = useFileTreeStore((s) => s.loadFolderContents);
  const removeFolder = useFileTreeStore((s) => s.removeFolder);
  const addFile = useFileTreeStore((s) => s.addFile);
  const removeFileFromEverywhere = useFileTreeStore((s) => s.removeFileFromEverywhere);
  const getSelectedFolder = useFileTreeStore((s) => s.getSelectedFolder);

  const files = useHistoryStore((s) => s.files);

  // --- Helpers ---

  const saveCurrentDraftIfNeeded = useCallback(async () => {
    await flushEditorDraft();
    const { currentFile: latestCurrentFile, isDirty: latestIsDirty } = useEditorStore.getState();
    if (latestCurrentFile?.id && latestIsDirty) {
      await saveFile();
    }
  }, [flushEditorDraft, saveFile]);

  // --- Undo / Redo ---

  const handleUndo = useCallback(async () => {
    await flushEditorDraft();
    undo();
  }, [flushEditorDraft, undo]);

  const handleRedo = useCallback(async () => {
    await flushEditorDraft();
    redo();
  }, [flushEditorDraft, redo]);

  // --- File actions ---

  const handleNewFile = useCallback(async () => {
    if (!user) return;
    try {
      const result = (await window.weaveMD.dialog.saveFilePath(
        t('navbar.newFileDialog'),
        'untitled.md'
      )) as unknown as DialogPathResult;
      if (!result.success || !result.data) return;

      const filePath = result.data.path;
      // Ensure .md extension
      const finalPath = filePath.endsWith('.md') ? filePath : `${filePath}.md`;

      // Create empty file on disk
      await window.weaveMD.file.write(finalPath, '');

      // Read back and open
      const readResult = (await window.weaveMD.file.readDisk(finalPath)) as unknown as ReadDiskResult;
      if (readResult.success && readResult.data) {
        const file: IFile = createDiskFile(user, readResult.data);
        openFile(file);
        addFile({
          id: readResult.data.path,
          name: readResult.data.name,
          path: readResult.data.path,
          content: '',
        });
      }
    } catch {
      setErrorMessage(t('navbar.createFileFailed'));
    }
  }, [user, openFile, addFile, t]);

  const handleOpenFile = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      await saveCurrentDraftIfNeeded();
      const result = (await window.weaveMD.file.open()) as unknown as ReadDiskResult;
      if (result.success && result.data) {
        // Use disk path as file ID for real-time filesystem sync
        const file: IFile = createDiskFile(user, result.data);
        openFile(file);

        // Add to file tree sidebar
        addFile({
          id: result.data.path,
          name: result.data.name,
          path: result.data.path,
          content: result.data.content,
        });
      }
    } catch {
      setErrorMessage(t('navbar.openFileFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [user, saveCurrentDraftIfNeeded, openFile, addFile, t]);

  const handleDeleteFile = useCallback(async () => {
    if (!currentFile) return;
    if (!window.confirm(t('navbar.confirmDeleteFile'))) return;
    await saveCurrentDraftIfNeeded();
    if (currentFile.id) {
      // Delete from disk if it's a disk file (path-based id)
      if (currentFile.id.includes('/') || currentFile.id.includes('\\')) {
        await window.weaveMD.file.deleteDisk(currentFile.id);
      }
      // Remove from file tree (both looseFiles and folder trees)
      removeFileFromEverywhere(currentFile.id);
    }
    closeFile();
  }, [currentFile, saveCurrentDraftIfNeeded, closeFile, removeFileFromEverywhere, t]);

  const handleCloseFile = useCallback(async () => {
    await saveCurrentDraftIfNeeded();
    closeFile();
  }, [saveCurrentDraftIfNeeded, closeFile]);

  // --- Folder actions ---

  const handleNewFolder = useCallback(async () => {
    try {
      // Use saveFilePath dialog (supports createDirectory) to let user pick location + enter folder name
      const result = (await window.weaveMD.dialog.saveFilePath(
        t('navbar.newFolderDialog'),
        'new-folder',
        [{ name: 'All Files', extensions: ['*'] }]
      )) as unknown as DialogPathResult;

      if (!result.success || !result.data) return;

      const folderPath = result.data.path;

      // Create the folder on disk
      await window.weaveMD.folder.createFolder(folderPath, '');

      const normalizedPath = folderPath.replace(/\\/g, '/');
      loadFolderContents(normalizedPath);
      setActiveTab('files');
    } catch {
      setErrorMessage(t('navbar.createFolderFailed'));
    }
  }, [loadFolderContents, setActiveTab, t]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const result = (await window.weaveMD.dialog.openFolder()) as unknown as {
        success: boolean;
        data?: { path: string };
      };
      if (result.success && result.data) {
        loadFolderContents(result.data.path);
        setActiveTab('files');
      }
    } catch {
      setErrorMessage(t('navbar.openFolderFailed'));
    }
  }, [loadFolderContents, setActiveTab, t]);

  const handleDeleteFolder = useCallback(async () => {
    // Get the selected folder from the sidebar
    const selectedFolder = getSelectedFolder();
    if (!selectedFolder) {
      setErrorMessage(t('navbar.selectFolderFirst'));
      return;
    }

    const folderPath = selectedFolder.path;

    if (!window.confirm(t('navbar.confirmDeleteFolder'))) return;

    // Check if current file is inside this folder
    if (currentFile?.id && currentFile.id.startsWith(folderPath)) {
      closeFile();
    }

    try {
      // Delete folder from disk (real-time filesystem sync)
      const deleteResult = (await window.weaveMD.folder.deleteFolder(folderPath)) as unknown as {
        success: boolean;
      };
      if (deleteResult.success) {
        // Remove from file tree
        removeFolder(selectedFolder.id);
      } else {
        setErrorMessage(t('navbar.deleteFolderFailed'));
      }
    } catch {
      setErrorMessage(t('navbar.deleteFolderFailed'));
    }
  }, [getSelectedFolder, removeFolder, currentFile, closeFile, t]);

  // --- History ---

  const handleHistoryOpenFile = useCallback(
    async (file: IFile) => {
      if (currentFile?.id !== file.id) {
        await saveCurrentDraftIfNeeded();
      }
      openFile(file);
    },
    [currentFile?.id, saveCurrentDraftIfNeeded, openFile]
  );

  // --- Misc ---

  const handleFindReplace = useCallback(() => {
    useUIStore.getState().toggleFindReplace();
  }, []);

  return {
    user,
    currentFile,
    undoStack,
    redoStack,
    files,
    isLoading,
    errorMessage,
    setErrorMessage,
    openModal,
    toggleHistoryPanel,
    handleUndo,
    handleRedo,
    handleNewFile,
    handleOpenFile,
    handleDeleteFile,
    handleCloseFile,
    handleNewFolder,
    handleOpenFolder,
    handleDeleteFolder,
    handleHistoryOpenFile,
    handleFindReplace,
  };
}

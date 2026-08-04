// ============================================
// WeaveMD — IPC Handlers Registration
// ============================================
import crypto from 'crypto';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import {
  IPC_CHANNELS,
  PASSWORD_MIN_LENGTH,
  RESERVED_USERNAMES,
  USERNAME_REGEX,
} from '../shared/constants';
import { createFile, deleteFile, getFile, listFiles, updateFileContent } from './db/files';
import { getHistoryForFile, getLastVersion, saveVersion } from './db/history';
import { getSettings, updateSettings } from './db/settings';
import {
  createUser,
  deleteUser,
  findById,
  getAccountInfo,
  isUsernameTaken,
  validateCredentials,
} from './db/users';

// JWT secret derived from user data path (unique per machine, stable across restarts)
function getJwtSecret(): string {
  return crypto.createHash('sha256').update(app.getPath('userData')).digest('hex');
}

function generateToken(userId: string, username: string, rememberMe: boolean): string {
  const expiresIn = rememberMe ? '30d' : '1d';
  return jwt.sign({ userId, username }, getJwtSecret(), { expiresIn });
}

function verifyToken(token: string): { userId: string; username: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { userId: string; username: string };
    return decoded;
  } catch {
    return null;
  }
}

export function registerAllIpcHandlers(): void {
  // ========================================
  // Window Controls
  // ========================================

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_UNMAXIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.unmaximize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  // ========================================
  // Dialog
  // ========================================

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FILE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false, error: 'No window' };

    const result = await dialog.showOpenDialog(win, {
      title: 'Open Markdown File',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Cancelled' };
    }

    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    const name = filePath.split(/[/\\]/).pop() || 'untitled.md';

    return { success: true, data: { path: filePath, name, content } };
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_SAVE_FILE, async (_event, { defaultName, filters }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No window' };

    const result = await dialog.showSaveDialog(win, {
      title: 'Export File',
      defaultPath: defaultName,
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Cancelled' };
    }

    return { success: true, data: { filePath: result.filePath } };
  });

  ipcMain.handle(
    IPC_CHANNELS.DIALOG_SAVE_FILE_PATH,
    async (_event, { title, defaultName, filters }) => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return { success: false, error: 'No window' };

      const result = await dialog.showSaveDialog(win, {
        title: title || 'Save File',
        defaultPath: defaultName || '',
        filters: filters || [{ name: 'Markdown', extensions: ['md'] }],
        properties: ['createDirectory'],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Cancelled' };
      }

      return { success: true, data: { path: result.filePath } };
    }
  );

  // ========================================
  // Auth
  // ========================================

  ipcMain.handle(IPC_CHANNELS.AUTH_REGISTER, async (_event, { username, password }) => {
    // Validate username format
    if (!username || typeof username !== 'string') {
      return { success: false, message: 'Username is required' };
    }

    const normalized = username.toLowerCase().trim();

    if (!USERNAME_REGEX.test(normalized)) {
      return {
        success: false,
        message:
          'Username must be 5-15 characters, start with a letter, and contain only a-z, 0-9, _',
      };
    }

    // Check reserved usernames
    if (RESERVED_USERNAMES.includes(normalized)) {
      return { success: false, message: 'This username is reserved and cannot be used' };
    }

    // Validate password
    if (!password || typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
      return { success: false, message: 'Password must be at least 8 characters' };
    }

    const result = createUser(normalized, password);
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_event, { username, password, rememberMe }) => {
    if (!username || !password) {
      return { success: false, message: 'Username and password are required' };
    }

    const result = validateCredentials(username, password);

    if (!result.success || !result.user) {
      return { success: false, message: result.message };
    }

    const token = generateToken(result.user.id, result.user.username, rememberMe || false);

    return {
      success: true,
      data: {
        token,
        user: {
          id: result.user.id,
          username: result.user.username,
          createdAt: result.user.created_at,
          lastLogin: result.user.last_login,
        },
      },
    };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_CHECK_USERNAME, async (_event, username) => {
    if (!username || typeof username !== 'string') {
      return { available: false, message: 'Username is required' };
    }

    const normalized = username.toLowerCase().trim();

    if (!USERNAME_REGEX.test(normalized)) {
      return {
        available: false,
        message: 'Username must be 5-15 chars, start with letter, a-z/0-9/_',
      };
    }

    if (RESERVED_USERNAMES.includes(normalized)) {
      return { available: false, message: 'This username is reserved' };
    }

    if (isUsernameTaken(normalized)) {
      return { available: false, message: 'This username is already taken' };
    }

    return { available: true, message: 'Username is available' };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_VALIDATE_TOKEN, async (_event, token) => {
    if (!token) return { success: false };

    const decoded = verifyToken(token);
    if (!decoded) return { success: false };

    const user = findById(decoded.userId);
    if (!user) return { success: false };

    return {
      success: true,
      data: {
        id: user.id,
        username: user.username,
        createdAt: user.created_at,
        lastLogin: user.last_login,
      },
    };
  });

  // ========================================
  // Account Management
  // ========================================

  ipcMain.handle(IPC_CHANNELS.ACCOUNT_INFO, async (_event, userId) => {
    try {
      const info = getAccountInfo(userId);
      if (!info) return { success: false, message: 'User not found' };
      return { success: true, data: info };
    } catch (error) {
      return { success: false, message: 'Failed to get account info' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ACCOUNT_DELETE, async (_event, userId) => {
    try {
      const result = deleteUser(userId);
      return result;
    } catch (error) {
      return { success: false, message: 'Failed to delete account' };
    }
  });

  // ========================================
  // Files
  // ========================================

  ipcMain.handle(IPC_CHANNELS.FILE_CREATE, async (_event, { userId, name }) => {
    try {
      const file = createFile(userId, name || 'untitled.md');
      return { success: true, data: file };
    } catch (error) {
      return { success: false, message: 'Failed to create file' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_LIST, async (_event, userId) => {
    try {
      const files = listFiles(userId);
      return { success: true, data: files };
    } catch (error) {
      return { success: false, message: 'Failed to list files' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_SAVE, async (_event, { fileId, content, userId }) => {
    try {
      // Save current version to history before updating
      const currentFile = getFile(fileId, userId);
      if (currentFile) {
        const lastVersion = getLastVersion(fileId);
        // Simple diff: just store the previous content
        saveVersion(fileId, lastVersion + 1, currentFile.content);
      }

      const updated = updateFileContent(fileId, userId, content);
      if (!updated) {
        return { success: false, message: 'File not found' };
      }
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, message: 'Failed to save file' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_DELETE, async (_event, { fileId, userId }) => {
    try {
      const success = deleteFile(fileId, userId);
      return { success, message: success ? 'File deleted' : 'File not found' };
    } catch (error) {
      return { success: false, message: 'Failed to delete file' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_GET, async (_event, { fileId, userId }) => {
    try {
      const file = getFile(fileId, userId);
      if (!file) return { success: false, message: 'File not found' };
      return { success: true, data: file };
    } catch (error) {
      return { success: false, message: 'Failed to get file' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_event, { filePath, content }) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      return { success: false, message: 'Failed to write file' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_DELETE_DISK, async (_event, filePath) => {
    try {
      fs.unlinkSync(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, message: 'Failed to delete file' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_event, filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        success: true,
        data: { path: filePath, name: filePath.split(/[/\\]/).pop(), content },
      };
    } catch (error) {
      return { success: false, message: 'Failed to read file' };
    }
  });

  // ========================================
  // History
  // ========================================

  ipcMain.handle(IPC_CHANNELS.HISTORY_LIST, async (_event, fileId) => {
    try {
      const history = getHistoryForFile(fileId);
      return { success: true, data: history };
    } catch (error) {
      return { success: false, message: 'Failed to get history' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_GET, async (_event, { fileId, userId }) => {
    try {
      const file = getFile(fileId, userId);
      if (!file) return { success: false, message: 'File not found' };
      const history = getHistoryForFile(fileId);
      return { success: true, data: { file, history } };
    } catch (error) {
      return { success: false, message: 'Failed to get history entry' };
    }
  });

  // ========================================
  // Settings
  // ========================================

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (_event, userId) => {
    try {
      const settings = getSettings(userId);
      return { success: true, data: settings || { theme: 'dark', language: 'zh-CN' } };
    } catch (error) {
      return { success: false, message: 'Failed to get settings' };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_UPDATE,
    async (_event, { userId, theme, language, customColors }) => {
      try {
        const updated = updateSettings(userId, { theme, language, customColors });
        return { success: true, data: updated };
      } catch (error) {
        return { success: false, message: 'Failed to update settings' };
      }
    }
  );

  // ========================================
  // Export
  // ========================================

  ipcMain.handle(IPC_CHANNELS.EXPORT_MD, async (_event, { content, filename }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No window' };
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Markdown',
      defaultPath: `${filename}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, data: { filePath: result.filePath } };
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_DOCX, async (_event, { content, filename }) => {
    // Simple DOCX export: save as HTML-wrapped file with .doc extension
    // Full docx library integration would be added in a real production version
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No window' };
    const result = await dialog.showSaveDialog(win, {
      title: 'Export as Word',
      defaultPath: `${filename}.doc`,
      filters: [{ name: 'Word Document', extensions: ['doc'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><pre>${content}</pre></body></html>`;
    fs.writeFileSync(result.filePath, htmlContent, 'utf-8');
    return { success: true, data: { filePath: result.filePath } };
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_PDF, async (_event, { content, filename }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No window' };
    const result = await dialog.showSaveDialog(win, {
      title: 'Export as PDF',
      defaultPath: `${filename}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };

    // Create hidden window for PDF printing
    const pdfWin = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: -apple-system, sans-serif; padding: 40px; color: #000; background: #fff; white-space: pre-wrap; }
    </style></head><body>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body></html>`;

    await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    const pdfData = await pdfWin.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(result.filePath, pdfData);
    pdfWin.close();
    return { success: true, data: { filePath: result.filePath } };
  });

  // ========================================
  // Folder
  // ========================================

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false, error: 'No window' };

    try {
      const result = await dialog.showOpenDialog(win, {
        title: 'Open Folder',
        properties: ['openDirectory'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' };
      }

      return { success: true, data: { path: result.filePaths[0] } };
    } catch (error) {
      return { success: false, error: 'Failed to open folder dialog' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER_READ, async (_event, folderPath: string) => {
    try {
      const files: Array<{ name: string; path: string; isDirectory: boolean }> = [];

      const scan = (dir: string) => {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const fullPath = `${dir}/${entry}`.replace(/\\/g, '/');
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            files.push({ name: entry, path: fullPath, isDirectory: true });
            scan(fullPath);
          } else if (entry.endsWith('.md')) {
            files.push({ name: entry, path: fullPath, isDirectory: false });
          }
        }
      };

      scan(folderPath);
      return { success: true, data: files };
    } catch (error) {
      return { success: false, message: 'Failed to read folder' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER_CREATE, async (_event, { path, name }) => {
    try {
      // If name is empty, path is the full folder path (from saveFilePath dialog)
      const targetPath = name ? `${path}/${name}` : path;
      fs.mkdirSync(targetPath, { recursive: true });
      return { success: true, data: { path: targetPath, name } };
    } catch (error) {
      return { success: false, message: 'Failed to create folder' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER_DELETE, async (_event, folderPath: string) => {
    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
      return { success: true };
    } catch (error) {
      return { success: false, message: 'Failed to delete folder' };
    }
  });

  // ========================================
  // Link — open external URL in system browser
  // ========================================
  ipcMain.handle(IPC_CHANNELS.LINK_OPEN_EXTERNAL, (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });
}

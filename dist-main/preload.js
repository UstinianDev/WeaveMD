"use strict";
const electron = require("electron");
const IPC_CHANNELS = {
  // Auth
  AUTH_LOGIN: "auth:login",
  AUTH_REGISTER: "auth:register",
  AUTH_CHECK_USERNAME: "auth:check-username",
  AUTH_VALIDATE_TOKEN: "auth:validate-token",
  // Files
  FILE_CREATE: "file:create",
  FILE_SAVE: "file:save",
  FILE_DELETE: "file:delete",
  FILE_LIST: "file:list",
  FILE_GET: "file:get",
  // History
  HISTORY_LIST: "history:list",
  HISTORY_GET: "history:get",
  // Settings
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  // Export
  EXPORT_MD: "export:md",
  EXPORT_DOCX: "export:docx",
  EXPORT_PDF: "export:pdf",
  // Window
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_UNMAXIMIZE: "window:unmaximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_IS_MAXIMIZED: "window:is-maximized",
  // Dialog
  DIALOG_OPEN_FILE: "dialog:open-file",
  DIALOG_SAVE_FILE: "dialog:save-file",
  // Account
  ACCOUNT_INFO: "account:info",
  ACCOUNT_DELETE: "account:delete"
};
const api = {
  auth: {
    login: (username, password, rememberMe) => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, { username, password, rememberMe }),
    register: (username, password) => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_REGISTER, { username, password }),
    checkUsername: (username) => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_CHECK_USERNAME, username),
    validateToken: (token) => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_VALIDATE_TOKEN, token)
  },
  file: {
    create: (userId, name) => electron.ipcRenderer.invoke(IPC_CHANNELS.FILE_CREATE, { userId, name }),
    open: () => electron.ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE),
    save: (fileId, content, userId) => electron.ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE, { fileId, content, userId }),
    delete: (fileId, userId) => electron.ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE, { fileId, userId }),
    list: (userId) => electron.ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST, userId),
    get: (fileId, userId) => electron.ipcRenderer.invoke(IPC_CHANNELS.FILE_GET, { fileId, userId })
  },
  history: {
    list: (fileId) => electron.ipcRenderer.invoke(IPC_CHANNELS.HISTORY_LIST, fileId),
    get: (fileId, userId) => electron.ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET, { fileId, userId })
  },
  settings: {
    get: (userId) => electron.ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, userId),
    update: (userId, settings) => electron.ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, { userId, ...settings })
  },
  export: {
    md: (content, filename) => electron.ipcRenderer.invoke(IPC_CHANNELS.EXPORT_MD, { content, filename }),
    docx: (content, filename) => electron.ipcRenderer.invoke(IPC_CHANNELS.EXPORT_DOCX, { content, filename }),
    pdf: (content, filename) => electron.ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PDF, { content, filename })
  },
  window: {
    minimize: () => electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
    unmaximize: () => electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_UNMAXIMIZE),
    close: () => electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    isMaximized: () => electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
  },
  dialog: {
    openFile: () => electron.ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE),
    saveFile: (options) => electron.ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, options)
  },
  account: {
    info: (userId) => electron.ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_INFO, userId),
    delete: (userId) => electron.ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_DELETE, userId)
  }
};
electron.contextBridge.exposeInMainWorld("weaveMD", api);

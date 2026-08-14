// ============================================
// WeaveMD — Preload Script (Security Boundary)
// ============================================

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { ExportRequest, ExportResult } from './export/types';
import type {
  AIErrorCode,
  AIStreamEvent,
  AiChatResult,
  AiConfigUpdate,
  AiConversationDetail,
  AiHealth,
  ConversationMode,
  IAIConfig,
  IAIConsent,
  IAIConversation,
} from '@shared/ai';
import type { IpcResponse } from '@shared/types';

export interface WeaveMDApi {
  auth: {
    login: (username: string, password: string, rememberMe: boolean) => Promise<unknown>;
    register: (username: string, password: string) => Promise<unknown>;
    checkUsername: (username: string) => Promise<unknown>;
    validateToken: (token: string) => Promise<unknown>;
  };
  file: {
    create: (userId: string, name: string) => Promise<unknown>;
    open: () => Promise<unknown>;
    save: (fileId: string, content: string, userId: string) => Promise<unknown>;
    delete: (fileId: string, userId: string) => Promise<unknown>;
    list: (userId: string) => Promise<unknown>;
    get: (fileId: string, userId: string) => Promise<unknown>;
    write: (filePath: string, content: string) => Promise<unknown>;
    deleteDisk: (filePath: string) => Promise<unknown>;
    readDisk: (filePath: string) => Promise<unknown>;
  };
  history: {
    list: (fileId: string) => Promise<unknown>;
    get: (fileId: string, userId: string) => Promise<unknown>;
  };
  settings: {
    get: (userId: string) => Promise<unknown>;
    update: (userId: string, settings: Record<string, unknown>) => Promise<unknown>;
  };
  export: {
    file: (req: ExportRequest) => Promise<ExportResult>;
  };
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    unmaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  dialog: {
    openFile: () => Promise<unknown>;
    saveFile: (options: {
      defaultName: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<unknown>;
    openFolder: () => Promise<unknown>;
    saveFilePath: (
      title: string,
      defaultName: string,
      filters?: Array<{ name: string; extensions: string[] }>
    ) => Promise<unknown>;
    pickImage: () => Promise<string | null>;
  };
  folder: {
    readFolder: (path: string) => Promise<unknown>;
    createFolder: (parentPath: string, name: string) => Promise<unknown>;
    deleteFolder: (path: string) => Promise<unknown>;
  };
  account: {
    info: (userId: string) => Promise<unknown>;
    delete: (userId: string) => Promise<unknown>;
  };
  link: {
    openExternal: (url: string) => Promise<void>;
  };
  ai: {
    getConfig: (userId: string) => Promise<IpcResponse<IAIConfig>>;
    setConfig: (userId: string, config: AiConfigUpdate) => Promise<IpcResponse<IAIConfig>>;
    getConsent: (userId: string) => Promise<IpcResponse<IAIConsent>>;
    setConsent: (userId: string, consent: IAIConsent) => Promise<IpcResponse<IAIConsent>>;
    health: () => Promise<IpcResponse<AiHealth>>;
    chat: (payload: {
      userId: string;
      conversationId: string | null;
      message: string;
    }) => Promise<IpcResponse<AiChatResult>>;
    chatAbort: (conversationId: string) => Promise<IpcResponse<Record<string, never>>>;
    listConversations: (
      userId: string,
      mode?: ConversationMode
    ) => Promise<IpcResponse<IAIConversation[]>>;
    getConversation: (
      conversationId: string,
      userId: string
    ) => Promise<IpcResponse<AiConversationDetail>>;
    createConversation: (
      userId: string,
      mode?: ConversationMode
    ) => Promise<IpcResponse<IAIConversation>>;
    deleteConversation: (
      conversationId: string,
      userId: string
    ) => Promise<IpcResponse<{ deleted: boolean }>>;
    updateConversationSummary: (
      conversationId: string,
      userId: string,
      summary: string
    ) => Promise<IpcResponse<IAIConversation>>;
    onStream: (cb: (evt: AIStreamEvent) => void) => () => void;
  };
}

const api: WeaveMDApi = {
  auth: {
    login: (username, password, rememberMe) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, { username, password, rememberMe }),
    register: (username, password) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_REGISTER, { username, password }),
    checkUsername: (username) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CHECK_USERNAME, username),
    validateToken: (token) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_VALIDATE_TOKEN, token),
  },
  file: {
    create: (userId, name) => ipcRenderer.invoke(IPC_CHANNELS.FILE_CREATE, { userId, name }),
    open: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE),
    save: (fileId, content, userId) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE, { fileId, content, userId }),
    delete: (fileId, userId) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE, { fileId, userId }),
    list: (userId) => ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST, userId),
    get: (fileId, userId) => ipcRenderer.invoke(IPC_CHANNELS.FILE_GET, { fileId, userId }),
    write: (filePath, content) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, { filePath, content }),
    deleteDisk: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE_DISK, filePath),
    readDisk: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
  },
  history: {
    list: (fileId) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_LIST, fileId),
    get: (fileId, userId) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET, { fileId, userId }),
  },
  settings: {
    get: (userId) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, userId),
    update: (userId, settings) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, { userId, ...settings }),
  },
  export: {
    file: (req) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_FILE, req),
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
    unmaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_UNMAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  },
  dialog: {
    openFile: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE),
    saveFile: (options) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, options),
    openFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER),
    saveFilePath: (title, defaultName, filters) =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE_PATH, { title, defaultName, filters }),
    pickImage: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_PICK_IMAGE),
  },
  folder: {
    readFolder: (path) => ipcRenderer.invoke(IPC_CHANNELS.FOLDER_READ, path),
    createFolder: (parentPath, name) =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDER_CREATE, { path: parentPath, name }),
    deleteFolder: (path) => ipcRenderer.invoke(IPC_CHANNELS.FOLDER_DELETE, path),
  },
  account: {
    info: (userId) => ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_INFO, userId),
    delete: (userId) => ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_DELETE, userId),
  },
  link: {
    openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.LINK_OPEN_EXTERNAL, url),
  },
  ai: {
    getConfig: (userId) => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_CONFIG, userId),
    setConfig: (userId, config) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SET_CONFIG, { userId, config }),
    getConsent: (userId) => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_CONSENT, userId),
    setConsent: (userId, consent) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SET_CONSENT, { userId, consent }),
    health: () => ipcRenderer.invoke(IPC_CHANNELS.AI_HEALTH),
    chat: (payload) => ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT, payload),
    chatAbort: (conversationId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT_ABORT, conversationId),
    listConversations: (userId, mode) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_LIST, userId, mode),
    getConversation: (conversationId, userId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_GET, conversationId, userId),
    createConversation: (userId, mode) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_CREATE, userId, mode),
    deleteConversation: (conversationId, userId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_DELETE, conversationId, userId),
    updateConversationSummary: (conversationId, userId, summary) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SUMMARY_UPDATE, conversationId, userId, summary),
    onStream: (cb) => {
      const listeners: Array<() => void> = [];
      const subscribe = <T>(channel: string, map: (payload: T) => AIStreamEvent): void => {
        const handler = (_event: Electron.IpcRendererEvent, payload: T): void => {
          cb(map(payload));
        };
        ipcRenderer.on(channel, handler);
        listeners.push(() => ipcRenderer.removeListener(channel, handler));
      };
      subscribe(
        IPC_CHANNELS.AI_STREAM_CHUNK,
        (p: { conversationId: string; delta: string }) => ({
          type: 'chunk',
          conversationId: p.conversationId,
          delta: p.delta,
        })
      );
      subscribe(
        IPC_CHANNELS.AI_STREAM_DONE,
        (p: { conversationId: string; usage?: { reasoningTokenCount?: number | null } }) => ({
          type: 'done',
          conversationId: p.conversationId,
          usage: p.usage,
        })
      );
      subscribe(
        IPC_CHANNELS.AI_STREAM_ERROR,
        (p: { conversationId: string; code: AIErrorCode; message: string }) => ({
          type: 'error',
          conversationId: p.conversationId,
          code: p.code,
          message: p.message,
        })
      );
      return () => {
        for (const off of listeners) off();
      };
    },
  },
};

contextBridge.exposeInMainWorld('weaveMD', api);

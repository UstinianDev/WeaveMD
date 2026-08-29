// ============================================
// WeaveMD — Preload Script (Security Boundary)
// ============================================

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { ExportRequest, ExportResult } from './export/types';
import type {
  AIErrorCode,
  AIStreamEvent,
  AgentInteractionPayload,
  AgentRollbackResult,
  AgentRunEvent,
  AgentRunPayload,
  AgentRunResult,
  AiChatResult,
  AiConfigUpdate,
  AiConversationDetail,
  ConversationMode,
  IAgentStreamInteractionEvent,
  IAgentStreamToolEvent,
  IAIConfig,
  IAIConsent,
  IAIConversation,
  IAIModelConfig,
  IDocumentParseResult,
  IEmbeddingConfig,
  IGlobalAgentFiles,
  ISearchConfig,
  IKbDocumentStatus,
  IKbImportResult,
  IKbSettings,
  AgentSkillInfo,
  KbDeleteResult,
  KbImportDirRequest,
  KbStatusResponse,
  ModelProtocol,
  RewriteReply,
  RewriteRequestPayload,
  SearchProvider,
  WriteMode,
} from '@shared/ai';
import type { IpcResponse } from '@shared/types';
import type {
  MailAuthStatus,
  MailPickImagesResult,
  MailSendRequest,
  MailSendResult,
  MailSetRequest,
} from '@shared/mail';

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
  clipboard: {
    readImage: () => Promise<string | null>;
  };
  ai: {
    getConfig: (userId: string) => Promise<IpcResponse<IAIConfig>>;
    setConfig: (userId: string, config: AiConfigUpdate) => Promise<IpcResponse<IAIConfig>>;
    getConsent: (userId: string) => Promise<IpcResponse<IAIConsent>>;
    setConsent: (userId: string, consent: IAIConsent) => Promise<IpcResponse<IAIConsent>>;
    chat: (payload: {
      userId: string;
      conversationId: string | null;
      message: string;
    }) => Promise<IpcResponse<AiChatResult>>;
    chatAbort: (conversationId: string, userId: string) => Promise<IpcResponse<Record<string, never>>>;
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
    searchConversations: (
      userId: string,
      query: string
    ) => Promise<IpcResponse<IAIConversation[]>>;
    exportConversation: (
      conversationId: string,
      userId: string
    ) => Promise<IpcResponse<{ success: boolean; markdown?: string; error?: string }>>;
    editMessage: (
      userId: string,
      conversationId: string,
      messageId: string,
      newContent: string
    ) => Promise<IpcResponse<{ deletedMessages: number; cancelledTasks: number }>>;
    updateMessageToolCalls: (
      conversationId: string,
      toolCalls: unknown[]
    ) => Promise<IpcResponse<{ success: boolean }>>;
    updateConversationSummary: (
      conversationId: string,
      userId: string,
      summary: string
    ) => Promise<IpcResponse<IAIConversation>>;
    runAgent: (payload: AgentRunPayload) => Promise<IpcResponse<AgentRunResult>>;
    agentAbort: (conversationId: string, userId: string) => Promise<IpcResponse<{ aborted: boolean }>>;
    rewritePreview: (payload: RewriteRequestPayload) => Promise<IpcResponse<RewriteReply>>;
    listSkills: (userId: string) => Promise<IpcResponse<AgentSkillInfo[]>>;
    replayEvents: (sessionId: string, lastSeq: number) => Promise<IpcResponse<AgentRunEvent[]>>;
    rollbackSnapshot: (sessionId: string, userId: string) => Promise<IpcResponse<AgentRollbackResult>>;
    listModels: (userId: string) => Promise<IpcResponse<string[]>>;
    getWriteMode: (userId: string) => Promise<IpcResponse<WriteMode>>;
    setWriteMode: (userId: string, mode: WriteMode) => Promise<IpcResponse<WriteMode>>;
    /** R3: 用户提交 ask_question_card 答案后恢复暂停的任务。 */
    resumeInteraction: (sessionId: string, answers: Record<string, string>) => Promise<IpcResponse<{ resumed: boolean }>>;
    /** R4: 重试失败的任务。 */
    retryTask: (taskId: string) => Promise<IpcResponse<{ taskId: string; status: string }>>;
    onStream: (cb: (evt: AIStreamEvent | IAgentStreamToolEvent | IAgentStreamInteractionEvent) => void) => () => void;
    embedding: {
      test: (payload: { baseUrl: string; model: string; apiKey: string; userId?: string }) => Promise<IpcResponse<{ message: string }>>;
      create: (payload: {
        baseUrl: string;
        model: string;
        apiKey: string;
        input: string | string[];
        multimodal?: boolean;
      }) => Promise<IpcResponse<{ embeddings: number[][]; model: string; usage: { promptTokens: number } }>>;
    };
    search: {
      test: (payload: { provider: string; apiKey: string; userId?: string }) => Promise<IpcResponse<{ message: string }>>;
      run: (payload: {
        provider: string;
        apiKey: string;
        query: string;
        maxResults?: number;
      }) => Promise<IpcResponse<{ results: Array<{ title: string; url: string; snippet: string }>; provider: SearchProvider }>>;
    };
    modelConfigs: {
      list: (userId: string) => Promise<IpcResponse<IAIModelConfig[]>>;
      create: (userId: string, config: {
        name?: string;
        protocol: ModelProtocol;
        provider: string;
        baseUrl: string;
        model: string;
        apiKey?: string;
        hint?: string;
      }) => Promise<IpcResponse<IAIModelConfig>>;
      update: (id: string, config: {
        name?: string;
        protocol?: ModelProtocol;
        provider?: string;
        baseUrl?: string;
        model?: string;
        apiKey?: string;
        hint?: string;
      }) => Promise<IpcResponse<IAIModelConfig>>;
      delete: (id: string) => Promise<IpcResponse<{ deleted: boolean }>>;
      activate: (userId: string, configId: string) => Promise<IpcResponse<IAIConfig>>;
    };
    embeddingConfig: {
      get: (userId: string) => Promise<IpcResponse<IEmbeddingConfig>>;
      set: (userId: string, config: {
        baseUrl?: string;
        model?: string;
        apiKey?: string;
        multimodal?: boolean;
      }) => Promise<IpcResponse<IEmbeddingConfig>>;
    };
    searchConfig: {
      get: (userId: string) => Promise<IpcResponse<ISearchConfig>>;
      set: (userId: string, config: {
        enabled?: boolean;
        provider?: SearchProvider;
        callMode?: string;
        maxResults?: number;
        apiKeys?: Partial<Record<SearchProvider, string>>;
      }) => Promise<IpcResponse<ISearchConfig>>;
    };
    globalFiles: {
      get: () => Promise<IpcResponse<IGlobalAgentFiles>>;
      set: (updates: { soul?: string; memory?: string; style?: string }) => Promise<IpcResponse<IGlobalAgentFiles>>;
    };
  };
  kb: {
    list: (userId: string) => Promise<IpcResponse<IKbDocumentStatus[]>>;
    importFile: (input: {
      userId: string;
      title: string;
      content: string;
    }) => Promise<IpcResponse<IKbImportResult>>;
    importDir: (req: KbImportDirRequest) => Promise<IpcResponse<IKbImportResult[]>>;
    reindex: (input: { userId: string; fileId: string }) => Promise<IpcResponse<IKbImportResult>>;
    delete: (input: { userId: string; fileId: string }) => Promise<IpcResponse<KbDeleteResult>>;
    status: (userId: string) => Promise<IpcResponse<KbStatusResponse>>;
    getSettings: (userId: string) => Promise<IpcResponse<IKbSettings>>;
    setSettings: (input: {
      userId: string;
      settings: IKbSettings;
    }) => Promise<IpcResponse<IKbSettings>>;
    parseDocument: (filePath: string, fileName: string, mimeType?: string) => Promise<IpcResponse<IDocumentParseResult>>;
  };
  mail: {
    get: (userId: string) => Promise<IpcResponse<MailAuthStatus>>;
    set: (input: MailSetRequest) => Promise<IpcResponse<MailAuthStatus>>;
    send: (input: MailSendRequest) => Promise<IpcResponse<MailSendResult>>;
    pickImages: () => Promise<IpcResponse<MailPickImagesResult> | null>;
  };
  version: {
    get: () => Promise<string>;
  };
  update: {
    check: () => Promise<IpcResponse<{ state: string }>>;
    download: () => Promise<IpcResponse<{ success: boolean }>>;
    quitAndInstall: () => Promise<void>;
    skipVersion: (version: string) => Promise<IpcResponse<{ success: boolean }>>;
    onEvent: (cb: (evt: unknown) => void) => () => void;
  };
  notification: {
    send: (title: string, body: string) => Promise<void>;
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
  clipboard: {
    readImage: () => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_READ_IMAGE),
  },
  ai: {
    getConfig: (userId) => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_CONFIG, userId),
    setConfig: (userId, config) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SET_CONFIG, { userId, config }),
    getConsent: (userId) => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_CONSENT, userId),
    setConsent: (userId, consent) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SET_CONSENT, { userId, consent }),
    chat: (payload) => ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT, payload),
    chatAbort: (conversationId, userId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT_ABORT, conversationId, userId),
    listConversations: (userId, mode) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_LIST, userId, mode),
    getConversation: (conversationId, userId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_GET, conversationId, userId),
    createConversation: (userId, mode) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_CREATE, userId, mode),
    deleteConversation: (conversationId, userId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_DELETE, conversationId, userId),
    searchConversations: (userId, query) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_SEARCH, userId, query),
    exportConversation: (conversationId, userId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_EXPORT, conversationId, userId),
    editMessage: (userId, conversationId, messageId, newContent) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_MESSAGE_EDIT, userId, conversationId, messageId, newContent),
    updateMessageToolCalls: (conversationId, toolCalls) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_MESSAGE_UPDATE_TOOL_CALLS, { conversationId, toolCalls }),
    updateConversationSummary: (conversationId, userId, summary) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SUMMARY_UPDATE, conversationId, userId, summary),
    runAgent: (payload) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_RUN, payload),
    agentAbort: (conversationId, userId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_ABORT, conversationId, userId),
    rewritePreview: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_REWRITE_PREVIEW, payload),
    listSkills: (userId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_SKILLS_LIST, { userId }),
    replayEvents: (sessionId, lastSeq) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_REPLAY_EVENTS, sessionId, lastSeq),
    rollbackSnapshot: (sessionId, userId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_ROLLBACK_SNAPSHOT, sessionId, userId),
    listModels: (userId) => ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_MODELS, userId),
    getWriteMode: (userId) => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_WRITE_MODE, userId),
    setWriteMode: (userId, mode) => ipcRenderer.invoke(IPC_CHANNELS.AI_SET_WRITE_MODE, { userId, mode }),
    resumeInteraction: (sessionId, answers) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_RESUME_INTERACTION, { sessionId, answers }),
    retryTask: (taskId) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_RETRY_TASK, taskId),
    onStream: (cb) => {
      const listeners: Array<() => void> = [];
      const subscribe = <T>(
        channel: string,
        map: (payload: T) => AIStreamEvent | IAgentStreamToolEvent | IAgentStreamInteractionEvent
      ): void => {
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
      subscribe(
        IPC_CHANNELS.AI_STREAM_TOOL,
        (p: {
          conversationId: string;
          toolCallId: string;
          name: string;
          args: string;
          status: 'ok' | 'error';
          result?: string;
          errorDesc?: string;
          thinking?: string;
          loopIndex?: number;
        }) => ({
          type: 'tool',
          conversationId: p.conversationId,
          toolCallId: p.toolCallId,
          name: p.name,
          args: p.args,
          status: p.status,
          ...(p.result !== undefined ? { result: p.result } : {}),
          ...(p.errorDesc !== undefined ? { errorDesc: p.errorDesc } : {}),
          ...(p.thinking !== undefined ? { thinking: p.thinking } : {}),
          ...(p.loopIndex !== undefined ? { loopIndex: p.loopIndex } : {}),
        })
      );
      // R3: 交互提问事件（ask_question_card 暂停时推送）
      subscribe(
        IPC_CHANNELS.AGENT_INTERACTION_QUESTION,
        (p: AgentInteractionPayload) => ({
          type: 'interaction',
          conversationId: p.conversationId,
          sessionId: p.sessionId,
          questions: p.questions,
        })
      );
      return () => {
        for (const off of listeners) off();
      };
    },
    embedding: {
      test: (payload) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_EMBEDDING_TEST, payload),
      create: (payload) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_EMBEDDING_CREATE, payload),
    },
    search: {
      test: (payload) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_SEARCH_TEST, payload),
      run: (payload) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_SEARCH_RUN, payload),
    },
    modelConfigs: {
      list: (userId) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_MODEL_CONFIGS_LIST, userId),
      create: (userId, config) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_MODEL_CONFIGS_CREATE, { userId, config }),
      update: (id, config) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_MODEL_CONFIGS_UPDATE, { id, config }),
      delete: (id) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_MODEL_CONFIGS_DELETE, id),
      activate: (userId, configId) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_MODEL_CONFIGS_ACTIVATE, { userId, configId }),
    },
    embeddingConfig: {
      get: (userId) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_EMBEDDING_GET_CONFIG, userId),
      set: (userId, config) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_EMBEDDING_SET_CONFIG, { userId, config }),
    },
    searchConfig: {
      get: (userId) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_SEARCH_GET_CONFIG, userId),
      set: (userId, config) =>
        ipcRenderer.invoke(IPC_CHANNELS.AI_SEARCH_SET_CONFIG, { userId, config }),
    },
    globalFiles: {
      get: () =>
        ipcRenderer.invoke(IPC_CHANNELS.AGENT_GLOBAL_FILES_GET),
      set: (updates) =>
        ipcRenderer.invoke(IPC_CHANNELS.AGENT_GLOBAL_FILES_SET, updates),
    },
  },
  kb: {
    list: (userId) => ipcRenderer.invoke(IPC_CHANNELS.KB_LIST, { userId }),
    importFile: (input) => ipcRenderer.invoke(IPC_CHANNELS.KB_IMPORT_FILE, input),
    importDir: (req) => ipcRenderer.invoke(IPC_CHANNELS.KB_IMPORT_DIR, req),
    reindex: (input) => ipcRenderer.invoke(IPC_CHANNELS.KB_REINDEX, input),
    delete: (input) => ipcRenderer.invoke(IPC_CHANNELS.KB_DELETE, input),
    status: (userId) => ipcRenderer.invoke(IPC_CHANNELS.KB_STATUS, { userId }),
    getSettings: (userId) => ipcRenderer.invoke(IPC_CHANNELS.KB_GET_SETTINGS, { userId }),
    setSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.KB_SET_SETTINGS, input),
    parseDocument: (filePath, fileName, mimeType) =>
      ipcRenderer.invoke(IPC_CHANNELS.KB_PARSE_DOCUMENT, filePath, fileName, mimeType),
  },
  mail: {
    get: (userId) => ipcRenderer.invoke(IPC_CHANNELS.MAIL_GET, userId),
    set: (input) => ipcRenderer.invoke(IPC_CHANNELS.MAIL_SET, input),
    send: (input) => ipcRenderer.invoke(IPC_CHANNELS.MAIL_SEND, input),
    pickImages: () => ipcRenderer.invoke(IPC_CHANNELS.MAIL_PICK_IMAGES),
  },
  version: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  },
  update: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
    download: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
    quitAndInstall: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_QUIT_AND_INSTALL),
    skipVersion: (version: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SKIP_VERSION, version),
    onEvent: (cb: (evt: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, evt: unknown): void => {
        cb(evt);
      };
      ipcRenderer.on(IPC_CHANNELS.UPDATE_EVENT, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_EVENT, handler);
      };
    },
  },
  notification: {
    send: (title: string, body: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_SEND, title, body),
  },
};

contextBridge.exposeInMainWorld('weaveMD', api);

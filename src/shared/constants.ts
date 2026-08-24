// ============================================
// WeaveMD — Shared Constants
// ============================================

// --- Reserved Usernames ---
export const RESERVED_USERNAMES = ['admin', 'root', 'system', 'guest', 'test', 'administrator'];

// --- Validation ---
export const USERNAME_MIN_LENGTH = 5;
export const USERNAME_MAX_LENGTH = 15;
export const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{4,14}$/;
export const PASSWORD_MIN_LENGTH = 8;

// --- Recent Accounts ---
export const MAX_RECENT_ACCOUNTS = 10;

// --- Layout ---
export const DEFAULT_SIDEBAR_WIDTH = 240;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 400;

// --- Splash ---
export const SPLASH_GRADIENT_DURATION = 1200; // ms
export const SPLASH_FADE_DURATION = 800; // ms

// --- IPC Channels ---
export const IPC_CHANNELS = {
  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_REGISTER: 'auth:register',
  AUTH_CHECK_USERNAME: 'auth:check-username',
  AUTH_VALIDATE_TOKEN: 'auth:validate-token',

  // Files
  FILE_CREATE: 'file:create',
  FILE_OPEN: 'file:open',
  FILE_SAVE: 'file:save',
  FILE_DELETE: 'file:delete',
  FILE_LIST: 'file:list',
  FILE_GET: 'file:get',
  FILE_WRITE: 'file:write',
  FILE_DELETE_DISK: 'file:delete-disk',
  FILE_READ: 'file:read',

  // History
  HISTORY_LIST: 'history:list',
  HISTORY_GET: 'history:get',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Export
  EXPORT_FILE: 'export:file',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_UNMAXIMIZE: 'window:unmaximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  // Dialog
  DIALOG_OPEN_FILE: 'dialog:open-file',
  DIALOG_SAVE_FILE: 'dialog:save-file',
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',
  DIALOG_SAVE_FILE_PATH: 'dialog:save-file-path',
  DIALOG_PICK_IMAGE: 'dialog:pick-image',

  // Folder
  FOLDER_READ: 'folder:read',
  FOLDER_CREATE: 'folder:create',
  FOLDER_DELETE: 'folder:delete',

  // Account
  ACCOUNT_INFO: 'account:info',
  ACCOUNT_DELETE: 'account:delete',

  // Link
  LINK_OPEN_EXTERNAL: 'link:open-external',

  // App / Update
  APP_GET_VERSION: 'app:get-version',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_QUIT_AND_INSTALL: 'update:quit-and-install',
  UPDATE_SKIP_VERSION: 'update:skip-version',
  UPDATE_EVENT: 'update:event',

  // AI (Chat/Agent panel)
  AI_GET_CONFIG: 'ai:get-config',
  AI_SET_CONFIG: 'ai:set-config',
  AI_GET_CONSENT: 'ai:get-consent',
  AI_SET_CONSENT: 'ai:set-consent',
  AI_CHAT: 'ai:chat',
  AI_CHAT_ABORT: 'ai:chat-abort',
  AI_CONVERSATION_LIST: 'ai:conversation:list',
  AI_CONVERSATION_GET: 'ai:conversation:get',
  AI_CONVERSATION_CREATE: 'ai:conversation:create',
  AI_CONVERSATION_DELETE: 'ai:conversation:delete',
  AI_SUMMARY_UPDATE: 'ai:summary:update',

  // AI — Knowledge base (第3期) invoke
  KB_LIST: 'kb:list',
  KB_IMPORT_FILE: 'kb:import:file',
  KB_IMPORT_DIR: 'kb:import:dir',
  KB_REINDEX: 'kb:reindex',
  KB_DELETE: 'kb:delete',
  KB_STATUS: 'kb:status',
  KB_GET_SETTINGS: 'kb:get-settings',
  KB_SET_SETTINGS: 'kb:set-settings',

  // AI — Agent (第4期) invoke
  AGENT_RUN: 'agent:run',
  AGENT_ABORT: 'agent:abort',
  // AI — Agent（第7期 B1）技能清单（只读，渲染补全菜单用）
  AGENT_SKILLS_LIST: 'agent:skills:list',
  // AI — Agent task queue（异步入队）
  AGENT_TASK_STATUS: 'agent:task:status',
  AGENT_TASK_CANCEL: 'agent:task:cancel',

  // AI — block rewrite (第5期) invoke
  AI_REWRITE_PREVIEW: 'ai:rewrite:preview',
  // AI — model list (ai-panel-redesign M1, 需求 R17) invoke
  AI_LIST_MODELS: 'ai:list-models',

  // AI — Embedding（Module 11）
  AI_EMBEDDING_TEST: 'ai:embedding:test',
  AI_EMBEDDING_CREATE: 'ai:embedding:create',

  // AI — Search（Module 12）
  AI_SEARCH_TEST: 'ai:search:test',
  AI_SEARCH_RUN: 'ai:search:run',

  // AI — 多模型配置（ai-settings-redesign）
  AI_MODEL_CONFIGS_LIST: 'ai:model-configs:list',
  AI_MODEL_CONFIGS_CREATE: 'ai:model-configs:create',
  AI_MODEL_CONFIGS_UPDATE: 'ai:model-configs:update',
  AI_MODEL_CONFIGS_DELETE: 'ai:model-configs:delete',
  AI_MODEL_CONFIGS_ACTIVATE: 'ai:model-configs:activate',

  // AI — Embedding 配置 CRUD（ai-settings-redesign，独立于 AI 模型配置）
  AI_EMBEDDING_GET_CONFIG: 'ai:embedding:get-config',
  AI_EMBEDDING_SET_CONFIG: 'ai:embedding:set-config',

  // AI — 搜索配置 CRUD（ai-settings-redesign）
  AI_SEARCH_GET_CONFIG: 'ai:search:get-config',
  AI_SEARCH_SET_CONFIG: 'ai:search:set-config',

  // AI — conversation export (第 8 期)
  AI_CONVERSATION_EXPORT: 'ai:conversation:export',

  // AI — conversation search
  AI_CONVERSATION_SEARCH: 'ai:conversation:search',

  // AI — message edit（编辑用户消息并删除后续消息）
  AI_MESSAGE_EDIT: 'ai:message:edit',

  // AI — stream push (main -> render, webContents.send)
  AI_STREAM_CHUNK: 'ai:stream:chunk',
  AI_STREAM_DONE: 'ai:stream:done',
  AI_STREAM_ERROR: 'ai:stream:error',
  AI_STREAM_TOOL: 'ai:stream:tool',

  // Mail — 问题反馈邮件（第⑤项）
  MAIL_GET: 'mail:get',
  MAIL_SET: 'mail:set',
  MAIL_SEND: 'mail:send',
  MAIL_PICK_IMAGES: 'mail:pick-images',
} as const;

// --- Design Tokens ---
export const COLORS = {
  bgPrimary: '#0F0F0F',
  bgSecondary: '#1A1A1A',
  border: '#2D2D2D',
  textPrimary: '#FFFFFF',
  textSub: '#999999',
  textMuted: '#666666',
  accent: '#7C3AED',
  accentSecondary: '#6366F1',
  accentHover: '#6D28D9',
} as const;

export const THEME_PRESETS = {
  navbarColors: ['#1A1A1A', '#7C3AED', '#6366F1', '#0F0F0F', '#FFFFFF'],
  bgColors: ['#0F0F0F', '#FFFFFF', '#1a1a2e', '#0d1b2a', '#1b1b2f'],
} as const;

// APP_VERSION 已移除：版本改由主进程 app.getVersion() 提供（IPC_CHANNELS.APP_GET_VERSION）

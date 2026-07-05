// ============================================
// WeaveMD — Shared Constants
// ============================================

// --- Reserved Usernames ---
export const RESERVED_USERNAMES = [
  'admin',
  'root',
  'system',
  'guest',
  'test',
  'administrator',
];

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

  // History
  HISTORY_LIST: 'history:list',
  HISTORY_GET: 'history:get',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Export
  EXPORT_MD: 'export:md',
  EXPORT_DOCX: 'export:docx',
  EXPORT_PDF: 'export:pdf',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_UNMAXIMIZE: 'window:unmaximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  // Dialog
  DIALOG_OPEN_FILE: 'dialog:open-file',
  DIALOG_SAVE_FILE: 'dialog:save-file',

  // Account
  ACCOUNT_INFO: 'account:info',
  ACCOUNT_DELETE: 'account:delete',
  ACCOUNT_EXPORT: 'account:export',
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

export const APP_VERSION = '1.1';

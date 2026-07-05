// ============================================
// WeaveMD — Shared TypeScript Types
// ============================================

// --- User & Auth ---
export interface IUser {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLogin: string | null;
}

export interface IUserPublic {
  id: string;
  username: string;
  createdAt: string;
  lastLogin: string | null;
}

export interface AuthState {
  user: IUserPublic | null;
  token: string | null;
  isAuthenticated: boolean;
  recentAccounts: string[];
}

// --- Files ---
export interface IFile {
  id: string;
  userId: string;
  name: string;
  content: string;
  createdAt: string;
  modifiedAt: string;
  deletedAt: string | null;
}

// --- History ---
export interface IHistoryEntry {
  id: string;
  fileId: string;
  version: number;
  diff: string | null;
  savedAt: string;
}

// --- Settings ---
export interface ISettings {
  id: string;
  userId: string;
  theme: ThemeType;
  language: LanguageType;
  customColors: string | null; // JSON string
}

// --- Editor ---
export interface EditorState {
  currentFile: IFile | null;
  content: string;
  isDirty: boolean;
  cursorPosition: ICursorPosition;
  undoStack: string[];
  redoStack: string[];
}

export interface ICursorPosition {
  lineNumber: number;
  column: number;
}

// --- UI ---
export interface UIState {
  theme: ThemeType;
  language: LanguageType;
  sidebarWidth: number;
  isSidebarOpen: boolean;
  pageWidth: PageWidth;
  activeModal: string | null;
  isLoading: boolean;
  isSplashComplete: boolean;
}

// --- History Panel ---
export interface HistoryState {
  files: IFile[];
  searchQuery: string;
  activeHistoryFileId: string | null;
}

// --- Enums ---
export type ThemeType = 'light' | 'dark' | 'light-header' | 'high-contrast' | 'custom';

export type LanguageType = 'zh-CN' | 'zh-TW' | 'en';

export type ExportFormat = 'md' | 'docx' | 'pdf';

export type PageWidth = 'default' | 'wide' | 'full';

// --- IPC Response ---
export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// --- Auth IPC ---
export interface LoginRequest {
  username: string;
  password: string;
  rememberMe: boolean;
}

export interface LoginResponse {
  token: string;
  user: IUserPublic;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface UsernameCheckResponse {
  available: boolean;
  message: string;
}

// --- Account Info (for settings) ---
export interface AccountInfo {
  username: string;
  createdAt: string;
  lastLogin: string | null;
  fileCount: number;
}

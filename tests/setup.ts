// ============================================
// WeaveMD — Vitest Setup
// ============================================

import '@testing-library/jest-dom';

// Mock window.weaveMD API
const mockWeaveMD = {
  auth: {
    login: vi.fn(),
    register: vi.fn(),
    checkUsername: vi.fn(),
    validateToken: vi.fn(),
  },
  file: {
    create: vi.fn(),
    open: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
  },
  history: {
    list: vi.fn(),
    get: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    update: vi.fn(),
  },
  export: {
    md: vi.fn(),
    docx: vi.fn(),
    pdf: vi.fn(),
  },
  window: {
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(),
  },
  dialog: {
    openFile: vi.fn(),
    saveFile: vi.fn(),
  },
  account: {
    info: vi.fn(),
    delete: vi.fn(),
    export: vi.fn(),
  },
};

Object.defineProperty(window, 'weaveMD', {
  value: mockWeaveMD,
  writable: true,
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: vi.fn(() => null),
  Editor: vi.fn(() => null),
}));

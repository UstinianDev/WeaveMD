// ============================================
// WeaveMD E2E — 共享 mock window.weaveMD API
// ============================================
// 所有 E2E 测试通过 page.addInitScript(mockFullApi) 注入完整 mock。

export function mockFullApi(): void {
  const MOCK_USER = {
    id: 'u1',
    username: 'tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLogin: null,
  };
  localStorage.setItem('weavemd_token', 'test-token');
  localStorage.setItem('weavemd_user', JSON.stringify(MOCK_USER));

  const ok = (data?: unknown) => ({ success: true, data });
  (window as unknown as { weaveMD: Record<string, unknown> }).weaveMD = {
    auth: {
      validateToken: async () => ok(MOCK_USER),
      login: async () => ok(MOCK_USER),
      register: async () => ok(MOCK_USER),
      checkUsername: async () => ok({ available: true }),
    },
    settings: { get: async () => ({ success: false }), update: async () => ok() },
    history: { list: async () => ok([]), get: async () => ok() },
    file: {
      create: async () => ok(), open: async () => ok(), save: async () => ok(),
      delete: async () => ok(), list: async () => ok([]), get: async () => ok(),
      write: async () => ok(), readDisk: async () => ok({ path: 'C:\\playwright\\note.md', name: 'note.md', content: '' }),
      deleteDisk: async () => ok(),
    },
    folder: { createFolder: async () => ok(), readFolder: async () => ok([]), deleteFolder: async () => ok() },
    dialog: { saveFilePath: async () => ok({ path: 'C:\\playwright\\note.md' }), openFile: async () => ok(), openFolder: async () => ok(), pickImage: async () => null },
    window: { minimize: async () => {}, maximize: async () => {}, unmaximize: async () => {}, close: async () => {}, isMaximized: async () => false },
    link: { openExternal: async () => {} },
    license: { status: async () => ok({ status: 'unactivated' }), activate: async () => ok({ ok: true }) },
    version: { get: async () => '1.1.0' },
    update: { check: async () => ok({ state: 'not-available' }), download: async () => ok(), quitAndInstall: async () => {}, onEvent: () => () => {}, skipVersion: async () => ok() },
    recent: { list: async () => ok([]), add: async () => ok(), remove: async () => ok() },
    kb: { list: async () => ok([]), importFile: async () => ok(), importDir: async () => ok(), reindex: async () => ok(), delete: async () => ok(), status: async () => ok(), getSettings: async () => ok(), setSettings: async () => ok() },
    ai: {
      getConfig: async () => ok(), setConfig: async () => ok(), getConsent: async () => ok(), setConsent: async () => ok(),
      chat: async () => ok(), chatAbort: async () => ok(), listConversations: async () => ok([]), getConversation: async () => ok(),
      createConversation: async () => ok(), deleteConversation: async () => ok(), updateConversationSummary: async () => ok(),
      runAgent: async () => ok(), agentAbort: async () => ok(), rewritePreview: async () => ok(),
      listSkills: async () => ok([]), listModels: async () => ok([]), onStream: () => () => {},
    },
    mail: { get: async () => ok(), set: async () => ok(), send: async () => ok(), pickImages: async () => ok() },
    export: { file: async () => ok() },
    account: { info: async () => ok(), delete: async () => ok() },
  };
}

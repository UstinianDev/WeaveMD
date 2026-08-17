// ============================================
// WeaveMD — 分隔线（thematic-break）选中删除 E2E
// 覆盖：渲染为可见分隔线、点击选中高亮、Backspace 删除
// ============================================

import { expect, test } from '@playwright/test';

/** 注入认证会话 + mock Electron API（绕过登录直达 MainPage） */
function mockApi(): void {
  const MOCK_USER = {
    id: 'u1',
    username: 'tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLogin: null,
  };
  localStorage.setItem('weavemd_token', 'test-token');
  localStorage.setItem('weavemd_user', JSON.stringify(MOCK_USER));

  const ok = (data?: unknown) => ({ success: true, data });
  const win = window as unknown as {
    weaveMD?: Record<string, unknown>;
  };
  win.weaveMD = {
    auth: {
      validateToken: async () => ok(MOCK_USER),
      login: async () => ok(MOCK_USER),
      register: async () => ok(MOCK_USER),
      checkUsername: async () => ok({ available: true }),
    },
    settings: {
      get: async () => ({ success: false }),
      update: async () => ok(),
    },
    history: {
      list: async () => ok([]),
      get: async () => ok(),
    },
    file: {
      create: async () => ok(),
      open: async () => ok(),
      save: async () => ok(),
      delete: async () => ok(),
      list: async () => ok([]),
      get: async () => ok(),
      write: async () => ok(),
      readDisk: async () =>
        ok({ path: 'C:\\playwright\\note.md', name: 'note.md', content: '' }),
      deleteDisk: async () => ok(),
    },
    folder: {
      createFolder: async () => ok(),
      readFolder: async () => ok([]),
      deleteFolder: async () => ok(),
    },
    dialog: {
      saveFilePath: async () => ok({ path: 'C:\\playwright\\note.md' }),
      openFile: async () => ok(),
      pickImage: async () => null,
    },
    link: {
      openExternal: async () => ok(),
    },
    recent: {
      list: async () => ok([]),
      add: async () => ok(),
      remove: async () => ok(),
    },
    license: { status: async () => ok({ status: 'activated' }), activate: async () => ok({ ok: true }) },
    version: { get: async () => '1.1.0' },
    update: { check: async () => ok({ state: 'not-available' }), download: async () => ok(), quitAndInstall: async () => {}, onEvent: () => () => {}, skipVersion: async () => ok() },
    kb: { list: async () => ok([]), importFile: async () => ok(), importDir: async () => ok(), reindex: async () => ok(), delete: async () => ok(), status: async () => ok(), getSettings: async () => ok(), setSettings: async () => ok() },
    ai: { getConfig: async () => ok(), setConfig: async () => ok(), getConsent: async () => ok(), setConsent: async () => ok(), chat: async () => ok(), chatAbort: async () => ok(), listConversations: async () => ok([]), getConversation: async () => ok(), createConversation: async () => ok(), deleteConversation: async () => ok(), updateConversationSummary: async () => ok(), runAgent: async () => ok(), agentAbort: async () => ok(), rewritePreview: async () => ok(), listSkills: async () => ok([]), listModels: async () => ok([]), onStream: () => () => {} },
    mail: { get: async () => ok(), set: async () => ok(), send: async () => ok(), pickImages: async () => ok() },
    export: { file: async () => ok() },
    window: { minimize: async () => {}, maximize: async () => {}, unmaximize: async () => {}, close: async () => {}, isMaximized: async () => false },
    account: { info: async () => ok(), delete: async () => ok() },
  };
}

test.describe('thematic-break 选中删除', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(mockApi);
    await page.goto('/');
    await page.waitForSelector('.editor-content-area');
  });

  test('--- 渲染为可见分隔线', async ({ page }) => {
    // 在段落中输入 ---（跳过 h1 标题，找第二个块即段落）
    const paraBlock = page.locator('.editor-content-area .paragraph-block').first();
    await paraBlock.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('---');

    // hr 应出现（输入第三个 - 时自动转换）
    const hr = page.locator('hr.thematic-break-block');
    await expect(hr).toBeVisible();

    // 高度应 > 0（非空白）
    const box = await hr.boundingBox();
    expect(box!.height).toBeGreaterThan(0);
  });

  test('点击 hr 选中 + Backspace 删除', async ({ page }) => {
    const paraBlock = page.locator('.editor-content-area .paragraph-block').first();
    await paraBlock.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('---');

    const hr = page.locator('hr.thematic-break-block');
    await hr.click();

    // 选中高亮外壳出现
    const sel = page.locator('.thematic-break-selection');
    await expect(sel).toBeVisible();

    // Backspace 删除
    await page.keyboard.press('Backspace');

    // hr 消失
    await expect(hr).not.toBeVisible();
  });
});

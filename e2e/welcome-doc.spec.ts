// ============================================
// WeaveMD — 内置欢迎文档 E2E（真实 Chromium）
// 场景：
//   1. 首启（空文件树）自动注入欢迎文档：侧栏出现「欢迎文档.md」+ 编辑区渲染其标题
//   2. 删除欢迎项后重启（reload 近似冷启动）再次注入
// 判定唯一依据：树中无 welcome:// 节点即注入（不以 currentFile 判空）
// ============================================
import { expect, test } from '@playwright/test';

/** 注入认证会话 + mock Electron API（空文件树、无 recent、无持久化文件树） */
function seedEmptyState(): void {
  const MOCK_USER = {
    id: 'u1',
    username: 'tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLogin: null,
  };
  localStorage.setItem('weavemd_token', 'test-token');
  localStorage.setItem('weavemd_user', JSON.stringify(MOCK_USER));

  const ok = (data?: unknown) => ({ success: true, data });
  const win = window as unknown as { weaveMD?: Record<string, unknown> };
  win.weaveMD = {
    auth: {
      validateToken: async () => ok(MOCK_USER),
      login: async () => ok(MOCK_USER),
      register: async () => ok(MOCK_USER),
      checkUsername: async () => ok({ available: true }),
    },
    settings: {
      get: async () => ok({ theme: 'dark', language: 'zh-CN' }),
      update: async () => ok(),
    },
    history: { list: async () => ok([]), get: async () => ok() },
    file: {
      create: async () => ok(),
      open: async () => ok(),
      save: async () => ok(),
      delete: async () => ok(),
      list: async () => ok([]),
      get: async () => ok(),
      write: async () => ok(),
      readDisk: async () => ok({ path: 'welcome://welcome.md', name: 'welcome.md', content: '' }),
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
      openFolder: async () => ok(),
    },
    window: {
      minimize: async () => ok(),
      maximize: async () => ok(),
      unmaximize: async () => ok(),
      close: async () => ok(),
      isMaximized: async () => ok(false),
    },
    link: { openExternal: async () => ok() },
  };
}

test('首启空文件树：自动注入欢迎文档并在编辑区渲染其标题', async ({ page }) => {
  await page.addInitScript(seedEmptyState);
  await page.goto('/');
  await page.waitForSelector('header');

  // 侧栏出现欢迎文档项
  await expect(page.locator('text=欢迎文档.md').first()).toBeVisible();

  // 编辑区渲染欢迎文档一级标题（首段 # 标题 → h1.heading-block）
  await page.waitForSelector('h1.heading-block');
  await expect(page.locator('h1.heading-block').first()).toContainText('WeaveMD');
});

test('删除欢迎项后重启（reload）：再次自动注入', async ({ page }) => {
  await page.addInitScript(seedEmptyState);
  await page.goto('/');
  await page.waitForSelector('header');

  // 首启注入出现
  await expect(page.locator('text=欢迎文档.md').first()).toBeVisible();

  // 点击欢迎项右侧垃圾桶删除（首启仅一个 looseFile，其垃圾桶是侧栏唯一一个）
  // 注：FileTreePanel 垃圾桶 title 用 t('common.remove')，i18n 缺键回退为字面 'common.remove'
  const trash = page.getByTitle('common.remove').first();
  await trash.click({ force: true });

  // 删除后侧栏不再有欢迎项
  await expect(page.locator('text=欢迎文档.md')).toHaveCount(0);

  // reload 模拟冷启动 → 树中无 welcome:// → 再次注入
  await page.reload();
  await page.waitForSelector('header');
  await expect(page.locator('text=欢迎文档.md').first()).toBeVisible();
  await page.waitForSelector('h1.heading-block');
});

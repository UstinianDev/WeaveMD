// ============================================
// WeaveMD — 编辑历史 + 恢复整个文件树 E2E（TDD strict·先 RED）
// page.reload() 近似冷启动：验证 recent persist、文件树恢复、磁盘失效剔除、当前编辑文件恢复
// ============================================
import { expect, test } from '@playwright/test';

/**
 * 预置持久化状态 + mock Electron API。
 * 场景：
 *   - recent 首条 /work/a.md → 重启后应自动恢复为当前编辑文件
 *   - 文件树持久化：root /work（有效，含过期子节点 /work/old.md）、root /gone（失效）
 *     + looseFile /alive.md（有效）、/ghost.md（失效）
 *   - /gone、/ghost.md 磁盘失效 → restore 剔除并提示，不崩溃
 *   - /work 有效 → 丢弃 persisted 子节点，改用 folder.readFolder 实读重建 /work/a.md
 */
function seedState(): void {
  const MOCK_USER = {
    id: 'u1',
    username: 'tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLogin: null,
  };
  localStorage.setItem('weavemd_token', 'test-token');
  localStorage.setItem('weavemd_user', JSON.stringify(MOCK_USER));

  // 最近打开（时间倒序，最新在首）
  localStorage.setItem(
    'weavemd_recent',
    JSON.stringify({
      state: {
        recent: [
          { id: '/work/a.md', path: '/work/a.md', name: 'a.md', lastOpenedAt: '2026-08-16T10:00:00Z' },
          { id: '/alive.md', path: '/alive.md', name: 'alive.md', lastOpenedAt: '2026-08-16T09:00:00Z' },
        ],
      },
      version: 0,
    })
  );

  // 文件树持久化：root folder + looseFile；含失效路径与过期子节点
  localStorage.setItem(
    'weavemd_filetree',
    JSON.stringify({
      state: {
        folders: [
          {
            id: '/work',
            name: 'work',
            path: '/work',
            isDirectory: true,
            isRoot: true,
            expanded: true,
            children: [
              // 过期持久化子节点（磁盘漂移，restore 应丢弃并实读重建）
              { id: '/work/old.md', name: 'old.md', path: '/work/old.md', isDirectory: false },
            ],
          },
          {
            id: '/gone',
            name: 'gone',
            path: '/gone',
            isDirectory: true,
            isRoot: true,
            expanded: true,
            children: [],
          },
        ],
        looseFiles: [
          { id: '/alive.md', name: 'alive.md', path: '/alive.md' },
          { id: '/ghost.md', name: 'ghost.md', path: '/ghost.md' },
        ],
        activeTab: 'files',
        selectedIds: [],
      },
      version: 0,
    })
  );

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
      get: async () => ({ success: true, data: { theme: 'dark', language: 'zh-CN' } }),
      update: async () => ok(),
    },
    history: { list: async () => ok([]), get: async () => ok() },
    file: {
      create: async () => ok(),
      open: async () =>
        ok({ path: 'C:\\playwright\\newnote.md', name: 'newnote.md', content: '' }),
      save: async () => ok(),
      delete: async () => ok(),
      list: async () => ok([]),
      get: async () => ok(),
      write: async () => ok(),
      // 磁盘校验：/ghost.md 与 /gone 相关路径失败；/alive.md、/work/a.md 成功
      readDisk: async (p: string) => {
        const path = String(p).toLowerCase();
        if (path.includes('ghost') || path.includes('gone')) {
          return { success: false };
        }
        const name = path.split(/[\\/]/).pop() || 'file.md';
        return ok({ path: String(p), name, content: '# ' + name.replace(/\.[^.]+$/, '') });
      },
      deleteDisk: async () => ok(),
    },
    folder: {
      createFolder: async () => ok(),
      // /work 有效返回实读子节点；/gone 失效
      readFolder: async (p: string) => {
        if (String(p).toLowerCase().includes('gone')) return { success: false };
        return {
          success: true,
          data: [
            { name: 'a.md', path: '/work/a.md', isDirectory: false },
            { name: 'sub', path: '/work/sub', isDirectory: true },
          ],
        };
      },
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

test('重启后文件树恢复 + 磁盘失效剔除 + 当前编辑文件由 recent 恢复', async ({ page }) => {
  await page.addInitScript(seedState);
  await page.goto('/');
  await page.waitForSelector('header');

  // 等待 restore() 完成（文件树出现 looseFile /alive.md）
  await page.waitForSelector('text=/alive.md/');

  // 1) 失效 looseFile /ghost.md 被剔除（不在侧栏）
  await expect(page.locator('text=/ghost.md/')).toHaveCount(0);

  // 2) 有效 root folder /work 保留且子节点实读重建（a.md 在，旧子节点 old.md 被丢弃）
  await page.waitForSelector('text=/work/');
  await page.waitForSelector('text=/a.md/');
  await expect(page.locator('text=/old.md/')).toHaveCount(0);

  // 3) 失效 root folder /gone 被剔除
  await expect(page.locator('text=/gone/')).toHaveCount(0);

  // 4) 当前编辑文件 = recent 首条（/work/a.md）被自动恢复打开 → 编辑器渲染其内容标题
  await page.waitForSelector('.editor-content-area');
  await expect(page.locator('h1.heading-block')).toContainText('a');
});

test('编辑历史菜单按最近打开时间倒序展示', async ({ page }) => {
  await page.addInitScript(seedState);
  await page.goto('/');
  await page.waitForSelector('header');

  // 打开「编辑历史」菜单（zh-CN 下 trigger 文本为 "历史 ▾"）
  await page.getByText(/^历史/).first().click();
  // recent 倒序：a.md（最新）应在 alive.md（更旧）之前（首个文件按钮为 a.md）
  const recentPanel = page.locator('[data-dropdown-panel]').last();
  const firstFile = recentPanel.locator('button').filter({ hasText: '.md' }).first();
  await expect(firstFile).toContainText('a.md');
});

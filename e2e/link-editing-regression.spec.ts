// ============================================
// 链接编辑回归（真实 Chromium）：四个超链接 bug 修复
//  1) hover 提示不被代码块顶栏覆盖
//  2) 点击链接内容（折叠光标）不弹「块类型|解链」工具栏
//  3) 链接内容后回车不损坏 [label](url)
//  4) 代码块内行内格式按钮禁用（raw 不渲染，杜绝字面量）
// ============================================
import { expect, test } from '@playwright/test';

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
  const win = window as unknown as { weaveMD?: Record<string, unknown> };
  win.weaveMD = {
    auth: {
      validateToken: async () => ok(MOCK_USER),
      login: async () => ok(MOCK_USER),
      register: async () => ok(MOCK_USER),
      checkUsername: async () => ok({ available: true }),
    },
    settings: { get: async () => ({ success: false }), update: async () => ok() },
    history: { list: async () => ok([]), get: async () => ok() },
    file: {
      create: async () => ok(),
      open: async () => ok(),
      save: async () => ok(),
      delete: async () => ok(),
      list: async () => ok([]),
      get: async () => ok(),
      write: async () => ok(),
      readDisk: async () => ok({ path: 'C:\\playwright\\n.md', name: 'n.md', content: '' }),
      deleteDisk: async () => ok(),
    },
    folder: {
      createFolder: async () => ok(),
      readFolder: async () => ok([]),
      deleteFolder: async () => ok(),
    },
    dialog: {
      saveFilePath: async () => ok({ path: 'C:\\playwright\\n.md' }),
      openFile: async () => ok(),
      openFolder: async () => ok(),
      pickImage: async () => 'C:\\playwright\\a.png',
    },
    window: {
      minimize: async () => ok(),
      maximize: async () => ok(),
      unmaximize: async () => ok(),
      close: async () => ok(),
      isMaximized: async () => ok(false),
    },
    link: { openExternal: async () => ok() },
    license: {
      status: async () => ok({ status: 'activated' }),
      activate: async () => ok({ ok: true }),
    },
    version: {
      get: async () => '1.1.0',
    },
    update: {
      check: async () => ok({ state: 'not-available' }),
      download: async () => ok(),
      quitAndInstall: async () => {},
      onEvent: () => () => {},
      skipVersion: async () => ok(),
    },
    recent: {
      list: async () => ok([]),
      add: async () => ok(),
      remove: async () => ok(),
    },
  };
}

async function openEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(mockApi);
  await page.goto('/');
  await page.waitForSelector('header');
  await page.keyboard.press('Control+n');
  await page.waitForSelector('span.block-content[contenteditable="true"]');
}

async function createLink(page: import('@playwright/test').Page, text: string, url: string): Promise<void> {
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type(text, { delay: 10 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="链接"]').click();
  const modal = page.locator('.insert-url-modal-overlay');
  await expect(modal).toBeVisible();
  await modal.locator('#insert-url-modal-input').click();
  await page.keyboard.type(url, { delay: 10 });
  await modal.getByRole('button', { name: '确定' }).click();
  await page.waitForTimeout(300);
}

test('链接 hover 提示不被代码块顶栏覆盖', async ({ page }) => {
  await openEditor(page);
  // 第一段：文本+链接；紧接着回车创建代码块
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('前文', { delay: 10 });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  // 选中"前文"→ 加链接
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="链接"]').click();
  const modal = page.locator('.insert-url-modal-overlay');
  await expect(modal).toBeVisible();
  await modal.locator('#insert-url-modal-input').click();
  await page.keyboard.type('www.baidu.com', { delay: 10 });
  await modal.getByRole('button', { name: '确定' }).click();
  await page.waitForTimeout(300);
  await expect(page.locator('a.inline-link')).toHaveCount(1);

  // 光标移到行尾，回车创建代码块
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```js', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('const a = 1;', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('```', { delay: 10 });
  await page.waitForTimeout(300);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);

  // hover 链接 → 实证 tooltip 是否被代码块顶栏覆盖：
  // 注入 ::after pointer-events:auto，使 tooltip 参与命中测试；若 elementFromPoint
  // 落在 tooltip 区返回的是 code-fence-header → 被覆盖（bug）；返回链接/段落 → 浮于其上。
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.addStyleTag({
    content: 'a.inline-link:hover::after { pointer-events: auto !important; z-index: 99999 !important; }',
  });
  const link = page.locator('a.inline-link');
  await link.hover();
  await page.waitForTimeout(300);

  const hit = await page.evaluate(() => {
    const link = document.querySelector('a.inline-link') as HTMLElement | null;
    if (!link) return null;
    const lr = link.getBoundingClientRect();
    // tooltip 位于链接正下方（top:100% + margin 4），取样左下区域
    const px = lr.left + 30;
    const py = lr.bottom + 10;
    const el = document.elementFromPoint(px, py);
    const inHeader = !!el?.closest('.code-fence-header');
    const inLink = !!el?.closest('a.inline-link');
    return {
      px,
      py,
      topTag: el?.tagName,
      topClass: el?.className ?? '',
      inHeader,
      inLink,
      headerClosest: !!el?.closest('.code-fence-block'),
    };
  });
  // 修复后：tooltip 浮于代码块顶栏之上，命中测试不应落在 .code-fence-header
  expect(hit?.inHeader).toBe(false);
});

test('点击链接内容（折叠光标）→ 不弹「块类型|解链」工具栏', async ({ page }) => {
  await openEditor(page);
  await createLink(page, '链接文本', 'www.baidu.com');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // 点击链接中间 → 折叠光标命中链接
  const link = page.locator('a.inline-link');
  await link.click({ position: { x: 10, y: 5 } });
  await page.waitForTimeout(500);
  const toolbar = page.locator('.floating-toolbar-v2');
  // 修复后：点击链接内容（折叠光标在链接内）不弹「块类型|解链」工具栏
  await expect(toolbar).toHaveCount(0);
});

test('链接内容后回车 → 链接格式不损坏', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('123', { delay: 10 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="链接"]').click();
  const modal = page.locator('.insert-url-modal-overlay');
  await expect(modal).toBeVisible();
  await modal.locator('#insert-url-modal-input').click();
  await page.keyboard.type('baidu.com', { delay: 10 });
  await modal.getByRole('button', { name: '确定' }).click();
  await page.waitForTimeout(300);
  await expect(page.locator('a.inline-link')).toHaveCount(1);
  await expect(editable).toHaveText('[123](baidu.com)');

  // 光标移到链接内容末尾（123 后）回车
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const paragraphs = page.locator('span.block-content[contenteditable="true"]');
  const texts = await paragraphs.evaluateAll((els) => els.map((el) => (el.textContent ?? '').replace(/​/g, '')));
  // 修复后：第一段保留完整链接，不出现 `[123` / `](baidu.com)` 残体
  expect(texts[0]).toBe('[123](baidu.com)');
  expect(texts.some((t) => t === '[123' || t === '](baidu.com)')).toBe(false);
});

test('代码块内链接按钮禁用（raw 不渲染，杜绝字面量）', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('```js', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('const url = abc;', { delay: 10 });
  await page.waitForTimeout(300);
  // 全选代码内容 → 点链接
  const codeContent = page.locator('.code-fence-content span.block-content').first();
  await codeContent.click();
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  // 修复后：代码块内链接按钮禁用，点击无效、不弹 InsertUrlModal
  const linkBtn = toolbar.locator('button[title="链接"]');
  await expect(linkBtn).toBeDisabled();
  await linkBtn.click({ force: true });
  await page.waitForTimeout(300);
  await expect(page.locator('.insert-url-modal-overlay')).toHaveCount(0);
  // 代码文本未被污染
  const codeText = await codeContent.evaluate((el) => (el.textContent ?? '').replace(/​/g, ''));
  expect(codeText).toBe('const url = abc;');
});

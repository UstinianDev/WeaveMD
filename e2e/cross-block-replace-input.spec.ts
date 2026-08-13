// ============================================
// WeaveMD - 跨块选区文本输入替换（真实 Chromium）
// 覆盖：拖选多行后输入字符 → beforeinput 拦截，块树级删除 + 插入
// （浏览器原生删除跨块选区只改 DOM，onInput 仅同步焦点块模型，
//   其余块模型未更新 → 重渲染后内容"复活"；本用例验证修复）
// jsdom 中 React onBeforeInput 不触发，故本路径由 e2e 覆盖
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

async function openEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(mockApi);
  await page.goto('/');
  await page.waitForSelector('header');
  await page.keyboard.press('Control+n');
  await page.waitForSelector('span.block-content[contenteditable="true"]');
}

/** 输入三行 "1"/"2"/"3"，返回三个块 span 的 locator */
async function typeThreeLines(page: import('@playwright/test').Page) {
  const blocks = page.locator('span.block-content[contenteditable="true"]');
  await blocks.nth(0).click();
  await page.keyboard.type('1', { delay: 20 });
  await page.keyboard.press('Enter');
  await blocks.nth(1).click();
  await page.keyboard.type('2', { delay: 20 });
  await page.keyboard.press('Enter');
  await blocks.nth(2).click();
  await page.keyboard.type('3', { delay: 20 });
  await page.waitForTimeout(300);
  return blocks;
}

/** 从第一行开头拖选到第三行末尾（跨三块） */
async function dragSelectAllThree(page: import('@playwright/test').Page): Promise<void> {
  const blocks = page.locator('span.block-content[contenteditable="true"]');
  const firstBox = await blocks.nth(0).boundingBox();
  const thirdBox = await blocks.nth(2).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(thirdBox).not.toBeNull();
  await page.mouse.move(firstBox!.x + 2, firstBox!.y + firstBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    thirdBox!.x + thirdBox!.width - 2,
    thirdBox!.y + thirdBox!.height / 2,
    { steps: 20 }
  );
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test('R1: 跨三行选区输入 "123" → 三行内容全部替换，仅剩一行 "123"', async ({ page }) => {
  await openEditor(page);
  await typeThreeLines(page);
  await dragSelectAllThree(page);

  // 选区确实跨块
  const selInfo = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    const resolve = (node: Node | null) => {
      if (!node) return null;
      const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement;
      return el.closest('span.block-content')?.getAttribute('data-block-id') ?? null;
    };
    return {
      startId: resolve(r.startContainer),
      endId: resolve(r.endContainer),
      collapsed: sel.isCollapsed,
    };
  });
  expect(selInfo?.collapsed).toBe(false);
  expect(selInfo?.startId).not.toBe(selInfo?.endId);

  // 输入字符 → beforeinput insertText 被拦截 → 块树级替换
  await page.keyboard.type('123', { delay: 30 });
  await page.waitForTimeout(400);

  const state = await page.locator('.editor-content-area').evaluate((el) => ({
    text: (el.textContent ?? '').replace(/\u200B/g, ''),
    paragraphs: el.querySelectorAll('p.paragraph-block').length,
    blocks: el.querySelectorAll('span.block-content').length,
  }));
  // 旧缺陷行为：跨块选区原生输入只改 anchor 块 → 文本 "12323"（首行 123 + 残行 23）
  // 修复后：选区整体被替换，仅剩一行 "123"
  expect(state.text.trim()).toBe('123');
  expect(state.paragraphs).toBe(1);
  expect(state.blocks).toBe(1);
});

test('R2: 跨三行选区输入不残留——中途行不再"复活"（原缺陷回归）', async ({ page }) => {
  await openEditor(page);
  await typeThreeLines(page);
  await dragSelectAllThree(page);
  await page.keyboard.type('X', { delay: 30 });
  await page.waitForTimeout(400);

  const state = await page.locator('.editor-content-area').evaluate((el) => ({
    text: (el.textContent ?? '').replace(/\u200B/g, ''),
    paragraphs: el.querySelectorAll('p.paragraph-block').length,
  }));
  expect(state.text.trim()).toBe('X');
  expect(state.paragraphs).toBe(1);
});
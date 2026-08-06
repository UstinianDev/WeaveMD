// ============================================
// WeaveMD - 列表退出与代码块退出回归（真实 Chromium）
// 覆盖：有序列表末尾空项退格退出 / ```lang 提交代码块 / 代码块下方空段落 / 空代码块回车退出
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

test('有序列表末尾空项退格 → 光标退出列表且列表保留', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('1. 一级标题', { delay: 20 });
  await page.keyboard.press('Enter');
  await expect(page.locator('.list-marker').nth(1)).toHaveText('2.');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);

  // 列表保留第 1 项
  await expect(page.locator('.list-item-block')).toHaveCount(1);
  await expect(page.locator('.list-marker').first()).toHaveText('1.');
  // 列表后存在独立空段落（不在列表容器内）
  const state = await page.locator('.editor-content-area').evaluate((el) => {
    const active = document.activeElement;
    const rootBlocks = Array.from(el.querySelectorAll(':scope > [data-block-id]'));
    return {
      rootTypes: rootBlocks.map((b) => b.className),
      activeInList:
        !!active && !!active.closest('.list-item-block'),
      activeTag: active ? active.tagName : null,
    };
  });
  expect(state.rootTypes.some((c) => c.includes('list-block'))).toBe(true);
  expect(state.rootTypes.some((c) => c.includes('paragraph-block'))).toBe(true);
  expect(state.activeInList).toBe(false);
  expect(state.activeTag).toBe('SPAN');

  // 再回车：列表仍保留，内容不被删除
  await page.keyboard.press('Enter');
  await expect(page.locator('.list-item-block')).toHaveCount(1);
  await expect(page.locator('.list-item-block')).toContainText('一级标题');
});

test('```java + 空格 → 代码块语言 java 且下方自动补空段落', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('```java ', { delay: 20 });
  await page.waitForTimeout(300);

  const select = page.locator('.code-fence-language-select');
  await expect(select).toHaveValue('java');
  await expect(page.locator('.code-fence-content')).toHaveText('');
  // 代码块下方自动存在空段落
  const state = await page.locator('.editor-content-area').evaluate((el) => {
    return Array.from(el.querySelectorAll(':scope > [data-block-id]')).map((b) => ({
      cls: b.className,
      text: b.querySelector('span.block-content')?.textContent ?? null,
    }));
  });
  expect(state.map((s) => s.cls)).toEqual([
    expect.stringContaining('code-fence-block'),
    expect.stringContaining('paragraph-block'),
  ]);
});

test('空代码块回车 → 退出代码块并可在下方继续输入', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('```java ', { delay: 20 });
  await page.waitForTimeout(300);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  // 代码块保留，光标落在下方段落
  await expect(page.locator('.code-fence-block')).toHaveCount(1);
  await page.keyboard.type('hello', { delay: 20 });
  const state = await page.locator('.editor-content-area').evaluate((el) => {
    const active = document.activeElement;
    return {
      activeInCode: !!active && !!active.closest('.code-fence-block'),
      helloInParagraph: Array.from(el.querySelectorAll('p.paragraph-block')).some(
        (p) => (p.textContent ?? '').includes('hello')
      ),
    };
  });
  expect(state.activeInCode).toBe(false);
  expect(state.helloInParagraph).toBe(true);
});

test('空代码块退格 → 保留代码块并聚焦下方段落', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('```java ', { delay: 20 });
  await page.waitForTimeout(300);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);

  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);
  const state = await page.locator('.editor-content-area').evaluate((el) => {
    const active = document.activeElement;
    return {
      activeInCode: !!active && !!active.closest('.code-fence-block'),
      activeTag: active ? active.tagName : null,
    };
  });
  expect(state.activeInCode).toBe(false);
  expect(state.activeTag).toBe('SPAN');
});

test('```java + 回车 → 提交为代码块（语言 java）', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('```java', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);
  await expect(page.locator('.code-fence-language-select')).toHaveValue('java');
});

test('引用空行回车 → 退出引用并可在下方继续输入', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('> 引用', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  // 第二次回车（空引用行）→ 退出引用
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.type('正文', { delay: 20 });
  const state = await page.locator('.editor-content-area').evaluate((el) => {
    const active = document.activeElement;
    return {
      activeInQuote: !!active && !!active.closest('.blockquote-block'),
      quoteCount: el.querySelectorAll('blockquote.blockquote-block').length,
      paragraphs: Array.from(el.querySelectorAll('p.paragraph-block')).map(
        (p) => p.textContent
      ),
    };
  });
  expect(state.activeInQuote).toBe(false);
  expect(state.quoteCount).toBe(1);
  expect(state.paragraphs.some((t) => (t ?? '').includes('正文'))).toBe(true);
});

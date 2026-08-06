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

test('空代码块退格 → 一键删除代码块', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('```java ', { delay: 20 });
  await page.waitForTimeout(300);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);

  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await expect(page.locator('.code-fence-block')).toHaveCount(0);
  const state = await page.locator('.editor-content-area').evaluate((el) => {
    const active = document.activeElement;
    return {
      activeInCode: !!active && !!active.closest('.code-fence-block'),
      activeTag: active ? active.tagName : null,
      paragraphCount: el.querySelectorAll('p.paragraph-block').length,
    };
  });
  expect(state.activeInCode).toBe(false);
  expect(state.activeTag).toBe('SPAN');
  expect(state.paragraphCount).toBeGreaterThan(0);
});

test('代码块后的空行 Backspace 受保护（删除代码块后才可删）', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  // 先输入一行正文，再创建代码块，确保删除代码块后空行有前段可合并
  await page.keyboard.type('正文', { delay: 20 });
  await page.keyboard.press('Enter');
  const second = page.locator('span.block-content[contenteditable="true"]').nth(1);
  await second.click();
  await page.keyboard.type('```java ', { delay: 20 });
  await page.waitForTimeout(300);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);
  await expect(page.locator('p.paragraph-block')).toHaveCount(2);

  // 1) 点击代码块后的空行，Backspace → 受保护，空行保留
  const trailing = page.locator('p.paragraph-block span.block-content').last();
  await trailing.click();
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);
  await expect(page.locator('p.paragraph-block')).toHaveCount(2);

  // 2) 点击空代码块，Backspace → 一键删除代码块
  const codeContent = page.locator('.code-fence-block span.block-content');
  await codeContent.click();
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await expect(page.locator('.code-fence-block')).toHaveCount(0);

  // 3) 删除代码块后，空行恢复为普通段落：Backspace 与前段合并
  const after = page.locator('p.paragraph-block span.block-content').last();
  await after.click();
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await expect(page.locator('p.paragraph-block')).toHaveCount(1);
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

test('列表退格链：无序退格降级后继续退格合并进有序项', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('1. 有序列表', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const afterExit = page.locator('span.block-content[contenteditable="true"]').last();
  await afterExit.click();
  await page.keyboard.type('- 无序列表', { delay: 20 });
  await page.waitForTimeout(300);
  await expect(page.locator('.list-item-block')).toHaveCount(2);

  // 光标移到无序项内容开头，退格撤销无序列表
  const second = page.locator('.list-item-block').last().locator('span.block-content');
  await second.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  await expect(page.locator('.list-item-block')).toHaveCount(1);
  await expect(page.locator('p.paragraph-block').last()).toContainText('无序列表');

  // 继续退格 → 合并进第一行有序列表内容（光标跳回上一行）
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  await expect(page.locator('.list-item-block')).toHaveCount(1);
  await expect(page.locator('.list-item-block')).toContainText('有序列表无序列表');
  await expect(page.locator('p.paragraph-block')).toHaveCount(1);
});

test('标题删除链：删光二级标题后连续退格光标跳回一级标题', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('# 一级标题', { delay: 20 });
  await page.keyboard.press('Enter');
  const second = page.locator('span.block-content[contenteditable="true"]').last();
  await second.click();
  await page.keyboard.type('## 二级标题', { delay: 20 });
  await page.waitForTimeout(300);
  await expect(page.locator('h2.heading-block')).toHaveCount(1);

  const h2 = page.locator('h2.heading-block span.block-content');
  await h2.click();
  await page.keyboard.press('End');
  // 逐字退格（含零宽空格），间隔避免快速连按丢键
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(300);
  // 二级标题内容已删光
  const emptyState = await page.locator('h2.heading-block span.block-content').evaluate((el) => ({
    text: el.textContent,
    activeIsH2: document.activeElement === el,
  }));
  expect(emptyState.text?.replace(/\u200B/g, '')).toBe('');
  expect(emptyState.activeIsH2).toBe(true);

  // 第一次退格：空二级标题降级为正文（焦点保持）
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  await expect(page.locator('h2.heading-block')).toHaveCount(0);
  await expect(page.locator('p.paragraph-block')).toHaveCount(1);

  // 第二次退格：合并进一级标题，光标回到第一行
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  await expect(page.locator('h1.heading-block')).toHaveCount(1);
  await expect(page.locator('p.paragraph-block')).toHaveCount(0);
  const state = await page.locator('.editor-content-area').evaluate((el) => {
    const active = document.activeElement;
    const sel = document.getSelection();
    return {
      activeInH1: !!active && !!active.closest('h1.heading-block'),
      selCollapsed: sel ? sel.isCollapsed : null,
      h1Text: el.querySelector('h1.heading-block span.block-content')?.textContent ?? null,
    };
  });
  expect(state.activeInH1).toBe(true);
  expect(state.selCollapsed).toBe(true);
  expect(state.h1Text).toBe('一级标题');
});

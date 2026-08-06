// ============================================
// WeaveMD — 编辑主区 E2E（真实 Chromium）
// 覆盖用户反馈的两个问题：
//   1. 编辑主区无法编辑填写内容
//   2. markdown 语法无法实时渲染为富文本
// ============================================

import { expect, test } from '@playwright/test';

/** 注入认证会话 + mock Electron API（绕过登录直达 MainPage） */
function mockApi(): void {
  // 注意：addInitScript 会序列化本函数（不含闭包），所有数据必须内联
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
      openFolder: async () => ok(),
    },
    window: {
      minimize: async () => ok(),
      maximize: async () => ok(),
      unmaximize: async () => ok(),
      close: async () => ok(),
      isMaximized: async () => ok(false),
    },
    link: {
      openExternal: async () => ok(),
    },
  };
}

async function openEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(mockApi);
  await page.goto('/');
  // 等主界面（splash 完成）
  await page.waitForSelector('header');
  // 新建文件（TopBar 全局快捷键，走 mock 对话框）
  await page.keyboard.press('Control+n');
  // 等 v2 编辑内容块出现
  await page.waitForSelector('span.block-content[contenteditable="true"]');
}

test('空文档可输入文本', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]');
  await editable.click();
  await page.keyboard.type('hello world');
  await expect(editable).toHaveText('hello world');
});

test('输入 # 前缀即时渲染为标题', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]');
  await editable.click();
  await page.keyboard.type('# ', { delay: 30 });
  // 前缀转换完成（h1 渲染）
  await expect(page.locator('h1.heading-block')).toHaveCount(1);
  // 转换后继续输入内容
  await page.keyboard.type('标题', { delay: 30 });
  await expect(page.locator('h1.heading-block')).toHaveCount(1);
  await expect(page.locator('h1.heading-block')).toContainText('标题');
});

test('输入加粗标记实时渲染为 strong', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]');
  await editable.click();
  await page.keyboard.type('**bold**');
  await expect(page.locator('strong')).toHaveCount(1);
  // DOM 保留语法标记（编辑不丢标记）
  await expect(editable).toHaveText('**bold**');
});

test('在已渲染的加粗文本后继续输入保留标记', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]');
  await editable.click();
  await page.keyboard.type('**bold**');
  await expect(page.locator('strong')).toHaveCount(1);
  // 光标在末尾继续输入，markdown 标记保持完整
  await page.keyboard.type('x');
  await expect(editable).toHaveText('**bold**x');
  await expect(page.locator('strong')).toHaveCount(1);
});

test('输入列表前缀即时转换为列表', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]');
  await editable.click();
  await page.keyboard.type('- ', { delay: 30 });
  await expect(page.locator('.list-item-block')).toHaveCount(1);
  await page.keyboard.type('item', { delay: 30 });
  await expect(page.locator('.list-item-block')).toHaveCount(1);
  await expect(page.locator('.list-item-block')).toContainText('item');
});

test('中文输入正常（IME 场景）', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]');
  await editable.click();
  await page.keyboard.insertText('你好，世界');
  await expect(editable).toHaveText('你好，世界');
});

/** 等待编辑器回到空文档（仅剩一个块），供同一测试内多次 openEditor 复用 */
async function waitEmptyDoc(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const area = document.querySelector('.editor-content-area');
    return area && area.querySelectorAll(':scope > [data-block-id]').length === 1;
  });
}

test('语法符号对齐 marktext：标题级别提示/任务复选框/引用竖线渲染与不可选中', async ({ page }) => {
  // 1) 标题：data-level + 聚焦显示灰色 # 提示、失焦隐藏
  await openEditor(page);
  const h1Editable = page.locator('span.block-content[contenteditable="true"]').first();
  await h1Editable.click();
  await page.keyboard.type('# 标题', { delay: 30 });
  const h1 = page.locator('h1.heading-block');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveAttribute('data-level', '1');
  await expect(h1).toContainText('标题');
  const focusedMarker = await h1.evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return { content: s.content, opacity: s.opacity, color: s.color };
  });
  expect(focusedMarker.content).toBe('"#"');
  expect(focusedMarker.opacity).toBe('1');
  expect(focusedMarker.color).toBe('rgb(156, 163, 175)');
  await page.locator('header').click();
  const blurredMarker = await h1.evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return { opacity: s.opacity, fontSize: s.fontSize };
  });
  expect(blurredMarker.opacity).toBe('0');
  expect(blurredMarker.fontSize).toBe('0px');

  // 2) 任务复选框：勾选态类 + accent 背景 + 不可选中
  await openEditor(page);
  await waitEmptyDoc(page);
  const taskEditable = page.locator('span.block-content[contenteditable="true"]').first();
  await taskEditable.click();
  // 一次性插入整串，避免 `- ` 先转为无序列表后不再触发任务列表转换
  await page.keyboard.insertText('- [x] done');
  const checkedBox = page.locator('.task-checkbox.task-checkbox--checked');
  await expect(checkedBox).toHaveCount(1);
  const boxStyle = await checkedBox.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      userSelect: s.userSelect,
      backgroundColor: s.backgroundColor,
      width: s.width,
      height: s.height,
    };
  });
  expect(boxStyle.userSelect).toBe('none');
  expect(boxStyle.backgroundColor).toBe('rgb(124, 58, 237)');
  expect(boxStyle.width).toBe('18px');
  expect(boxStyle.height).toBe('18px');

  // 3) 引用：3px 绿色竖线
  await openEditor(page);
  await waitEmptyDoc(page);
  const quoteEditable = page.locator('span.block-content[contenteditable="true"]').first();
  await quoteEditable.click();
  await page.keyboard.type('> quote', { delay: 30 });
  const quote = page.locator('blockquote.blockquote-block');
  await expect(quote).toHaveCount(1);
  const quoteStyle = await quote.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      borderLeftWidth: s.borderLeftWidth,
      borderLeftStyle: s.borderLeftStyle,
      borderLeftColor: s.borderLeftColor,
    };
  });
  expect(quoteStyle.borderLeftWidth).toBe('3px');
  expect(quoteStyle.borderLeftStyle).toBe('solid');
  expect(quoteStyle.borderLeftColor).toBe('rgb(66, 211, 146)');

  // 4) 无序列表 marker：灰色 + 不可选中
  await openEditor(page);
  await waitEmptyDoc(page);
  const listEditable = page.locator('span.block-content[contenteditable="true"]').first();
  await listEditable.click();
  await page.keyboard.type('- item', { delay: 30 });
  const marker = page.locator('.list-marker');
  await expect(marker).toHaveCount(1);
  const markerStyle = await marker.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, userSelect: s.userSelect };
  });
  expect(markerStyle.color).toBe('rgb(107, 114, 128)');
  expect(markerStyle.userSelect).toBe('none');
});

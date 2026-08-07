// ============================================
// WeaveMD - 跨块鼠标拖选回归（真实 Chromium）
// 覆盖：拖过不同内容块生成跨块选区；Backspace 块树级删除
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

test('跨块鼠标拖选并退格删除', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('第一行', { delay: 20 });
  await page.keyboard.press('Enter');
  const second = page.locator('span.block-content[contenteditable="true"]').nth(1);
  await second.click();
  await page.keyboard.type('第二行', { delay: 20 });
  await page.waitForTimeout(200);

  // 从第一行开头拖到第二行末尾（跨块）
  const firstBox = await editable.boundingBox();
  const secondBox = await second.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  await page.mouse.move(firstBox!.x + 2, firstBox!.y + firstBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    secondBox!.x + secondBox!.width - 2,
    secondBox!.y + secondBox!.height / 2,
    { steps: 20 }
  );
  await page.mouse.up();
  await page.waitForTimeout(300);

  // 选区跨两个块
  const selInfo = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    const startSpan = (
      r.startContainer.nodeType === Node.ELEMENT_NODE
        ? r.startContainer
        : r.startContainer.parentElement
    )?.closest('span.block-content');
    const endSpan = (
      r.endContainer.nodeType === Node.ELEMENT_NODE
        ? r.endContainer
        : r.endContainer.parentElement
    )?.closest('span.block-content');
    return {
      text: sel.toString(),
      startId: startSpan?.getAttribute('data-block-id'),
      endId: endSpan?.getAttribute('data-block-id'),
      startOffset: r.startOffset,
      endOffset: r.endOffset,
      startNodeText: r.startContainer.textContent,
      endNodeText: r.endContainer.textContent,
      collapsed: sel.isCollapsed,
    };
  });
  expect(selInfo?.startId).not.toBe(selInfo?.endId);
  expect(selInfo?.collapsed).toBe(false);

  // Backspace 块树级删除跨块选区
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  const state = await page.locator('.editor-content-area').evaluate((el) => ({
    text: (el.textContent ?? '').replace(/\u200B/g, ''),
    paragraphs: el.querySelectorAll('p.paragraph-block').length,
  }));
  expect(state.text).not.toContain('第一行');
  expect(state.text).not.toContain('第二行');
  expect(state.paragraphs).toBeGreaterThan(0);
});

test('G2：从下往上跨块拖选 → 反向选区覆盖两不同块', async ({ page }) => {
  await openEditor(page);
  const first = page.locator('span.block-content[contenteditable="true"]').first();
  await first.click();
  await page.keyboard.type('第一行', { delay: 20 });
  await page.keyboard.press('Enter');
  const second = page.locator('span.block-content[contenteditable="true"]').nth(1);
  await second.click();
  await page.keyboard.type('第二行', { delay: 20 });
  await page.waitForTimeout(200);
  // 从第二行（下方）向上拖到第一行（上方）——反向拖选。
  // 起点取块右端、终点取块左端，使反向选区覆盖到第一行末尾。
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  await page.mouse.move(
    secondBox!.x + secondBox!.width - 2,
    secondBox!.y + secondBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(firstBox!.x + 2, firstBox!.y + firstBox!.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  await page.waitForTimeout(400);

  // 反向选区同样覆盖两个不同块
  const selInfo = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    const startSpan = (
      r.startContainer.nodeType === Node.ELEMENT_NODE
        ? r.startContainer
        : r.startContainer.parentElement
    )?.closest('span.block-content');
    const endSpan = (
      r.endContainer.nodeType === Node.ELEMENT_NODE
        ? r.endContainer
        : r.endContainer.parentElement
    )?.closest('span.block-content');
    return {
      startId: startSpan?.getAttribute('data-block-id'),
      endId: endSpan?.getAttribute('data-block-id'),
      collapsed: sel.isCollapsed,
    };
  });
  expect(selInfo?.startId).not.toBe(selInfo?.endId);
  expect(selInfo?.collapsed).toBe(false);
  // 说明：Chromium 对跨编辑宿主的 Selection.toString() 只返回 anchor 块内文本，
  // 反向拖选 anchor 停在第一行末尾 → toString 为空，但 Range 边界保留跨块。
  // 因此用与正向用例一致的方式验证：Backspace 块树级删除跨块选区。

  // Backspace 块树级删除跨块选区：反向选区起点在第一行末尾，故只应删除
  // 覆盖到的下方锚点块内容（"第二行"），第一行末尾之前的内容保留。
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  const state = await page.locator('.editor-content-area').evaluate((el) => ({
    text: (el.textContent ?? '').replace(/\u200B/g, ''),
    paragraphs: el.querySelectorAll('p.paragraph-block').length,
  }));
  expect(state.text).not.toContain('第二行');
  expect(state.paragraphs).toBeGreaterThan(0);
});

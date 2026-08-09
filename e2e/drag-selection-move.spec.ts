// ============================================
// WeaveMD - 原生拖拽移动选区禁用（真实 Chromium）
// 覆盖：选中含 `.md-syntax` 标记的选区后，浏览器原生的"拖拽移动选区"（DnD）
// 必须被阻止——否则标记字符会被当普通文本拖走，破坏 markdown 语法。
// 修复：EditorV2 根容器 onDragStart preventDefault（跨块拖选走 mousedown/mousemove 自实现，不受影响）。
//
// 说明：Chromium 的 contentEditable 原生文本拖拽移动依赖真实输入序列，Playwright
// 合成鼠标（CDP Input.dispatchMouseEvent）无法稳定触发其 drop 阶段；故本 spec 采用
// 事件级断言（dragstart 是否被阻止），与组件单测（editorV2Format.test.tsx）共同守护。
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

/** 输入 `**加粗**` 并等待行内渲染为 <strong> */
async function typeBoldDoc(page: import('@playwright/test').Page): Promise<void> {
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.insertText('**加粗**');
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**加粗**');
  await expect(page.locator('span.block-content strong')).toHaveCount(1);
}

test('DSM-R1：含标记选区存在时，根容器 dragstart 被阻止（defaultPrevented=true）', async ({ page }) => {
  await openEditor(page);
  await typeBoldDoc(page);
  // 先建立含 close 标记的选区（`粗**`），再验证拖拽起点被阻止
  await page.evaluate(() => {
    const strong = document.querySelector('span.block-content strong');
    if (!strong) throw new Error('strong not found');
    const nodes = Array.from(strong.childNodes);
    const textNode = nodes.find((n) => n.nodeType === Node.TEXT_NODE);
    if (!textNode) throw new Error('content text node not found');
    const close = nodes[nodes.length - 1];
    if (!close || !close.firstChild) throw new Error('close marker not found');
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(close.firstChild, close.firstChild.length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.getSelection()?.toString() ?? '')
    )
    .toBe('粗**');

  const prevented = await page.evaluate(() => {
    const root = document.querySelector('div.relative.w-full.h-full');
    if (!root) throw new Error('editor root not found');
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    root.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(true);
});

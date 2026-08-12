// ============================================
// WeaveMD — R1 图片选中框 + 四角缩放 / R4 链接场景工具栏定位（真实 Chromium）
// ============================================
// R1·E6：点击图片 → 选中框 + 4 角手柄可见；拖拽角手柄 → img style.width 变化；
//         独立图底层 markdown 获得 style="width:Npx"（经 file.write 自动保存捕获序列化）。
// R4·E5：光标放入链接内 → 浮动工具栏 computed left < 链接盒 left（工具栏在链接正左方）。
import { expect, test } from '@playwright/test';

// mock 与 openEditor 沿用 floating-toolbar.spec.ts 的既有约定（含 file/folder 全量 IPC），
// 额外捕获 file.write 的序列化内容到 __persisted（独立图宽度往返断言）。
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
    __persisted?: string[];
  };
  const persisted: string[] = [];
  win.__persisted = persisted;
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
      write: async (_path: string, content: string) => {
        persisted.push(content);
        return ok();
      },
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
      pickImage: async () => {
        const w = window as unknown as { __pickImageResult?: string | null };
        return w.__pickImageResult !== undefined ? w.__pickImageResult : 'C:\\playwright\\a.png';
      },
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

/** 部分选区（offset 相对首个 block-content 的可见文本，忽略 U+200B） */
async function selectTextRange(
  page: import('@playwright/test').Page,
  start: number,
  end: number
): Promise<void> {
  await page.evaluate(
    (offsets: { start: number; end: number }) => {
      const el = document.querySelector<HTMLElement>(
        'span.block-content[contenteditable="true"]'
      );
      if (!el) return;
      const findPoint = (offset: number): { node: Node; offset: number } => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let remaining = Math.max(0, offset);
        let textNode: Text | null;
        while ((textNode = walker.nextNode() as Text | null) !== null) {
          const value = textNode.nodeValue ?? '';
          const effectiveLength = value.replace(/\u200B/g, '').length;
          if (remaining <= effectiveLength) {
            let charCount = 0;
            let position = 0;
            for (let i = 0; i < value.length; i++) {
              if (value[i] !== '\u200B') charCount++;
              if (remaining > 0 && charCount >= remaining) {
                position = i + 1;
                break;
              }
            }
            return { node: textNode, offset: position };
          }
          remaining -= effectiveLength;
        }
        return { node: el, offset: el.childNodes.length };
      };
      const sp = findPoint(offsets.start);
      const ep = findPoint(offsets.end);
      const range = document.createRange();
      range.setStart(sp.node, sp.offset);
      range.setEnd(ep.node, ep.offset);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },
    { start, end }
  );
}

/** 经工具栏「图片」直选插入 https 图（CSP 放行 + route 返回 SVG，img 保持可点击） */
async function insertImageViaToolbar(
  page: import('@playwright/test').Page,
  url: string
): Promise<void> {
  await page.evaluate((src: string) => {
    (window as unknown as { __pickImageResult: string }).__pickImageResult = src;
  }, url);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="图片"]').click();
}

test('R1·E6: 点击行内图片 → 选中框 + 4 角手柄可见；拖拽 ne 角 → img 宽度变化', async ({ page }) => {
  test.setTimeout(90000);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#ccc"/></svg>';
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg })
  );

  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('图片文本x', { delay: 15 });
  await page.waitForTimeout(300);
  // 部分选区 [0,4)：行内替换（块内残留 'x'，不会转 image-block）
  await selectTextRange(page, 0, 4);
  await page.waitForTimeout(300);
  await insertImageViaToolbar(page, 'https://example.com/a.png');
  await page.waitForTimeout(500);

  const img = page.locator('img.inline-image');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('src', 'https://example.com/a.png');

  await img.click();
  await page.waitForTimeout(300);
  const box = page.locator('.image-resize-box');
  await expect(box).toHaveCount(1);
  await expect(page.locator('[data-handle]')).toHaveCount(4);

  const before = Number(await img.evaluate((el) => el.getBoundingClientRect().width));
  const handleNe = page.locator('[data-handle="ne"]');
  const bb = await handleNe.boundingBox();
  if (!bb) throw new Error('no ne handle bbox');
  // 从 ne 角向右拖 60px（east 角 +dx → 宽度增大）
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const after = Number(await img.evaluate((el) => el.getBoundingClientRect().width));
  expect(after).toBeGreaterThan(before);
  const styleWidth = await img.evaluate((el) => el.style.width);
  expect(styleWidth).toMatch(/^\d+px$/);
});

test('R1·E6: 独立图（image-block）拖拽 → 底层 markdown 获得 style="width:Npx"', async ({ page }) => {
  test.setTimeout(90000);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#ccc"/></svg>';
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg })
  );

  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('图片文本', { delay: 15 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  await insertImageViaToolbar(page, 'https://example.com/stand.png');
  await page.waitForTimeout(500);

  // 整段替换 → image-block（图后自动补空段落），img 正常加载保持可点击
  const block = page.locator('.image-block');
  await expect(block).toHaveCount(1);
  const img = page.locator('.image-block img.inline-image');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('src', 'https://example.com/stand.png');
  await expect(img).toHaveAttribute('alt', '图片文本');

  await img.click();
  await page.waitForTimeout(300);
  await expect(page.locator('.image-resize-box')).toHaveCount(1);

  const handleSe = page.locator('[data-handle="se"]');
  const bb = await handleSe.boundingBox();
  if (!bb) throw new Error('no se handle bbox');
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 80, bb.y + bb.height / 2, { steps: 6 });
  await page.mouse.up();
  // 独立图提交走 setImageWidth → block.text 更新 → MainPage 1200ms 自动保存 → file.write 捕获
  await page.waitForTimeout(2200);

  const persisted = await page.evaluate(() => {
    const w = window as unknown as { __persisted?: string[] };
    return w.__persisted ?? [];
  });
  const last = persisted[persisted.length - 1] ?? '';
  // 宽度写回对齐包裹（wrapImageWidth：裸图 → <div align="left" style="width:Npx">…</div>）
  expect(last).toMatch(/<div align="[a-z]+" style="width:\d+px">!\[图片文本\]/);
});

test('R4·E5: 光标放入链接内 → 工具栏 left < 链接盒 left（正左方）', async ({ page }) => {
  test.setTimeout(90000);
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('链接文本', { delay: 15 });
  await page.keyboard.press('Control+a');
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

  const link = page.locator('a.inline-link');
  await expect(link).toHaveCount(1);
  // 链接命中时工具栏左置，且链接贴近左缘会被宽工具栏遮挡 → 先 Escape 收起再点击链接，
  // 让链接可点、随后（折叠光标 inLink）工具栏以正左方重新出现
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await link.click();
  await page.waitForTimeout(300);

  const toolbarAfter = page.locator('.floating-toolbar-v2');
  await expect(toolbarAfter).toBeVisible();
  const toolbarLeft = await toolbarAfter.evaluate((el) => el.getBoundingClientRect().left);
  const linkLeft = await link.evaluate((el) => el.getBoundingClientRect().left);
  // R4·G1：工具栏位于链接正左方（left < 链接 left）
  expect(toolbarLeft).toBeLessThan(linkLeft);
});

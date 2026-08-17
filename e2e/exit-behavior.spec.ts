// ============================================
// WeaveMD - 列表退出与代码块退出回归（真实 Chromium）
// 覆盖：有序列表末尾空项退格退出 / ```lang 提交代码块 / 代码块下方空段落 / 空代码块回车退出
// SPEC-EDIT-CBTP 6.2：应用重载后代码块尾随保护空行恢复（可聚焦 / Backspace 受保护）
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

  // mock 磁盘存储：localStorage 持久化，跨 page.reload() 存活，
  // 供"保存 → 重载 → 重新打开"场景回灌 content（SPEC-EDIT-CBTP 6.2）。
  // 注意：字面量须与测试侧 E2E_DISK_KEY 保持一致（addInitScript 序列化函数体，
  // 无法引用外层常量）。
  const DISK_KEY = 'weavemd_e2e_disk_files';
  const readDisk = (): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(DISK_KEY) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  };
  const writeDisk = (disk: Record<string, string>): void => {
    localStorage.setItem(DISK_KEY, JSON.stringify(disk));
  };
  const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

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
      // 打开文件：从 mock 磁盘存储回灌最近写入的文件（无落盘记录时返回空）
      open: async () => {
        const disk = readDisk();
        const paths = Object.keys(disk);
        if (paths.length === 0) return ok();
        const path = paths[paths.length - 1];
        return ok({ path, name: baseName(path), content: disk[path] ?? '' });
      },
      save: async () => ok(),
      delete: async () => ok(),
      list: async () => ok([]),
      get: async () => ok(),
      write: async (path: unknown, content: unknown) => {
        const disk = readDisk();
        disk[String(path)] = String(content ?? '');
        writeDisk(disk);
        return ok();
      },
      readDisk: async (path: unknown) => {
        const p = typeof path === 'string' && path !== '' ? path : 'C:\\playwright\\n.md';
        const disk = readDisk();
        return ok({ path: p, name: baseName(p), content: disk[p] ?? '' });
      },
      deleteDisk: async (path: unknown) => {
        const disk = readDisk();
        delete disk[String(path)];
        writeDisk(disk);
        return ok();
      },
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

// ============================================
// 应用重载场景辅助（SPEC-EDIT-CBTP 6.2）
// ============================================

/** 与 mockApi 内 DISK_KEY 一致（mock 侧因序列化限制须内联字面量） */
const E2E_DISK_KEY = 'weavemd_e2e_disk_files';

/** 等待 MainPage 自动保存（1200ms debounce）把含 marker 的内容写入 mock 磁盘存储 */
async function waitForDiskSave(
  page: import('@playwright/test').Page,
  marker: string
): Promise<void> {
  await page.waitForFunction(
    ({ key, expected }) => {
      try {
        const disk = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string>;
        return Object.values(disk).some((content) => content.includes(expected));
      } catch {
        return false;
      }
    },
    { key: E2E_DISK_KEY, expected: marker }
  );
}

/** reload 丢失内存态后重新打开文件：编辑器从保存文本重建块树（走 markdownToState 补偿） */
async function reloadAndReopen(page: import('@playwright/test').Page): Promise<void> {
  await page.reload();
  await page.waitForSelector('header');
  await page.keyboard.press('Control+o');
  await page.waitForSelector('span.block-content[contenteditable="true"]');
}

/** 读取编辑区块树结构（根块类型 + 末块空标记/文本），不比较块 ID 避免噪音 */
async function readBlockStructure(page: import('@playwright/test').Page): Promise<{
  classes: string[];
  trailingEmpty: string | null;
  trailingText: string;
}> {
  return page.locator('.editor-content-area').evaluate((el) => {
    const roots = Array.from(el.querySelectorAll(':scope > [data-block-id]'));
    const last = roots[roots.length - 1];
    const span = last ? last.querySelector('span.block-content') : null;
    return {
      classes: roots.map((b) => b.className),
      trailingEmpty: span ? span.getAttribute('data-empty') : null,
      trailingText: (span?.textContent ?? '').replace(/\u200B/g, ''),
    };
  });
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
      activeInList: !!active && !!active.closest('.list-item-block'),
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
      helloInParagraph: Array.from(el.querySelectorAll('p.paragraph-block')).some((p) =>
        (p.textContent ?? '').includes('hello')
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

test('代码块内只剩换行（视觉为空）→ Backspace 删除代码块 / Enter 退出', async ({ page }) => {
  // SPEC-EDIT-EXIT 3.5 修订：代码块"空内容"含纯空白/换行——删光内容后残留的 "\n"
  // 不得让代码块变死胡同：Backspace 一键删除，Enter 退出（光标移出）。
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('```java ', { delay: 20 });
  await page.waitForTimeout(300);
  const code = page.locator('.code-fence-block span.block-content');
  await code.click();
  // 构造 text = "a\n"，再把光标移到起点、Delete 删掉 "a"，留下 "\n"（视觉空行）
  await page.keyboard.type('a', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  const leftover = await code.evaluate((el) => (el.textContent ?? '').replace(/​/g, ''));
  expect(leftover).toBe('\n');

  // 1) Backspace → 一键删除代码块
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await expect(page.locator('.code-fence-block')).toHaveCount(0);

  // 2) 重新建一个换行代码块，Enter → 退出代码块（保留代码块，光标移出）
  const editable2 = page.locator('span.block-content[contenteditable="true"]').first();
  await editable2.click();
  await page.keyboard.type('```java ', { delay: 20 });
  await page.waitForTimeout(300);
  const code2 = page.locator('.code-fence-block span.block-content');
  await code2.click();
  await page.keyboard.type('a', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);
  const state = await page.evaluate(() => {
    const active = document.activeElement;
    return { activeInCode: !!active && !!active.closest('.code-fence-block') };
  });
  expect(state.activeInCode).toBe(false);
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
      paragraphs: Array.from(el.querySelectorAll('p.paragraph-block')).map((p) => p.textContent),
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

// ============================================
// SPEC-EDIT-CBTP 6.2：应用重载后代码块尾随保护空行
// ============================================

test('```js 代码块 → 应用重载 → 代码块后空行恢复且点击可聚焦', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('```js ', { delay: 20 });
  await page.waitForTimeout(300);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);
  // 语言选择器把别名 js 归一化为 javascript（CodeBlock.normalizeLanguage，预期行为）
  await expect(page.locator('.code-fence-language-select')).toHaveValue('javascript');

  // 等自动保存落盘后再重载（reload 丢失内存块树，仅 mock 磁盘存储存活）
  await waitForDiskSave(page, '```js');
  await reloadAndReopen(page);

  // 从保存文本重建的块树：code-fence-block + 解析期补偿的空 paragraph
  const state = await readBlockStructure(page);
  expect(state.classes).toEqual([
    expect.stringContaining('code-fence-block'),
    expect.stringContaining('paragraph-block'),
  ]);
  expect(state.trailingEmpty).toBe('true');
  expect(state.trailingText).toBe('');
  await expect(page.locator('.code-fence-block')).toHaveCount(1);
  await expect(page.locator('.code-fence-language-select')).toHaveValue('javascript');
  await expect(page.locator('p.paragraph-block span.block-content[data-empty="true"]')).toHaveCount(
    1
  );

  // 空行点击可聚焦
  const trailing = page.locator('p.paragraph-block span.block-content').last();
  await trailing.click();
  await page.waitForTimeout(100);
  const focused = await trailing.evaluate((el) => document.activeElement === el);
  expect(focused).toBe(true);
});

test('重载后代码块尾随空行 Backspace 受保护（块树不变）', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('```js ', { delay: 20 });
  await page.waitForTimeout(300);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);

  await waitForDiskSave(page, '```js');
  await reloadAndReopen(page);

  const before = await readBlockStructure(page);

  // 空行上 Backspace → 前块为 code-block，mergeParagraph 保护：不合并、不删除
  const trailing = page.locator('p.paragraph-block span.block-content').last();
  await trailing.click();
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);

  // 块树不变化：结构快照一致，代码块与空块（data-empty）均仍在
  const after = await readBlockStructure(page);
  expect(after).toEqual(before);
  await expect(page.locator('.code-fence-block')).toHaveCount(1);
  await expect(page.locator('p.paragraph-block')).toHaveCount(1);
  await expect(page.locator('p.paragraph-block span.block-content[data-empty="true"]')).toHaveCount(
    1
  );
});

test('Bug C：代码块 + 图片 → 打开（图片解析为 image-block）→ 移除图片 → 代码块后保护空行补回（SPEC-EDIT-CBTP）', async ({
  page,
}) => {
  // 路由拦截 https 图片，保证 image-block 的 img 可点击（不触发 fallback 替换）
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="60" height="30" fill="#ccc"/></svg>';
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg })
  );

  await page.addInitScript(mockApi);
  await page.goto('/');
  await page.waitForSelector('header');
  // 直接向 mock 磁盘写入"代码块 + 图片"markdown（` ``` ` 后独立行图片被 markdownToState
  // 解析为 image-block，无中间空段——Bug C 复现场景，等价于打开已保存的此类文件）
  await page.evaluate(
    ({ key, content }) => {
      const disk: Record<string, string> = { 'C:\\playwright\\bugc.md': content };
      localStorage.setItem(key, JSON.stringify(disk));
    },
    { key: E2E_DISK_KEY, content: '```js\ncode\n```\n\n![a](https://example.com/a.png)' }
  );
  await page.keyboard.press('Control+o');
  await page.waitForSelector('span.block-content[contenteditable="true"]');

  await expect(page.locator('.code-fence-block')).toHaveCount(1);
  const img = page.locator('img.inline-image').first();
  await expect(img).toHaveCount(1);

  // 点击图片 → 图片工具栏 → 移除图片
  await img.click();
  const imageToolbar = page.locator('[data-testid="image-toolbar"]');
  await expect(imageToolbar).toBeVisible();
  await imageToolbar.locator('[data-testid="image-toolbar-remove"]').click();
  await page.waitForTimeout(300);

  // Bug C 修复：代码块成为最后叶子后按 CBTP 补回受保护空段（code-fence-block + 空 paragraph）
  const state = await readBlockStructure(page);
  expect(state.classes).toEqual([
    expect.stringContaining('code-fence-block'),
    expect.stringContaining('paragraph-block'),
  ]);
  expect(state.trailingEmpty).toBe('true');
  expect(state.trailingText).toBe('');
  await expect(page.locator('img.inline-image')).toHaveCount(0);
});

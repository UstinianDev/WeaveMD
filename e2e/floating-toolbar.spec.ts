// ============================================
// WeaveMD - v2 浮动工具栏回归（真实 Chromium）
// 覆盖：选区触发、加粗、块类型下拉（正文 ↔ H1-H6）
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

/** 在浮动工具栏块类型下拉中选择目标类型（自定义下拉，SPEC-EDIT-FT G3①） */
async function selectBlockType(
  toolbar: import('@playwright/test').Locator,
  value: string
): Promise<void> {
  await toolbar.locator('.block-type-trigger').click();
  await toolbar.locator(`.block-type-menu [data-value="${value}"]`).click();
}

test('选中文本后浮动工具栏出现并可加粗', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('hello world', { delay: 20 });
  // 全选（单块文档）触发选区
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();

  await toolbar.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**hello world**');
});

test('块类型下拉：正文 → H2 二级标题转换', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('标题内容', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();

  await selectBlockType(toolbar, 'h2');
  await page.waitForTimeout(300);
  await expect(page.locator('h2.heading-block')).toHaveCount(1);
  await expect(page.locator('h2.heading-block')).toContainText('标题内容');
});

test('块类型下拉：标题级别切换与转回正文', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('## 二级标题', { delay: 20 });
  await page.waitForTimeout(300);

  // 选中标题内容，工具栏下拉应显示 h2
  const h2 = page.locator('h2.heading-block span.block-content');
  await h2.click();
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('.block-type-trigger')).toHaveText('H2 二级标题');

  // H2 → H3
  await selectBlockType(toolbar, 'h3');
  await page.waitForTimeout(300);
  await expect(page.locator('h3.heading-block')).toHaveCount(1);

  // 再次选中 → 转回正文
  const h3 = page.locator('h3.heading-block span.block-content');
  await h3.click();
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar2 = page.locator('.floating-toolbar-v2');
  await expect(toolbar2).toBeVisible();
  await selectBlockType(toolbar2, 'paragraph');
  await page.waitForTimeout(300);
  await expect(page.locator('p.paragraph-block')).toHaveCount(1);
  await expect(page.locator('p.paragraph-block')).toContainText('二级标题');
});

test('G1：选中 h1 + h2 混合类型 → 浮动工具栏不出现', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('# 一级标题', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('## 二级标题', { delay: 20 });
  await page.waitForTimeout(300);

  // 鼠标从 h1 拖到 h2，构造真实跨块混合选区（Control+a 只选当前块，无法跨块）
  const h1 = page.locator('h1.heading-block span.block-content');
  const h2 = page.locator('h2.heading-block span.block-content');
  const firstBox = await h1.boundingBox();
  const secondBox = await h2.boundingBox();
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
  await page.waitForTimeout(400);

  // 确认已是跨块选区
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

  await expect(page.locator('.floating-toolbar-v2')).toHaveCount(0);
});

test('G3②：代码块选中 → 下拉显示"代码块"且其余目标禁用', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('```js', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('const a = 1;', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('```', { delay: 20 });
  await page.waitForTimeout(300);

  const codeContent = page.locator('.code-fence-content').first();
  await expect(codeContent).toBeVisible();
  await codeContent.click();
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);

  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('.block-type-trigger')).toHaveText('代码块');
  await toolbar.locator('.block-type-trigger').click();
  await expect(
    toolbar.locator('.block-type-menu [data-value="h1"]')
  ).toBeDisabled();
});

// ============================================================
// SPEC-EDIT-FT2 阶段 5：G1 尺寸 / G2 标记隐藏 / G3 新功能
// ============================================================
test('FT2-E1: 工具栏计算样式——字号≥14px、容器 gap≥6px、下拉项 padding/行高≥8px、总高≥40px', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('hello world', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();

  const btn = toolbar.locator('button[title="加粗"]');
  const btnFont = await btn.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(btnFont).toBeGreaterThanOrEqual(14);

  const containerGap = await toolbar.evaluate((el) =>
    parseFloat(getComputedStyle(el).columnGap || getComputedStyle(el).gap)
  );
  expect(containerGap).toBeGreaterThanOrEqual(6);

  await toolbar.locator('.block-type-trigger').click();
  const option = toolbar.locator('.block-type-menu [data-value="h1"]');
  const optPad = await option.evaluate((el) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  });
  expect(optPad).toBeGreaterThanOrEqual(16); // 8px*2

  const height = await toolbar.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(40);
});

test('FT2-E2: 加粗两次回到原文，绝不产生 ****', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('a', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**a**');
  // 再次全选 → 解除
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar2 = page.locator('.floating-toolbar-v2');
  await expect(toolbar2).toBeVisible();
  await toolbar2.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('a');
  await expect(editable).not.toContainText('****');
});

test('FT2-E3: 应用格式后 .md-syntax 默认不可见；DOM textContent 与源一致；块聚焦后灰显', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('加粗文本', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**加粗文本**');

  // 加粗后光标仍在块内（聚焦）→ .md-syntax 灰显（opacity 0.55）
  const mdSyntax = page.locator('.md-syntax').first();
  await expect(mdSyntax).toHaveCount(1);
  const faded = await mdSyntax.evaluate((el) => getComputedStyle(el).opacity === '0.55');
  expect(faded).toBe(true);

  // 点击编辑区外失焦 → .md-syntax 不可见（font-size 0 或 opacity 0）
  await page.locator('header').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(300);
  const hidden = await mdSyntax.evaluate((el) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.fontSize) === 0 || cs.opacity === '0';
  });
  expect(hidden).toBe(true);
});

test('FT2-E4: ==高亮== → mark 计算背景为黄色（浅色 rgb(255,235,59)）', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('==高亮==', { delay: 20 });
  await page.waitForTimeout(300);
  const mark = page.locator('mark');
  await expect(mark).toHaveCount(1);
  const bg = await mark.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(255, 235, 59)');
});

test('FT2-E5: 下划线按钮 → <u> 渲染且无可见 <u> 文本', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('下划线文本', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="下划线"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('u')).toHaveCount(1);
  await expect(editable).toHaveText('<u>下划线文本</u>');
});

test('FT2-E6: 图片按钮（dialog 输入 URL）→ ![alt](url) 插入并渲染 img.inline-image', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('图片文本', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  page.once('dialog', async (d) => {
    await d.accept('https://example.com/a.png');
  });
  await toolbar.locator('button[title="图片"]').click();
  await page.waitForTimeout(300);
  // img 无文本内容（textContent 为空），断言 alt/src 与数量
  const img = page.locator('img.inline-image');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('alt', '图片文本');
  await expect(img).toHaveAttribute('src', 'https://example.com/a.png');
});

test('FT2-E7: 数学按钮 → $x^2$ 渲染为 .katex 且无可见 $', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('x^2', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="数学公式"]').click();
  await page.waitForTimeout(500);
  await expect(page.locator('.math-inline .katex')).toHaveCount(1);
});

test('FT2-E8: 橡皮擦 → 清除选区全部行内格式为纯文本', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('加粗文本', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**加粗文本**');
  // 全选 → 橡皮擦清除
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar2 = page.locator('.floating-toolbar-v2');
  await expect(toolbar2).toBeVisible();
  await toolbar2.locator('button[title="橡皮擦"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('加粗文本');
});

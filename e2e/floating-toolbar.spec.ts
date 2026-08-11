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

/**
 * SPEC-EDIT-FT3：按块文本偏移（textContent 口径，含 .md-syntax 标记字符、
 * 跳过零宽空格 \u200B）构造真实 Range 选区——与 kernel/selection.ts offsetToDomPoint 同口径。
 */
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

/** 全选当前块内容并删除，回到空段落（供同一测试内多场景复用） */

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
test('FT2-E1: 工具栏计算样式——字号13px、容器 gap 4~5px、按钮 32×28px、总高 clientHeight ≤ 34px（SPEC-EDIT-FT3 G4）', async ({
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
  const btnStyle = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      font: parseFloat(cs.fontSize),
      width: parseFloat(cs.width),
      height: parseFloat(cs.height),
    };
  });
  expect(btnStyle.font).toBe(13);
  expect(btnStyle.width).toBe(32);
  expect(btnStyle.height).toBe(28);

  const containerGap = await toolbar.evaluate((el) =>
    parseFloat(getComputedStyle(el).columnGap || getComputedStyle(el).gap)
  );
  expect(containerGap).toBeGreaterThanOrEqual(4);
  expect(containerGap).toBeLessThanOrEqual(5);

  await toolbar.locator('.block-type-trigger').click();
  const option = toolbar.locator('.block-type-menu [data-value="h1"]');
  const optPad = await option.evaluate((el) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  });
  expect(optPad).toBeGreaterThanOrEqual(12); // 6px*2

  // 总高口径：按钮 28px + 容器垂直 padding 3px×2 = 34px（含 padding 不含 border）
  const height = await toolbar.evaluate((el) => el.clientHeight);
  expect(height).toBeLessThanOrEqual(34);
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

test('FT2-E3: 应用格式后 .md-syntax 默认不可见；DOM textContent 与源一致；聚焦/失焦均隐藏（WYSIWYG）', async ({
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

  // 光标在块内（聚焦）→ .md-syntax 仍隐藏（e5e2f6f 移除聚焦灰显，改为始终 WYSIWYG）
  const mdSyntax = page.locator('.md-syntax').first();
  await expect(mdSyntax).toHaveCount(1);
  const focusedHidden = await mdSyntax.evaluate((el) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.fontSize) === 0 || cs.opacity === '0';
  });
  expect(focusedHidden).toBe(true);

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

test('FT2-E6: 图片按钮（两段式）→ 插入占位 + ImageEditTool 输入 https URL → 嵌入 → ![alt](url) 渲染 img.inline-image（G2）', async ({
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
  // K3b：图片按钮 → 立即插入 `![图片文本]()` 占位 + 工具栏隐藏 + ImageEditTool 锚定（alt 预填选区文本）
  await toolbar.locator('button[title="图片"]').click();
  await expect(toolbar).toHaveCount(0);
  const tool = page.locator('[data-testid="image-edit-tool"]');
  await expect(tool).toBeVisible();
  await expect(editable.locator('.inline-image-empty')).toHaveText('图片文本');
  await expect(tool.locator('input[placeholder="可选描述 (alt)"]')).toHaveValue('图片文本');
  await tool.locator('input[placeholder="输入图片 URL"]').click();
  await page.keyboard.type('https://example.com/a.png', { delay: 10 });
  await tool.getByRole('button', { name: '嵌入', exact: true }).click();
  await page.waitForTimeout(300);
  // 网络图受 CSP https: 放行，应能渲染 img（不回退占位）；断言 alt/src 与数量
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

// ============================================================
// SPEC-EDIT-FT3：G1 不叠加 / G2 无残留 / G3 工具栏驻留退出
// ============================================================
test('FT3-E1: 选中部分语法标记再点加粗 → 解除且绝不产生 ****（SPEC-EDIT-FT3 G1）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('123', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**123**');

  // 选中 123**（含右侧部分标记）→ 点加粗 → 解除为 123
  await selectTextRange(page, 2, 7);
  await page.waitForTimeout(300);
  const toolbar2 = page.locator('.floating-toolbar-v2');
  await expect(toolbar2).toBeVisible();
  await toolbar2.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('123');
  await expect(editable).not.toContainText('****');

  // 重新加粗 → 选中 **123（含左侧部分标记）→ 点加粗 → 解除
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar3 = page.locator('.floating-toolbar-v2');
  await expect(toolbar3).toBeVisible();
  await toolbar3.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**123**');
  await selectTextRange(page, 0, 5);
  await page.waitForTimeout(300);
  const toolbar4 = page.locator('.floating-toolbar-v2');
  await expect(toolbar4).toBeVisible();
  await toolbar4.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('123');
  await expect(editable).not.toContainText('****');
});

test('FT3-E2: 高亮部分标记再点 → 无 ==== 双层、无残留 mark（SPEC-EDIT-FT3 G2）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('123', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="高亮"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('==123==');
  await expect(page.locator('mark')).toHaveCount(1);

  // 选中 123==（含右侧部分标记）→ 点高亮 → 解除，无 mark 残留
  await selectTextRange(page, 2, 7);
  await page.waitForTimeout(300);
  const toolbar2 = page.locator('.floating-toolbar-v2');
  await expect(toolbar2).toBeVisible();
  await toolbar2.locator('button[title="高亮"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('123');
  await expect(editable).not.toContainText('====');
  await expect(page.locator('mark')).toHaveCount(0);
});

test('FT3-E3: 加粗后工具栏驻留且 B 高亮；点击工具栏外退出（SPEC-EDIT-FT3 G3）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('123', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);

  // 工具栏驻留且内容保持选中
  await expect(toolbar).toBeVisible();
  const selCollapsed = await page.evaluate(() => window.getSelection()?.isCollapsed);
  expect(selCollapsed).toBe(false);
  // 加粗按钮 active（style 含 --accent）
  const activeStyle = await toolbar
    .locator('button[title="加粗"]')
    .evaluate((el) => el.getAttribute('style') ?? '');
  expect(activeStyle).toContain('var(--accent)');

  // 点击工具栏外（页面 header）→ 退出
  await page.locator('header').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(300);
  await expect(toolbar).toHaveCount(0);
});

test('FT3-E5: 加粗后按 Escape → 工具栏退出（SPEC-EDIT-FT3 G3）', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('123', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(toolbar).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(toolbar).toHaveCount(0);
});

test('FT3-E6: 跨多 token 选区点加粗 → 两 token 均解除，无 ****（C10 逐 token 拆分）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('a **b** c **d** e', { delay: 20 });
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('a **b** c **d** e');

  // 选中覆盖 token1 close 与 token2 open 的区间 [4,13)
  await selectTextRange(page, 4, 13);
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);

  // 两个 token 均解除为纯文本，无双层标记
  await expect(editable).toHaveText('a b c d e');
  await expect(editable).not.toContainText('****');
  await expect(page.locator('strong')).toHaveCount(0);
});

test('FT3-E7: 加粗后再斜体 → `***` 渲染 em 内嵌 strong，无字面语法符号残留（C11 跨风格叠加）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('abc', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**abc**');
  await expect(page.locator('strong')).toHaveCount(1);

  // 工具栏驻留、内容仍选中 → 直接点斜体
  await expect(toolbar).toBeVisible();
  const selCollapsed = await page.evaluate(() => window.getSelection()?.isCollapsed);
  expect(selCollapsed).toBe(false);
  await toolbar.locator('button[title="斜体"]').click();
  await page.waitForTimeout(300);

  // 叠加为 `***abc***`：em 内嵌 strong，abc 无字面 `*` 污染
  await expect(editable).toHaveText('***abc***');
  await expect(page.locator('em')).toHaveCount(1);
  await expect(page.locator('em strong')).toHaveCount(1);
  const strongInnerText = await page.locator('em strong').evaluate((el) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
  );
  expect(strongInnerText).toBe('abc');
});

// ============================================
// PLAN-EDIT-FT4：跨风格叠加（S1）E2E 验收
// ============================================
test('FT4-E1: `**123**` 选 `3**`（含 close 标记）点斜体 → strong 内嵌 em，无字面 `*` 残体（PLAN-EDIT-FT4 S1）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('123', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="加粗"]').click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**123**');
  await expect(page.locator('strong')).toHaveCount(1);

  // 程序化选区覆盖 close 标记 `**`（含标记偏移 [4,7) = `3**`）
  await selectTextRange(page, 4, 7);
  await page.waitForTimeout(300);
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="斜体"]').click();
  await page.waitForTimeout(400);

  // 文本层：`**12*3***`，strong 内嵌 em（`3` 斜体），加粗标记原位不动
  await expect(editable).toHaveText('**12*3***');
  await expect(page.locator('strong em')).toHaveCount(1);
  const emInner = await page.locator('em').evaluate((el) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
  );
  expect(emInner).toBe('3');

  // 剥离 .md-syntax 后无裸星（无字面残体）
  const residue = await page.evaluate(() => {
    const el = document.querySelector('span.block-content[contenteditable="true"]');
    if (!el) return 'NO_BLOCK';
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.md-syntax').forEach((n) => n.remove());
    return (clone.textContent ?? '').replace(/\u200B/g, '');
  });
  expect(residue).not.toContain('*');
});

test('FT4-E2: `**12*3***` 选 `*3*`（em 全 token）点下划线 → `<u>` 内纯内容、无 `.md-syntax` 标记字符（PLAN-EDIT-FT4 S1）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('**12*3***', { delay: 20 });
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**12*3***');

  // 程序化选区覆盖 em 标记 `*3*`（含标记偏移 [4,7)）
  await selectTextRange(page, 4, 7);
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="下划线"]').click();
  await page.waitForTimeout(400);

  // `<u>` 标记渲染为 u 元素内 `.md-syntax` 灰显（架构如此，对标 FT2-E5）；剥离标记后 u 内为纯内容 `3`，
  // em 标记 `*` 保留在 `<u>` 外，u 内无 `*` 残体
  await expect(editable).toHaveText('**12*<u>3</u>***');
  const u = page.locator('u');
  await expect(u).toHaveCount(1);
  const uResidue = await u.evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.md-syntax').forEach((n) => n.remove());
    return (clone.textContent ?? '').replace(/\u200B/g, '');
  });
  expect(uResidue).toBe('3');
  const uStar = await u.evaluate((el) => (el.textContent ?? '').replace(/\u200B/g, '').includes('*'));
  expect(uStar).toBe(false);
});

// ============================================================
// PLAN-EDIT-LINK-IMAGE：链接补协议 / tooltip / media:// 图片 / 占位回退（E2E）
// 说明：
//  1) 链接生成走工具栏 InsertUrlModal（U5）；图片走 K3b 两段式（图片按钮 → 占位 → ImageEditTool），
//     均不用 raw 键入 markdown——contentEditable 会对 `[`/`(` 自动补全闭合括号，raw 键入 `[x](...)`
//     会被破坏（实测 `[]x]()...`）。
//  2) renderer-only 环境无 Electron 主进程 media handler，media:// 图片在 Chromium 中加载
//     404 → 触发 EditorV2 onErrorCapture 回退为 .inline-image-fallback。img 被替换为瞬态
//     （下次重渲染覆盖），故用 MutationObserver 在 img 创建时捕获 src。
// ============================================================
test('LINK-IMAGE-E1: \u5DE5\u5177\u680F\u63D2\u5165\u65E0\u534F\u8BAE\u94FE\u63A5 www.baidu.com \u2192 href/data-href \u8865 https:// \u4E14 textContent \u4E0D\u53D8\uFF08G4+G6\uFF09', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('\u94FE\u63A5\u6587\u672C', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();

  // \u5DE5\u5177\u680F"\u94FE\u63A5"\u2192 \u5F39 InsertUrlModal \u2192 \u8F93\u5165\u88F8\u57DF\u540D \u2192 \u786E\u5B9A
  await toolbar.locator('button[title="\u94FE\u63A5"]').click();
  const modal = page.locator('.insert-url-modal-overlay');
  await expect(modal).toBeVisible();
  await modal.locator('#insert-url-modal-input').click();
  await page.keyboard.type('www.baidu.com', { delay: 10 });
  await modal.getByRole('button', { name: '\u786E\u5B9A' }).click();
  await page.waitForTimeout(300);

  const link = page.locator('a.inline-link');
  await expect(link).toHaveCount(1);
  // G4\uFF1Ahref \u4E0E data-href \u5747\u8865\u5168\u4E3A\u53EF\u6253\u5F00\u7684\u5B8C\u6574 URL
  await expect(link).toHaveAttribute('href', 'https://www.baidu.com');
  await expect(link).toHaveAttribute('data-href', 'https://www.baidu.com');
  // \u94FE\u63A5\u53EF\u89C6\u6587\u5B57\u4E3A label\uFF08\u5265\u79BB .md-syntax \u6807\u8BB0\u5B57\u7B26\uFF09
  const label = await link.evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.md-syntax').forEach((n) => n.remove());
    return (clone.textContent ?? '').replace(/\u200B/g, '');
  });
  expect(label).toBe('\u94FE\u63A5\u6587\u672C');
  // G6\uFF1ADOM textContent \u4E0E\u6E90 markdown \u4E00\u81F4\uFF08.md-syntax \u6807\u8BB0\u9690\u85CF\u5B57\u7B26\u4E0D\u5F71\u54CD textContent\uFF09
  await expect(editable).toHaveText('[\u94FE\u63A5\u6587\u672C](www.baidu.com)');
});

test('LINK-IMAGE-E2: hover \u94FE\u63A5 \u2192 ::after tooltip content == \u8865\u5168\u540E URL\uFF08G5\uFF09', async ({ page }) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('\u94FE\u63A5\u6587\u672C', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="\u94FE\u63A5"]').click();
  const modal = page.locator('.insert-url-modal-overlay');
  await expect(modal).toBeVisible();
  await modal.locator('#insert-url-modal-input').click();
  await page.keyboard.type('www.baidu.com', { delay: 10 });
  await modal.getByRole('button', { name: '\u786E\u5B9A' }).click();
  await page.waitForTimeout(300);

  const link = page.locator('a.inline-link');
  await expect(link).toHaveCount(1);
  await link.hover();
  await page.waitForTimeout(200);

  const content = await link.evaluate((el) => getComputedStyle(el, '::after').content);
  expect(content).not.toBe('none');
  // content \u5E8F\u5217\u5316\u4E3A\u5E26\u5F15\u53F7\u5B57\u7B26\u4E32\uFF0C\u5982 `"https://www.baidu.com"`
  expect(content.replace(/"/g, '')).toContain('https://www.baidu.com');
});

test('LINK-IMAGE-E3: 图片两段式 · 本地选择（pickImage=C:\\playwright\\a.png）→ 直接应用 img src=media://C%3A/... 且加载失败回退占位（G1+G3）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();

  // MutationObserver \u6355\u83B7 img.inline-image \u521B\u5EFA\u65F6\u7684 src\uFF08img \u4F1A\u88AB fallback \u66FF\u6362\uFF0C\u9700\u8BB0\u4E0B\u77AC\u6001 src\uFF09
  await page.evaluate(() => {
    const win = window as unknown as { __capturedImgSrc?: string[] };
    win.__capturedImgSrc = [];
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          const el = n as HTMLElement;
          if (
            n.nodeType === 1 &&
            el.tagName === 'IMG' &&
            el.classList.contains('inline-image')
          ) {
            win.__capturedImgSrc?.push(el.getAttribute('src') ?? '');
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });

  await editable.click();
  await page.keyboard.type('\u56FE\u7247\u6587\u672C', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();

  // K3b：图片按钮 → ImageEditTool → 本地选择 → 选择图片（pickImage 返回 C:\playwright\a.png 直接应用）
  await toolbar.locator('button[title="图片"]').click();
  const tool = page.locator('[data-testid="image-edit-tool"]');
  await expect(tool).toBeVisible();
  await tool.getByRole('button', { name: '本地选择' }).click();
  await tool.getByRole('button', { name: '选择图片' }).click();
  await page.waitForTimeout(500);

  // G1\uFF1Aimg \u521B\u5EFA\u65F6 src \u4E3A media:// + encodeURIComponent\uFF08\u76D8\u7B26\u5192\u53F7\u7F16\u7801\u3001\u659C\u6760\u4FDD\u7559\uFF09
  const captured = await page.evaluate(
    () => (window as unknown as { __capturedImgSrc?: string[] }).__capturedImgSrc ?? []
  );
  expect(captured).toContain('media://C%3A/playwright/a.png');

  // G3\uFF1Amedia:// \u5728 renderer-only \u4E0B 404 \u2192 \u56DE\u9000\u5360\u4F4D\uFF0C\u65E0\u6B8B\u7559 broken img
  const fallback = page.locator('.inline-image-fallback');
  await expect(fallback).toHaveCount(1, { timeout: 3000 });
  await expect(fallback).toHaveText('\u56FE\u7247\u6587\u672C'); // alt \u6587\u672C
  await expect(page.locator('img.inline-image')).toHaveCount(0);
});

test('LINK-IMAGE-E4: 图片两段式 · 嵌入不存在图片 C:/no-such-file.png → 占位回退且无残留 img.inline-image（G3）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('\u56FE\u7247\u6587\u672C', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();

  // K3b：图片按钮 → ImageEditTool → 输入不存在的本地路径 → 嵌入 → media://C%3A/no-such-file.png 加载失败 → 回退占位
  await toolbar.locator('button[title="图片"]').click();
  const tool = page.locator('[data-testid="image-edit-tool"]');
  await expect(tool).toBeVisible();
  await tool.locator('input[placeholder="输入图片 URL"]').click();
  await page.keyboard.type('C:/no-such-file.png', { delay: 10 });
  await tool.getByRole('button', { name: '嵌入', exact: true }).click();

  const fallback = page.locator('.inline-image-fallback');
  await expect(fallback).toHaveCount(1, { timeout: 3000 });
  // 回退占位显示 alt 文本（图片文本），而非 broken 图标
  await expect(fallback).toHaveText('图片文本');
  await expect(page.locator('img.inline-image')).toHaveCount(0);
});

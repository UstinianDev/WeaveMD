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
      // K7：直选流程的 pickImage 返回值由用例内哨兵 __pickImageResult 覆盖
      // （undefined → 默认本地路径；null = 取消；也可覆盖为不存在路径 / https URL）
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

test('G1（第 7 期 A2 更新）：选中 h1 + h2 混合类型 → 工具栏出现且仅含「AI 改写」、无行内格式/块类型下拉', async ({ page }) => {
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

  // A2（第 7 期）：混合类型不再 hide —— 工具栏出现，仅含「AI 改写」，行内格式/块类型隐藏
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible({ timeout: 5000 });
  await expect(toolbar).toHaveAttribute('data-mixed', 'true');
  await expect(toolbar.locator('button[title="AI 改写"]')).toBeVisible();
  await expect(toolbar.locator('button[title="加粗"]')).toHaveCount(0);
  await expect(toolbar.locator('button[title="斜体"]')).toHaveCount(0);
  await expect(toolbar.locator('.block-type-trigger')).toHaveCount(0);
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

test('FT2-E6: 图片按钮（直选）→ pickImage 返回本地路径 → 整段替换为 ![alt](src)、无中间弹层；media:// 404 回退占位（K6）', async ({
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

  // K6：图片按钮 → 直接 pickImage（mock 默认返回 C:\playwright\a.png），不弹
  // InsertUrlModal / ImageEditTool，无占位中间态
  await toolbar.locator('button[title="图片"]').click();
  await page.waitForTimeout(500);

  // 无弹层
  await expect(page.locator('.insert-url-modal-overlay')).toHaveCount(0);
  await expect(page.locator('[data-testid="image-edit-tool"]')).toHaveCount(0);
  await expect(page.locator('.inline-image-empty')).toHaveCount(0);

  // 整段替换 → 块变 image-block（非编辑块，DOM 无 markdown 字面；选区文本进 img alt）；
  // 插入时自动补一个空段落供继续输入
  await expect(page.locator('.image-block')).toHaveCount(1);
  await expect(page.locator('p.paragraph-block')).toHaveCount(1);
  await expect(
    page.locator('p.paragraph-block span.block-content')
  ).toHaveAttribute('data-empty', 'true');

  // G3：media:// 在 renderer-only 下 404 → 回退占位（alt 文本），无残留 broken img。
  // image-block 路径下 Chromium 对无效协议 img 同步 error → fallback 直接渲染，
  // 瞬时 img 不进入 DOM（src 编码断言见 LINK-IMAGE-E3 行内路径）
  const fallback = page.locator('.inline-image-fallback');
  await expect(fallback).toHaveCount(1, { timeout: 3000 });
  await expect(fallback).toHaveText('图片文本');
  await expect(page.locator('img.inline-image')).toHaveCount(0);

  // 插入完成后工具栏隐藏（不自动弹出图片工具栏）
  await expect(toolbar).toHaveCount(0);
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

test('FT2-E9: 图片按钮取消（pickImage=null）→ 纯 no-op：文本不变、无弹层、无占位残留、工具栏隐藏（K6）', async ({
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

  // 覆盖 pickImage 返回 null（用户取消文件选择）
  await page.evaluate(() => {
    (window as unknown as { __pickImageResult: string | null }).__pickImageResult = null;
  });
  await toolbar.locator('button[title="图片"]').click();
  await page.waitForTimeout(500);

  // 文本不变（无替换、无占位插入）
  await expect(editable).toHaveText('图片文本');
  // 无任何弹层 / 占位残留
  await expect(page.locator('.insert-url-modal-overlay')).toHaveCount(0);
  await expect(page.locator('[data-testid="image-edit-tool"]')).toHaveCount(0);
  await expect(page.locator('.inline-image-empty')).toHaveCount(0);
  await expect(page.locator('.inline-image-fallback')).toHaveCount(0);
  await expect(page.locator('.image-block')).toHaveCount(0);
  await expect(page.locator('img.inline-image')).toHaveCount(0);
  // 工具栏隐藏（取消后不驻留）
  await expect(toolbar).toHaveCount(0);
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
//  1) 链接生成走工具栏 InsertUrlModal（U5）；图片走 K6 直选（图片按钮 → pickImage →
//     直接替换选区，取消 no-op），均不用 raw 键入 markdown——contentEditable 会对
//     `[`/`(` 自动补全闭合括号，raw 键入 `[x](...)` 会被破坏（实测 `[]x]()...`）。
//  2) renderer-only 环境无 Electron 主进程 media handler，media:// 图片在 Chromium 中
//     加载 404 → 触发 EditorV2 onErrorCapture 回退为 .inline-image-fallback。img 被
//     替换为瞬态（下次重渲染覆盖），故用 MutationObserver 在 img 创建时捕获 src。
//  3) 图片工具栏用例（E5/E6）用 https 图（CSP https: 放行，route 拦截返回 SVG 保证
//     加载成功不触发 fallback），使 img 保持可点击；URL 图渲染 src 直用 https 无 media://。
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

test('LINK-IMAGE-E2: hover \u94FE\u63A5 \u2192 ::after tooltip content == \u65B0\u63D0\u793A\u201Cctrl + \u5DE6\u952E  \u6253\u5F00\u7F51\u9875\u201D\uFF08R3\uFF09', async ({ page }) => {
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
  // R4\uFF1A\u94FE\u63A5\u547D\u4E2D\u65F6\u5DE5\u5177\u680F\u5DE6\u7F6E\uFF0C\u94FE\u63A5\u8D34\u8FD1\u5DE6\u7F18\u4F1A\u88AB\u5BBD\u5DE5\u5177\u680F\u906E\u6321 \u2192 \u5148 Escape \u6536\u8D77
  // \u5DE5\u5177\u680F\u518D hover\uFF0C\u907F\u514D\u5DE5\u5177\u680F\u6309\u94AE\u62E6\u622A\u6307\u9488\u4E8B\u4EF6\uFF08hover \u65AD\u8A00\u53EA\u9488\u5BF9 tooltip \u672C\u4F53\uFF09\u3002
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await link.hover();
  await page.waitForTimeout(200);

  const content = await link.evaluate((el) => getComputedStyle(el, '::after').content);
  expect(content).not.toBe('none');
  // R3\uFF1A\u4E0D\u518D\u663E\u793A\u539F\u59CB URL\uFF0C\u6539\u663E\u793A\u201Cctrl + \u5DE6\u952E  \u6253\u5F00\u7F51\u9875\u201D\uFF08\u952E\u5B57\u540E\u53CC\u7A7A\u683C\uFF09
  expect(content.replace(/"/g, '')).not.toContain('www.baidu.com');
  expect(content.replace(/"/g, '')).toContain('ctrl + \u5DE6\u952E  \u6253\u5F00\u7F51\u9875');
});

test('LINK-IMAGE-E4R5: \u9009\u4E2D\u6587\u672C \u2192 \u52A0\u94FE\uFF08InsertUrlModal\uFF09\u2192 \u4E0D\u70B9\u786E\u5B9A\u76F4\u63A5\u56DE\u8F66 \u2192 \u94FE\u63A5\u5E94\u7528\u4E14\u9009\u4E2D\u5185\u5BB9\u4E0D\u4E22\u5931\uFF08R5 G1+G2\uFF09', async ({
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

  // \u52A0\u94FE \u2192 InsertUrlModal \u2192 \u8F93\u5165 URL \u540E\u3010\u76F4\u63A5\u56DE\u8F66\u3011\uFF08\u4E0D\u70B9\u786E\u5B9A\uFF09
  await toolbar.locator('button[title="\u94FE\u63A5"]').click();
  const modal = page.locator('.insert-url-modal-overlay');
  await expect(modal).toBeVisible();
  await modal.locator('#insert-url-modal-input').click();
  await page.keyboard.type('www.baidu.com', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  // G1/G2\uFF1A\u94FE\u63A5\u5B58\u5728\uFF0CtextContent \u4E0D\u4E22\uFF0C\u7126\u70B9/\u9009\u533A\u6062\u590D
  const link = page.locator('a.inline-link');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('data-href', /https:\/\/www\.baidu\.com/);
  // \u53EF\u89C6\u5316\u6587\u672C = \u539F\u9009\u4E2D label\uFF08\u5265\u79BB .md-syntax \u6807\u8BB0\u5B57\u7B26\uFF09
  const label = await link.evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.md-syntax').forEach((n) => n.remove());
    return (clone.textContent ?? '').replace(/\u200B/g, '');
  });
  expect(label).toBe('\u94FE\u63A5\u6587\u672C');
  // \u6E90 markdown \u4E0E DOM textContent \u4E00\u81F4\uFF08\u5185\u5BB9\u672A\u4E22\u5931\uFF09
  await expect(editable).toHaveText('[\u94FE\u63A5\u6587\u672C](www.baidu.com)');
  // \u9009\u533A\u6062\u590D\uFF1AactiveElement \u5728\u5757\u5185\u5BB9\u5185\uFF0C\u4E14 selection \u975E\u7A7A\uFF08\u9009\u4E2D\u94FE\u63A5 label\uFF09
  const activeInBlock = await page.evaluate(() => {
    const ae = document.activeElement;
    return !!ae && (!!ae.closest('.block-content') || !!ae.closest('.content-block-inner'));
  });
  expect(activeInBlock).toBe(true);
  const selText = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const r = sel.getRangeAt(0);
    return (r.toString() || '').replace(/\u200B/g, '');
  });
  expect(selText.length).toBeGreaterThan(0);
});

test('LINK-IMAGE-E3: 图片直选 · 本地路径（pickImage=C:\\playwright\\a.png）→ 行内替换 img src=media://C%3A/... 且加载失败回退占位、无残留 img（G1+G3）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();

  // MutationObserver 捕获 img.inline-image 创建时的 src（行内路径 img 真正插入 DOM，
  // 随后被 fallback 替换，需记下瞬时 src；image-block 路径 img 不进 DOM，见 FT2-E6）
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
  await page.keyboard.type('图片文本x', { delay: 20 });
  await page.waitForTimeout(300);

  // 部分选区 [0,4)：行内替换（块内残留 'x'，不会转 image-block）
  await selectTextRange(page, 0, 4);
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();

  // K6：图片按钮 → 直接 pickImage（默认返回 C:\playwright\a.png）→ 替换选区，无 ImageEditTool 中间态
  await toolbar.locator('button[title="图片"]').click();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="image-edit-tool"]')).toHaveCount(0);

  // G1：img 创建时 src 为 media:// + encodeURIComponent（盘符冒号编码、斜杠保留）
  const captured = await page.evaluate(
    () => (window as unknown as { __capturedImgSrc?: string[] }).__capturedImgSrc ?? []
  );
  expect(captured).toContain('media://C%3A/playwright/a.png');

  // G3：media:// 在 renderer-only 下 404 → 回退占位，无残留 broken img
  const fallback = page.locator('.inline-image-fallback');
  await expect(fallback).toHaveCount(1, { timeout: 3000 });
  await expect(fallback).toHaveText('图片文本'); // alt 文本
  await expect(page.locator('img.inline-image')).toHaveCount(0);
});

test('LINK-IMAGE-E4: 图片直选 · 不存在路径（pickImage=C:/no-such-file.png）→ 占位回退且无残留 img.inline-image（G3）', async ({
  page,
}) => {
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  // 覆盖 pickImage 返回不存在的本地路径
  await page.evaluate(() => {
    (window as unknown as { __pickImageResult: string | null }).__pickImageResult =
      'C:/no-such-file.png';
  });
  await editable.click();
  await page.keyboard.type('图片文本', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();

  // K6：图片按钮 → 直接 pickImage → 替换选区 → media://C%3A/no-such-file.png 加载失败 → 回退占位
  await toolbar.locator('button[title="图片"]').click();
  await page.waitForTimeout(500);

  const fallback = page.locator('.inline-image-fallback');
  await expect(fallback).toHaveCount(1, { timeout: 3000 });
  // 回退占位显示 alt 文本（图片文本），而非 broken 图标
  await expect(fallback).toHaveText('图片文本');
  await expect(page.locator('img.inline-image')).toHaveCount(0);
});

test('LINK-IMAGE-E5: 图片工具栏全链路——点击图 → 居左/居中/居右（active）→ 修改图片（预填+替换保留包裹）→ 内联图片 → 移除图片（K4/K5/K6）', async ({
  page,
}) => {
  // renderer-only 下 media:// 无主进程会 404 触发 fallback 替换 img；本用例用 https 图
  // （CSP https: 放行）route 拦截返回 SVG，保证 img 加载成功保持可点击
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#ccc"/></svg>';
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg })
  );

  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('图片文本', { delay: 20 });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();

  // 直选插入 https 图（URL 图渲染 src 直用 https，无 media://）→ 整段替换 → image-block
  await page.evaluate(() => {
    (window as unknown as { __pickImageResult: string | null }).__pickImageResult =
      'https://example.com/a.png';
  });
  await toolbar.locator('button[title="图片"]').click();
  const imageBlock = page.locator('.image-block');
  await expect(imageBlock).toHaveCount(1);
  const img = page.locator('.image-block img.inline-image').first();
  await expect(img).toHaveAttribute('src', 'https://example.com/a.png');
  await expect(img).toHaveAttribute('alt', '图片文本');

  // 点击图片 → 图片工具栏出现且文本工具栏（块类型下拉）不出现
  await img.click();
  const imageToolbar = page.locator('[data-testid="image-toolbar"]');
  await expect(imageToolbar).toBeVisible();
  await expect(page.locator('.block-type-trigger')).toHaveCount(0);

  // 6 按钮中文文案断言
  await expect(imageToolbar.locator('[data-testid="image-toolbar-edit"]')).toHaveText('修改图片');
  await expect(imageToolbar.locator('[data-testid="image-toolbar-inline"]')).toHaveText('内联图片');
  await expect(imageToolbar.locator('[data-testid="image-toolbar-align-left"]')).toHaveText('居左');
  await expect(
    imageToolbar.locator('[data-testid="image-toolbar-align-center"]')
  ).toHaveText('居中');
  await expect(imageToolbar.locator('[data-testid="image-toolbar-align-right"]')).toHaveText('居右');
  await expect(imageToolbar.locator('[data-testid="image-toolbar-remove"]')).toHaveText('移除图片');

  // 居左 → 块 textAlign=left；动作后工具栏关闭，重开时「居左」active（style 含 --accent）
  await imageToolbar.locator('[data-testid="image-toolbar-align-left"]').click();
  await expect(imageBlock).toHaveCSS('text-align', 'left');
  await page.locator('.image-block img.inline-image').first().click();
  const toolbarLeft = page.locator('[data-testid="image-toolbar"]');
  await expect(toolbarLeft).toBeVisible();
  const leftActive = await toolbarLeft
    .locator('[data-testid="image-toolbar-align-left"]')
    .evaluate((el) => el.getAttribute('style') ?? '');
  expect(leftActive).toContain('var(--accent)');

  // 换向：居中 → textAlign=center；重开时「居中」active
  await toolbarLeft.locator('[data-testid="image-toolbar-align-center"]').click();
  await expect(imageBlock).toHaveCSS('text-align', 'center');
  await page.locator('.image-block img.inline-image').first().click();
  const toolbarCenter = page.locator('[data-testid="image-toolbar"]');
  await expect(toolbarCenter).toBeVisible();
  const centerActive = await toolbarCenter
    .locator('[data-testid="image-toolbar-align-center"]')
    .evaluate((el) => el.getAttribute('style') ?? '');
  expect(centerActive).toContain('var(--accent)');

  // 居右 → textAlign=right
  await toolbarCenter.locator('[data-testid="image-toolbar-align-right"]').click();
  await expect(imageBlock).toHaveCSS('text-align', 'right');

  // 修改图片：预填 src/alt → 输入新 URL → 嵌入 → 新 src 且对齐包裹保留（仍 image-block + right）
  await page.locator('.image-block img.inline-image').first().click();
  const toolbarEdit = page.locator('[data-testid="image-toolbar"]');
  await expect(toolbarEdit).toBeVisible();
  await toolbarEdit.locator('[data-testid="image-toolbar-edit"]').click();
  const tool = page.locator('[data-testid="image-edit-tool"]');
  await expect(tool).toBeVisible();
  await expect(tool.locator('input[placeholder="输入图片 URL"]')).toHaveValue(
    'https://example.com/a.png'
  );
  await expect(tool.locator('input[placeholder="可选描述 (alt)"]')).toHaveValue('图片文本');
  await tool.locator('input[placeholder="输入图片 URL"]').fill('https://example.com/new.png');
  await tool.getByRole('button', { name: '嵌入', exact: true }).click();
  await page.waitForTimeout(300);
  await expect(imageBlock).toHaveCSS('text-align', 'right');
  await expect(page.locator('.image-block img.inline-image')).toHaveAttribute(
    'src',
    'https://example.com/new.png'
  );

  // 内联图片：解除包裹 → 块变 paragraph（源码层 wrapper 移除）；插入时补的空段落保持原样
  await page.locator('.image-block img.inline-image').first().click();
  const toolbarInline = page.locator('[data-testid="image-toolbar"]');
  await expect(toolbarInline).toBeVisible();
  await toolbarInline.locator('[data-testid="image-toolbar-inline"]').click();
  await expect(page.locator('.image-block')).toHaveCount(0);
  const para = page.locator('p.paragraph-block');
  await expect(para).toHaveCount(2);
  await expect(para.first().locator('img.inline-image')).toHaveAttribute(
    'src',
    'https://example.com/new.png'
  );

  // 移除图片：整段（行内）删除，图与语法消失，段落清空可供继续输入
  await para.first().locator('img.inline-image').first().click();
  const toolbarRemove = page.locator('[data-testid="image-toolbar"]');
  await expect(toolbarRemove).toBeVisible();
  await toolbarRemove.locator('[data-testid="image-toolbar-remove"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('img.inline-image')).toHaveCount(0);
  await expect(page.locator('.image-block')).toHaveCount(0);
  await expect(page.locator('.inline-image-fallback')).toHaveCount(0);
  await expect(page.locator('p.paragraph-block')).toHaveCount(2);
  await expect(
    page.locator('p.paragraph-block span.block-content').first()
  ).toHaveAttribute('data-empty', 'true');
});

test('LINK-IMAGE-E6: 行内图（块内还有其他文本）→ 图片工具栏出现且对齐/内联按钮置灰（K4）', async ({
  page,
}) => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#ccc"/></svg>';
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg })
  );

  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  await page.keyboard.type('前文 图片', { delay: 20 });
  await page.waitForTimeout(300);

  // 选中「图片」（偏移 [3,5)）→ 直选插入 https 图 → 行内替换，块仍 paragraph
  await selectTextRange(page, 3, 5);
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __pickImageResult: string | null }).__pickImageResult =
      'https://example.com/a.png';
  });
  await toolbar.locator('button[title="图片"]').click();
  const para = page.locator('p.paragraph-block');
  await expect(para).toHaveCount(1);
  const img = para.locator('img.inline-image').first();
  await expect(img).toHaveAttribute('alt', '图片');
  await expect(img).toHaveAttribute('src', 'https://example.com/a.png');

  // 点击行内图 → 图片工具栏出现；对齐/内联置灰（非独立成块），修改/移除可用
  await img.click();
  const imageToolbar = page.locator('[data-testid="image-toolbar"]');
  await expect(imageToolbar).toBeVisible();
  await expect(page.locator('.block-type-trigger')).toHaveCount(0);
  await expect(imageToolbar.locator('[data-testid="image-toolbar-align-left"]')).toBeDisabled();
  await expect(imageToolbar.locator('[data-testid="image-toolbar-align-center"]')).toBeDisabled();
  await expect(imageToolbar.locator('[data-testid="image-toolbar-align-right"]')).toBeDisabled();
  await expect(imageToolbar.locator('[data-testid="image-toolbar-inline"]')).toBeDisabled();
  await expect(imageToolbar.locator('[data-testid="image-toolbar-edit"]')).not.toBeDisabled();
  await expect(imageToolbar.locator('[data-testid="image-toolbar-remove"]')).not.toBeDisabled();
});

test('LINK-IMAGE-E7: 图片工具栏滚动跟随——滚动后工具栏相对图片位移不变（Bug B 重锚定）', async ({
  page,
}) => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#ccc"/></svg>';
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg })
  );

  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();

  // 图片前 5 段（撑出滚动空间）
  for (let i = 0; i < 5; i++) {
    await page.keyboard.type(`前段内容 ${i}`, { delay: 5 });
    await page.keyboard.press('Enter');
  }

  // 当前段整段选中 → 直选插入 https 图 → image-block（独立成块）
  await page.keyboard.type('图片占位文本', { delay: 10 });
  await page.keyboard.press('Shift+Home');
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __pickImageResult: string | null }).__pickImageResult =
      'https://example.com/a.png';
  });
  await toolbar.locator('button[title="图片"]').click();
  const imageBlock = page.locator('.image-block');
  await expect(imageBlock).toHaveCount(1);
  const img = imageBlock.locator('img.inline-image').first();
  await expect(img).toHaveAttribute('src', 'https://example.com/a.png');

  // 图片后 10 段（文档可滚动）
  for (let i = 0; i < 10; i++) {
    await page.keyboard.type(`后段内容 ${i}`, { delay: 5 });
    await page.keyboard.press('Enter');
  }

  // 滚动到图片位于视口中部 → 点击 → 图片工具栏出现
  await img.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await img.click();
  const imageToolbar = page.locator('[data-testid="image-toolbar"]');
  await expect(imageToolbar).toBeVisible();

  const readState = () =>
    page.evaluate(() => {
      const container = document.querySelector('.editor-scroll-container') as HTMLElement;
      const t = document.querySelector('[data-testid="image-toolbar"]') as HTMLElement;
      const im = document.querySelector('img.inline-image') as HTMLImageElement;
      const tr = t.getBoundingClientRect();
      const ir = im.getBoundingClientRect();
      return { scrollTop: container.scrollTop, tTop: tr.top, iTop: ir.top };
    });
  const before = await readState();

  // 向下滚动 120px
  await page.evaluate(() => {
    const container = document.querySelector('.editor-scroll-container') as HTMLElement;
    container.scrollTop += 120;
  });
  await page.waitForTimeout(300);
  const after = await readState();

  // 断言：容器确实滚动了 120，且工具栏相对图片的纵向间距不变（跟随图片而非停留原地）
  expect(after.scrollTop - before.scrollTop).toBeCloseTo(120, 0);
  const relBefore = before.tTop - before.iTop;
  const relAfter = after.tTop - after.iTop;
  expect(Math.abs(relAfter - relBefore)).toBeLessThanOrEqual(2);
});

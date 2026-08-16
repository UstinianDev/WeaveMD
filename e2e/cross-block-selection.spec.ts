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

/**
 * 选区事件计数探针（SPEC-EDIT-DSF 6.2）：每次 selectionchange 递增 window.__selChangeCount。
 * 用 addInitScript 在页面加载时注入，保证拖选全程都计入。
 */
function selectionCounterProbe(): void {
  const win = window as unknown as { __selChangeCount?: number };
  win.__selChangeCount = 0;
  // selectionchange 事件在 document 上触发且不冒泡，须用 document 级监听
  document.addEventListener('selectionchange', () => {
    win.__selChangeCount = (win.__selChangeCount ?? 0) + 1;
  });
}

/** 读取当前选区端点所在块信息（含端点块语法类型，用于多类型断言） */
async function readSelectionInfo(
  page: import('@playwright/test').Page
): Promise<{
  startId: string | null;
  endId: string | null;
  startType: string | null;
  endType: string | null;
  collapsed: boolean;
} | null> {
  return page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    const resolve = (node: Node | null): { id: string | null; type: string } | null => {
      if (!node) return null;
      const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null;
      const span = el?.closest('span.block-content');
      const type = span?.closest('.heading-block')
        ? 'heading'
        : span?.closest('blockquote.blockquote-block')
          ? 'quote'
          : span?.closest('.list-item-block')
            ? 'list'
            : span?.closest('p.paragraph-block')
              ? 'paragraph'
              : 'unknown';
      return { id: span?.getAttribute('data-block-id') ?? null, type };
    };
    const start = resolve(r.startContainer);
    const end = resolve(r.endContainer);
    return {
      startId: start?.id ?? null,
      endId: end?.id ?? null,
      startType: start?.type ?? null,
      endType: end?.type ?? null,
      collapsed: sel.isCollapsed,
    };
  });
}

/** 构造跨三种语法类型文档：H1 标题 + 正文段落 + 引用 */
async function typeMultiTypeDoc(page: import('@playwright/test').Page): Promise<void> {
  const first = page.locator('span.block-content[contenteditable="true"]').first();
  await first.click();
  await page.keyboard.type('# 一级标题', { delay: 20 });
  await page.keyboard.press('Enter');
  const second = page.locator('span.block-content[contenteditable="true"]').nth(1);
  await second.click();
  await page.keyboard.type('正文段落', { delay: 20 });
  await page.keyboard.press('Enter');
  const third = page.locator('span.block-content[contenteditable="true"]').nth(2);
  await third.click();
  await page.keyboard.type('> 引用内容', { delay: 20 });
  await page.waitForTimeout(400);
}

/** 读取探针计数 */
async function readSelCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __selChangeCount: number }).__selChangeCount
  );
}

/** 反向跨块拖选：从下方引用块右端向上拖到上方标题块左端 */
async function reverseDragMultiType(page: import('@playwright/test').Page): Promise<void> {
  const h1Span = page.locator('h1.heading-block span.block-content');
  const quoteSpan = page.locator('blockquote.blockquote-block span.block-content');
  const h1Box = await h1Span.boundingBox();
  const quoteBox = await quoteSpan.boundingBox();
  expect(h1Box).not.toBeNull();
  expect(quoteBox).not.toBeNull();
  const startX = quoteBox!.x + quoteBox!.width - 2;
  const startY = quoteBox!.y + quoteBox!.height / 2;
  const endX = h1Box!.x + 2;
  const endY = h1Box!.y + h1Box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 分段移动（每步一帧），模拟真实鼠标高频 mousemove 拖到终点
  const STEPS = 20;
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(
      startX + ((endX - startX) * i) / STEPS,
      startY + ((endY - startY) * i) / STEPS
    );
    await page.waitForTimeout(16);
  }
  // 终点静止重复移动段：保持按住，在同一坐标重复触发 mousemove（每帧一次）。
  // 真实场景下鼠标几乎不动（选区端点保持不变）时，旧实现（无端点级变化检测）
  // 仍会每帧 removeAllRanges + addRange 重建 selection → 持续触发 selectionchange
  // 风暴（P1 根因 2.2）；新实现端点级检测发现端点全等则跳过写入（P1 核心）。
  for (let j = 0; j < 30; j++) {
    await page.mouse.move(endX, endY);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
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

test('P3：反向跨块拖选跨多种语法类型（标题+段落+引用）仍成立 + Backspace 块树级删除', async ({
  page,
}) => {
  await openEditor(page);
  await typeMultiTypeDoc(page);
  await reverseDragMultiType(page);
  await page.waitForTimeout(400);

  // 反向选区成立：起点/终点落在不同语法类型块上，选区非折叠
  const selInfo = await readSelectionInfo(page);
  expect(selInfo).not.toBeNull();
  expect(selInfo?.collapsed).toBe(false);
  expect(selInfo?.startId).not.toBe(selInfo?.endId);
  expect(selInfo?.startId).not.toBeNull();
  expect(selInfo?.endId).not.toBeNull();
  // 起点与终点属于不同语法类型（跨类型，P3 核心：反向跨多种类型仍成立）
  expect(selInfo?.startType).not.toBe(selInfo?.endType);
  // 覆盖的两种类型都应在 { heading, quote, paragraph, list } 中，避免 'unknown'
  const types = new Set([selInfo?.startType, selInfo?.endType]);
  for (const t of types) {
    expect(['heading', 'quote', 'paragraph', 'list']).toContain(t);
  }

  // Backspace 块树级删除（SPEC-EDIT-FT G2 不回归）：下方锚点块内容应被删除
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  const state = await page.locator('.editor-content-area').evaluate((el) => ({
    text: (el.textContent ?? '').replace(/\u200B/g, ''),
    paragraphs: el.querySelectorAll('p.paragraph-block').length,
    quotes: el.querySelectorAll('blockquote.blockquote-block').length,
  }));
  expect(state.text).not.toContain('引用内容');
  expect(state.paragraphs).toBeGreaterThan(0);
});

test('P1/P2：反向跨块拖选期间 selectionchange 计数收敛（≤ 帧数上限，静止后不再增长）', async ({
  page,
}) => {
  // 注入计数探针（addInitScript，页面加载时生效）
  await page.addInitScript(selectionCounterProbe);
  await openEditor(page);
  await typeMultiTypeDoc(page);

  // 清零计数后再拖选，确保只统计拖选窗口内的 selectionchange
  await page.evaluate(() => {
    (window as unknown as { __selChangeCount: number }).__selChangeCount = 0;
  });

  await reverseDragMultiType(page);
  await page.waitForTimeout(500);

  // 静止后计数收敛：再等 500ms，计数不再增长（P1：静止时 selection 不再被反复重建）
  const countBeforeIdle = await readSelCount(page);
  await page.waitForTimeout(500);
  const countAfterIdle = await readSelCount(page);
  expect(countAfterIdle).toBe(countBeforeIdle);

  // 总量低于明显风暴阈值：拖选全程（约 20 步 × 每步 rAF 1 帧 + mouseup 末帧兜底）
  // 至多 ~2×帧数级别；阈值取 120 次/秒量级 × 拖选窗口，留合理余量避免 flaky
  const MAX_SELECTIONCHANGE = 120;
  expect(countBeforeIdle).toBeLessThanOrEqual(MAX_SELECTIONCHANGE);
});

test('DSF：同构大选区拖选期间 selectionchange 计数收敛（单槽 memo 不重扫全链）', async ({
  page,
}) => {
  // 注入计数探针（addInitScript，页面加载时生效）
  await page.addInitScript(selectionCounterProbe);
  await openEditor(page);

  // 构造 ~30 段同类型（正文 paragraph）大选区：每段键入后回车
  const editable = page.locator('span.block-content[contenteditable="true"]');
  await editable.first().click();
  await page.keyboard.type('块 0', { delay: 5 });
  for (let i = 1; i < 30; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`块 ${i}`, { delay: 5 });
  }
  await page.waitForTimeout(300);

  // 清零计数后再拖选，确保只统计拖选窗口内的 selectionchange
  await page.evaluate(() => {
    (window as unknown as { __selChangeCount: number }).__selChangeCount = 0;
  });

  const firstSpan = page.locator('span.block-content[contenteditable="true"]').first();
  const lastSpan = page.locator('span.block-content[contenteditable="true"]').last();
  const firstBox = await firstSpan.boundingBox();
  const lastBox = await lastSpan.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(lastBox).not.toBeNull();

  // 从首块左端向下拖到末块右端（超长跨块同构选区）
  await page.mouse.move(firstBox!.x + 2, firstBox!.y + firstBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    lastBox!.x + lastBox!.width - 2,
    lastBox!.y + lastBox!.height / 2,
    { steps: 40 }
  );
  await page.mouse.up();
  await page.waitForTimeout(500);

  // 同构（全部 paragraph）大区间拖选后：memo 命中使 resolveSyntaxTypesInRange 不重扫全链。
  // selectionchange 计数收敛，禁止"每帧全链 O(N)"风暴。
  const countBeforeIdle = await readSelCount(page);
  await page.waitForTimeout(500);
  const countAfterIdle = await readSelCount(page);
  expect(countAfterIdle).toBe(countBeforeIdle);
  // 大选区拖选窗口（40 步 × rAF 1 帧）计数应明显低于"每帧重建"水平，取宽松阈值防 flaky
  const MAX_SELECTIONCHANGE = 150;
  expect(countBeforeIdle).toBeLessThanOrEqual(MAX_SELECTIONCHANGE);
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

// ============================================
// WeaveMD - PLAN-EDIT-FT4 Phase 0：G-② 灰度拖选语法标记移位复现（真实 Chromium）
// 覆盖：拖选含 `.md-syntax` 标记字符的区间后，
//       删除（DSG-R1）/ 格式化（DSG-R2）/ 光标恢复（DSG-R3）三条路径的标记移位，
//       以及程序化选区对照（DSG-P，区分「拖选本身」与「选区含标记」两个变量）。
// 预期当前 RED（根因：globals.css:1933-1945 灰度 `.md-syntax` 占真实宽度且
//   user-select:none 在 contentEditable 内失效；selection.ts getCursorOffsets/
//   offsetInBlock 把标记字符计入偏移）。本阶段只写复现，不改生产代码。
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

// ------------------------------------------------------------
// 复现专用辅助（对标 e2e/cross-block-selection.spec.ts 的 mockApi/openEditor 模式）
// ------------------------------------------------------------

/** 输入 `**加粗**` 并等待行内渲染为 <strong>（含 2 个 .md-syntax 标记 span） */
async function typeBoldDoc(page: import('@playwright/test').Page): Promise<void> {
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await editable.click();
  // insertText 一次写入整串，避免逐键触发中间态（对标 editor.spec.ts 任务复选框写法）
  await page.keyboard.insertText('**加粗**');
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('**加粗**');
  await expect(page.locator('span.block-content strong')).toHaveCount(1);
}

/**
 * 聚焦内容块（点击内容中部）→ `.md-syntax` 灰显、占真实宽度（globals.css:1940-1945）。
 * 返回「加粗」内容文本节点（strong 内 open 标记 span 之后的 text node）的像素矩形。
 */
async function focusBlock(
  page: import('@playwright/test').Page
): Promise<{ left: number; right: number; top: number; bottom: number } | null> {
  const rect = await page.evaluate(() => {
    const strong = document.querySelector('span.block-content strong');
    if (!strong) return null;
    const openSpan = strong.querySelector('.md-syntax');
    const tn = openSpan ? (openSpan.nextSibling as Text | null) : null;
    if (!tn) return null;
    const range = document.createRange();
    range.selectNodeContents(tn);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  expect(rect).not.toBeNull();
  // 点击内容中部（「加」与「粗」之间），聚焦块使标记灰显
  await page.mouse.click(
    rect!.left + (rect!.right - rect!.left) * 0.5,
    (rect!.top + rect!.bottom) / 2
  );
  await page.waitForTimeout(200);
  return rect;
}

/**
 * 真实鼠标拖选「粗**」（内容尾 + close 标记）：文本偏移 [3,6)。
 * 从内容中部（「加」「粗」之间，caret≈3）拖到 close 标记 `.md-syntax` 右缘（≈6）。
 */
async function dragSelectMarkers(page: import('@playwright/test').Page): Promise<void> {
  const closeMarker = page.locator('span.block-content strong .md-syntax').last();
  await expect(closeMarker).toHaveCount(1);
  const closeBox = await closeMarker.boundingBox();
  expect(closeBox).not.toBeNull();
  const rect = await focusBlock(page);
  const startX = rect!.left + (rect!.right - rect!.left) * 0.5;
  const startY = (rect!.top + rect!.bottom) / 2;
  const endX = closeBox!.x + closeBox!.width - 1;
  const endY = closeBox!.y + closeBox!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.waitForTimeout(16);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** 读取序列化文本：.editor-content-area 的 textContent（去零宽），单块即块文本 */
async function readSerialized(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('.editor-content-area').evaluate((el) =>
    (el.textContent ?? '').replace(/\u200B/g, '')
  );
}

/** 读取当前选区在块文本坐标系下的 [start, end) 偏移与选中文本（排除零宽） */
async function readSelectionOffsets(
  page: import('@playwright/test').Page
): Promise<{ start: number; end: number; text: string; collapsed: boolean } | null> {
  return page.evaluate(() => {
    const el = document.querySelector('span.block-content[contenteditable="true"]');
    if (!el) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null;
    const range = sel.getRangeAt(0);
    const off = (node: Node, offset: number): number => {
      const pre = document.createRange();
      pre.selectNodeContents(el);
      pre.setEnd(node, offset);
      return pre.toString().replace(/\u200B/g, '').length;
    };
    return {
      start: off(range.startContainer, range.startOffset),
      end: off(range.endContainer, range.endOffset),
      text: sel.toString().replace(/\u200B/g, ''),
      collapsed: sel.isCollapsed,
    };
  });
}

/** 读取折叠光标在块文本坐标系下的偏移（null 表示无有效光标） */
async function readCaretOffset(page: import('@playwright/test').Page): Promise<number | null> {
  return page.evaluate(() => {
    const el = document.querySelector('span.block-content[contenteditable="true"]');
    if (!el) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.anchorNode === null) return null;
    const node = sel.anchorNode;
    if (node && !el.contains(node)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(node, sel.anchorOffset);
    return pre.toString().replace(/\u200B/g, '').length;
  });
}

/** 程序化选区对照（对标 floating-toolbar.spec.ts selectTextRange）：按块文本偏移选 [s,e) */
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

/**
 * 安全标记文本不变量（G-②/S4 口径）：`*` 不得产生未闭合 `**` 或单侧残体移位。
 * 要么全部成对构成 `**` 且首尾对称（`**加粗**`），要么不含 `*`（`加粗`）；
 * `**加`（未闭合）、`加**`、`**加*粗***`（畸形混合）、`*X*加粗**`（分裂残体）均判非法。
 */
function isSafeMarkerText(text: string): boolean {
  if (!text.includes('*')) return true;
  const opens = text.startsWith('**');
  const closes = text.endsWith('**');
  if (opens !== closes) return false;
  return (text.match(/\*{1,2}/g) ?? []).every((m) => m === '**');
}

/**
 * 渲染口径残体判定（对标 tdd.md §4）：移除全部 `.md-syntax` 标记后，剩余文本中
 * 若出现 `*` / `_` 即为字面标记残体（未闭合标记或畸形混合会以裸星渲染到视口）。
 * 合法的 `**加*粗***`（strong 内嵌 em）移除标记后为纯内容，无残体。
 * 返回剥离标记后的文本；调用方断言不含 `*`/`_`。
 */
async function readMarkerResidue(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('span.block-content[contenteditable="true"]');
    if (!el) return 'NO_BLOCK';
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.md-syntax').forEach((n) => n.remove());
    return (clone.textContent ?? '').replace(/\u200B/g, '');
  });
}

// ------------------------------------------------------------
// DSG-R1：删除路径 —— 拖选「粗**」后 Backspace
// ------------------------------------------------------------
test('DSG-R1: 拖选含 close 标记后 Backspace → 序列化文本无未闭合 **、无残体移位（当前 RED）', async ({
  page,
}) => {
  await openEditor(page);
  await typeBoldDoc(page);

  await dragSelectMarkers(page);
  // 前置条件：真实拖选确实覆盖到 close 标记字符（user-select:none 在 contentEditable 内失效）
  const sel = await readSelectionOffsets(page);
  expect(sel?.text).toBe('粗**');
  expect(sel?.collapsed).toBe(false);

  // 删除路径：Backspace（同块选区，ContentBlock 不拦截 → 走浏览器原生删除）
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);

  const text = await readSerialized(page);
  // 期望：标记不当作内容删除，不产生 `**加` 式未闭合残体
  const rest = await readMarkerResidue(page);
  expect(rest, `DSG-R1 残体检测（渲染口径）: ${JSON.stringify(rest)}`).not.toMatch(/[*_]/);
});

// ------------------------------------------------------------
// DSG-R2：格式化路径 —— 拖选「粗**」后点斜体 / 下划线
// ------------------------------------------------------------
test('DSG-R2a: 拖选含 close 标记后点斜体 → 无标记移位、无畸形叠加（当前 RED）', async ({
  page,
}) => {
  await openEditor(page);
  await typeBoldDoc(page);

  await dragSelectMarkers(page);
  const sel = await readSelectionOffsets(page);
  expect(sel?.text).toBe('粗**');

  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="斜体"]').click();
  await page.waitForTimeout(400);

  const text = await readSerialized(page);
  // 期望：斜体标记干净包裹内容「粗」且加粗标记原位不动（U1 叠加语义）
  const rest = await readMarkerResidue(page);
  expect(rest, `DSG-R2a 残体检测（渲染口径）: ${JSON.stringify(rest)}`).not.toMatch(/[*_]/);
});

test('DSG-R2b: 拖选含 close 标记后点下划线 → 无 <u> 与标记畸形叠加（当前 RED）', async ({
  page,
}) => {
  await openEditor(page);
  await typeBoldDoc(page);

  await dragSelectMarkers(page);
  const sel = await readSelectionOffsets(page);
  expect(sel?.text).toBe('粗**');

  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="下划线"]').click();
  await page.waitForTimeout(400);

  const text = await readSerialized(page);
  // 期望：`<u>` 不把 `**` 当内容包入、不产生字面残体
  const rest = await readMarkerResidue(page);
  expect(rest, `DSG-R2b 残体检测（渲染口径）: ${JSON.stringify(rest)}`).not.toMatch(/[*_]/);
});

// ------------------------------------------------------------
// DSG-R3：光标恢复路径 —— 拖选含标记后点击内容中部 / 方向键
// ------------------------------------------------------------
test('DSG-R3: 拖选含标记后点击内容中部与方向键导航 → 光标落点不分裂标记、序列化文本正常（当前 RED）', async ({
  page,
}) => {
  await openEditor(page);
  await typeBoldDoc(page);

  // (a) 点击内容中部（「加」「粗」之间）→ 光标落在内容边界，文本不被破坏
  await dragSelectMarkers(page);
  const sel = await readSelectionOffsets(page);
  expect(sel?.text).toBe('粗**');
  // 用内容文本节点矩形点击「加」「粗」之间
  const rect = await page.evaluate(() => {
    const strong = document.querySelector('span.block-content strong');
    if (!strong) return null;
    const openSpan = strong.querySelector('.md-syntax');
    const tn = openSpan ? (openSpan.nextSibling as Text | null) : null;
    if (!tn) return null;
    const range = document.createRange();
    range.selectNodeContents(tn);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  expect(rect).not.toBeNull();
  await page.mouse.click(
    rect!.left + (rect!.right - rect!.left) * 0.5,
    (rect!.top + rect!.bottom) / 2
  );
  await page.waitForTimeout(200);
  const caretA = await readCaretOffset(page);
  expect(caretA).toBe(3);
  expect(await readSerialized(page)).toBe('**加粗**');

  // (b) 方向键：重新拖选后连续 ArrowLeft，光标进入 open 标记内部 →
  //     期望吸附到内容边界（offset 0/2），而非落在标记字符中间（offset 1/5）
  await dragSelectMarkers(page);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  const caretB = await readCaretOffset(page);
  // soft：即使光标落在标记内也继续，用于采集「键入分裂」证据
  expect.soft(caretB, `DSG-R3(b) 方向键后光标偏移（实际）: ${caretB}`).not.toBe(1);
  expect.soft(caretB).not.toBe(5);

  // 在光标处输入字符，标记不得被分裂为残体
  await page.keyboard.type('X', { delay: 20 });
  await page.waitForTimeout(300);
  const textB = await readSerialized(page);
  const restB = await readMarkerResidue(page);
  expect(restB, `DSG-R3(b) 残体检测（渲染口径）: ${JSON.stringify(restB)}`).not.toMatch(/[*_]/);
});

// ------------------------------------------------------------
// DSG-P：程序化选区对照 —— 区分「拖选本身」与「选区含标记」两个变量
// ------------------------------------------------------------
test('DSG-P: 程序化 selectTextRange 选区与真实拖选结果一致 → 问题源于选区含标记而非拖选本身（当前 RED）', async ({
  page,
}) => {
  // 拖选路径
  await openEditor(page);
  await typeBoldDoc(page);
  await dragSelectMarkers(page);
  const dragSel = await readSelectionOffsets(page);
  expect(dragSel?.text).toBe('粗**');
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="斜体"]').click();
  await page.waitForTimeout(400);
  const dragResult = await readSerialized(page);

  // 程序化路径（重载编辑器，隔离状态）
  await openEditor(page);
  await typeBoldDoc(page);
  await page.locator('span.block-content strong').first().click();
  await selectTextRange(page, 3, 6);
  await page.waitForTimeout(300);
  const progSel = await readSelectionOffsets(page);
  expect(progSel?.text).toBe('粗**');
  const toolbar2 = page.locator('.floating-toolbar-v2');
  await expect(toolbar2).toBeVisible();
  await toolbar2.locator('button[title="斜体"]').click();
  await page.waitForTimeout(400);
  const progResult = await readSerialized(page);

  // 拖选端点与程序化选区端点一致、格式化产出一致 → useCrossBlockDragSelection
  // 对同块拖选不写入选区（startSpan === endSpan），不放大问题；移位根源在偏移映射
  expect(dragSel?.start).toBe(progSel?.start);
  expect(dragSel?.end).toBe(progSel?.end);
  expect(dragResult).toBe(progResult);
  // 两个产出都应无畸形（当前 RED：均为 `**加*粗***` 畸形叠加，渲染剥离标记后无残体）
  const restDrag = await readMarkerResidue(page);
  expect(restDrag, `DSG-P 拖选路径残体检测（渲染口径）: ${JSON.stringify(restDrag)}`).not.toMatch(/[*_]/);
  const restProg = await readMarkerResidue(page);
  expect(restProg, `DSG-P 程序化路径残体检测（渲染口径）: ${JSON.stringify(restProg)}`).not.toMatch(/[*_]/);
});

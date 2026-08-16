// ============================================================
// WeaveMD — 可编辑表格块 E2E（真实 Chromium，renderer-only vite:5199）
// 前置依赖 M1（tableCodec kernel 单测）+ M2（TableBlock 组件测试）均绿。
// 覆盖：
//  1) 单元格编辑 → 外层 block 序列化文本为规范 md（| 值 | 结构、| 转义）
//  2) 增列/删列/增行/删行 → DOM 行数/列数与文本同步
//  3) 往返重解析：编辑后 text 经 stateToMarkdown(markdownToState(text)) 等价
//     （列数/内容一致，对齐分隔符固定 ---）
//  4) | 输入自动转义；Enter/Tab 跨格导航光标位置
//  5) 只读约束：表格外壳/对齐分隔行不可编辑
//  6) 撤销回归：Ctrl+Z 回退单元格编辑与增删行列
// 铁律：mock window.weaveMD（file.readDisk 注入 seedContent），唯一后端 remote，不上网。
// ============================================================
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface TableMockOptions {
  /** 新建文档注入的初始 markdown（含表格）。 */
  seedContent: string;
}

/**
 * addInitScript 注入本地 window.weaveMD mock（唯一后端 remote）。
 * 仅需要编辑主区（EditorView）所需的最小 IPC 面。
 */
function installTableMock(opts: TableMockOptions): void {
  const ok = (data?: unknown) => ({ success: true, data });
  const seedContent = opts.seedContent ?? '';
  const user = {
    id: 'u1',
    username: 'table_tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLogin: null,
  };
  localStorage.setItem('weavemd_token', 'test-token');
  localStorage.setItem('weavemd_user', JSON.stringify(user));

  (window as unknown as Record<string, unknown>).weaveMD = {
    auth: {
      validateToken: async () => ok(user),
      login: async () => ok(user),
      register: async () => ok(user),
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
      readDisk: async () => ok({ path: 'C:\\playwright\\table.md', name: 'table.md', content: seedContent }),
      deleteDisk: async () => ok(),
    },
    folder: {
      createFolder: async () => ok(),
      readFolder: async () => ok([]),
      deleteFolder: async () => ok(),
    },
    dialog: {
      saveFilePath: async () => ok({ path: 'C:\\playwright\\table.md' }),
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
    account: { info: async () => ok(user), delete: async () => ok() },
  };
}

/** 新建带 seedContent 的文档并等待表格块渲染。 */
async function openTableDoc(page: Page, opts: TableMockOptions): Promise<void> {
  await page.addInitScript(installTableMock, opts);
  await page.goto('/');
  await page.waitForSelector('header');
  await page.keyboard.press('Control+n');
  await page.waitForSelector('table.table-block-grid th[data-cellkey]');
  await page.waitForTimeout(200);
}

/** 表格块定位器（文档首张表格）。 */
function firstTable(page: Page) {
  return page.locator('.table-block').first();
}

/**
 * 读取单元格的直接文本内容（排除悬停手柄 ÷/−/＋ 按钮等子元素），并归一化零宽空格。
 * cellkey: '-1:0'（表头）或 '0:0'（数据）。rowKey: '-1'=表头,'0','1'...。
 */
async function cellText(page: Page, cellkey: string): Promise<string> {
  const val = await firstTable(page)
    .locator(`th[data-cellkey="${cellkey}"], td[data-cellkey="${cellkey}"]`)
    .evaluate((el) => {
      // 仅取直接文本节点拼接（过滤 .table-*-handles 等子元素）
      const parts: string[] = [];
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) parts.push(node.nodeValue ?? '');
      }
      return parts.join('').replace(/​/g, '');
    });
  return val || '';
}

/** 读取当前渲染表格矩阵（只取单元格直接文本，过滤手柄）。 */
async function readDomTable(page: Page): Promise<{ header: string[]; rows: string[][] }> {
  return (await firstTable(page).evaluate((el) => {
    const readCell = (ce: HTMLElement): string => {
      const parts: string[] = [];
      for (const node of ce.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) parts.push(node.nodeValue ?? '');
      }
      return parts.join('').replace(/​/g, '');
    };
    const ths = Array.from(el.querySelectorAll<HTMLElement>('th[data-cellkey]'))
      .sort((a, b) => Number(a.dataset.cellkey?.split(':')[1]) - Number(b.dataset.cellkey?.split(':')[1]))
      .map(readCell);
    const rows: string[][] = [];
    for (const tr of Array.from(el.querySelectorAll<HTMLElement>('tbody tr'))) {
      const cells = Array.from(tr.querySelectorAll<HTMLElement>('td[data-cellkey]'))
        .sort((a, b) => Number(a.dataset.cellkey?.split(':')[1]) - Number(b.dataset.cellkey?.split(':')[1]))
        .map(readCell);
      rows.push(cells);
    }
    return { header: ths, rows };
  })) as { header: string[]; rows: string[][] };
}

/**
 * 悬停目标格并点击其行/列手柄按钮（add-col / remove-col / add-row / remove-row）。
 * 手柄按钮在悬停时才渲染；点击会触发 setTree 重建 DOM → handle div 分离。用 dispatchEvent
 * 派发原生 click 触发 React onClick，规避 Playwright 指针动作在重建期 detach / 被
 * .editor-content-area 拦截的抖动。
 */
async function clickHandle(page: Page, cellkey: string, action: string): Promise<void> {
  const cell = firstTable(page).locator(`th[data-cellkey="${cellkey}"], td[data-cellkey="${cellkey}"]`).first();
  await cell.hover();
  await cell.locator(`button[data-action="${action}"]`).waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(120);
  await cell.locator(`button[data-action="${action}"]`).dispatchEvent('click');
  await page.waitForTimeout(300);
}

/**
 * 程序化设置单元格内容并派发 input 事件（走 React onInput → serialize -> store.content）。
 * 比键盘 Control+a/type 在 contenteditable plaintext-only 上更确定（避免选区/转义时序抖动）。
 */
async function setCellText(page: Page, cellkey: string, value: string): Promise<void> {
  await firstTable(page)
    .locator(`th[data-cellkey="${cellkey}"], td[data-cellkey="${cellkey}"]`)
    .first()
    .evaluate((el, text) => {
      // 清掉子元素里的手柄，再写纯文本
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) el.removeChild(child);
      }
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }, value);
  await page.waitForTimeout(200);
}

/** 读取当前编辑器序列化 markdown（editorStore.content 实时快照）。 */
async function readMarkdown(page: Page): Promise<string> {
  return (await page.evaluate(async () => {
    const mod = await import('/src/render/stores/editorStore.ts');
    const store = (mod as { useEditorStore: { getState: () => { content: string } } }).useEditorStore;
    return store.getState().content;
  })) as string;
}

/** 从整 Document markdown 中抽取第一张表格的文本行（连续含 | 段），返回规范文本。 */
function extractTableText(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inTable = false;
  for (const line of lines) {
    if (line.includes('|')) {
      inTable = true;
      out.push(line);
    } else if (inTable) break;
  }
  return out.join('\n');
}

/**
 * 往返不变式（T4.1）：把表格 markdown 经 stateToMarkdown(markdownToState(text)) 重解析，
 * 提取表格矩阵（列数/行数/各格内容，含 \| 解义）。
 */
async function applyRoundTrip(page: Page, sourceMarkdown: string): Promise<{
  cols: number;
  rows: number;
  header: string[];
  data: string[][];
}> {
  return (await page.evaluate(async (md: string) => {
    const m = await import('/src/render/editor/kernel/index.ts');
    const kernel = m as { markdownToState: (s: string) => unknown; stateToMarkdown: (s: unknown) => string };
    const reparsed = kernel.stateToMarkdown(kernel.markdownToState(md));
    const lines = reparsed.split('\n').filter((l) => l.includes('|'));
    // 按未转义 | 切分（与 parseTableText 同口径，尊重 \| 转义），再解义
    const splitCells = (line: string): string[] =>
      line.split(/(?<!\\)\|/).map((s) => s.trim()).filter((s, i, a) => i !== 0 && i !== a.length - 1)
        .map((c) => c.replace(/\\\|/g, '|'));
    const headerCells = lines[0] ? splitCells(lines[0]) : [];
    const colCount = headerCells.length;
    const dataRows = lines.slice(2).filter((l) => l.includes('|')).map(splitCells);
    return { cols: colCount, rows: dataRows.length, header: headerCells, data: dataRows };
  }, sourceMarkdown)) as {
    cols: number;
    rows: number;
    header: string[];
    data: string[][];
  };
}

test('单元格编辑：th/td 变更 → 序列化文本为规范 md（| 值 | 结构与 | 转义）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await openTableDoc(page, { seedContent: '| A | B |\n| --- | --- |\n| a1 | b1 |' });

  // 编辑表头与数据格
  await setCellText(page, '-1:1', 'B2');
  await setCellText(page, '0:0', 'new');
  await setCellText(page, '0:1', '含|竖线');

  const md = await readMarkdown(page);
  const tableText = extractTableText(md);
  // 序列化为规范 md：| 值 | 结构 + 表头 + 分隔行
  expect(tableText).toContain('| A | B2 |');
  expect(tableText).toContain('| --- | --- |');
  expect(tableText).toContain('| new | 含\\|竖线 |');
  const dom = await readDomTable(page);
  expect(dom.header[1]).toBe('B2');
  expect(dom.rows[0][0]).toBe('new');
  // DOM 显示转义态 \|（handleCellInput 就地转义）
  expect(await cellText(page, '0:1')).toBe('含\\|竖线');
  expect(errors.length).toBe(0);
});

test('| 输入自动转义：格内含竖线 → DOM 显 \\|、序列化文本为 \\|、重解析还原 |', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await openTableDoc(page, { seedContent: '| A | B |\n| --- | --- |\n| a1 | b1 |' });

  // 输入含竖线文本，走 onInput 转义（handleCellInput 与 beforeinput 用同一 escape/commit 路径：
  // rawDom 含未转义 | → 就地转义 \|，模型存解义态，serialize 再统一转义）。
  await setCellText(page, '0:0', 'ab|cd');

  // DOM 显示转义态 \|（源码态，避免格内出现裸竖线）
  const domEscaped = await cellText(page, '0:0');
  expect(domEscaped).toBe('ab\\|cd');
  // 序列化 markdown 单元格也是 \|（escapeCell）
  const tableText = extractTableText(await readMarkdown(page));
  expect(tableText).toContain('ab\\|cd');
  // 往返重解析解义回 |（T2.4 闭环：输入含 | → 序列化 \| → 重解析 |）
  const rt = await applyRoundTrip(page, tableText);
  expect(rt.data[0][0]).toBe('ab|cd');
  expect(errors.length).toBe(0);
});

test('增列：列顶 + → DOM 列数 +1 且文本同步；新列格为空串', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await openTableDoc(page, { seedContent: '| A | B |\n| --- | --- |\n| a1 | b1 |' });
  expect((await readDomTable(page)).header.length).toBe(2);

  const th0 = firstTable(page).locator('th[data-cellkey="-1:0"]');
  await th0.hover();
  await page.waitForTimeout(150);
  await th0.locator('button[data-action="add-col"]').click();
  await page.waitForTimeout(300);

  const after = await readDomTable(page);
  expect(after.header.length).toBe(3);
  // 加列：悬停列 0 顶 + → 在列 0 右侧插入空列 → header=[A,'',B]
  expect(after.header).toEqual(['A', '', 'B']);
  expect(after.rows[0].length).toBe(3);
  expect(after.rows[0][1]).toBe('');
  // 文本同步：分隔行列数对齐（3 段 ---）
  const tableText = extractTableText(await readMarkdown(page));
  expect((tableText.match(/---/g) ?? []).length).toBe(3);
  expect(errors.length).toBe(0);
});

test('删列：列顶 - → DOM 列数 -1 且文本同步；列数=1 时禁用删除手柄', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await openTableDoc(page, { seedContent: '| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |' });

  await clickHandle(page, '-1:1', 'remove-col');

  const after = await readDomTable(page);
  expect(after.header).toEqual(['A', 'C']);
  expect(after.rows[0]).toEqual(['a1', 'c1']);
  expect(extractTableText(await readMarkdown(page))).toContain('| A | C |');

  // 删到最后 1 列 → 删除手柄 disabled
  await clickHandle(page, '-1:0', 'remove-col');
  expect((await readDomTable(page)).header.length).toBe(1);
  // 只剩 1 列 → 删除按钮确实 disabled（按钮 aria-label 恒为 删除列，disabled 态渲染）
  const thOnly = firstTable(page).locator('th[data-cellkey="-1:0"]');
  await thOnly.hover();
  const removeBtn = thOnly.locator('button[aria-label="删除列"]');
  await removeBtn.waitFor({ state: 'visible', timeout: 5000 });
  await expect(removeBtn).toBeDisabled();
  expect(errors.length).toBe(0);
});

test('增行/删行：行首 + / - → DOM 行数同步；末行 Enter → 自动增行聚焦', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await openTableDoc(page, { seedContent: '| A | B |\n| --- | --- |\n| a1 | b1 |' });

  // 增行（数据行 0 手柄 +）
  await clickHandle(page, '0:0', 'add-row');
  let dom = await readDomTable(page);
  expect(dom.rows.length).toBe(2);
  expect(dom.rows[1]).toEqual(['', '']);
  expect(extractTableText(await readMarkdown(page)).split('\n')).toHaveLength(4);

  // 删行（第 0 数据行手柄 -）
  await clickHandle(page, '0:0', 'remove-row');
  expect((await readDomTable(page)).rows.length).toBe(1);
  expect(extractTableText(await readMarkdown(page)).split('\n')).toHaveLength(3);

  // 末行 Enter → 自动增行聚焦新行同列（T2.5）
  await firstTable(page).locator('td[data-cellkey="0:0"]').click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect((await readDomTable(page)).rows.length).toBe(2);
  // 新行（1:0）追加空串入文本
  expect(extractTableText(await readMarkdown(page)).split('\n')).toHaveLength(4);
  expect(errors.length).toBe(0);
});

test('跨格导航：Enter/Tab/Shift+Tab 在数据格间移动，光标落目标格', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await openTableDoc(page, {
    seedContent: '| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |',
  });

  const focusedKey = async () =>
    page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.cellkey ?? null);

  // Tab: (0:0) → (0:1)
  await firstTable(page).locator('td[data-cellkey="0:0"]').click();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await focusedKey()).toBe('0:1');

  // Tab 行尾 (0:2) → 下一行首列 (1:0)
  await firstTable(page).locator('td[data-cellkey="0:2"]').click();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await focusedKey()).toBe('1:0');

  // Shift+Tab: (1:0) → (0:2)
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(150);
  expect(await focusedKey()).toBe('0:2');

  // Enter: (0:2) → 同列下一行 (1:2)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  expect(await focusedKey()).toBe('1:2');

  // 导航后光标 offset 0：目标格末尾追加文本时导航使输入出现在格首（首字符成前缀）
  await firstTable(page).locator('td[data-cellkey="0:1"]').click();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  await page.keyboard.type('Z');
  await page.waitForTimeout(200);
  expect(await cellText(page, '0:2')).toBe('Zc1');
  expect(errors.length).toBe(0);
});

test('只读约束：对齐分隔行不渲染为源码、外壳不可编辑、单元格内 Enter 不产生换行', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await openTableDoc(page, { seedContent: '| A | B |\n| --- | --- |\n| a1 | b1 |' });

  // 分隔行不渲染为文本
  const inner = (await firstTable(page).innerText()).replace(/​/g, '');
  expect(inner).not.toContain('---');
  // 表格外壳容器不设 contenteditable
  const wrapEditable = await firstTable(page).evaluate((el) => el.querySelector('.markdown-table-wrap')?.getAttribute('contenteditable'));
  expect(wrapEditable).toBeNull();

  // 单元格内 Enter（plaintext-only + preventDefault）不产生 <br（格内无换行）
  const cell = firstTable(page).locator('td[data-cellkey="0:0"]');
  await setCellText(page, '0:0', 'ab');
  await cell.click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const hasBr = await cell.evaluate((td) => td.querySelector('br') !== null);
  expect(hasBr).toBe(false);
  // 源单元格未引入 <br>：仍为单行纯文本 'ab'（Enter 未在格内打断文本）
  expect(await cellText(page, '0:0')).toBe('ab');
  expect(errors.length).toBe(0);
});

test('撤销回归：Ctrl+Z 回退单元格编辑、增列、增行', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await openTableDoc(page, { seedContent: '| A | B |\n| --- | --- |\n| a1 | b1 |' });

  // ① 单元格编辑 → Ctrl+Z 回退
  await setCellText(page, '0:1', 'b1-edited');
  expect((await readDomTable(page)).rows[0][1]).toBe('b1-edited');
  await firstTable(page).locator('td[data-cellkey="0:1"]').click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  expect((await readDomTable(page)).rows[0][1]).toBe('b1');

  // ② 增列 → Ctrl+Z 回退列数
  await clickHandle(page, '-1:0', 'add-col');
  expect((await readDomTable(page)).header.length).toBe(3);
  const td00 = firstTable(page).locator('td[data-cellkey="0:0"]');
  await td00.click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  expect((await readDomTable(page)).header.length).toBe(2);

  // ③ 增行 → Ctrl+Z 回退行数
  await clickHandle(page, '0:0', 'add-row');
  expect((await readDomTable(page)).rows.length).toBe(2);
  await firstTable(page).locator('td[data-cellkey="0:0"]').click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  expect((await readDomTable(page)).rows.length).toBe(1);
  expect(errors.length).toBe(0);
});

test('往返重解析：编辑后文本经 markdownToState/stateToMarkdown 重解析 → 列数/内容一致', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await openTableDoc(page, { seedContent: '| who | what |\n| --- | --- |\n| 张三 | 写文档 |\n| 李四 | 审阅 |' });

  // 程序化编辑含竖线的表头与数据格（| 走 onInput 转义）
  await setCellText(page, '-1:1', '做什么|事');
  await setCellText(page, '1:1', '已|完成');

  const domMatrix = await readDomTable(page);
  // DOM 显示转义态 \|（就地转义；模型存解义态，序列化再统一转义）
  expect(domMatrix.header[1]).toBe('做什么\\|事');
  expect(domMatrix.rows[1][1]).toBe('已\\|完成');

  // 往返重解析：stateToMarkdown(markdownToState(编辑后text)) → 解义 \| 还原内容
  const tableText = extractTableText(await readMarkdown(page));
  // 序列化 markdown 为转义态（escapeCell）
  expect(tableText).toContain('做什么\\|事');
  const rt = await applyRoundTrip(page, tableText);

  expect(rt.cols).toBe(domMatrix.header.length);
  expect(rt.rows).toBe(domMatrix.rows.length);
  // 恢复的竖线原义（往返解义还原）
  expect(rt.header[1]).toBe('做什么|事');
  expect(rt.data[1][1]).toBe('已|完成');
  // 全字段等价：往返结果 == DOM 解义（\|→|），即与用户输入原义一致，列数/内容不变
  for (let c = 0; c < domMatrix.header.length; c++) {
    expect(rt.header[c]).toBe((domMatrix.header[c] ?? '').replace(/\\\|/g, '|'));
    for (let r = 0; r < domMatrix.rows.length; r++) {
      expect(rt.data[r][c]).toBe((domMatrix.rows[r][c] ?? '').replace(/\\\|/g, '|'));
    }
  }
  expect(errors.length).toBe(0);
});

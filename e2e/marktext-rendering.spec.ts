// ============================================
// WeaveMD - marktext 语法渲染回归（真实 Chromium）
// 覆盖：标题 marker 并排 / 空标题行可点击 / 列表项 marker 与内容并排且无多余圆点
// ============================================
import { expect, test } from '@playwright/test';

const SAMPLE = [
  '# 一级标题',
  '',
  '## 二级标题',
  '',
  '1. 有序列表',
  '- 无序列表',
  '- [ ] 任务列表',
  '',
  '> 引用',
].join('\n');

function mockApi(content: string): void {
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
      open: async () =>
        ok({ path: 'C:\\playwright\\sample.md', name: 'sample.md', content }),
      save: async () => ok(),
      delete: async () => ok(),
      list: async () => ok([]),
      get: async () => ok(),
      write: async () => ok(),
      readDisk: async () =>
        ok({ path: 'C:\\playwright\\sample.md', name: 'sample.md', content }),
      deleteDisk: async () => ok(),
    },
    folder: {
      createFolder: async () => ok(),
      readFolder: async () => ok([]),
      deleteFolder: async () => ok(),
    },
    dialog: {
      saveFilePath: async () => ok({ path: 'C:\\playwright\\sample.md' }),
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

async function openSample(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(mockApi, SAMPLE);
  await page.goto('/');
  await page.waitForSelector('header');
  await page.keyboard.press('Control+o');
  await page.waitForSelector('h1.heading-block');
}

test('标题 marker 与内容并排显示', async ({ page }) => {
  await openSample(page);
  const h1 = page.locator('h1.heading-block');
  await h1.locator('span.block-content').click();
  const measure = await h1.evaluate((el) => {
    const marker = getComputedStyle(el, '::before');
    const span = el.querySelector('span.block-content') as HTMLElement;
    const sr = span.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return {
      markerContent: marker.content,
      markerOpacity: marker.opacity,
      spanTopDiff: sr.top - er.top,
    };
  });
  expect(measure.markerContent).toBe('"#"');
  expect(measure.markerOpacity).toBe('1');
  // marker 与内容必须在同一行（flex 布局）
  expect(measure.spanTopDiff).toBe(0);
});

test('空标题行可点击并选中', async ({ page }) => {
  await openSample(page);
  const h2 = page.locator('h2.heading-block');
  const h2Content = h2.locator('span.block-content');
  await h2Content.click();
  // 逐字删除全部内容（4 个字符，避免触发空标题退格降级）
  await page.keyboard.press('End');
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Backspace');
  }
  await page.waitForTimeout(200);
  // 点击空行最左侧（# 级别提示区域）也应聚焦内容 span
  const box = await h2.boundingBox();
  if (box) {
    await page.mouse.click(box.x + 5, box.y + box.height / 2);
  }
  await page.waitForTimeout(200);
  const state = await h2.evaluate((el) => {
    const active = document.activeElement;
    const sel = document.getSelection();
    const span = el.querySelector('span.block-content') as HTMLElement;
    return {
      activeIsContentSpan: active === span,
      selCollapsed: sel ? sel.isCollapsed : null,
    };
  });
  expect(state.activeIsContentSpan).toBe(true);
  expect(state.selCollapsed).toBe(true);
});

test('列表项 marker 与内容并排且任务项无多余圆点', async ({ page }) => {
  await openSample(page);
  const data = await page.locator('.editor-content-area').evaluate((el) => {
    return Array.from(el.querySelectorAll('.list-item-block')).map((item) => {
      const marker = item.querySelector('.list-marker') as HTMLElement | null;
      const checkbox = item.querySelector('.task-checkbox') as HTMLElement | null;
      const content = item.querySelector('span.block-content') as HTMLElement | null;
      const rect = (node: HTMLElement | null) => {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      };
      return {
        display: getComputedStyle(item).display,
        markerRect: rect(marker),
        checkboxRect: rect(checkbox),
        contentRect: rect(content),
      };
    });
  });

  expect(data.length).toBe(3);
  for (const item of data) {
    expect(item.display).toBe('flex');
    // marker/复选框与内容在同一行
    expect(Math.round((item.markerRect?.top ?? item.checkboxRect?.top ?? 0) - (item.contentRect?.top ?? 0))).toBeLessThanOrEqual(3);
  }
  // 任务项：只有复选框，没有多余圆点 marker
  expect(data[2]?.checkboxRect).not.toBeNull();
  expect(data[2]?.markerRect).toBeNull();
  // 有序/无序项：有 marker 无复选框
  expect(data[0]?.markerRect).not.toBeNull();
  expect(data[1]?.markerRect).not.toBeNull();
  expect(data[0]?.checkboxRect).toBeNull();
  expect(data[1]?.checkboxRect).toBeNull();
});

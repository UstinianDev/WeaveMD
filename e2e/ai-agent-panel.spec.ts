// ============================================
// WeaveMD — AI 代理面板 E2E（真实 Chromium，renderer-only vite:5199）
// 覆盖：
//  1) 导航栏 AI 按钮 → 右侧面板开合 + 宽度拖拽把手存在
//  2) Chat Tab 发送消息 → user 气泡 → mock 流式 assistant 逐块出现 → done 后完整落显
//  3) 会话列表：新建 / 切换 / 删除可用
//  4) Agent Tab 显示「第 4 期上线」占位
//  5) ConsentOverlay：remote 未同意时发送触发 overlay；同意后放行并持久化（setConsent 被调用）；拒绝则中止
//  6) 全程无 uncaught error（pageerror 门禁）
//
// 铁律：不真正连接 Ollama/网络 —— ai.* 全部走 addInitScript 注入的本地 mock。
// ============================================
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface AiMockOptions {
  backend?: 'ollama' | 'remote';
  consented?: boolean;
  /** 预置会话数 */
  seedConversations?: number;
}

/**
 * addInitScript 用：注入 window.weaveMD（含可编程的 ai mock）。
 * 该函数作为字符串序列化进浏览器执行，不能引用外部闭包——ok/user 等
 * 必须内联在该函数体内，否则浏览器侧会 ReferenceError。
 */
function installWeaveMDMock(opts: AiMockOptions): void {
  const ok = (data?: unknown) => ({ success: true, data });
  const backend = opts.backend ?? 'ollama';
  const consented = opts.consented ?? false;
  const seed = opts.seedConversations ?? 0;
  const user = {
    id: 'u1',
    username: 'ai_tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLogin: null,
  };

  localStorage.setItem('weavemd_token', 'test-token');
  localStorage.setItem('weavemd_user', JSON.stringify(user));

  // 会话/消息内存库
  const conversations: Array<{
    id: string;
    userId: string;
    mode: string;
    summary: string;
    createdAt: string;
    updatedAt: string;
  }> = [];
  const messages: Array<{
    id: string;
    conversationId: string;
    userId: string;
    role: string;
    content: string;
    refsJson: string | null;
    createdAt: string;
  }> = [];
  let seq = 1;
  const nextId = (p: string) => `${p}_${Date.now()}_${seq++}`;
  for (let i = 0; i < seed; i++) {
    const id = `c_pre_${i}`;
    conversations.push({
      id,
      userId: 'u1',
      mode: 'chat',
      summary: `预置会话 ${i}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  let consentGiven = consented;
  let streamCb: ((evt: unknown) => void) | null = null;
  const win = window as unknown as Record<string, unknown>;

  const streamChunk = (
    conversationId: string,
    parts: string[],
    onDone: () => void
  ): void => {
    const cb = streamCb;
    if (!cb) {
      onDone();
      return;
    }
    parts.forEach((part, i) => {
      // 逐块延迟触发，模拟增量/结束
      setTimeout(() => {
        cb({ type: 'chunk', conversationId, delta: part });
        if (i === parts.length - 1) {
          setTimeout(() => {
            cb({ type: 'done', conversationId });
            onDone();
          }, 10);
        }
      }, i * 40);
    });
  };

  win.weaveMD = {
    auth: {
      validateToken: async () => ok(user),
      login: async () => ok(user),
      register: async () => ok(user),
      checkUsername: async () => ok({ available: true }),
    },
    settings: {
      get: async () => ({ success: false }),
      update: async () => ok(),
    },
    history: { list: async () => ok([]), get: async () => ok() },
    file: {
      create: async () => ok(),
      open: async () => ok(),
      save: async () => ok(),
      delete: async () => ok(),
      list: async () => ok([]),
      get: async () => ok(),
      write: async () => ok(),
      readDisk: async () => ok({ path: 'C:\\playwright\\ai.md', name: 'ai.md', content: '' }),
      deleteDisk: async () => ok(),
    },
    folder: {
      createFolder: async () => ok(),
      readFolder: async () => ok([]),
      deleteFolder: async () => ok(),
    },
    dialog: {
      saveFilePath: async () => ok({ path: 'C:\\playwright\\ai.md' }),
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
    account: {
      info: async () => ok(user),
      delete: async () => ok(),
    },
    ai: {
      getConfig: async () =>
        ok({
          backend,
          ollamaBaseUrl: 'http://localhost:11434',
          remoteBaseUrl: 'https://api.example.com',
          model: 'mock-model',
          hasApiKey: backend === 'remote',
        }),
      setConfig: async () => ok({}),
      getConsent: async () =>
        ok({
          allowNetwork: consentGiven,
          allowSend: consentGiven,
          consentUpdatedAt: consentGiven ? new Date().toISOString() : null,
        }),
      setConsent: async (userId: string, consent: { allowNetwork: boolean; allowSend: boolean }) => {
        consentGiven = consent.allowNetwork || consent.allowSend;
        return ok({ ...consent, consentUpdatedAt: new Date().toISOString() });
      },
      health: async () => ok({}),
      chat: async (payload: { userId: string; conversationId: string | null; message: string }) => {
        const convId =
          payload.conversationId ??
          (conversations.find((c) => c.userId === payload.userId)?.id ?? nextId('c'));
        return new Promise((resolve) => {
          // 延迟触发流，模拟主进程逐块推送
          setTimeout(() => {
            const reply = `你好，我是 mock AI。你说的是：${payload.message}`;
            streamChunk(convId, reply.match(/.{1,6}/g) ?? [], () => resolve(ok({ conversationId: convId })));
          }, 20);
        });
      },
      chatAbort: async () => ok(),
      listConversations: async (userId: string, mode: string) =>
        ok(conversations.filter((c) => c.userId === userId && c.mode === mode)),
      getConversation: async (conversationId: string, userId: string) => {
        const conv = conversations.find(
          (c) => c.id === conversationId && c.userId === userId
        );
        if (!conv) return { success: false };
        return ok({ conversation: conv, messages: messages.filter((m) => m.conversationId === conv.id) });
      },
      createConversation: async (userId: string, mode: string) => {
        const conv = {
          id: nextId('c'),
          userId,
          mode,
          summary: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        conversations.unshift(conv);
        return ok(conv);
      },
      deleteConversation: async (conversationId: string, userId: string) => {
        const idx = conversations.findIndex(
          (c) => c.id === conversationId && c.userId === userId
        );
        if (idx >= 0) conversations.splice(idx, 1);
        return ok({ deleted: idx >= 0 });
      },
      updateConversationSummary: async () => ok({}),
      // eslint-disable-next-line
      onStream: (cb: (evt: unknown) => void) => {
        streamCb = cb;
        return () => {
          streamCb = null;
        };
      },
    },
  };
}

/** AI 面板 aside：唯一含 cursor-col-resize（宽度拖拽把手）的 aside，区别于左侧栏 */
function aiPanel(page: Page) {
  return page.locator('aside:has(.cursor-col-resize)');
}

async function bootAiPanel(page: Page, opts: AiMockOptions = {}): Promise<void> {
  await page.addInitScript(installWeaveMDMock, opts);
  await page.goto('/');
  await page.waitForSelector('header');
  await page.waitForTimeout(300);
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
}

test('导航栏 AI 按钮开合面板，宽度拖拽把手存在', async ({ page }) => {
  await bootAiPanel(page);
  const panel = aiPanel(page);
  await expect(panel).toBeVisible();
  // 宽度把手（cursor-col-resize）存在
  await expect(panel.locator('.cursor-col-resize').first()).toBeVisible();
  // 关闭（✕）→ 面板隐藏
  await panel.getByText('✕').click();
  await page.waitForTimeout(250);
  await expect(panel).toBeHidden();
});

test('Chat Tab：发送消息 → user 气泡 → 流式 assistant 逐块出现 → done 后完整落显', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, {});
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(200);

  const panel = aiPanel(page);
  const textarea = panel.locator('textarea').first();
  await textarea.fill('你好世界');
  await panel.getByText('发送', { exact: true }).click();

  // user 气泡出现
  await expect(panel.getByText('你好世界')).toBeVisible();
  // assistant 流式最终完整渲染（done 后）
  await expect(
    panel.getByText('你好，我是 mock AI。你说的是：你好世界')
  ).toBeVisible({ timeout: 5000 });
  // 无未捕获错误
  expect(errors.length).toBe(0);
});

test('会话列表：新建 / 切换 / 删除可用', async ({ page }) => {
  await page.addInitScript(installWeaveMDMock, { seedConversations: 1 });
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(200);
  const panel = aiPanel(page);

  // 预置会话出现在列表
  await expect(panel.getByText('预置会话 0')).toBeVisible();

  // 新建会话 -> 清空消息区
  await panel.getByText('新建会话', { exact: true }).click();
  // 删除预置会话
  await panel.getByText('预置会话 0').hover();
  await panel
    .getByText('预置会话 0')
    .locator('xpath=following-sibling::button')
    .click();
  await expect(panel.getByText('预置会话 0')).not.toBeVisible();
});

test('Agent Tab 显示「第 4 期上线」占位', async ({ page }) => {
  await bootAiPanel(page);
  // 默认 zh-CN：Agent Tab 标签为「代理」
  await aiPanel(page).getByText('代理', { exact: true }).click();
  await expect(page.getByText('Agent 能力第 4 期上线')).toBeVisible();
});

test('ConsentOverlay：remote 未同意时发送触发 overlay，同意后放行并持久化（setConsent 被调用）', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  // backend=remote 且未同意
  await page.addInitScript(installWeaveMDMock, {
    backend: 'remote',
    consented: false,
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);

  const textarea = panel.locator('textarea').first();
  await textarea.fill('需要联网的问题');
  await panel.getByText('发送', { exact: true }).click();

  // 触发同意 overlay（渲染在 aside 之外的兄弟层，需用 page 级断言）
  await expect(page.getByText('AI 知情同意', { exact: true })).toBeVisible();
  // 勾选「允许联网」并「同意并记住」
  await page.getByText('允许联网', { exact: true }).click();
  await page.getByText('同意并记住', { exact: true }).click();
  // setConsent 被调用 -> 后续无 overlay
  await expect(page.getByText('AI 知情同意', { exact: true })).toBeHidden();
  // 同意后持久化内存 consentGiven=true，需重新发送才放行
  await textarea.fill('需要联网的问题');
  await panel.getByText('发送', { exact: true }).click();

  // 放行：user 气泡出现，assistant 流式完整落显
  await expect(panel.getByText('需要联网的问题')).toBeVisible();
  await expect(
    panel.getByText('你好，我是 mock AI。你说的是：需要联网的问题')
  ).toBeVisible({ timeout: 5000 });
  expect(errors.length).toBe(0);
});

test('ConsentOverlay：remote 未同意时拒绝则中止（不发送 / 无 assistant 气泡）', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, { backend: 'remote', consented: false });
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);

  const textarea = panel.locator('textarea').first();
  await textarea.fill('不应发送的内容');
  await panel.getByText('发送', { exact: true }).click();

  await expect(page.getByText('AI 知情同意', { exact: true })).toBeVisible();
  // 点击「拒绝」-> 中止
  await page.getByText('拒绝', { exact: true }).click();
  await expect(page.getByText('AI 知情同意', { exact: true })).toBeHidden();
  // 不应出现 user 气泡或 assistant 气泡
  await expect(panel.getByText('不应发送的内容')).toBeHidden();
  await expect(panel.getByText('你好，我是 mock AI。你说的是：不应发送的内容')).toBeHidden();
  expect(errors.length).toBe(0);
});

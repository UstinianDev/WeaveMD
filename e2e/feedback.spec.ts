// ============================================
// WeaveMD — 问题反馈 Modal E2E（真实 Chromium，renderer-only vite:5199）
// 覆盖：
//  1) 帮助菜单「问题反馈」入口在「设置」下方，点击打开 FeedbackModal
//  2) 描述为空点发送 → 提示必填，不调用 mail.send
//  3) 未配置授权码点发送 → 首拦提示（请先配置授权码），不调用 mail.send
//  4) 配置授权码后填写描述 → 发送成功反馈（mail.send 携带 body + imagePaths）
//  5) 全程无 uncaught error（pageerror 门禁）
//
// 铁律：不真正连接 SMTP —— window.weaveMD.mail.* 全部走 addInitScript 注入的本地 mock。
// 真 SMTP 手工验收标记 test.skip（需真实 QQ 授权码 + 网络），不放 CI。
// ============================================
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface FeedbackMockOptions {
  /** mail.get 返回的已配置授权码状态（默认 false）。 */
  hasAuthCode?: boolean;
  /** mail.send 的返回：true=成功，false=失败（error.code 可指定）。 */
  sendResult?: 'ok' | { code: string; message: string };
  /** mail.pickImages 返回的路径数组；默认 null（取消）。 */
  pickImages?: string[];
}

function installWeaveMDMock(opts: FeedbackMockOptions): void {
  // 序列化进浏览器，不能引用外部闭包——所有状态内联
  const hasAuthCode = opts.hasAuthCode ?? false;
  const sendResult = opts.sendResult ?? 'ok';
  const pickImages = opts.pickImages ?? null;
  const user = {
    id: 'u1',
    username: 'feedback_tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLogin: null,
  };
  localStorage.setItem('weavemd_token', 'test-token');
  localStorage.setItem('weavemd_user', JSON.stringify(user));

  const sentCalls: unknown[] = [];
  window.weaveMD = {
    auth: {
      login: async () => ({ success: true, data: user }),
      register: async () => ({ success: true, data: user }),
      checkUsername: async () => ({ available: true }),
      validateToken: async () => ({ success: true, data: user }),
    },
    file: {
      create: async () => ({ success: true, data: {} }),
      open: async () => ({ success: false }),
      save: async () => ({ success: true, data: {} }),
      delete: async () => ({ success: true }),
      list: async () => ({ success: true, data: [] }),
      get: async () => ({ success: false }),
      write: async () => ({ success: true }),
      deleteDisk: async () => ({ success: true }),
      readDisk: async () => ({ success: false }),
    },
    history: { list: async () => ({ success: true, data: [] }), get: async () => ({ success: false }) },
    settings: {
      get: async () => ({ success: true, data: { theme: 'dark', language: 'zh-CN' } }),
      update: async () => ({ success: true }),
    },
    export: { file: async () => ({ success: false }) },
    window: {
      minimize: async () => {},
      maximize: async () => {},
      unmaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
    },
    dialog: {
      openFile: async () => null,
      saveFile: async () => null,
      openFolder: async () => ({ success: false }),
      saveFilePath: async () => ({ success: false }),
      pickImage: async () => null,
    },
    folder: {
      readFolder: async () => ({ success: true, data: [] }),
      createFolder: async () => ({ success: false }),
      deleteFolder: async () => ({ success: false }),
    },
    account: { info: async () => ({ success: false }), delete: async () => ({ success: false }) },
    link: { openExternal: async () => {} },
    ai: {
      getConfig: async () => ({ success: true, data: { backend: 'remote', remoteBaseUrl: '', model: '', hasApiKey: false } }),
      setConfig: async () => ({ success: true, data: {} }),
      getConsent: async () => ({ success: true, data: { allowNetwork: false, allowSend: false, consentUpdatedAt: null } }),
      setConsent: async () => ({ success: true }),
      chat: async () => ({ success: false }),
      chatAbort: async () => ({ success: true }),
      listConversations: async () => ({ success: true, data: [] }),
      getConversation: async () => ({ success: false }),
      createConversation: async () => ({ success: false }),
      deleteConversation: async () => ({ success: false }),
      updateConversationSummary: async () => ({ success: false }),
      runAgent: async () => ({ success: false }),
      agentAbort: async () => ({ success: true }),
      rewritePreview: async () => ({ success: false }),
      listSkills: async () => ({ success: true, data: [] }),
      listModels: async () => ({ success: true, data: [] }),
      onStream: () => () => {},
    },
    kb: {
      list: async () => ({ success: true, data: [] }),
      importFile: async () => ({ success: false }),
      importDir: async () => ({ success: false }),
      reindex: async () => ({ success: false }),
      delete: async () => ({ success: false }),
      status: async () => ({ success: true, data: { documents: 0 } }),
      getSettings: async () => ({ success: true, data: {} }),
      setSettings: async () => ({ success: true }),
    },
    mail: {
      get: async () => ({ success: true, data: { hasAuthCode } }),
      set: async ({ authCode }: { userId: string; authCode: string }) => ({
        success: true,
        data: { hasAuthCode: !!authCode },
      }),
      send: async (input: { userId: string; body: string; imagePaths: string[] }) => {
        sentCalls.push(input);
        if (sendResult === 'ok') {
          return { success: true, data: { success: true, messageId: '<mock@qq.com>' } };
        }
        return { success: true, data: { success: false, error: sendResult } };
      },
      pickImages: async () => ({ success: true, data: pickImages }),
    },
    license: {
      status: async () => ({ success: true, data: { status: 'activated' } }),
      activate: async () => ({ success: true, data: { ok: true } }),
    },
    version: {
      get: async () => '1.1.0',
    },
    update: {
      check: async () => ({ success: true, data: { state: 'not-available' } }),
      download: async () => ({ success: true }),
      quitAndInstall: async () => {},
      onEvent: () => () => {},
      skipVersion: async () => ({ success: true }),
    },
    recent: {
      list: async () => ({ success: true, data: [] }),
      add: async () => ({ success: true }),
      remove: async () => ({ success: true }),
    },
  };
  // 暴露 sentCalls 供测试断言（只读快照）
  (window as unknown as { __mailSentCalls: () => unknown[] }).__mailSentCalls = () => sentCalls;
}

async function bootFeedback(page: Page, opts: FeedbackMockOptions = {}): Promise<void> {
  await page.addInitScript(installWeaveMDMock, opts);
  await page.goto('/');
  await page.waitForSelector('header');
  await page.waitForTimeout(300);
  // 打开帮助菜单 → 点「问题反馈」（帮助按钮文本含「▾」，用子串匹配）
  await page.locator('header').getByText('帮助').click();
  await page.waitForTimeout(300);
  await page.getByText('问题反馈', { exact: true }).click();
  await page.waitForTimeout(200);
}

test('帮助「问题反馈」入口打开 FeedbackModal 且展示描述区', async ({ page }) => {
  await bootFeedback(page);
  await expect(page.getByLabel('问题描述')).toBeVisible();
  // 未配置授权码 → 显示授权码输入
  await expect(page.getByTestId('feedback-auth-input')).toBeVisible();
});

test('描述为空点发送 → 提示必填，不调用 mail.send', async ({ page }) => {
  await bootFeedback(page, { hasAuthCode: true });
  await page.getByRole('button', { name: '发送反馈' }).click();
  await expect(page.getByText('请填写问题描述')).toBeVisible();
  const calls = (await page.evaluate(() => (window as unknown as { __mailSentCalls: () => unknown[] }).__mailSentCalls())) as unknown[];
  expect(calls).toHaveLength(0);
});

test('未配置授权码点发送 → 首拦提示，不调用 mail.send', async ({ page }) => {
  await bootFeedback(page, { hasAuthCode: false });
  await page.getByLabel('问题描述').fill('遇到一个 bug');
  await page.getByRole('button', { name: '发送反馈' }).click();
  await expect(page.getByText('请先配置授权码')).toBeVisible();
  const calls = (await page.evaluate(() => (window as unknown as { __mailSentCalls: () => unknown[] }).__mailSentCalls())) as unknown[];
  expect(calls).toHaveLength(0);
});

test('配置授权码 + 描述 → 发送成功；mail.send 携带 body/imagePaths', async ({ page }) => {
  await bootFeedback(page, { hasAuthCode: true, pickImages: ['C:/docs/a.png', 'C:/docs/b.png'] });
  await page.getByLabel('问题描述').fill('缩放动画卡顿');
  // 添加两张图片
  await page.getByRole('button', { name: '添加图片' }).click();
  await page.waitForTimeout(200);
  await expect(page.locator('[data-testid="feedback-img-thumb"]')).toHaveCount(2);
  await page.getByRole('button', { name: '发送反馈' }).click();
  await expect(page.getByText('反馈已发送')).toBeVisible();
  const calls = (await page.evaluate(() => (window as unknown as { __mailSentCalls: () => unknown[] }).__mailSentCalls())) as unknown[];
  expect(calls).toHaveLength(1);
  const call = calls[0] as { userId: string; body: string; imagePaths: string[] };
  expect(call.body).toContain('缩放动画卡顿');
  expect(call.imagePaths).toHaveLength(2);
});

test('发送失败（授权码错误）→ 专属文案，不显示原始 SMTP 细节', async ({ page }) => {
  await bootFeedback(page, {
    hasAuthCode: true,
    sendResult: { code: 'auth_failed', message: '535 Authentication failed' },
  });
  await page.getByLabel('问题描述').fill('发不出去');
  await page.getByRole('button', { name: '发送反馈' }).click();
  // auth_failed → 专属分类文案（需求⑤：授权码错误明确提示）
  await expect(page.getByText('授权码错误，请检查 QQ 邮箱授权码')).toBeVisible();
  // 原始 SMTP 错误细节不外透到渲染
  await expect(page.getByText('535 Authentication failed')).toBeHidden();
});

// 真 SMTP 手工验收：打标跳过，不放 CI（需真实 QQ 授权码 + 网络）。
test.skip('真 SMTP 自收收到含描述+附件图片邮件（手工验收，需真实授权码）', async ({ page }) => {
  // 该用例不注入 mail mock，暴露真实 ipcRenderer → 主进程 nodemailer。CI 无授权码，恒跳过。
  await page.goto('/');
  await page.locator('header').getByText('帮助').click();
  await page.getByText('问题反馈', { exact: true }).click();
  await expect(page.getByLabel('问题描述')).toBeVisible();
});

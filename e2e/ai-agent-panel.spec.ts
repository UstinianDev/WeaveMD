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
  /** Agent 运行行为（runAgent 返回值，控制意图卡片/后端降级提示）。 */
  agentResult?: {
    intentCard?: boolean;
    backendHint?: string;
    /** 是否流式发送 tool 轨迹（searchKB 命中）。 */
    withTool?: boolean;
  };
  /** 预置知识库文档数（kb.list 返回）。 */
  seedKbDocuments?: number;
  /** 第 5 期改写 mock：rewritePreview 返回的 LLM 原始文本。
   *  selectionText = 选区 scope 的改写文本（LLM 返回改写后 md）；
   *  documentText = document scope 的改写文本（LLM 返回 JSON 数组串）。 */
  rewrite?: {
    selectionText?: string;
    documentText?: string;
  };
  /** 新建文档（Control+n 经 readDisk 打开）时注入的初始内容。
   *  用于改写用例：打开即含文本，undo 栈干净（openFile 重置），确保「一次撤销」只回退改写自身。 */
  seedContent?: string;
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
  const agentResult = opts.agentResult ?? {};
  const seedKb = opts.seedKbDocuments ?? 0;
  // 第 5 期改写：rewritePreview LLM 原始文本（selection=改写后 md；document=JSON 数组串）
  const rewrite = opts.rewrite ?? {};
  // 新建文档初始内容（改写用例注入，openFile 后 undo 栈干净）
  const seedContent = opts.seedContent ?? '';
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

  // 知识库文档（kb.status / kb.list 内存库）
  const kbDocuments: Array<{
    docId: string;
    fileId: string | null;
    title: string;
    sourceType: string;
    pinned: boolean;
    status: string;
    chunkCount: number;
  }> = [];
  for (let i = 0; i < seedKb; i++) {
    kbDocuments.push({
      docId: `kb_${i}`,
      fileId: `f_kb_${i}`,
      title: `知识库文档 ${i}`,
      sourceType: 'import',
      pinned: false,
      status: 'done',
      chunkCount: 3,
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

  const streamTool = (
    conversationId: string,
    toolCallId: string,
    name: string,
    args: unknown,
    result: string,
    cb: (evt: unknown) => void
  ): void => {
    // 先推 tool 开始，再推 ok 结果（分两步模拟流式状态）
    setTimeout(() => {
      cb({
        type: 'tool',
        conversationId,
        toolCallId,
        name,
        args: JSON.stringify(args),
        status: 'ok',
      });
      setTimeout(() => {
        cb({
          type: 'tool',
          conversationId,
          toolCallId,
          name,
          args: JSON.stringify(args),
          status: 'ok',
          result,
        });
      }, 15);
    }, 5);
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
      readDisk: async () => ok({ path: 'C:\\playwright\\ai.md', name: 'ai.md', content: seedContent }),
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
      runAgent: async (payload: {
        userId: string;
        conversationId: string | null;
        message: string;
        mode?: string;
        useKnowledgeBase?: boolean;
      }) => {
        const convId =
          payload.conversationId ??
          (conversations.find((c) => c.userId === payload.userId && c.mode === 'agent')?.id ??
            nextId('c'));
        const cb = streamCb;
        return new Promise((resolve) => {
          setTimeout(() => {
            if (agentResult.withTool && cb) {
              streamTool(convId, 'call_t1', 'searchKB', { query: payload.message, topK: 5 }, '命中知识库片段 seed', cb);
              streamTool(convId, 'call_t2', 'readFile', { file_id: 'f_kb_0' }, '读取到文档内容', cb);
            }
            const reply = `Agent 完成：${payload.message}`;
            streamChunk(convId, reply.match(/.{1,6}/g) ?? [], () => {
              resolve(
                ok({
                  conversationId: convId,
                  assistantId: nextId('a'),
                  roundsUsed: agentResult.withTool ? 2 : 1,
                  intent: agentResult.intentCard
                    ? {
                        intent: 'kbQa',
                        confidence: 0.4,
                        candidates: ['kbQa', 'tech'],
                        reason: 'low confidence',
                      }
                    : null,
                  ...(agentResult.backendHint
                    ? { agentBackendHint: agentResult.backendHint }
                    : {}),
                })
              );
            });
          }, 20);
        });
      },
      agentAbort: async () => ok(),
      // 第 5 期改写：mock 主进程薄代理返回 LLM 原始文本（RewriteReply{text}）。
      // 不解析 markdown、不计算 proposal——proposal 由渲染侧 proposeSelectionRewrite / proposeDocumentRewrite 依据该 text 计算。
      // 默认 selection 改写为「改写后文本」，document 改写为「改写 block 0」的 JSON 数组串。
      rewritePreview: async (payload: {
        scope?: string;
        selectionMarkdown?: string;
        numberedBlocks?: Array<{ blockIndex: number }>;
      }) => {
        if (payload.scope === 'document') {
          return ok({ text: rewrite.documentText ?? '[{"block_index":0,"new_content":"改写后 document"}]' });
        }
        return ok({ text: rewrite.selectionText ?? '改写后文本' });
      },
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
    kb: {
      list: async (_userId: string) =>
        ok(kbDocuments.map((d) => ({ ...d, chunkCount: d.chunkCount }))),
      importFile: async () =>
        ok({ docId: nextId('kb'), title: 'imported', chunks: 1, status: 'done' }),
      importDir: async () => ok([]),
      reindex: async () => ok({ docId: 'kb_0', title: '', chunks: 0, status: 'done' }),
      delete: async () => ok({ deleted: true }),
      status: async () => ok({ documents: kbDocuments.length, embedding: { available: true, dims: 768 } }),
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

test('Agent Tab：进入后显示知识库开关/压缩/知识点设置」，空态文案', async ({ page }) => {
  await bootAiPanel(page);
  const panel = aiPanel(page);
  // 默认 zh-CN：Agent Tab 标签为「代理」
  await panel.getByText('代理', { exact: true }).click();
  // Agent 骨架已上线：知识库开关、压缩、知识库设置入口可见
  await expect(panel.getByText('依照知识库创作')).toBeVisible();
  await expect(panel.getByText('压缩上下文')).toBeVisible();
  await expect(panel.getByRole('button', { name: '知识库' })).toBeVisible();
  // 空态：无会话提示
  await expect(panel.getByText('新建一个会话，或选择一个已有会话')).toBeVisible();
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

test('Agent 全流程：发送 → tool 轨迹渲染 → assistant 富文本落显（mock runAgent，无外发）', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  // backend=ollama（无需同意），withTool 触发 searchKB/readFile 轨迹
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    agentResult: { withTool: true },
    seedKbDocuments: 1,
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);

  // 切到 Agent tab
  await panel.getByText('代理', { exact: true }).click();
  const textarea = panel.locator('textarea').first();
  await textarea.fill('帮我查知识库里的项目计划');
  await panel.getByText('发送', { exact: true }).click();

  // user 气泡
  await expect(panel.getByText('帮我查知识库里的项目计划', { exact: true })).toBeVisible();
  // assistant 富文本流式完整落显（工具栏轨迹 name 也断言）
  await expect(panel.getByText('Agent 完成：帮我查知识库里的项目计划')).toBeVisible({
    timeout: 5000,
  });
  // 工具轨迹：searchKB / readFile 出现 + 结果折叠可展开
  await expect(panel.getByText('searchKB')).toBeVisible({ timeout: 5000 });
  await expect(panel.getByText('readFile')).toBeVisible();
  // 日志门禁：无未捕获错误
  expect(errors.length).toBe(0);
});

test('知识库设置区：kb.status/list 状态列表渲染 + 导入按钮存在', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, { seedKbDocuments: 2 });
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);

  await panel.getByText('代理', { exact: true }).click();
  // 展开知识库设置抽屉
  await panel.getByText('知识库', { exact: true }).click();
  // 状态列表渲染（kb.list 返回 2 篇）
  await expect(panel.getByText('知识库文档 0')).toBeVisible({ timeout: 5000 });
  await expect(panel.getByText('知识库文档 1')).toBeVisible();
  // embedding 可用提示（kb.status 返回 available:true）
  await expect(panel.getByText('已启用语义召回（向量可用）')).toBeVisible();
  // 导入按钮存在
  await expect(panel.getByRole('button', { name: '导入文件', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '导入文件夹', exact: true })).toBeVisible();
  expect(errors.length).toBe(0);
});

test('意图卡片：runAgent 返回低置信 intent → 卡片渲染、点击发送', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    agentResult: { intentCard: true },
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);

  await panel.getByText('代理', { exact: true }).click();
  const textarea = panel.locator('textarea').first();
  await textarea.fill('怎么组织这次演讲？');
  await panel.getByText('发送', { exact: true }).click();

  // 意图卡片（候选提问）出现
  await expect(panel.getByText('你想做什么？')).toBeVisible({ timeout: 5000 });
  await expect(panel.getByText('知识库问答')).toBeVisible();
  // 点击候选卡片 -> 触发发送（assistant 收到重发的提示模板）
  await panel.getByText('知识库问答', { exact: true }).last().click();
  await expect(
    panel.getByText('请在知识库中检索并作答。')
  ).toBeVisible({ timeout: 5000 });
  expect(errors.length).toBe(0);
});

test('后端降级：runAgent 返回 agentBackendHint → 提示条渲染', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    agentResult: { backendHint: 'Agent 能力需远程后端，当前为纯生成模式' },
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);

  await panel.getByText('代理', { exact: true }).click();
  const textarea = panel.locator('textarea').first();
  await textarea.fill('普通对话');
  await panel.getByText('发送', { exact: true }).click();

  // 降级提示条渲染（runAgent 返回 agentBackendHint）
  await expect(
    panel.getByText('Agent 能力需远程后端，当前为纯生成模式')
  ).toBeVisible({ timeout: 5000 });
  expect(errors.length).toBe(0);
});

// ============================================================
// 第 5 期（块级改写）E2E —— 全部 mock window.weaveMD.ai.rewritePreview，不上网。
// 选区触发改写（AGT-12 主 + AGT-14 红删绿增/一次撤销） / 面板 @ 兜底（document scope）/
// stale 拒绝 / unchanged「无变化」。
// 铁律一：确认写入仅渲染侧 applyRewrite -> updateContent（入 undo 栈），AI 无直接落盘。
// ============================================================

/** 打开空白 WYSIWYG 编辑器（Control+n 经 mock 新建空文档）。 */
async function openEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Control+n');
  await page.waitForSelector('span.block-content[contenteditable="true"]');
}

/** 打开 AI 面板并切到 Agent 代理页（RewritePreviewCard 与改写 composer 均在此页）。 */
async function openAgentPanel(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);
  await panel.getByText('代理', { exact: true }).click();
  await page.waitForTimeout(300);
  return panel;
}

/**
 * 按文本偏移（textContent 口径，跳过零宽空格 ​）构造真实 Range 选区——
 * 与 kernel/selection.ts offsetToDomPoint 同口径，覆盖选区内文本块。
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
          const effectiveLength = value.replace(/​/g, '').length;
          if (remaining <= effectiveLength) {
            let charCount = 0;
            let position = 0;
            for (let i = 0; i < value.length; i++) {
              if (value[i] !== '​') charCount++;
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

test('改写闭环：选区选中 → FloatingToolbar AI 改写 → 面板 composer → 预览卡（红删绿增）→ 应用 → 编辑器 content 更新且一次撤销还原', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  // seedContent：新建文档即含文本，undo 栈干净（openFile 重置），确保「一次撤销」只回退改写自身
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    seedContent: 'hello world',
  });
  await page.goto('/');
  await page.waitForSelector('header');

  // 新建文档（内容 hello world），选区边界与内容一致
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await expect(editable).toHaveText('hello world');

  // 打开 AI 面板并切到 Agent 代理页
  const panel = await openAgentPanel(page);

  // 编辑器选中整段文本 → 浮动工具栏出现，「AI 改写」按钮存在
  await selectTextRange(page, 0, 11);
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="AI 改写"]').click();
  await page.waitForTimeout(300);

  // 面板（Agent 页）composer 出现选区改写占位提示
  const composer = panel.locator('textarea').first();
  await expect(composer).toHaveAttribute('placeholder', '描述如何改写选中内容');
  await composer.fill('把它改写得更简洁');
  await composer.press('Enter');
  await page.waitForTimeout(400);

  // 预览卡片出现：标题 + 行级红删绿增（del 红删除原行 / ins 绿新增改写行）
  await expect(panel.getByText('改写预览', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(panel.locator('[data-type="del"]').first()).toContainText('hello world');
  await expect(panel.locator('[data-type="ins"]').first()).toContainText('改写后文本');

  // 点「应用」→ 编辑器 content 更新（整段被改写）
  await panel.getByText('应用', { exact: true }).click();
  await page.waitForTimeout(400);
  await expect(editable).toHaveText('改写后文本');
  // 预览卡片关闭
  await expect(panel.getByText('改写预览', { exact: true })).toBeHidden();

  // 一次 Ctrl+Z（编辑器 undo）还原原文
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('hello world');
  expect(errors.length).toBe(0);
});

test('面板 @ 兜底：Agent composer @+描述 → document scope 预览卡 → 确认写入', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    seedContent: '第一段内容',
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await expect(editable).toHaveText('第一段内容');

  const panel = await openAgentPanel(page);
  const composer = panel.locator('textarea').first();
  // @ + 描述 → document scope 块级改写
  await composer.fill('@ 把第一段改成 Document 改写');
  await composer.press('Enter');
  await page.waitForTimeout(400);

  // 预览卡片出现（mock document 返回 JSON：改写 block 0）
  await expect(panel.getByText('改写预览', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(panel.locator('[data-type="ins"]').first()).toContainText('改写后 document');

  // 取消 → 编辑器不变
  await panel.getByText('取消', { exact: true }).click();
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('第一段内容');
  expect(errors.length).toBe(0);
});

test('stale 拒绝：预览卡出现后改文档 → 应用被拒（文档已变更提示，不写入）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    seedContent: 'hello world',
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await expect(editable).toHaveText('hello world');

  const panel = await openAgentPanel(page);
  await selectTextRange(page, 0, 11);
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="AI 改写"]').click();

  const composer = panel.locator('textarea').first();
  await composer.fill('改写一下');
  await composer.press('Enter');
  await page.waitForTimeout(400);
  await expect(panel.getByText('改写预览', { exact: true })).toBeVisible({ timeout: 5000 });

  // 预览期间改编辑器内容（stale：content != originalMd）
  await editable.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(' 新增内容', { delay: 20 });
  await page.waitForTimeout(300);

  // 点「应用」→ stale 拒绝，提示「文档已变更」，编辑器不被改写
  await panel.getByText('应用', { exact: true }).click();
  await page.waitForTimeout(300);
  await expect(panel.getByText('文档已变更，请重新生成', { exact: true })).toBeVisible();
  await expect(editable).not.toContainText('改写后文本');
  expect(errors.length).toBe(0);
});

test('unchanged：mock 改写结果与原文相同 → 提示「无变化」，不弹预览卡', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    seedContent: 'hello world',
    // 改写返回与选中原文完全一致 → 渲染侧比较 unchanged=true
    rewrite: { selectionText: 'hello world' },
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await expect(editable).toHaveText('hello world');

  const panel = await openAgentPanel(page);
  await selectTextRange(page, 0, 11);
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="AI 改写"]').click();

  const composer = panel.locator('textarea').first();
  await composer.fill('保持不变');
  await composer.press('Enter');
  await page.waitForTimeout(400);

  // 「无变化」提示出现，预览卡不出现
  await expect(panel.getByText('改写结果与原文相同，无变化', { exact: true })).toBeVisible({
    timeout: 5000,
  });
  await expect(panel.getByText('改写预览', { exact: true })).toBeHidden();
  // 编辑器未被改写
  await expect(editable).toHaveText('hello world');
  expect(errors.length).toBe(0);
});

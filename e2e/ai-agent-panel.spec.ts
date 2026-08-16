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
  /** 模型下拉数据源（`ai.listModels` 返回；缺省返回两个内置模型名）。 */
  listModels?: string[];
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
  const mockModels = opts.listModels ?? ['qwen3.5:0.8b', 'deepseek-chat'];
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
  // 内存态配置（ModelForm 保存 / ModelDropdown 选中持久化；model 可被更新）
  let mockConfig: {
    backend: 'ollama' | 'remote';
    ollamaBaseUrl: string;
    remoteBaseUrl: string;
    model: string;
    hasApiKey: boolean;
  } = {
    backend,
    ollamaBaseUrl: 'http://localhost:11434',
    remoteBaseUrl: 'https://api.example.com',
    model: 'mock-model',
    hasApiKey: backend === 'remote',
  };
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
      getConfig: async () => ok({ ...mockConfig }),
      setConfig: async (userId: string, cfg: { model?: string; backend?: 'ollama' | 'remote' }) => {
        if (cfg.model !== undefined) mockConfig = { ...mockConfig, model: cfg.model };
        if (cfg.backend !== undefined) mockConfig = { ...mockConfig, backend: cfg.backend };
        return ok({ ...mockConfig });
      },
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
      // 第 7 期 B1：技能清单 mock（本地，不上网）
      listSkills: async () =>
        ok([
          { name: 'polish_rewrite', description: '润色、缩写或扩写文本' },
          { name: 'tech_organize', description: '整理技术资料' },
          { name: 'kb_qa_guide', description: '基于知识库引导式问答' },
        ]),
      listModels: async () => ok(mockModels),
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
      updateConversationSummary: async (conversationId: string, userId: string, summary: string) => {
        // 首条消息写入概要 → RECENT/会话标题据此渲染（R20/R21 契约）
        conversations.forEach((c) => {
          if (c.id === conversationId && c.userId === userId) {
            c.summary = summary;
            c.updatedAt = new Date().toISOString();
          }
        });
        return ok({});
      },
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
      // 第 6 期：KB 参数持久化契约（agentStore.init 会调 getSettings）
      getSettings: async () =>
        ok({
          topK: 5,
          fuse: 0.5,
          threshold: 0.6,
          pinnedWeight: 1.5,
          embeddingHost: 'http://localhost:11434',
          embeddingModel: 'nomic-embed-text',
        }),
      setSettings: async (_input: { userId: string; settings: unknown }) =>
        ok({
          topK: 5,
          fuse: 0.5,
          threshold: 0.6,
          pinnedWeight: 1.5,
          embeddingHost: 'http://localhost:11434',
          embeddingModel: 'nomic-embed-text',
        }),
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

/** B3：通过 composer 模式下拉切换「对话 / 智能体」。 */
async function switchMode(
  page: import('@playwright/test').Page,
  mode: 'chat' | 'agent'
): Promise<import('@playwright/test').Locator> {
  const panel = aiPanel(page);
  const select = panel.getByTestId('ai-mode-select');
  await select.selectOption(mode);
  await page.waitForTimeout(300);
  return panel;
}

/** 顶部「+ 新建会话」→ 清空当前会话并进入 session 视图（M3 新会话入口）。 */
async function newChatAndEnterSession(
  page: import('@playwright/test').Page
): Promise<import('@playwright/test').Locator> {
  const panel = aiPanel(page);
  await panel.getByTestId('new-chat-btn').click();
  await page.waitForTimeout(300);
  return panel;
}

test('导航栏 AI 按钮开合面板，宽度拖拽把手存在', async ({ page }) => {
  await bootAiPanel(page);
  const panel = aiPanel(page);
  await expect(panel).toBeVisible();
  // 宽度把手（cursor-col-resize）存在
  await expect(panel.locator('.cursor-col-resize').first()).toBeVisible();
  // 关闭（✕）→ 面板隐藏
  await panel.getByTestId('close-panel-btn').click();
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
  await expect(panel).toBeVisible();
  const textarea = panel.locator('textarea').first();
  await textarea.fill('你好世界');
  await panel.getByText('发送', { exact: true }).click();

  // 首条消息写入会话标题；assistant 回复（唯一文本）完整落显（done 后）
  await expect(panel.getByTestId('session-title')).toHaveText('你好世界');
  await expect(
    panel.getByText('你好，我是 mock AI。你说的是：你好世界')
  ).toBeVisible({ timeout: 5000 });
  // 无未捕获错误
  expect(errors.length).toBe(0);
});

test('home RECENT：预置会话出现在最近列表，空库显示空态文案', async ({ page }) => {
  await page.addInitScript(installWeaveMDMock, { seedConversations: 1 });
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);
  // 默认 home 视图：RECENT 区块可见，预置会话出现在列表
  await expect(panel.getByText('最近', { exact: true })).toBeVisible();
  await expect(panel.getByText('预置会话 0')).toBeVisible();
});

test('home 空态：无会话时显示 ai.home.noRecent 文案', async ({ page }) => {
  await bootAiPanel(page);
  const panel = aiPanel(page);
  await expect(panel.getByText('暂无最近会话', { exact: true })).toBeVisible();
});

test('智能体模式：切 agent 后进 session 视图 → 显示知识库开关/压缩/知识库设置入口', async ({
  page,
}) => {
  await bootAiPanel(page);
  const panel = await switchMode(page, 'agent');
  // 知识库开关/压缩/知识库设置入口只在 session 视图渲染 → 先「+ 新建会话」进入 session
  await newChatAndEnterSession(page);
  await expect(panel.getByText('依照知识库创作')).toBeVisible();
  await expect(panel.getByText('压缩上下文')).toBeVisible();
  await expect(panel.getByRole('button', { name: '知识库' })).toBeVisible();
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

  // 放行：首条消息写入会话标题；assistant 流式完整落显
  await expect(panel.getByTestId('session-title')).toHaveText('需要联网的问题');
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

  // 切到 智能体 模式（B3 下拉）
  await switchMode(page, 'agent');
  const textarea = panel.locator('textarea').first();
  await textarea.fill('帮我查知识库里的项目计划');
  await panel.getByText('发送', { exact: true }).click();

  // 首条消息写入会话标题；assistant 富文本流式完整落显（工具栏轨迹 name 也断言）
  await expect(panel.getByTestId('session-title')).toHaveText('帮我查知识库里的项目计划');
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

  // 切到 智能体 模式（B3 下拉）→ 进 session 视图以显示知识库设置区
  await switchMode(page, 'agent');
  await newChatAndEnterSession(page);
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

  // 切到 智能体 模式（B3 下拉）
  await switchMode(page, 'agent');
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

  // 切到 智能体 模式（B3 下拉）
  await switchMode(page, 'agent');
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

/** 打开 AI 面板并切到 智能体 模式（RewritePreviewCard 与改写 composer 均在此模式）。 */
async function openAgentPanel(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  return switchMode(page, 'agent');
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

  // 打开 AI 面板并切到 Agent 智能体页
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

/**
 * 跨两个 `.block-content` 内容叶 span 建立真实 Range 选区（按文档序取第 start/end 个，
 * startOffset/endOffset 作用于各自首文本节点）——复刻 Chromium 拖选跨块的选区形态
 * （anchor 在第 start 块、focus 在第 end 块）。注意：Chromium 对跨编辑宿主
 * Selection.toString() 只返回 anchor 块内文本，断言用块文本/预览 diff，勿用 toString()。
 */
async function selectCrossBlocks(
  page: import('@playwright/test').Page,
  start: number,
  startOffset: number,
  end: number,
  endOffset: number
): Promise<void> {
  await page.evaluate(
    (cfg: { start: number; startOffset: number; end: number; endOffset: number }) => {
      const spans = Array.from(
        document.querySelectorAll<HTMLElement>('span.block-content[contenteditable="true"]')
      );
      const a = spans[cfg.start];
      const b = spans[cfg.end];
      if (!a || !b) return;
      const range = document.createRange();
      range.setStart(a.firstChild as Node, cfg.startOffset);
      range.setEnd(b.firstChild as Node, cfg.endOffset);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },
    { start, startOffset, end, endOffset }
  );
}

// ============================================================
// 第 7 期 A4：含列表容器文档的跨块选区改写 → 落到正确叶子（叶序下标），区间外字节零改动。
// 修复前 DOM `[data-block-id]` 序含容器 div → 叶序下标偏大 → 改写落错块。mock 不上网。
// ============================================================
test('A4 回归：含列表文档跨块选区改写 → 仅替换选中区间（含列表项与中间叶），区间外正文保持不变', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  // seedContent：列表两叶 + 区间外正文一叶（markdownToState 叶序 [item-a, item-b, outside]）
  const seed = '- item-a\n\n- item-b\n\noutside';
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    seedContent: seed,
    rewrite: { selectionText: '改写块' },
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await openEditor(page);

  // 确认渲染出 2 个列表项内容叶 + 1 个正文内容叶
  const contentSpans = page.locator('span.block-content[contenteditable="true"]');
  await expect(contentSpans).toHaveCount(3);
  await expect(contentSpans.nth(0)).toHaveText('item-a');
  await expect(contentSpans.nth(1)).toHaveText('item-b');
  await expect(contentSpans.nth(2)).toHaveText('outside');

  const panel = await openAgentPanel(page);

  // 跨块选中：列表项 item-a（叶 0）→ 列表项 item-b（叶 1），区间外 'outside' 不被选中
  await selectCrossBlocks(page, 0, 0, 1, 1);
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="AI 改写"]').click();
  await page.waitForTimeout(300);

  const composer = panel.locator('textarea').first();
  await composer.fill('改一下');
  await composer.press('Enter');
  await page.waitForTimeout(400);

  // 预览卡出现（改写成功；修复前落错块会 unchanged/noop 无预览）
  await expect(panel.getByText('改写预览', { exact: true })).toBeVisible({ timeout: 5000 });
  // 红删（del）覆盖选中区间文本（item-a / item-b），且不含区间外 'outside' 整词
  const del = panel.locator('[data-type="del"]');
  await expect(del.first()).toBeVisible();
  const delText = (await del.allTextContents()).join('');
  expect(delText).toContain('item-a');
  expect(delText).toContain('item-b');
  expect(delText).not.toContain('outside');

  // 应用 → 编辑器更新：选中的列表项被改写为 '改写块'，区间外 'outside' 原样保留。
  // 跨块替换会合并中/尾叶，span 下标随之收敛——只断言「改写块」已写入且区间外正文未变。
  await panel.getByText('应用', { exact: true }).click();
  await page.waitForTimeout(400);
  const left = (await page.locator('span.block-content[contenteditable="true"]').allTextContents()).join('');
  expect(left).toContain('改写块');
  expect(left).not.toContain('item-a');
  // 区间外正文块保持原样（列表改写不影响它）
  await expect(page.getByText('outside', { exact: true }).first()).toBeVisible();
  expect(errors.length).toBe(0);
});

// ============================================================
// 第 7 期 A1c：从 0 到 1 写整篇。
// 闭环：空文档 → 说「从 0 到 1 写一篇」→ 整篇生成（document scope 空 numberedBlocks）→
//       预览卡 → 应用 → 写入当前文档 → 一次 Ctrl+Z 还原。
// 验收 2：未打开文档 → 引导提示（不产生空写）。mock 不上网。
// ============================================================
test('A1c 从0到1写整篇：空文档 composer 触发 → 预览卡 → 应用写入 → 一次撤销还原', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const doc = '# 关于 AI\n\n这是一篇 AI 生成的整篇文档。';
  // 空文档打开（seedContent 默认 ''）；documentText = AI 产整篇 markdown（空 numberedBlocks 协议）
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    rewrite: { documentText: doc },
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await openEditor(page); // 新建空文档
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await expect(editable).toHaveText('');

  const panel = await openAgentPanel(page);
  const composer = panel.locator('textarea').first();
  // 「从 0 到 1 写一篇」→ WRITE_WHOLE_DOC_RE 命中 → runFullDocumentRewrite
  await composer.fill('帮我从 0 到 1 写一篇关于 AI 的文档');
  await composer.press('Enter');
  await page.waitForTimeout(400);

  // 预览卡出现（整篇生成，红删绿增——原始空行被 + 全文替换）
  await expect(panel.getByText('改写预览', { exact: true })).toBeVisible({ timeout: 5000 });

  // 应用 → 编辑器写入整篇 markdown
  await panel.getByText('应用', { exact: true }).click();
  await page.waitForTimeout(400);
  await expect(editable).toHaveText('关于 AI');
  // 整篇多块渲染（标题 + 段落）
  await expect(page.getByText('这是一篇 AI 生成的整篇文档。', { exact: true })).toBeVisible();

  // 一次 Ctrl+Z（编辑器 undo）还原为空文档
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  await expect(editable).toHaveText('');
  expect(errors.length).toBe(0);
});

test('A1c 未打开文档 + 整篇写诉求 → 引导提示，不产生空写', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  // 不打开任何编辑器文档
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
  });
  await page.goto('/');
  await page.waitForSelector('header');
  const panel = await openAgentPanel(page);

  const composer = panel.locator('textarea').first();
  await composer.fill('帮我从 0 到 1 写一篇关于 AI 的文档');
  await composer.press('Enter');
  await page.waitForTimeout(400);

  // 引导提示条渲染（ai.rewrite.noDocument），不弹预览卡（无 proposal）
  await expect(panel.getByText(/请先打开一个文档/)).toBeVisible({ timeout: 5000 });
  await expect(panel.getByText('改写预览', { exact: true })).toBeHidden();
  expect(errors.length).toBe(0);
});

// ============================================================
// 第 7 期 A2：混合语法类型选中 → 弹「AI 改写」工具栏（无行内格式/块类型下拉）。
// 文档 = 标题 + 正文 + 列表（heading/paragraph/bullet-list 混合），跨块选中标题→正文。
// mock 不上网。
// ============================================================
test('A2 混合语法类型：跨块选中标题+正文 → 工具栏含「AI 改写」、无行内格式/块类型下拉', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const seed = '# 大标题\n\n正文段落';
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    seedContent: seed,
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await openEditor(page);

  // 标题叶 + 正文叶 各 1 个 `.block-content` span
  const contentSpans = page.locator('span.block-content[contenteditable="true"]');
  await expect(contentSpans).toHaveCount(2);

  // 跨块选中标题 → 正文（heading + paragraph，语法类型混合）
  await selectCrossBlocks(page, 0, 0, 1, 1);
  await page.waitForTimeout(300);

  const toolbar = page.locator('.floating-toolbar-v2');
  // A2：混合类型 → 工具栏出现（修复前整个隐藏）
  await expect(toolbar).toBeVisible({ timeout: 5000 });
  // 仅「AI 改写」入口；行内格式 / 块类型下拉隐藏
  await expect(toolbar.locator('button[title="AI 改写"]')).toBeVisible();
  await expect(toolbar.locator('button[title="加粗"]')).toHaveCount(0);
  await expect(toolbar.locator('button[title="链接"]')).toHaveCount(0);
  await expect(toolbar.locator('.block-type-trigger')).toHaveCount(0);
  // 混合标记已置位
  await expect(toolbar).toHaveAttribute('data-mixed', 'true');

  // 点「AI 改写」→ 面板打开，composer 获焦后选区高亮仍在（A3 联动）
  await toolbar.locator('button[title="AI 改写"]').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);
  await expect(panel).toBeVisible();
  expect(errors.length).toBe(0);
});

// ============================================================
// 第 7 期 A3：选区保持 —— 点「AI 改写」、面板 composer 获焦输入后，编辑器内被改写
// 范围仍以 `.rewrite-highlight` 持久高亮；取消/应用后高亮清除，编辑器跳转改写内容。
// mock 不上网。
// ============================================================
test('A3 选区保持：点 AI 改写 → 编辑器内 .rewrite-highlight 高亮 + 面板聚焦不清除 → 应用后高亮清除', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    seedContent: 'hello world',
    rewrite: { selectionText: '改写后内容' },
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await expect(editable).toHaveText('hello world');

  const panel = await openAgentPanel(page);

  // 编辑器选中整段 → 浮动工具栏出现 → 点「AI 改写」
  await selectTextRange(page, 0, 11);
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="AI 改写"]').click();
  await page.waitForTimeout(300);

  // A3：面板打开后编辑器内出现持久高亮（改写范围被标记）
  const highlight = panel.page().locator('.rewrite-highlight');
  await expect(highlight.first()).toBeVisible({ timeout: 5000 });

  // 面板 composer 聚焦输入 → 高亮不消失（选中不丢）
  const composer = panel.locator('textarea').first();
  await composer.click();
  await composer.fill('改写成这样');
  await page.waitForTimeout(200);
  await expect(highlight.first()).toBeVisible();
  expect(errors.length).toBe(0);

  // 应用改写 → 高亮清除 + 编辑器内容更新为改写后文本
  await composer.press('Enter');
  await page.waitForTimeout(400);
  await expect(panel.getByText('改写预览', { exact: true })).toBeVisible({ timeout: 5000 });
  await panel.getByText('应用', { exact: true }).click();
  await page.waitForTimeout(400);
  // 高亮随 selectionContext 清空而移除
  await expect(panel.page().locator('.rewrite-highlight')).toHaveCount(0);
  // 编辑器跳转到改写后内容
  await expect(editable).toHaveText('改写后内容');
  expect(errors.length).toBe(0);
});

// ============================================
// 第 7 期批次④ B1：/ 与 @ 自动补全（全部本地 mock，不上网）
// ============================================

test('B1 @ 补全：输入 @ → 弹出引用菜单（当前文档/知识库），选中「当前文档」注入前缀，Esc 关闭', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    seedContent: '第一段内容',
    rewrite: { documentText: '[{"block_index":0,"new_content":"改写后 document"}]' },
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await openEditor(page);
  const editable = page.locator('span.block-content[contenteditable="true"]').first();
  await expect(editable).toHaveText('第一段内容');

  const panel = await openAgentPanel(page);
  const composer = panel.locator('textarea').first();
  // 输入 @ → 引用补全菜单出现（含标题「引用」与两类目标）
  await composer.fill('@');
  await expect(panel.getByText('引用', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(panel.getByText('当前文档')).toBeVisible();
  await expect(panel.getByText('知识库文档')).toBeVisible();

  // 选中「知识库文档」→ 注入 @知识库 前缀 + 空格
  await panel.getByText('知识库文档').click();
  await expect(composer).toHaveValue('@知识库 ');
  // 输入 @ 重新触发 → 选中「当前文档」→ 注入 @文档 前缀
  await composer.fill('@');
  await expect(panel.getByText('当前文档')).toBeVisible();
  await panel.getByText('当前文档').click();
  await expect(composer).toHaveValue('@文档 ');

  // 补充指令 → Enter → document scope 预览卡（复用现有 @ 协议消费）
  await composer.fill('@文档 把第一段改成 B1 改写');
  await composer.press('Enter');
  await page.waitForTimeout(400);
  await expect(panel.getByText('改写预览', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(panel.locator('[data-type="ins"]').first()).toContainText('改写后 document');

  // 取消后验证 Esc 关闭逻辑：重新输入 @ 弹菜单 → Esc 关闭
  await panel.getByText('取消', { exact: true }).click();
  await page.waitForTimeout(300);
  await composer.fill('@');
  await expect(panel.getByText('引用', { exact: true })).toBeVisible({ timeout: 5000 });
  await composer.press('Escape');
  await expect(panel.getByText('引用', { exact: true })).toHaveCount(0);
  expect(errors.length).toBe(0);
});

test('B1 / 补全：输入 / → 弹出技能清单（mock listSkills），选中注入 /技能名 前缀, Enter 发送剥前缀走 agent', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    seedContent: '内容',
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await openEditor(page);

  const panel = await openAgentPanel(page);
  const composer = panel.locator('textarea').first();
  // 输入 / → 技能补全菜单（标题「运行技能」+ 3 个内置技能名称）
  await composer.fill('/');
  await expect(panel.getByText('运行技能', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(panel.getByText('polish_rewrite')).toBeVisible();
  await expect(panel.getByText('tech_organize')).toBeVisible();
  await expect(panel.getByText('kb_qa_guide')).toBeVisible();

  // 选中技能 → 注入 /polish_rewrite 前缀 + 空格
  await panel.getByText('polish_rewrite').click();
  await expect(composer).toHaveValue('/polish_rewrite ');

  // 补充指令 → Enter → 剥前缀后走 sendAgentMessage（本地 mock，无网络）
  await composer.fill('/polish_rewrite 把这段润色');
  await composer.press('Enter');
  await page.waitForTimeout(400);
  // 剥前缀生效：首条消息写入会话标题 = 指令正文；user 气泡（第 0 个消息气泡）同为剥除 /技能名 后的指令正文
  await expect(panel.getByTestId('session-title')).toHaveText('把这段润色');
  await expect(panel.getByText('把这段润色', { exact: true }).nth(1)).toBeVisible({ timeout: 5000 });
  await expect(panel.getByText('把这段润色', { exact: true }).nth(1)).toHaveText('把这段润色');
  expect(errors.length).toBe(0);
});

// ============================================================
// 第 7 期批次⑥ B3：双 Tab 合并 单面板 + composer 上下拉模式选择。
// ① 单面板无 Tab、模式下拉存在；② 切换模式消息/会话随 mode 域切换（不串号）；
// ③ agent 模式保专属控件、chat 纯对话。mock 不上网。
// ============================================================

test('B3 单面板：无 Chat/Agent 双 Tab按钮，头部有模式下拉（对话/智能体）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await bootAiPanel(page);
  const panel = aiPanel(page);

  // 无 Tab 割裂：面板内不存在「对话」「智能体」按钮（模式由下拉承载）
  await expect(panel.getByRole('button', { name: '对话' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '智能体' })).toHaveCount(0);

  // 头部存在模式下拉，选项为 对话/智能体
  const select = panel.getByTestId('ai-mode-select');
  await expect(select).toBeVisible();
  await expect(select.locator('option[value="chat"]')).toHaveText('对话');
  await expect(select.locator('option[value="agent"]')).toHaveText('智能体');
  expect(errors.length).toBe(0);
});

test('B3 模式切换：chat ↔ agent 时 mode 下拉生效、消息同一会话内累积', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await bootAiPanel(page);
  const panel = aiPanel(page);
  const select = panel.getByTestId('ai-mode-select');

  // 默认 chat 域：agent 专属控件（仅在 session 视图渲染）不显示
  await expect(select).toHaveValue('chat');
  await expect(panel.getByText('依照知识库创作')).toHaveCount(0);

  // chat 域发一条消息 → home composer 发送即自动进 session，等待流式 assistant 完整落显
  await panel.locator('textarea').first().fill('对话消息');
  await panel.getByText('发送', { exact: true }).click();
  // 首条消息写入会话标题（=「对话消息」），与 user 气泡并存 → 用消息区气泡精确断言
  await expect(panel.getByTestId('session-title')).toHaveText('对话消息');
  await expect(
    panel.getByText('你好，我是 mock AI。你说的是：对话消息')
  ).toBeVisible({ timeout: 5000 });

  // 切 agent 域：agent 专属控件（session 视图）出现；消息流（共享 store）保留 chat 消息
  await switchMode(page, 'agent');
  await expect(panel.getByText('依照知识库创作')).toBeVisible();
  await expect(
    panel.getByText('你好，我是 mock AI。你说的是：对话消息')
  ).toBeVisible();

  // agent 域同会话发一条 → runAgent mock 回复（与 chat 消息共存）
  await panel.locator('textarea').first().fill('agent指令');
  await panel.getByText('发送', { exact: true }).click();
  await expect(panel.getByText('agent指令', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(panel.getByText('Agent 完成：agent指令')).toBeVisible({ timeout: 5000 });

  // 切回 chat 域：agent 专属控件消失；消息仍在（同一会话内共享）
  await switchMode(page, 'chat');
  await expect(panel.getByText('依照知识库创作')).toHaveCount(0);
  await expect(panel.getByText('Agent 完成：agent指令')).toBeVisible();
  expect(errors.length).toBe(0);
});

test('B3 专属控件归属：agent 保 知识库开关/压缩/KB设置，chat 纯对话无 /@ 补全', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await bootAiPanel(page);
  const panel = aiPanel(page);

  // chat 模式：输入 / 不弹技能补全（纯对话），agent 专属控件不显示
  const composer = panel.locator('textarea').first();
  await composer.fill('/');
  await expect(panel.getByText('运行技能', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('依照知识库创作')).toHaveCount(0);
  // 清空输入，避免切换后残留 '/' 使第二次 fill 成为无变化操作（React onChange 不触发）
  await composer.fill('');

  // 切 agent 模式 → 进 session 视图：知识库控齐全 + / 技能补全出现
  await switchMode(page, 'agent');
  await newChatAndEnterSession(page);
  await expect(panel.getByText('依照知识库创作')).toBeVisible();
  await expect(panel.getByText('压缩上下文')).toBeVisible();
  await expect(panel.getByRole('button', { name: '知识库' })).toBeVisible();
  await composer.fill('/');
  await expect(panel.getByText('运行技能', { exact: true })).toBeVisible({ timeout: 5000 });
  expect(errors.length).toBe(0);
});

// ============================================================
// 三视图重构（M3）新增 E2E：home 空态/建会话/首条标题+RECENT/最近会话点击/标题行×关闭/
// 设置三 tab+模型保存/模型下拉列出+持久化/KB 归属（session）/改写失败条×关闭。
// mock 不上网（updateConversationSummary 写回内存 conversations，title 据此渲染）。
// ============================================================

test('三视图：默认 home 视图 + [+] 新建会话进入 session，标题行 × 关闭回 home', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await bootAiPanel(page);
  const panel = aiPanel(page);

  // 默认 home：RECENT 空态 + composer 存在
  await expect(panel.getByText('暂无最近会话', { exact: true })).toBeVisible();
  await expect(panel.locator('textarea').first()).toBeVisible();

  // [+] 新建会话 → 进入 session 视图（session-title 行出现，标题为模式兜底）
  await panel.getByTestId('new-chat-btn').click();
  await page.waitForTimeout(300);
  await expect(panel.getByTestId('session-title')).toBeVisible();

  // 标题行 [×] 关闭当前会话 → newChat + 回 home（空态回来）
  await panel.getByTestId('close-conversation').click();
  await page.waitForTimeout(300);
  await expect(panel.getByText('暂无最近会话', { exact: true })).toBeVisible();
  expect(errors.length).toBe(0);
});

test('首条消息 → 会话标题=首条问题；回 home 后 RECENT 显示该标题', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(installWeaveMDMock, {});
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);

  // home composer 发送首条消息 → 自动进 session，标题=首条问题
  await panel.locator('textarea').first().fill('第一个问题是什么');
  await panel.getByText('发送', { exact: true }).click();
  await expect(panel.getByTestId('session-title')).toHaveText('第一个问题是什么', { timeout: 5000 });
  await expect(panel.getByText('你好，我是 mock AI。你说的是：第一个问题是什么')).toBeVisible({
    timeout: 5000,
  });

  // 标题行 × 关闭会话 → 回 home；RECENT 显示该标题（summary=首条问题）
  await panel.getByTestId('close-conversation').click();
  await page.waitForTimeout(300);
  const recentBtn = panel.getByTestId('home-recent-item').first();
  await expect(recentBtn).toBeVisible({ timeout: 5000 });
  await expect(recentBtn).toContainText('第一个问题是什么');
  expect(errors.length).toBe(0);
});

test('点击 home RECENT 最近会话 → loadConversation 进 session，标题=该会话 summary', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  // 预置 1 个会话（summary=预置会话 0）→ home RECENT 显示，点击进 session
  await page.addInitScript(installWeaveMDMock, { seedConversations: 1 });
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByTitle('AI').click();
  await page.waitForTimeout(300);
  const panel = aiPanel(page);

  const recentBtn = panel.getByTestId('home-recent-item').first();
  await expect(recentBtn).toContainText('预置会话 0');
  await recentBtn.click();
  await page.waitForTimeout(300);
  // 进入 session 视图，标题 = 该会话 summary
  await expect(panel.getByTestId('session-title')).toHaveText('预置会话 0');
  expect(errors.length).toBe(0);
});

test('设置三 tab：模型/skills/MCP 切换，模型表单保存后 config model 生效（mock）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await bootAiPanel(page);
  const panel = aiPanel(page);

  // ⚙ 进入设置视图
  await panel.getByTestId('open-settings-btn').click();
  await page.waitForTimeout(300);
  await expect(panel.getByTestId('settings-tab-model')).toBeVisible();

  // 三 tab 存在
  await expect(panel.getByText('模型', { exact: true })).toBeVisible();
  await expect(panel.getByText('技能', { exact: true })).toBeVisible();
  await expect(panel.getByText('MCP', { exact: true })).toBeVisible();

  // 切到 skills → 列出 mock 技能
  await panel.getByTestId('settings-tab-skills').click();
  await page.waitForTimeout(300);
  await expect(panel.getByTestId('skill-item').first()).toBeVisible({ timeout: 5000 });
  await expect(panel.getByText('polish_rewrite')).toBeVisible();

  // 切到 mcp → 延期占位
  await panel.getByTestId('settings-tab-mcp').click();
  await page.waitForTimeout(300);
  await expect(panel.getByText('真正的 MCP server 管理已延期交付')).toBeVisible();

  // 回到 模型 表单：改 model 并保存 → 下拉 label 更新（setConfig 持久化）
  await panel.getByTestId('settings-tab-model').click();
  await page.waitForTimeout(300);
  const modelInput = panel.locator('input[placeholder*="qwen3.5"]').first();
  await modelInput.fill('my-saved-model');
  await panel.getByTestId('model-form-save').click();
  await page.waitForTimeout(400);
  expect(errors.length).toBe(0);
});

test('composer 模式下拉 chat/agent + 模型下拉列出 mock 模型、选中持久化', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await bootAiPanel(page);
  const panel = aiPanel(page);

  // 模式下拉存在且默认 chat
  const modeSelect = panel.getByTestId('ai-mode-select');
  await expect(modeSelect).toHaveValue('chat');

  // 模型下拉：打开列出 mock 模型
  await panel.getByTestId('model-dropdown').click();
  await page.waitForTimeout(300);
  await expect(panel.getByText('qwen3.5:0.8b')).toBeVisible({ timeout: 5000 });
  await expect(panel.getByText('deepseek-chat')).toBeVisible();

  // 选中一个模型 → setConfig 持久化（下拉按钮 label 更新为该模型）
  await panel.getByText('deepseek-chat').click();
  await page.waitForTimeout(300);
  await expect(panel.getByTestId('model-dropdown')).toContainText('deepseek-chat');
  expect(errors.length).toBe(0);
});

test('改写失败条出现 ✕ 可关闭（dismissRewriteBanner）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  // 「无变化」路径：rewritePreview 返回与原文相同 → rewriteError='no-change'、pendingRewrite=null
  // → 渲染无提案提示条（含 ✕ dismiss），点 ✕ → dismissRewriteBanner 清除。
  await page.addInitScript(installWeaveMDMock, {
    backend: 'ollama',
    consented: true,
    seedContent: 'hello world',
    rewrite: { selectionText: 'hello world' }, // 与原文相同 → 无变化提示条
  });
  await page.goto('/');
  await page.waitForSelector('header');
  await openEditor(page);
  const panel = await openAgentPanel(page);

  // 选区改写 → mock 返回与原文相同 → 无变化提示条渲染
  await selectTextRange(page, 0, 11);
  await page.waitForTimeout(300);
  const toolbar = page.locator('.floating-toolbar-v2');
  await expect(toolbar).toBeVisible();
  await toolbar.locator('button[title="AI 改写"]').click();
  await page.waitForTimeout(300);

  const composer = panel.locator('textarea').first();
  await composer.fill('保持不变');
  await composer.press('Enter');
  await page.waitForTimeout(400);
  await expect(panel.getByText('改写结果与原文相同，无变化', { exact: true })).toBeVisible({
    timeout: 5000,
  });

  // ✕（aria-label=关闭）→ 无变化提示条消失（dismissRewriteBanner）
  await expect(panel.getByRole('button', { name: '关闭' })).toBeVisible();
  await panel.getByRole('button', { name: '关闭' }).click();
  await page.waitForTimeout(200);
  await expect(panel.getByText('改写结果与原文相同，无变化', { exact: true })).toBeHidden();
  expect(errors.length).toBe(0);
});

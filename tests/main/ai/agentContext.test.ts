// ============================================
// doc-pipeline 遗留修复批次：prepareAgentContext 集成测试
// R3：ToolCtx.attachmentEgressAllowed 注入（allowSend ∨ 勾选授权，fail-closed）
// （Bug A 附件清单/提示词选择、Bug B vision 判定后续小节在此扩展）
// ============================================
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// --- Electron mock（agentContext: BrowserWindow；imageStorage 链: app/nativeImage） ---
const electronMock = vi.hoisted(() => ({
  webContentsSend: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ webContents: { send: electronMock.webContentsSend } }),
  },
  app: { getPath: () => ':memory:' },
  nativeImage: { createFromBuffer: vi.fn(() => ({ toDataURL: () => 'data:,' })) },
}));

// --- DB mock（prepareAgentContext 只读会话/消息 + 落用户消息） ---
const dbAiMock = vi.hoisted(() => ({
  appendMessage: vi.fn((m: Record<string, unknown>) => ({ id: 'm1', ...m })),
  getConversation: vi.fn(),
  getMessagesByConversationPaginated: vi.fn(
    (): Array<{ role: string; content: string }> => []
  ),
}));
vi.mock('@main/db/ai', () => dbAiMock);

const dbFilesMock = vi.hoisted(() => ({ listFiles: vi.fn(() => []) }));
vi.mock('@main/db/files', () => dbFilesMock);

// R3：勾选授权附件存在性（kbAttachmentEgressGranted 来源）
const dbKbMock = vi.hoisted(() => ({ hasGrantedAttachmentDocs: vi.fn(() => false) }));
vi.mock('@main/db/kb', () => dbKbMock);

const embConfigMock = vi.hoisted(() => ({ getEmbeddingConfig: vi.fn(() => null) }));
vi.mock('@main/db/embeddingConfig', () => embConfigMock);

vi.mock('@main/ai/secureConfig', () => ({
  decryptApiKey: vi.fn((enc: string) => enc.replace('enc:', '')),
}));

// contextManager 用真实实现（依赖 llmClient/anthropicClient 已 mock；
// agentMedia/mdImageResolver 还需其 KEEP_RECENT_IMAGES 导出）

// A-b-1 P0-1：buildCompressed 透传真实实现，同时留出可断言的 spy 入口
const contextManagerMock = vi.hoisted(() => ({ buildCompressed: vi.fn() }));
vi.mock('@main/ai/contextManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/ai/contextManager')>();
  return {
    ...actual,
    buildCompressed: (...args: Parameters<typeof actual.buildCompressed>) => {
      contextManagerMock.buildCompressed(...args);
      return actual.buildCompressed(...args);
    },
  };
});

// A-b-3 P0-3：classifyIntent 接线 hasHistory（长度门上下文门控）
const intentRouterMock = vi.hoisted(() => ({ classifyIntent: vi.fn() }));
vi.mock('@main/ai/intentRouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/ai/intentRouter')>();
  return {
    ...actual,
    classifyIntent: (input: string, ctx?: { hasHistory?: boolean }) => {
      intentRouterMock.classifyIntent(input, ctx);
      return actual.classifyIntent(input, ctx);
    },
  };
});

vi.mock('@main/ai/llm/llmClient', () => ({
  streamChatCompletionWithRetry: vi.fn(),
}));
vi.mock('@main/ai/llm/anthropicClient', () => ({
  streamAnthropicCompletion: vi.fn(),
}));
vi.mock('@main/ai/knowledge/embeddingClient', () => ({
  createEmbedding: vi.fn(async () => ({ embeddings: [[0.1]] })),
}));
vi.mock('@main/ai/skills/skillLoader', () => ({
  loadSkills: vi.fn(() => []),
}));
vi.mock('@main/ai/tools/webSearch', () => ({
  resolveSearchConfig: vi.fn(() => null),
}));
vi.mock('@main/ai/agent/agentEventStore', () => ({
  persistAndSend: vi.fn(),
}));
// agentToolSelector 依赖 toolRegistry（24 工具全量链路）→ mock 最小工具集
vi.mock('@main/ai/toolRegistry', () => ({
  defineCoreTools: vi.fn(() => [
    { type: 'function', function: { name: 'searchDocument', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'ask_question_card', description: 'x', parameters: {} } },
  ]),
  buildToolListForPrompt: vi.fn((tools: unknown[]) => tools),
}));

import { prepareAgentContext } from '@main/ai/agent/agentContext';
import { buildCompressed } from '@main/ai/contextManager';
import { classifyIntent } from '@main/ai/intentRouter';
import { CHAT_SYSTEM_PROMPT } from '@main/ai/agent/agentPromptBuilder';
import type { IAIConfig, IAttachmentMeta } from '@shared/ai';
import type { AgentReqPayload } from '@main/ai/agent/agentLoop';

function makeConfig(over: Partial<IAIConfig> = {}): IAIConfig {
  return {
    backend: 'remote',
    remoteBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hasApiKey: true,
    ...over,
  };
}

function makeEvent(): Electron.IpcMainInvokeEvent {
  return { sender: { id: 1 } } as unknown as Electron.IpcMainInvokeEvent;
}

function makePayload(over: Partial<AgentReqPayload> = {}): AgentReqPayload {
  return {
    userId: 'u1',
    conversationId: 'c1',
    message: '你好，今天天气怎么样？',
    ...over,
  };
}

interface DepsLike {
  consent: { allowNetwork: boolean; allowSend: boolean; consentUpdatedAt: string | null };
  waitForInteraction?: unknown;
}

function runPrepare(payload: AgentReqPayload, deps: DepsLike, config = makeConfig()) {
  return prepareAgentContext(
    makeEvent(),
    payload,
    config,
    'enc:test-key',
    new AbortController(),
    deps as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbAiMock.getConversation.mockReset().mockReturnValue({
    id: 'c1',
    userId: 'u1',
    mode: 'agent',
    summary: '',
    createdAt: 'now',
    updatedAt: 'now',
  });
  dbAiMock.getMessagesByConversationPaginated.mockReset().mockReturnValue([]);
  dbKbMock.hasGrantedAttachmentDocs.mockReset().mockReturnValue(false);
});

describe('R3 — toolCtx.attachmentEgressAllowed 注入（allowSend ∨ 勾选授权）', () => {
  it('allowSend=true → 标志 true（外发闸放行）', () => {
    const ctx = runPrepare(makePayload(), {
      consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    });
    expect(ctx.toolCtx.attachmentEgressAllowed).toBe(true);
  });

  it('allowSend=false + 无勾选授权 → 标志 false（fail-closed）', () => {
    const ctx = runPrepare(makePayload(), {
      consent: { allowNetwork: false, allowSend: false, consentUpdatedAt: null },
    });
    expect(ctx.toolCtx.attachmentEgressAllowed).toBe(false);
    expect(dbKbMock.hasGrantedAttachmentDocs).toHaveBeenCalledWith('u1');
  });

  it('allowSend=false + 存在勾选授权附件 → 标志 true（勾选=显式授权）', () => {
    dbKbMock.hasGrantedAttachmentDocs.mockReturnValue(true);
    const ctx = runPrepare(makePayload(), {
      consent: { allowNetwork: false, allowSend: false, consentUpdatedAt: null },
    });
    expect(ctx.toolCtx.attachmentEgressAllowed).toBe(true);
  });

  it('会话边界上下文随 toolCtx 透传（currentConversationId）', () => {
    const ctx = runPrepare(makePayload({ conversationId: 'c9' }), {
      consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    });
    expect(ctx.toolCtx.currentConversationId).toBe('c9');
  });
});

// ---------------------------------------------------------------------------
// Bug A-1：附件清单（文件名 + 绝对路径 + attachment_id + 状态）注入 system 段
// 根因：渲染层正文只有 [文件: xxx] 占位符，att.path/attachment_id 从未进 prompt，
// LLM 调 readLocalFile 只能编造路径（诊断报告 A-1）。
// ---------------------------------------------------------------------------

describe('Bug A-1 — 附件清单注入 system prompt', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };

  function fileAtt(over: Partial<IAttachmentMeta> = {}): IAttachmentMeta {
    return {
      id: 'att-1',
      type: 'file',
      name: 'report.pdf',
      path: 'C:/docs/report.pdf',
      parseStatus: 'done',
      ...over,
    };
  }

  it('带文件附件 → system 段含文件名、绝对路径、附件 id、解析状态与工具指引', () => {
    const ctx = runPrepare(
      makePayload({
        message: '[文件: report.pdf]\n帮我看看',
        attachments: [
          fileAtt(),
          {
            id: 'att-2',
            type: 'image',
            name: 'shot.png',
            path: 'attachments/u1/c1/att-2.png',
            parseStatus: 'done',
          },
        ],
      }),
      ALLOW_ALL
    );
    const systemText = ctx.llmMessages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    // 文件：绝对路径 + id + 状态
    expect(systemText).toContain('report.pdf');
    expect(systemText).toContain('C:/docs/report.pdf');
    expect(systemText).toContain('att-1');
    expect(systemText).toContain('done');
    // 图片：id 引导（不给 readLocalFile 用的相对路径）
    expect(systemText).toContain('att-2');
    // 工具指引：searchDocument 优先 / readLocalFile 按路径读原始文件
    expect(systemText).toContain('searchDocument');
    expect(systemText).toContain('readLocalFile');
  });

  it('无附件 → 附件清单段不出现（零回归）', () => {
    const ctx = runPrepare(makePayload({ message: '写一篇关于 React 的文章' }), ALLOW_ALL);
    const systemText = ctx.llmMessages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    expect(systemText).not.toContain('本会话附件清单');
  });
});

// ---------------------------------------------------------------------------
// Bug A-2：chat 意图吃掉 CHAT_SYSTEM_PROMPT（「不要提及工具」）导致附件场景
// 工具/提问全被禁。裁定：附件消息有附件即走 Agent prompt（聊天闲聊不带附件）。
// ---------------------------------------------------------------------------

describe('Bug A-2 — 附件消息不受 chat 意图提示词禁令锁死', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };

  it('前置事实：附件消息被 classifyIntent 判为 chat（问题根因）', () => {
    expect(classifyIntent('[文件: a.pdf]\n帮我看看').intent).toBe('chat');
  });

  it('chat 意图 + 附件 → 用 Agent 提示（含 ask_question_card 铁律），非 CHAT_SYSTEM_PROMPT', () => {
    const ctx = runPrepare(
      makePayload({
        message: '[文件: a.pdf]\n帮我看看',
        attachments: [{ id: 'a1', type: 'file', name: 'a.pdf', path: 'C:/a.pdf', parseStatus: 'done' }],
      }),
      ALLOW_ALL
    );
    const first = ctx.llmMessages[0];
    expect(first.role).toBe('system');
    const text = typeof first.content === 'string' ? first.content : '';
    expect(classifyIntent('[文件: a.pdf]\n帮我看看').intent).toBe('chat'); // 同输入
    expect(text).toContain('ask_question_card');
    expect(text).not.toContain('不要提及工具、文件或文档');
    expect(text).not.toBe(CHAT_SYSTEM_PROMPT);
  });

  it('纯闲聊无附件 → 仍走 CHAT_SYSTEM_PROMPT（零回归）', () => {
    const ctx = runPrepare(makePayload({ message: '你好，今天天气怎么样？' }), ALLOW_ALL);
    expect(ctx.llmMessages[0].role).toBe('system');
    expect(ctx.llmMessages[0].content).toBe(CHAT_SYSTEM_PROMPT);
  });
});

// ---------------------------------------------------------------------------
// Bug B — vision 发送前最终判定链（visionOverride 覆盖 → 已知能力表 → 未知乐观）
// 注入侧：llmMessages 图片 part 有无 + VISION_DEGRADED_NOTICE；
// 上屏侧：降级时当前轮图片附件写入 parseStatus=error + error（IAttachmentMeta.error 通道）。
// ---------------------------------------------------------------------------

describe('Bug B — prepareAgentContext 注入/降级判定链', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };
  // 注入链 existsSync 走真实 fs：建真实临时图片文件（agentMedia 的 fs 链未被
  // vi.mock 覆盖，实测 mock 'fs' 不影响其模块实例 —— 用真文件更贴近生产）
  const tmpImage = join(tmpdir(), `weavemd-vision-${process.pid}.png`);
  const PNG_BYTES = Buffer.from('89504e470d0a1a0a', 'hex');
  let imageAtt: IAttachmentMeta;
  beforeAll(() => {
    writeFileSync(tmpImage, PNG_BYTES);
    imageAtt = {
      id: 'i1',
      type: 'image',
      name: 'shot.png',
      path: tmpImage,
      parseStatus: 'done',
    };
  });
  afterAll(() => {
    try {
      rmSync(tmpImage, { force: true });
    } catch {
      /* 清理失败不影响结果 */
    }
  });

  function userMessage(ctx: ReturnType<typeof runPrepare>) {
    const users = ctx.llmMessages.filter((m) => m.role === 'user');
    return users[users.length - 1];
  }

  function lastAppendedAttachments(): IAttachmentMeta[] | undefined {
    const calls = dbAiMock.appendMessage.mock.calls;
    const last = calls[calls.length - 1][0] as { attachments?: IAttachmentMeta[] };
    return last.attachments;
  }

  it('visionOverride=true + 已知非 vision 模型 → 注入 image_url part（覆盖优先）', () => {
    const ctx = runPrepare(
      makePayload({ message: '[图片: shot.png] 看看', attachments: [imageAtt] }),
      ALLOW_ALL,
      makeConfig({ model: 'deepseek-chat', visionOverride: true })
    );
    const user = userMessage(ctx);
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as Array<{ type: string }>;
    expect(parts.some((p) => p.type === 'image_url')).toBe(true);
    // 覆盖为真 → 不降级、附件不被标失败
    const atts = lastAppendedAttachments();
    expect(atts?.[0].parseStatus).toBe('done');
    expect(atts?.[0].error).toBeUndefined();
  });

  it('visionOverride=false + 已知 vision 模型 → 无 part + 降级提示 + 附件上屏失败态', () => {
    const ctx = runPrepare(
      makePayload({ message: '[图片: shot.png] 看看', attachments: [imageAtt] }),
      ALLOW_ALL,
      makeConfig({ model: 'claude-sonnet-4', visionOverride: false })
    );
    const user = userMessage(ctx);
    expect(typeof user.content).toBe('string');
    // LLM 可见降级提示
    const systemText = ctx.llmMessages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    expect(systemText).toContain('不支持图片理解');
    // 用户可见降级：attachments_json 图片失败态（IAttachmentMeta.error 上屏通道）
    const atts = lastAppendedAttachments();
    expect(atts?.[0].parseStatus).toBe('error');
    expect(atts?.[0].error).toContain('不支持图片理解');
  });

  it('未知模型无覆盖 → 乐观注入（不降级）', () => {
    const ctx = runPrepare(
      makePayload({ message: '[图片: shot.png] 看看', attachments: [imageAtt] }),
      ALLOW_ALL,
      makeConfig({ model: 'my-private-llm' })
    );
    const user = userMessage(ctx);
    expect(Array.isArray(user.content)).toBe(true);
    const atts = lastAppendedAttachments();
    expect(atts?.[0].parseStatus).toBe('done');
  });

  it('已知非 vision 模型无覆盖 → 降级 + 附件失败态上屏（既有保守行为保留）', () => {
    runPrepare(
      makePayload({ message: '[图片: shot.png] 看看', attachments: [imageAtt] }),
      ALLOW_ALL,
      makeConfig({ model: 'deepseek-chat' })
    );
    const atts = lastAppendedAttachments();
    expect(atts?.[0].parseStatus).toBe('error');
    expect(atts?.[0].error).toContain('不支持图片理解');
  });

  it('识别链已标过失败的附件保留原 error（不覆盖既有失败原因）', () => {
    runPrepare(
      makePayload({
        message: '[图片: shot.png] 看看',
        attachments: [{ ...imageAtt, parseStatus: 'error', error: '图片保存失败' }],
      }),
      ALLOW_ALL,
      makeConfig({ model: 'deepseek-chat' })
    );
    const atts = lastAppendedAttachments();
    expect(atts?.[0].error).toBe('图片保存失败');
  });
});

// ---------------------------------------------------------------------------
// A-b-1：历史读取上提 + P0-1 chat 取数统一 + :449 反上下文行改写
// ---------------------------------------------------------------------------

describe('A-b-1 — chat 历史取数统一与 :449 反上下文行', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };

  beforeEach(() => {
    contextManagerMock.buildCompressed.mockClear();
    dbAiMock.getConversation.mockReturnValue({
      id: 'c1',
      userId: 'u1',
      mode: 'agent',
      summary: '此前讨论了 WeaveMD 的导出能力与 MIME 映射',
      createdAt: 'now',
      updatedAt: 'now',
    });
    // 2 轮历史（user/assistant × 2），当前 user 消息由 prepareAgentContext 落库
    dbAiMock.getMessagesByConversationPaginated.mockReturnValue([
      { role: 'user', content: '上一轮问题一' },
      { role: 'assistant', content: '上一轮回答一' },
      { role: 'user', content: '上一轮问题二' },
      { role: 'assistant', content: '上一轮回答二' },
    ]);
  });

  it('P0-1：chat 意图下 buildCompressed 收到 history.length > 1 且 summary 非空', () => {
    const ctx = runPrepare(makePayload(), ALLOW_ALL);
    expect(ctx.intent.intent).toBe('chat');
    expect(contextManagerMock.buildCompressed).toHaveBeenCalledTimes(1);
    const args = contextManagerMock.buildCompressed.mock.calls[0] as Parameters<typeof buildCompressed>;
    const historyArg = args[0];
    expect(historyArg.length).toBeGreaterThan(1);
    expect(historyArg.filter((m) => m.role === 'user').length).toBeGreaterThan(1);
    expect(String(args[1])).toContain('导出能力');
    // 端到端：历史确实进了发给 LLM 的消息序列
    const flat = ctx.llmMessages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    expect(flat).toContain('上一轮问题一');
    expect(flat).toContain('上一轮回答二');
  });

  it('历史读取发生在 classifyIntent / appendMessage 之前（读取上提）', () => {
    runPrepare(makePayload(), ALLOW_ALL);
    const readOrder = dbAiMock.getMessagesByConversationPaginated.mock.invocationCallOrder[0];
    const appendOrder = dbAiMock.appendMessage.mock.invocationCallOrder[0];
    expect(readOrder).toBeLessThan(appendOrder);
  });

  it(':449 反上下文行改写：不含「忽略之前的所有对话」，保留 :444 分隔行', () => {
    const ctx = runPrepare(makePayload(), ALLOW_ALL);
    const separator = ctx.llmMessages.filter(
      (m) => m.role === 'system' && m.content === '=== 当前用户问题（必须回答此问题）==='
    );
    expect(separator).toHaveLength(1);

    const anchor = ctx.llmMessages.filter(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.startsWith('【重要】')
    );
    expect(anchor).toHaveLength(1);
    const text = String(anchor[0].content);
    expect(text).not.toContain('忽略之前的所有对话');
    expect(text).not.toContain('全新的独立问题');
    expect(text).toContain('历史与摘要仅用于理解当前问题中的指代与上下文');
    expect(text).toContain('只回答');
  });

  it('非 chat 意图仍走同一取数与压缩路径（零回归）', () => {
    const ctx = runPrepare(makePayload({ message: '请帮我写一篇关于 SQLite 的技术文章' }), ALLOW_ALL);
    expect(ctx.intent.intent).not.toBe('chat');
    expect(contextManagerMock.buildCompressed).toHaveBeenCalledTimes(1);
    const args = contextManagerMock.buildCompressed.mock.calls[0] as Parameters<typeof buildCompressed>;
    expect(args[0].length).toBeGreaterThan(1);
    expect(String(args[1])).toContain('导出能力');
  });
});

// ---------------------------------------------------------------------------
// A-b-3：classifyIntent(message, { hasHistory }) 接线（P0-3）
// hasHistory 基于上提后的原始读取行（含 assistant 行），不基于 cleanup 之后的数组。
// ---------------------------------------------------------------------------

describe('A-b-3 — classifyIntent 接线 { hasHistory }', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };
  // 零关键词命中 → 走 chat 兜底分支，长度门在 hasHistory 下失效
  const SHORT_QUERY = '它有什么优势';

  beforeEach(() => {
    intentRouterMock.classifyIntent.mockClear();
  });

  it('会话含历史 assistant 行 → 以 { hasHistory:true } 调用，长度不触发澄清', () => {
    dbAiMock.getMessagesByConversationPaginated.mockReturnValue([
      { role: 'user', content: '上一轮问题' },
      { role: 'assistant', content: '上一轮回答' },
    ]);
    const ctx = runPrepare(makePayload({ message: SHORT_QUERY }), ALLOW_ALL);
    expect(intentRouterMock.classifyIntent).toHaveBeenCalledTimes(1);
    expect(intentRouterMock.classifyIntent).toHaveBeenCalledWith(SHORT_QUERY, { hasHistory: true });
    // 端到端：needsClarification 未因字数置位 → 仍走 CHAT_SYSTEM_PROMPT
    expect(ctx.intent.needsClarification).not.toBe(true);
    expect(ctx.llmMessages[0].content).toBe(CHAT_SYSTEM_PROMPT);
  });

  it('仅 user 孤立历史行（无 assistant）→ { hasHistory:false }，长度门照旧', () => {
    dbAiMock.getMessagesByConversationPaginated.mockReturnValue([
      { role: 'user', content: '上一轮问题' },
    ]);
    const ctx = runPrepare(makePayload({ message: SHORT_QUERY }), ALLOW_ALL);
    expect(intentRouterMock.classifyIntent).toHaveBeenCalledWith(SHORT_QUERY, { hasHistory: false });
    expect(ctx.intent.needsClarification).toBe(true);
    expect(ctx.llmMessages[0].content).not.toBe(CHAT_SYSTEM_PROMPT);
  });

  it('空会话首轮 → { hasHistory:false }，行为与现状一致（澄清置位 → Agent 提示）', () => {
    dbAiMock.getMessagesByConversationPaginated.mockReturnValue([]);
    const ctx = runPrepare(makePayload({ message: SHORT_QUERY }), ALLOW_ALL);
    expect(intentRouterMock.classifyIntent).toHaveBeenCalledWith(SHORT_QUERY, { hasHistory: false });
    expect(ctx.intent.intent).toBe('chat');
    expect(ctx.intent.needsClarification).toBe(true);
    expect(ctx.llmMessages[0].content).not.toBe(CHAT_SYSTEM_PROMPT);
    expect(String(ctx.llmMessages[0].content)).toContain('ask_question_card');
  });

  it('有历史时闲聊意图零回归：正常长度消息仍走 CHAT_SYSTEM_PROMPT', () => {
    dbAiMock.getMessagesByConversationPaginated.mockReturnValue([
      { role: 'assistant', content: '上一轮回答' },
    ]);
    const ctx = runPrepare(makePayload({ message: '你好，今天天气怎么样？' }), ALLOW_ALL);
    expect(intentRouterMock.classifyIntent).toHaveBeenCalledWith('你好，今天天气怎么样？', {
      hasHistory: true,
    });
    expect(ctx.llmMessages[0].content).toBe(CHAT_SYSTEM_PROMPT);
  });
});

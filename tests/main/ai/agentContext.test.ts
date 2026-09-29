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
// B-c / P0-5：历史读取改走 getRecentMessagesByRounds（按轮 + 软字节闸）
const dbAiMock = vi.hoisted(() => ({
  appendMessage: vi.fn((m: Record<string, unknown>) => ({ id: 'm1', ...m })),
  getConversation: vi.fn(),
  getRecentMessagesByRounds: vi.fn((): unknown[] => []),
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

import {
  prepareAgentContext,
  repairToolTurnPairing,
  MISSING_TOOL_RESULT_PLACEHOLDER,
} from '@main/ai/agent/agentContext';
import { buildCompressed } from '@main/ai/contextManager';
import type { LlmMessage } from '@main/ai/contextManager';
import type { AgentLlmMessage } from '@main/ai/agent/agentLoop';
import { classifyIntent } from '@main/ai/intentRouter';
import { CHAT_SYSTEM_PROMPT } from '@main/ai/agent/agentPromptBuilder';
import type { IAIConfig, IAttachmentMeta, IAIMessage, IAgentToolCall } from '@shared/ai';
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
  dbAiMock.getRecentMessagesByRounds.mockReset().mockReturnValue([]);
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
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
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
    const readOrder = dbAiMock.getRecentMessagesByRounds.mock.invocationCallOrder[0];
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
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
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
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      { role: 'user', content: '上一轮问题' },
    ]);
    const ctx = runPrepare(makePayload({ message: SHORT_QUERY }), ALLOW_ALL);
    expect(intentRouterMock.classifyIntent).toHaveBeenCalledWith(SHORT_QUERY, { hasHistory: false });
    expect(ctx.intent.needsClarification).toBe(true);
    expect(ctx.llmMessages[0].content).not.toBe(CHAT_SYSTEM_PROMPT);
  });

  it('空会话首轮 → { hasHistory:false }，行为与现状一致（澄清置位 → Agent 提示）', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([]);
    const ctx = runPrepare(makePayload({ message: SHORT_QUERY }), ALLOW_ALL);
    expect(intentRouterMock.classifyIntent).toHaveBeenCalledWith(SHORT_QUERY, { hasHistory: false });
    expect(ctx.intent.intent).toBe('chat');
    expect(ctx.intent.needsClarification).toBe(true);
    expect(ctx.llmMessages[0].content).not.toBe(CHAT_SYSTEM_PROMPT);
    expect(String(ctx.llmMessages[0].content)).toContain('ask_question_card');
  });

  it('有历史时闲聊意图零回归：正常长度消息仍走 CHAT_SYSTEM_PROMPT', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      { role: 'assistant', content: '上一轮回答' },
    ]);
    const ctx = runPrepare(makePayload({ message: '你好，今天天气怎么样？' }), ALLOW_ALL);
    expect(intentRouterMock.classifyIntent).toHaveBeenCalledWith('你好，今天天气怎么样？', {
      hasHistory: true,
    });
    expect(ctx.llmMessages[0].content).toBe(CHAT_SYSTEM_PROMPT);
  });
});

// ---------------------------------------------------------------------------
// B-b-fix：运行维度盐（工具轮确定性 id 的 runId 维度）
// ---------------------------------------------------------------------------

describe('B-b-fix — runId 运行维度盐', () => {
  const DEPS = { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } };

  it('每次 prepareAgentContext 生成唯一 runId（同一会话二次运行不撞 id）', () => {
    const first = runPrepare(makePayload(), DEPS);
    const second = runPrepare(makePayload(), DEPS);
    expect(typeof first.runId).toBe('string');
    expect(first.runId.length).toBeGreaterThan(0);
    expect(second.runId).not.toBe(first.runId);
  });
});

// ---------------------------------------------------------------------------
// B-c：P0-5 按轮读取 + P0-4 回读 tool_calls / 空 content 放行 + P0-6 toolCtx.history
// ---------------------------------------------------------------------------

/** DB 行夹具（`getRecentMessagesByRounds` 返回的 IAIMessage 形状）。 */
function dbRow(
  id: string,
  role: IAIMessage['role'],
  content: string,
  over: Partial<IAIMessage> = {}
): IAIMessage {
  return {
    id,
    conversationId: 'c1',
    userId: 'u1',
    role,
    content,
    refsJson: null,
    createdAt: `2026-09-29T00:00:00.${id}`,
    ...over,
  };
}

const TOOL_CALL_FIXTURE: IAgentToolCall = {
  toolCallId: 'call_0_0',
  name: 'searchKB',
  args: '{"query":"SQLite 优势"}',
  status: 'ok',
};

/** 一个完整工具轮：user → assistant(tool_calls) → tool → assistant 正文。 */
function toolRoundRows(): IAIMessage[] {
  return [
    dbRow('u1', 'user', '帮我查一下 SQLite 的优势'),
    dbRow('a1', 'assistant', '', { toolCalls: [TOOL_CALL_FIXTURE] }),
    dbRow('t1', 'tool', 'SQLite 优势：零配置、单文件、嵌入式', {
      toolCallId: TOOL_CALL_FIXTURE.toolCallId,
    }),
    dbRow('a2', 'assistant', 'SQLite 的优势包括零配置与嵌入式部署。'),
  ];
}

/** buildCompressed 收到的入参（压缩前的完整历史，含当前 user 消息）。 */
function preCompressedHistory(): LlmMessage[] {
  const calls = contextManagerMock.buildCompressed.mock.calls;
  return calls[calls.length - 1][0] as LlmMessage[];
}

describe('B-c P0-5 — 上下文按轮读取（getRecentMessagesByRounds）', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };

  it('以 KEEP_RECENT_ROUNDS(3) 轮 + 45_000 字节预算读取（轮数与预算均为具名常量）', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue(toolRoundRows());
    runPrepare(makePayload(), ALLOW_ALL);
    expect(dbAiMock.getRecentMessagesByRounds).toHaveBeenCalledTimes(1);
    expect(dbAiMock.getRecentMessagesByRounds).toHaveBeenCalledWith('c1', 'u1', 3, {
      byteBudget: 45_000,
    });
  });

  it('单轮 25 条工具结果完整取回（行数上限已取消，P0-5 验收）', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `call_0_${i}`);
    const toolCalls: IAgentToolCall[] = ids.map((id) => ({
      toolCallId: id,
      name: 'searchDocument',
      args: `{"query":"q${id}"}`,
      status: 'ok',
    }));
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      dbRow('u1', 'user', '把这批文档全读一遍'),
      dbRow('a1', 'assistant', '', { toolCalls }),
      ...ids.map((id, i) =>
        dbRow(`t${i}`, 'tool', `结果 ${i}`, { toolCallId: id })
      ),
      dbRow('a2', 'assistant', '已读完。'),
    ]);
    const ctx = runPrepare(makePayload(), ALLOW_ALL);
    expect(preCompressedHistory().filter((m) => m.role === 'tool')).toHaveLength(25);
    expect(ctx.llmMessages.filter((m) => m.role === 'tool')).toHaveLength(25);
  });

  it('跨 3 轮的 user/assistant 全部取回（轮次不减少）', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      dbRow('u1', 'user', '第一轮问题'),
      dbRow('a1', 'assistant', '第一轮回答'),
      dbRow('u2', 'user', '第二轮问题'),
      dbRow('a2', 'assistant', '第二轮回答'),
      dbRow('u3', 'user', '第三轮问题'),
      dbRow('a3', 'assistant', '第三轮回答'),
    ]);
    const ctx = runPrepare(makePayload(), ALLOW_ALL);
    const history = preCompressedHistory();
    const texts = history
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('|');
    // 3 轮历史 + 当前 user 消息 = 4 条 user
    expect(history.filter((m) => m.role === 'user')).toHaveLength(4);
    for (const t of ['第一轮问题', '第二轮问题', '第三轮问题', '第一轮回答', '第三轮回答']) {
      expect(texts).toContain(t);
    }
  });
});

describe('B-c P0-4 — 回读携带 tool_calls + 空 content 行放行', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };

  function assistantToolCalls(ctx: ReturnType<typeof runPrepare>) {
    return ctx.llmMessages.filter(
      (m) => m.role === 'assistant' && !!m.tool_calls && m.tool_calls.length > 0
    );
  }

  it('chat 意图：回读 assistant 行携带 tool_calls（OpenAI 形状，与 assembleToolTurn 对齐）', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue(toolRoundRows());
    const ctx = runPrepare(makePayload(), ALLOW_ALL);
    expect(ctx.intent.intent).toBe('chat');
    const withCalls = assistantToolCalls(ctx);
    expect(withCalls).toHaveLength(1);
    expect(withCalls[0].tool_calls).toEqual([
      {
        id: 'call_0_0',
        type: 'function',
        function: { name: 'searchKB', arguments: '{"query":"SQLite 优势"}' },
      },
    ]);
    // 配对 tool 行保留且 tool_call_id 一致
    const toolRows = ctx.llmMessages.filter((m) => m.role === 'tool');
    expect(toolRows).toHaveLength(1);
    expect(toolRows[0].tool_call_id).toBe('call_0_0');
  });

  it('非 chat 意图同样携带 tool_calls（P0-4 与意图无关）', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue(toolRoundRows());
    const ctx = runPrepare(
      makePayload({ message: '请帮我写一篇关于 SQLite 的技术文章' }),
      ALLOW_ALL
    );
    expect(ctx.intent.intent).not.toBe('chat');
    expect(assistantToolCalls(ctx)).toHaveLength(1);
    expect(assistantToolCalls(ctx)[0].tool_calls?.[0].function.name).toBe('searchKB');
  });

  it("content:'' 的 assistant(tool_calls) 行不被滤掉（否则该轮整体丢失）", () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue(toolRoundRows());
    const ctx = runPrepare(makePayload(), ALLOW_ALL);
    const emptyContentCalls = ctx.llmMessages.filter(
      (m) => m.role === 'assistant' && !!m.tool_calls && m.content === ''
    );
    expect(emptyContentCalls).toHaveLength(1);
  });

  it('纯空白噪音行仍被滤掉（无 tool_calls/tool_call_id 且内容全空白）', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      dbRow('u1', 'user', '上一轮问题'),
      dbRow('a0', 'assistant', '   '),
      dbRow('t0', 'tool', '\n\t  '),
      dbRow('a1', 'assistant', '上一轮回答'),
    ]);
    const ctx = runPrepare(makePayload(), ALLOW_ALL);
    const texts = ctx.llmMessages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('|');
    // 纯空白行（无 tool_calls/tool_call_id）仍被滤掉
    expect(ctx.llmMessages.some((m) => m.content === '   ')).toBe(false);
    expect(ctx.llmMessages.some((m) => m.content === '\n\t  ')).toBe(false);
    expect(ctx.llmMessages.some((m) => m.content === '上一轮回答')).toBe(true);
    expect(texts).toContain('上一轮问题');
  });
});

describe('B-c P0-6 — toolCtx.history 注入（零额外 DB 读）', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };

  it('注入 history：仅 user/assistant 角色、含当前问题、全文与 LLM 一致', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue(toolRoundRows());
    const ctx = runPrepare(makePayload(), ALLOW_ALL);
    expect(dbAiMock.getRecentMessagesByRounds).toHaveBeenCalledTimes(1); // Q10 零额外 DB 读
    const history = ctx.toolCtx.history;
    expect(history).toBeDefined();
    expect(history!.length).toBeGreaterThan(0);
    expect(history!.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
    const roles: string[] = history!.map((m) => m.role);
    expect(roles.some((r) => r === 'tool' || r === 'system')).toBe(false);
    const texts = history!.map((m) => m.content).join('|');
    expect(texts).toContain('帮我查一下 SQLite 的优势');
    expect(texts).toContain('SQLite 的优势包括零配置与嵌入式部署。');
    // 当前问题也在内（与 LLM 看到的上下文一致）
    expect(texts).toContain('你好，今天天气怎么样？');
    // 配对修复之后：占位 tool 行被角色过滤挡在 history 之外
    expect(history!.some((m) => m.content.includes('工具结果缺失'))).toBe(false);
  });

  it('带图片的历史行 content 经 contentToText 还原为文本（[图片] 占位）', () => {
    const tmpImage = join(tmpdir(), `weavemd-bc-history-${process.pid}.png`);
    writeFileSync(tmpImage, Buffer.from('89504e470d0a1a0a', 'hex'));
    try {
      dbAiMock.getRecentMessagesByRounds.mockReturnValue([
        dbRow('u1', 'user', '看这张图', {
          attachments: [
            { id: 'i1', type: 'image', name: 'shot.png', path: tmpImage } as IAttachmentMeta,
          ],
        }),
        dbRow('a1', 'assistant', '这是一张截图。'),
      ]);
      const ctx = runPrepare(makePayload(), ALLOW_ALL, makeConfig({ model: 'claude-sonnet-4' }));
      const imgRow = ctx.toolCtx.history!.find((m) => m.content.includes('看这张图'));
      expect(imgRow).toBeDefined();
      expect(imgRow!.content).toContain('[图片]');
      expect(typeof imgRow!.content).toBe('string');
    } finally {
      rmSync(tmpImage, { force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B-c P0-4：repairToolTurnPairing —— 三条规则（纯内存、永不写库、不复用 cleanup）
// ---------------------------------------------------------------------------

describe('B-c P0-4 — repairToolTurnPairing 配对修复', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };
  const CALL_A = {
    id: 'call_0_0',
    type: 'function' as const,
    function: { name: 'searchKB', arguments: '{"query":"SQLite"}' },
  };
  const CALL_B = {
    id: 'call_0_1',
    type: 'function' as const,
    function: { name: 'readLocalFile', arguments: '{"path":"a.md"}' },
  };

  it('规则 1：assistant 有 tool_calls 缺配对 tool 行 → 合成占位 tool 行（锁文案），不剥 tool_calls', () => {
    const out = repairToolTurnPairing([
      { role: 'user', content: '查一下' },
      { role: 'assistant', content: '', tool_calls: [CALL_A] },
      { role: 'assistant', content: '正文回答' },
    ] as AgentLlmMessage[]);
    expect(out).toHaveLength(4);
    const placeholder = out[2];
    expect(placeholder.role).toBe('tool');
    expect(placeholder.tool_call_id).toBe('call_0_0');
    // 文案逐字锁定（plan §5 / 风险 6）
    expect(placeholder.content).toBe('[工具结果缺失：会话在该工具完成前中断，结果不可恢复]');
    expect(placeholder.content).toBe(MISSING_TOOL_RESULT_PLACEHOLDER);
    // 不剥 tool_calls：该轮不因缺结果整体丢失
    expect(out[1].tool_calls).toEqual([CALL_A]);
  });

  it('规则 2：孤儿 tool 行（前置无该 tool_call_id 的 assistant.tool_calls）→ 丢弃', () => {
    const out = repairToolTurnPairing([
      { role: 'user', content: '查一下' },
      { role: 'tool', tool_call_id: 'call_ghost', content: '孤儿结果' },
      { role: 'assistant', content: '正文回答' },
    ] as AgentLlmMessage[]);
    expect(out.some((m) => m.role === 'tool')).toBe(false);
    expect(out).toHaveLength(2);
  });

  it('规则 3：老数据纯文本 assistant 行（无 tool_calls）→ 原样保留', () => {
    const input = [
      { role: 'user', content: '老问题' },
      { role: 'assistant', content: '老回答' },
    ] as AgentLlmMessage[];
    const out = repairToolTurnPairing(input);
    expect(out).toEqual(input);
    expect(out[1].tool_calls).toBeUndefined();
  });

  it('双向：完整配对不改动（含既有 tool 内容），输入数组不被原地改写', () => {
    const input = [
      { role: 'user', content: '查一下' },
      { role: 'assistant', content: '', tool_calls: [CALL_A] },
      { role: 'tool', tool_call_id: 'call_0_0', content: '真实结果' },
      { role: 'assistant', content: '正文回答' },
    ] as AgentLlmMessage[];
    const snapshot = JSON.parse(JSON.stringify(input)) as AgentLlmMessage[];
    const out = repairToolTurnPairing(input);
    expect(out).toEqual(snapshot);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
    expect(out[2].content).toBe('真实结果');
  });

  it('双向：多 tool 单轮只补缺失的那一条（部分配对）', () => {
    const out = repairToolTurnPairing([
      { role: 'user', content: '查两个' },
      { role: 'assistant', content: '', tool_calls: [CALL_A, CALL_B] },
      { role: 'tool', tool_call_id: 'call_0_1', content: 'B 的结果' },
      { role: 'assistant', content: '正文回答' },
    ] as AgentLlmMessage[]);
    const tools = out.filter((m) => m.role === 'tool');
    expect(tools).toHaveLength(2);
    expect(tools.find((t) => t.tool_call_id === 'call_0_0')?.content).toBe(
      '[工具结果缺失：会话在该工具完成前中断，结果不可恢复]'
    );
    expect(tools.find((t) => t.tool_call_id === 'call_0_1')?.content).toBe('B 的结果');
  });

  it('接线：孤儿 tool 行不进 LLM 上下文；缺配对的轮补出占位 tool 行', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      dbRow('u1', 'user', '查一下 SQLite'),
      dbRow('o1', 'tool', '孤儿结果', { toolCallId: 'call_ghost' }),
      dbRow('a1', 'assistant', '', { toolCalls: [TOOL_CALL_FIXTURE] }),
      dbRow('a2', 'assistant', '正文回答'),
    ]);
    const ctx = runPrepare(makePayload(), ALLOW_ALL);
    expect(
      ctx.llmMessages.some((m) => m.role === 'tool' && m.tool_call_id === 'call_ghost')
    ).toBe(false);
    const placeholder = ctx.llmMessages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_0_0'
    );
    expect(placeholder?.content).toBe(
      '[工具结果缺失：会话在该工具完成前中断，结果不可恢复]'
    );
    // assistant(tool_calls) 仍在（该轮未丢失）
    expect(
      ctx.llmMessages.some((m) => m.role === 'assistant' && !!m.tool_calls)
    ).toBe(true);
  });
});

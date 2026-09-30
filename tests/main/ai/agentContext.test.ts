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
// A1：全局 Agent 文件（soul/memory/style）读取注入（内容可控）
const globalAgentFilesMock = vi.hoisted(() => ({
  getGlobalAgentFiles: vi.fn(),
}));
vi.mock('@main/ai/files/globalAgentFiles', () => globalAgentFilesMock);

// B4：画像层读取（kind='profile' 且 active 的 DAO 视图，db 首参注入）
const agentMemoryMock = vi.hoisted(() => ({
  getActiveProfile: vi.fn((): unknown[] => []),
}));
vi.mock('@main/db/agentMemory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@main/db/agentMemory')>()),
  getActiveProfile: agentMemoryMock.getActiveProfile,
}));

/** 全局 Agent 文件夹具（mock 默认返回值，断言与注入内容同源）。 */
const GLOBAL_FILES_FIXTURE = {
  soul: 'SOUL_E2E_保持直接冷静',
  memory: 'MEMORY_E2E_用户偏好与已确认决策',
  style: 'STYLE_E2E_写作风格保留事实',
};
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
  buildGlobalAgentFilesBlock,
  buildProfileBlock,
  buildExperienceBlock,
} from '@main/ai/agent/agentContext';
import type { AgentMemoryRow } from '@main/db/agentMemory';
import { buildCompressed, estimateTokens } from '@main/ai/contextManager';
import type { LlmMessage } from '@main/ai/contextManager';
import type { AgentLlmMessage } from '@main/ai/agent/agentLoop';
import { classifyIntent } from '@main/ai/intentRouter';
import {
  CHAT_SYSTEM_PROMPT,
  EXPERIENCE_TOKEN_LIMIT,
  PROFILE_TOKEN_LIMIT,
  buildChatSystemPrompt,
  buildAgentSystemPrompt,
} from '@main/ai/agent/agentPromptBuilder';
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
  /** B4：画像层读取的 db 来源（生产由后台 worker 注入 deps.db）。 */
  db?: unknown;
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
  // A1：全局文件默认返回夹具（mockReset 顺带清掉用例残留的 mockImplementationOnce）
  globalAgentFilesMock.getGlobalAgentFiles.mockReset().mockReturnValue(GLOBAL_FILES_FIXTURE);
  // B4：画像默认为空（未配置画像 → 注入空串，与 A1 未配置文件同口径）
  agentMemoryMock.getActiveProfile.mockReset().mockReturnValue([]);
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

  it('纯闲聊无附件 → 仍走 chat 提示（基线正文逐字保留 + 全局文件块）', () => {
    const ctx = runPrepare(makePayload({ message: '你好，今天天气怎么样？' }), ALLOW_ALL);
    expect(ctx.llmMessages[0].role).toBe('system');
    // 内容 = 基线 CHAT 正文 + 三文件块（引用方式变更，字符串基线未改）
    expect(ctx.llmMessages[0].content).toBe(
      buildChatSystemPrompt(buildGlobalAgentFilesBlock(GLOBAL_FILES_FIXTURE))
    );
    expect(String(ctx.llmMessages[0].content)).toContain('不要提及工具、文件或文档');
    expect(String(ctx.llmMessages[0].content)).toContain(GLOBAL_FILES_FIXTURE.memory);
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
    // 端到端：needsClarification 未因字数置位 → 仍走 chat 提示（非 Agent 提示）
    expect(ctx.intent.needsClarification).not.toBe(true);
    expect(ctx.llmMessages[0].content).toBe(
      buildChatSystemPrompt(buildGlobalAgentFilesBlock(GLOBAL_FILES_FIXTURE))
    );
    expect(ctx.llmMessages[0].content).not.toContain('ask_question_card');
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
    expect(ctx.llmMessages[0].content).toBe(
      buildChatSystemPrompt(buildGlobalAgentFilesBlock(GLOBAL_FILES_FIXTURE))
    );
    // 非 chat 提示（Agent 提示特有段落不出现）
    expect(ctx.llmMessages[0].content).not.toContain('## 工作流');
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

// ---------------------------------------------------------------------------
// A1 — soul/memory/style 三文件注入 system prompt（Q2 同批 / Q3 落点 / Q4 上限）
// ---------------------------------------------------------------------------

describe('A1 — 全局 Agent 文件注入 system prompt', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };
  const AGENT_MSG = '请帮我写一篇关于 SQLite 的技术文章';
  const CHAT_MSG = '你好，今天天气怎么样？';

  it('三文件内容进首条 system 消息，且位于【核心规则】之后、## 工作流 之前', () => {
    const ctx = runPrepare(makePayload({ message: AGENT_MSG }), ALLOW_ALL);
    expect(ctx.intent.intent).not.toBe('chat');
    const text = String(ctx.llmMessages[0].content);
    const idxCore = text.indexOf('【核心规则】');
    const idxWorkflow = text.indexOf('## 工作流');
    expect(idxCore).toBeGreaterThan(-1);
    expect(idxWorkflow).toBeGreaterThan(idxCore);
    for (const marker of [GLOBAL_FILES_FIXTURE.soul, GLOBAL_FILES_FIXTURE.memory, GLOBAL_FILES_FIXTURE.style]) {
      expect(text).toContain(marker);
      expect(text.indexOf(marker)).toBeGreaterThan(idxCore);
      expect(text.indexOf(marker)).toBeLessThan(idxWorkflow);
    }
    expect(text).toContain('【全局 Agent 文件】');
    expect(globalAgentFilesMock.getGlobalAgentFiles).toHaveBeenCalledTimes(1);
  });

  it('chat 意图（无附件、无澄清）→ 同样读三文件并注入，且位于【核心规则】与【注意力锚点】之间', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      { role: 'assistant', content: '上一轮回答' },
    ]);
    const ctx = runPrepare(makePayload({ message: CHAT_MSG }), ALLOW_ALL);
    expect(ctx.intent.intent).toBe('chat');
    expect(ctx.llmMessages[0].content).toBe(
      buildChatSystemPrompt(buildGlobalAgentFilesBlock(GLOBAL_FILES_FIXTURE))
    );
    const text = String(ctx.llmMessages[0].content);
    const idxCore = text.indexOf('【核心规则】');
    const idxSoul = text.indexOf(GLOBAL_FILES_FIXTURE.soul);
    const idxAnchor = text.indexOf('【注意力锚点】');
    expect(idxSoul).toBeGreaterThan(idxCore);
    expect(idxAnchor).toBeGreaterThan(idxSoul);
    // 锚点仍在最后一行
    expect(text.endsWith('那是你必须回答的问题。')).toBe(true);
    expect(globalAgentFilesMock.getGlobalAgentFiles).toHaveBeenCalledTimes(1);
  });

  it('chat 意图三段全空 → 输出逐字等于 CHAT_SYSTEM_PROMPT 基线（sha256）', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      { role: 'assistant', content: '上一轮回答' },
    ]);
    globalAgentFilesMock.getGlobalAgentFiles.mockReturnValue({
      soul: '  ',
      memory: '',
      style: '\n',
    });
    const ctx = runPrepare(makePayload({ message: CHAT_MSG }), ALLOW_ALL);
    expect(ctx.llmMessages[0].content).toBe(CHAT_SYSTEM_PROMPT);
    expect(ctx.llmMessages[0].content).toBe(buildChatSystemPrompt());
  });

  it('chat 分支读取抛错 → 主流程不中断、降级为 CHAT_SYSTEM_PROMPT 基线', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      { role: 'assistant', content: '上一轮回答' },
    ]);
    globalAgentFilesMock.getGlobalAgentFiles.mockImplementationOnce(() => {
      throw new Error('EIO: 全局文件读取失败');
    });
    const ctx = runPrepare(makePayload({ message: CHAT_MSG }), ALLOW_ALL);
    expect(ctx.intent.intent).toBe('chat');
    expect(ctx.llmMessages[0].content).toBe(CHAT_SYSTEM_PROMPT);
    expect(String(ctx.llmMessages[0].content)).not.toContain('【全局 Agent 文件】');
  });

  it('三段全空/全空白 → 不注入块，也不留下多余空行', () => {
    globalAgentFilesMock.getGlobalAgentFiles.mockReturnValue({
      soul: '  ',
      memory: '',
      style: '\n\t',
    });
    const ctx = runPrepare(makePayload({ message: AGENT_MSG }), ALLOW_ALL);
    const text = String(ctx.llmMessages[0].content);
    expect(text).not.toContain('【全局 Agent 文件】');
    // 核心规则与工作流之间不因注入失败多出空行（与改动前逐字一致）
    expect(text).toContain(
      '4. 当看到 "=== 当前用户问题 ===" 标记时，那是你必须回答的问题\n## 工作流'
    );
    expect(text).not.toContain('问题\n\n## 工作流');
  });

  it('读取抛错 → 主流程不中断、不注入块', () => {
    globalAgentFilesMock.getGlobalAgentFiles.mockImplementationOnce(() => {
      throw new Error('EIO: 全局文件读取失败');
    });
    const ctx = runPrepare(makePayload({ message: AGENT_MSG }), ALLOW_ALL);
    const text = String(ctx.llmMessages[0].content);
    expect(ctx.intent.intent).not.toBe('chat');
    expect(text).toContain('【核心规则】');
    expect(text).not.toContain('【全局 Agent 文件】');
  });

  it('buildGlobalAgentFilesBlock：三段拼装带文件名小节头', () => {
    const block = buildGlobalAgentFilesBlock(GLOBAL_FILES_FIXTURE);
    expect(block).toContain('【全局 Agent 文件】');
    expect(block).toContain('soul.md');
    expect(block).toContain('memory.md');
    expect(block).toContain('style.md');
    expect(block).toContain(GLOBAL_FILES_FIXTURE.memory);
    expect(block.indexOf('soul.md')).toBeLessThan(block.indexOf('memory.md'));
    expect(block.indexOf('memory.md')).toBeLessThan(block.indexOf('style.md'));
  });

  it('buildGlobalAgentFilesBlock：全空返回空串（调用方 filter(Boolean) 零注入）', () => {
    expect(buildGlobalAgentFilesBlock({ soul: '', memory: '', style: '' })).toBe('');
    expect(buildGlobalAgentFilesBlock({ soul: '   ', memory: '\n', style: '' })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// B4 — 分层 Prompt：画像层（agent-memory-optimize-2 req §二 B4 / 裁定 1~4）
// 画像 = B1 视图 getActiveProfile 读出的当前有效画像；
// 未就绪（无 db / 表缺失 / 查询抛错 / 画像为空）一律降级空串，不留占位噪音。
// ---------------------------------------------------------------------------

/** 画像行夹具（AgentMemoryRow，camelCase 字段）。 */
function profileRow(
  id: number,
  subject: string,
  content: string,
  writtenAt: string
): AgentMemoryRow {
  return {
    id,
    userId: 'u1',
    kind: 'profile',
    subject,
    content,
    source: 'auto',
    conversationId: null,
    fingerprint: `fp-${id}`,
    validFrom: '2026-09-01 00:00:00',
    validTo: null,
    writtenAt,
  };
}

describe('B4 — buildProfileBlock（画像 → 注入块）', () => {
  it('空数组 → 空串（连小节标题都不留）', () => {
    expect(buildProfileBlock([])).toBe('');
  });

  it('以稳定小节标题开头，每条含 subject 与 content', () => {
    const block = buildProfileBlock([
      profileRow(1, '职业', '后端工程师', '2026-09-01 00:00:00'),
      profileRow(2, '常用技术栈', 'TypeScript / SQLite', '2026-09-02 00:00:00'),
    ]);
    expect(block.startsWith('【用户画像】')).toBe(true);
    expect(block).toContain('职业');
    expect(block).toContain('后端工程师');
    expect(block).toContain('常用技术栈');
    expect(block).toContain('TypeScript / SQLite');
  });

  it('按 writtenAt 新者优先排序（旧条目不挤掉新条目）', () => {
    const block = buildProfileBlock([
      profileRow(1, '旧主题', '旧内容', '2026-01-01 00:00:00'),
      profileRow(2, '新主题', '新内容', '2026-09-30 00:00:00'),
    ]);
    expect(block.indexOf('新主题')).toBeLessThan(block.indexOf('旧主题'));
  });

  it('writtenAt 相同 → 按 id 新者优先（稳定 tie-break）', () => {
    const block = buildProfileBlock([
      profileRow(1, '先写入的同刻条目', '内容一', '2026-09-01 00:00:00'),
      profileRow(9, '后写入的同刻条目', '内容二', '2026-09-01 00:00:00'),
    ]);
    expect(block.indexOf('后写入的同刻条目')).toBeLessThan(block.indexOf('先写入的同刻条目'));
  });

  it('条数上限 40：超出截断并在块尾标注省略条数（新者保留）', () => {
    const rows = Array.from({ length: 45 }, (_, i) =>
      profileRow(i + 1, `主题${i}`, `内容${i}`, `2026-09-01 00:00:${String(i).padStart(2, '0')}`)
    );
    const block = buildProfileBlock(rows);
    const entryLines = block.split('\n').filter((l) => l.startsWith('- '));
    expect(entryLines).toHaveLength(40);
    expect(block).toContain('已省略 5 条');
    expect(block).toContain('- 主题44：'); // 最新一条在
    expect(block).not.toContain('- 主题0：'); // 最旧一条被截掉
    // 块尾是省略标注（截断信息可读）
    expect(block.trimEnd().endsWith(')')).toBe(true);
  });

  it('40 条以内不出现省略标注', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      profileRow(i + 1, `主题${i}`, `内容${i}`, `2026-09-01 00:00:${String(i).padStart(2, '0')}`)
    );
    expect(buildProfileBlock(rows)).not.toContain('已省略');
  });

  it('字段为空/null 的行：空 subject 回退到 content、全空行剔除、结构不破', () => {
    const block = buildProfileBlock([
      profileRow(1, '只有主题', null as unknown as string, '2026-09-01 00:00:00'),
      profileRow(2, '', '仅有内容的条目', '2026-09-02 00:00:00'),
      profileRow(3, '   ', '   ', '2026-09-03 00:00:00'), // 全空白 → 不进块
    ]);
    expect(block).toContain('- 只有主题');
    expect(block).toContain('- 仅有内容的条目');
    expect(block.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(2);
  });

  it('入参为空（undefined）→ 返回空串不抛错（调用方 try/catch 之外的兜底）', () => {
    expect(buildProfileBlock(undefined as unknown as AgentMemoryRow[])).toBe('');
  });

  it('多行 content 归一为单行（不破坏条目结构）', () => {
    const block = buildProfileBlock([
      profileRow(1, '备注', '第一行\n第二行', '2026-09-01 00:00:00'),
    ]);
    expect(block.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1);
    expect(block).toContain('第一行 第二行');
  });
});

describe('B4 — 画像层接入 prepareAgentContext', () => {
  const ALLOW_ALL = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
  };
  const AGENT_MSG = '请帮我写一篇关于 SQLite 的技术文章';
  const CHAT_MSG = '你好，今天天气怎么样？';
  /** 注入的 db（DAO 已 mock，此处只验证透传与归属）。 */
  const FAKE_DB = { tag: 'fake-db' };
  const DEPS_WITH_DB = { ...ALLOW_ALL, db: FAKE_DB };
  const ROWS = [
    profileRow(1, '职业', '后端工程师', '2026-09-01 00:00:00'),
    profileRow(2, '常用技术栈', 'TypeScript / SQLite', '2026-09-02 00:00:00'),
  ];

  /**
   * 「只带三文件块」的期望输出：画像层为空时的逐字等价对象。
   * 澄清前缀取自本次 classifyIntent 结果（避免用例被意图置信度绑架）。
   */
  function expectedAgentPrompt(ctx: ReturnType<typeof runPrepare>): string {
    return buildAgentSystemPrompt(
      '',
      '',
      ctx.intent.needsClarification === true,
      '',
      buildGlobalAgentFilesBlock(GLOBAL_FILES_FIXTURE)
    );
  }

  it('画像进首条 system 消息，位于【核心规则】之后、全局文件块之后、## 工作流 之前', () => {
    agentMemoryMock.getActiveProfile.mockReturnValue(ROWS);
    const ctx = runPrepare(makePayload({ message: AGENT_MSG }), DEPS_WITH_DB);
    expect(ctx.intent.intent).not.toBe('chat');
    const text = String(ctx.llmMessages[0].content);
    const idxCore = text.indexOf('【核心规则】');
    const idxGlobal = text.indexOf(GLOBAL_FILES_FIXTURE.memory);
    const idxProfile = text.indexOf('【用户画像】');
    const idxWorkflow = text.indexOf('## 工作流');
    expect(idxProfile).toBeGreaterThan(idxGlobal);
    expect(idxGlobal).toBeGreaterThan(idxCore);
    expect(idxWorkflow).toBeGreaterThan(idxProfile);
    expect(text).toContain('职业');
    expect(text).toContain('后端工程师');
    expect(agentMemoryMock.getActiveProfile).toHaveBeenCalledTimes(1);
  });

  it('DAO 收到注入的 db 与当前 userId（user_id 归属过滤在 DAO 侧）', () => {
    agentMemoryMock.getActiveProfile.mockReturnValue(ROWS);
    runPrepare(makePayload({ message: AGENT_MSG, userId: 'u7' }), DEPS_WITH_DB);
    expect(agentMemoryMock.getActiveProfile).toHaveBeenCalledWith(FAKE_DB, 'u7');
  });

  it('chat 意图同样注入画像（Q15 同口径），且位于【核心规则】与【注意力锚点】之间', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      { role: 'assistant', content: '上一轮回答' },
    ]);
    agentMemoryMock.getActiveProfile.mockReturnValue(ROWS);
    const ctx = runPrepare(makePayload({ message: CHAT_MSG }), DEPS_WITH_DB);
    expect(ctx.intent.intent).toBe('chat');
    const text = String(ctx.llmMessages[0].content);
    const idxCore = text.indexOf('【核心规则】');
    const idxGlobal = text.indexOf(GLOBAL_FILES_FIXTURE.memory);
    const idxProfile = text.indexOf('【用户画像】');
    const idxAnchor = text.indexOf('【注意力锚点】');
    expect(idxGlobal).toBeGreaterThan(idxCore);
    expect(idxProfile).toBeGreaterThan(idxGlobal);
    expect(idxAnchor).toBeGreaterThan(idxProfile);
    expect(text.endsWith('那是你必须回答的问题。')).toBe(true);
    expect(text).toContain('后端工程师');
  });

  it('画像为空 → 无占位噪音，输出与「只带三文件块」逐字一致', () => {
    agentMemoryMock.getActiveProfile.mockReturnValue([]);
    const ctx = runPrepare(makePayload({ message: AGENT_MSG }), DEPS_WITH_DB);
    const text = String(ctx.llmMessages[0].content);
    expect(ctx.intent.intent).not.toBe('chat');
    expect(text).not.toContain('【用户画像】');
    expect(text).not.toContain('画像');
    expect(text).toBe(expectedAgentPrompt(ctx));
    // 核心规则 → 个性化层 → 工作流之间不留空行残渣（filter(Boolean) 口径）
    expect(text).toContain(
      '4. 当看到 "=== 当前用户问题 ===" 标记时，那是你必须回答的问题\n【全局 Agent 文件】'
    );
    expect(text).not.toContain('问题\n\n');
    expect(text.indexOf('【全局 Agent 文件】')).toBeLessThan(text.indexOf('## 工作流'));
  });

  it('DAO 查询抛错 → 静默降级空串，prompt 组装与三文件注入均不受影响', () => {
    agentMemoryMock.getActiveProfile.mockImplementationOnce(() => {
      throw new Error('SqliteError: no such table: agent_memory');
    });
    const ctx = runPrepare(makePayload({ message: AGENT_MSG }), DEPS_WITH_DB);
    const text = String(ctx.llmMessages[0].content);
    expect(agentMemoryMock.getActiveProfile).toHaveBeenCalledTimes(1);
    expect(text).toContain('【核心规则】');
    expect(text).toContain(GLOBAL_FILES_FIXTURE.soul);
    expect(text).not.toContain('【用户画像】');
    expect(text).toBe(expectedAgentPrompt(ctx));
  });

  it('未注入 db（DB 未初始化）→ 降级空串且不发起查询', () => {
    agentMemoryMock.getActiveProfile.mockReturnValue(ROWS);
    const ctx = runPrepare(makePayload({ message: AGENT_MSG }), ALLOW_ALL);
    expect(agentMemoryMock.getActiveProfile).not.toHaveBeenCalled();
    const text = String(ctx.llmMessages[0].content);
    expect(text).not.toContain('【用户画像】');
    expect(text).toContain('【核心规则】');
    expect(text).toBe(expectedAgentPrompt(ctx));
  });

  it('chat 分支：画像为空 / 抛错 / 无 db → 输出与 CHAT 基线块逐字一致', () => {
    dbAiMock.getRecentMessagesByRounds.mockReturnValue([
      { role: 'assistant', content: '上一轮回答' },
    ]);
    const expected = buildChatSystemPrompt(buildGlobalAgentFilesBlock(GLOBAL_FILES_FIXTURE));

    agentMemoryMock.getActiveProfile.mockReturnValue([]);
    expect(
      String(runPrepare(makePayload({ message: CHAT_MSG }), DEPS_WITH_DB).llmMessages[0].content)
    ).toBe(expected);

    agentMemoryMock.getActiveProfile.mockImplementationOnce(() => {
      throw new Error('SqliteError: no such table: agent_memory');
    });
    expect(
      String(runPrepare(makePayload({ message: CHAT_MSG }), DEPS_WITH_DB).llmMessages[0].content)
    ).toBe(expected);

    expect(
      String(runPrepare(makePayload({ message: CHAT_MSG }), ALLOW_ALL).llmMessages[0].content)
    ).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// D4 — buildExperienceBlock（意图 → 经验匹配，六.2 总指挥裁定 3/4）
// ---------------------------------------------------------------------------

/** 技能夹具（结构兼容 `CoreSkill`，只取经验块消费的字段）。 */
interface ExpSkillFixture {
  name: string;
  description: string;
  instructions: string;
  intents?: string[];
}

const EXPLICIT_SKILL: ExpSkillFixture = {
  name: 'auto_outline_notes',
  description: '把零散笔记整理成大纲',
  instructions: '1. 先读取原文件\n2. 再提取标题层级\n3. 最后输出大纲\n避坑：不要直接改写原文件',
  intents: ['rewrite'],
};

const LEGACY_SKILL: ExpSkillFixture = {
  name: 'auto_polish_flow',
  description: '把零散笔记润色成流畅段落',
  instructions: '1. 通读全段\n2. 修正语病\n3. 输出润色结果',
};

describe('D4 — buildExperienceBlock（意图 → 经验匹配）', () => {
  it('显式标注命中意图 → 经验内容进块，且含稳定小节标题与技能名', () => {
    const block = buildExperienceBlock([EXPLICIT_SKILL], 'rewrite');
    expect(block.startsWith('【可复用经验】')).toBe(true);
    expect(block).toContain('【技能 auto_outline_notes】');
    expect(block).toContain('1. 先读取原文件');
    expect(block).toContain('避坑：不要直接改写原文件');
  });

  it('指令步骤顺序逐字保持（注入不洗乱 instructions 原顺序）', () => {
    const block = buildExperienceBlock([EXPLICIT_SKILL], 'rewrite');
    const i1 = block.indexOf('1. 先读取原文件');
    const i2 = block.indexOf('2. 再提取标题层级');
    const i3 = block.indexOf('3. 最后输出大纲');
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(block.indexOf('避坑：不要直接改写原文件')).toBeGreaterThan(i3);
  });

  it('显式标注但意图不匹配 → 空串（零占位噪音）', () => {
    expect(buildExperienceBlock([EXPLICIT_SKILL], 'kbQa')).toBe('');
    expect(buildExperienceBlock([EXPLICIT_SKILL], 'tech')).toBe('');
  });

  it('chat 意图一律不注入（无规则 fallback，裁定 3）', () => {
    expect(buildExperienceBlock([EXPLICIT_SKILL], 'chat')).toBe('');
    // 即便技能被硬塞 chat 标注也不注入
    expect(buildExperienceBlock([{ ...EXPLICIT_SKILL, intents: ['chat'] }], 'chat')).toBe('');
    expect(buildExperienceBlock([{ ...LEGACY_SKILL, intents: ['chat'] }], 'rewrite')).toBe('');
  });

  it('无技能 / 意图缺省 → 空串', () => {
    expect(buildExperienceBlock([], 'rewrite')).toBe('');
    expect(buildExperienceBlock(undefined as unknown as ExpSkillFixture[], 'rewrite')).toBe('');
    expect(buildExperienceBlock([EXPLICIT_SKILL], undefined)).toBe('');
    expect(buildExperienceBlock([EXPLICIT_SKILL], '')).toBe('');
  });

  it('老技能无 intents → 走关键词推断，推断命中才注入', () => {
    // description 含「润色」→ classifyIntent 判 rewrite → 与当前意图一致
    expect(buildExperienceBlock([LEGACY_SKILL], 'rewrite')).toContain('2. 修正语病');
    // 同一技能对别的意图推断不中 → 不注入
    expect(buildExperienceBlock([LEGACY_SKILL], 'kbQa')).toBe('');
    expect(buildExperienceBlock([LEGACY_SKILL], 'web')).toBe('');
  });

  it('非法 intents 值（不在 5 个显式规则意图白名单内）→ 视为不匹配，不注入', () => {
    const bad = [{ ...EXPLICIT_SKILL, intents: ['notAnIntent'] }];
    expect(buildExperienceBlock(bad, 'rewrite')).toBe('');
    const empty = [{ ...EXPLICIT_SKILL, intents: [] }];
    expect(buildExperienceBlock(empty, 'rewrite')).toBe('');
  });

  it('显式标注命中优先于推断命中，且各自保持技能数组原顺序', () => {
    const other = { ...LEGACY_SKILL, name: 'auto_polish_second' };
    const block = buildExperienceBlock([LEGACY_SKILL, other, EXPLICIT_SKILL], 'rewrite');
    // 显式标注排前（即便在数组里最后）
    expect(block.indexOf('【技能 auto_outline_notes】')).toBeLessThan(
      block.indexOf('【技能 auto_polish_flow】')
    );
    // 两个推断命中之间保持数组原顺序
    expect(block.indexOf('【技能 auto_polish_flow】')).toBeLessThan(
      block.indexOf('【技能 auto_polish_second】')
    );
    // 每条 instructions 原样出现
    expect(block).toContain('1. 通读全段');
    expect(block).toContain('1. 先读取原文件');
  });
});

// ---------------------------------------------------------------------------
// D5 — 防膨胀三防线：复核淘汰后的经验不再进入任何提示词（req §二 D5 验收 2）
//
// 链路：策略淘汰（closeMemory 置 valid_to）→ getActiveProfile / listActiveMemories
//       只回 active 行 → buildProfileBlock / buildExperienceBlock 不含该内容
//       → buildAgentSystemPrompt 最终提示同样不含。
// DAO 侧的 valid_to 过滤断言在 tests/main/ai/memorySimilarMerge.test.ts（真 fake DB）；
// 本文件断言提示词侧，并用「混入已淘汰行」的对照组证明断言不是恒真。
// ---------------------------------------------------------------------------

describe('D5 — 复核淘汰后的内容不再进入提示词', () => {
  const EVICTED = 'D5_EVICTED_被淘汰的深色主题记忆';
  const KEPT = 'D5_KEPT_保留的深色主题记忆';

  const KEPT_ROW = profileRow(1, '外观设置', KEPT, '2026-09-30 00:00:00');
  const EVICTED_ROW: AgentMemoryRow = {
    ...profileRow(2, '主题偏好', EVICTED, '2026-01-01 00:00:00'),
    validTo: '2026-09-30 12:00:00',
  };

  const EXP_SKILL: ExpSkillFixture = {
    name: 'auto_note_outline',
    description: '把零散笔记整理成大纲',
    instructions: '1. 读取原文件\n2. 提取标题层级\n3. 输出大纲',
    intents: ['rewrite'],
  };

  it('画像块：active 集合不含被淘汰行 → 块内无该内容（对照组证明断言有区分力）', () => {
    const activeRows = [KEPT_ROW];
    const block = buildProfileBlock(activeRows);
    expect(block).not.toContain(EVICTED);
    expect(block).toContain(KEPT);
    // 对照：把已淘汰行混进集合内容就会出现 → 说明「不含」不是恒真
    expect(buildProfileBlock([KEPT_ROW, EVICTED_ROW])).toContain(EVICTED);
  });

  it('经验块：被淘汰的记忆内容不出现（经验块只吃 active _auto 技能，与记忆淘汰链路隔离）', () => {
    const block = buildExperienceBlock([EXP_SKILL], 'rewrite');
    expect(block).toContain('1. 读取原文件');
    expect(block).not.toContain(EVICTED);
  });

  it('最终系统提示：画像块与经验块双侧都不含被淘汰内容', () => {
    const prompt = buildAgentSystemPrompt(
      '',
      '',
      false,
      '',
      '',
      buildProfileBlock([KEPT_ROW]),
      buildExperienceBlock([EXP_SKILL], 'rewrite')
    );
    expect(prompt).not.toContain(EVICTED);
    expect(prompt).toContain(KEPT);
    expect(prompt).toContain('【可复用经验】');
  });

  it('验收 1：50 条画像合并后条数 ≤ 40 且不超 PROFILE_TOKEN_LIMIT', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      profileRow(i + 1, `主题${i}`, `内容${i}`, '2026-09-01 00:00:00')
    );
    const block = buildProfileBlock(rows);
    const entries = block.split('\n').filter((l) => l.startsWith('- '));
    expect(entries).toHaveLength(40);
    expect(estimateTokens(block)).toBeLessThanOrEqual(PROFILE_TOKEN_LIMIT);
    expect(estimateTokens(block)).toBeLessThanOrEqual(2000);
  });

  it('验收 1：50 条经验叠加 → 进提示词的部分被截断到 EXPERIENCE_TOKEN_LIMIT 预算内', () => {
    const skills = Array.from({ length: 50 }, (_, i) => ({
      name: `auto_note_${i}`,
      description: `整理笔记第 ${i} 版`,
      instructions:
        '1. 读取原文件\n2. 提取标题层级\n3. 输出大纲\n避坑：不要直接改写原文件，务必先另存备份，' +
        `再按章节逐段整理第 ${i} 版内容，避免覆盖用户已有修改`,
      intents: ['rewrite'],
    }));
    const block = buildExperienceBlock(skills, 'rewrite');
    expect(block.split('【技能 ').length - 1).toBe(50);
    const prompt = buildAgentSystemPrompt('', '', false, '', '', '', block);
    expect(prompt).toContain('(经验过长已截断)');
    // 截断后最末一条技能不再出现在提示词里
    expect(prompt).not.toContain('【技能 auto_note_49】');
    expect(EXPERIENCE_TOKEN_LIMIT).toBe(2000);
  });
});
// ============================================
// doc-pipeline 遗留修复批次：prepareAgentContext 集成测试
// R3：ToolCtx.attachmentEgressAllowed 注入（allowSend ∨ 勾选授权，fail-closed）
// （Bug A 附件清单/提示词选择、Bug B vision 判定后续小节在此扩展）
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  getMessagesByConversationPaginated: vi.fn(() => []),
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

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
import type { IAIConfig } from '@shared/ai';
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

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- electron mock ---
const electronMock = vi.hoisted(() => {
  const webContentsSend = vi.fn();
  return { webContentsSend };
});
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ webContents: { send: electronMock.webContentsSend } }),
  },
}));

// --- db/ai mock ---
const dbMock = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  getConversation: vi.fn(),
  getMessagesByConversation: vi.fn(() => []),
  updateConversationSummary: vi.fn(),
}));
vi.mock('@main/db/ai', () => dbMock);

// --- secureConfig / consent / context / skill mocks ---
vi.mock('@main/ai/secureConfig', () => ({
  decryptApiKey: vi.fn((enc: string) => enc.replace('enc:', '')),
}));
const consentMock = vi.hoisted(() => ({
  needsConsent: vi.fn(() => false),
  needsKbSendConsent: vi.fn(() => true),
}));
vi.mock('@main/ai/consent', () => consentMock);

const contextMock = vi.hoisted(() => ({
  shouldCompress: vi.fn(() => false),
  summarizeViaLlm: vi.fn(async () => 'S'),
}));
vi.mock('@main/ai/contextManager', () => ({
  buildCompressed: (msgs: unknown[], summary: string, _n: number) => [
    { role: 'system', content: `以下为历史摘要：${summary}` },
    ...(msgs as Array<{ role: string; content: string }>),
  ],
  estimateTokens: (t: string) => Math.ceil((t || '').length / 4),
  shouldCompress: contextMock.shouldCompress,
  summarizeViaLlm: contextMock.summarizeViaLlm,
}));

const skillMock = vi.hoisted(() => ({ loadSkills: vi.fn(() => []), CORE_SKILLS: [] }));
vi.mock('@main/ai/skillLoader', () => skillMock);

const intentMock = vi.hoisted(() => ({
  classifyIntent: vi.fn(() => ({ intent: 'create', confidence: 0.9 })),
}));
vi.mock('@main/ai/intentRouter', () => intentMock);

// --- llmClient mock ---
const llmMock = vi.hoisted(() => ({ streamChatCompletion: vi.fn() }));
vi.mock('@main/ai/llmClient', () => llmMock);

// --- toolRegistry mock (only executeTool trusted impl mocked via vi.mock of executeTool + real defineCoreTools) ---
const toolMock = vi.hoisted(() => ({
  executeTool: vi.fn(),
  defineCoreTools: vi.fn(() => [
    { type: 'function', function: { name: 'listFiles', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'readFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'searchKB', description: 'x', parameters: {} } },
  ]),
}));
vi.mock('@main/ai/toolRegistry', () => toolMock);

import { runAgentFlow } from '@main/ai/agentLoop';
import { IPC_CHANNELS } from '@shared/constants';
import type { IAIConfig } from '@shared/ai';

function makeConfig(over: Partial<IAIConfig> = {}): IAIConfig {
  return {
    backend: 'remote',
    remoteBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hasApiKey: true,
    ...over,
  };
}

function makeEvent() {
  return { sender: { id: 1 } } as unknown as Electron.IpcMainInvokeEvent;
}

function payload(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    conversationId: 'c1',
    message: '写一个 react 组件',
    useKnowledgeBase: false,
    ...over,
  };
}

beforeEach(() => {
  electronMock.webContentsSend.mockReset();
  dbMock.appendMessage.mockReset().mockImplementation((m) => ({
    id: `m-${Math.random()}`,
    conversationId: m.conversationId,
    userId: m.userId,
    role: m.role,
    content: m.content,
    refsJson: null,
    createdAt: 'now',
  }));
  dbMock.getConversation.mockReset().mockReturnValue({
    id: 'c1',
    userId: 'u1',
    mode: 'agent',
    summary: '',
    createdAt: 'now',
    updatedAt: 'now',
  });
  dbMock.getMessagesByConversation.mockReset().mockReturnValue([]);
  llmMock.streamChatCompletion.mockReset();
  toolMock.executeTool.mockReset();
  consentMock.needsConsent.mockReset().mockReturnValue(false);
  // 默认：allowSend 未授权（需要 KB 外发同意）——安全默认不提供 searchKB
  consentMock.needsKbSendConsent.mockReset().mockReturnValue(true);
  intentMock.classifyIntent.mockReset().mockReturnValue({ intent: 'create', confidence: 0.9 });
});

describe('runAgentFlow', () => {
  it('rejects with consent_required when agent consent not granted and sends nothing', async () => {
    consentMock.needsConsent.mockReturnValue(true);
    const controller = new AbortController();
    await expect(
      runAgentFlow(makeEvent(), payload(), makeConfig(), 'enc:key', controller, {
        consent: { allowNetwork: false, allowSend: false, consentUpdatedAt: null },
      })
    ).rejects.toMatchObject({ code: 'consent_required' });
    // 不发外发请求
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
    expect(electronMock.webContentsSend).not.toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_CHUNK,
      expect.anything()
    );
  });

  it('executes tool_calls -> backfills role:tool -> continues loop -> converges', async () => {
    // round1: tool_calls(readFile); round2: final text
    let call = 0;
    llmMock.streamChatCompletion.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return (async function* () {
          yield {
            delta: '',
            toolCalls: [
              { index: 0, name: 'readFile', arguments: '{"file_id":"f1"}' },
            ],
          };
        })();
      }
      return (async function* () {
        yield { delta: '答案正文' };
      })();
    });
    toolMock.executeTool.mockResolvedValue({ content: '文件内容', status: 'ok' });

    const controller = new AbortController();
    const res = await runAgentFlow(makeEvent(), payload(), makeConfig(), 'enc:key', controller, {
      consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    });

    // 工具被调用并回填
    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(2);
    // role:'tool' 落库
    const toolWrites = dbMock.appendMessage.mock.calls.filter(
      (c) => c[0].role === 'tool'
    );
    expect(toolWrites.length).toBe(1);
    expect(toolWrites[0][0].content).toContain('文件内容');
    // assistant 落库
    expect(
      dbMock.appendMessage.mock.calls.some(
        (c) => c[0].role === 'assistant' && c[0].content.includes('答案正文')
      )
    ).toBe(true);
    // tool 事件推送
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_TOOL,
      expect.objectContaining({ toolCallId: 'call_0_0', name: 'readFile', status: 'ok' })
    );
    expect(res.roundsUsed).toBe(2);
    expect(res.assistantId).toBeTruthy();
    // 回归：续轮消息必须用 OpenAI 兼容 snake_case 字段（camelCase `toolCalls`/`toolCallId`
    // 会被 DeepSeek 400「missing field tool_call_id」——活体验证抓到的真实 bug）。
    const secondMessages = llmMock.streamChatCompletion.mock.calls[1][0].messages as Array<
      Record<string, unknown>
    >;
    const assistantTurn = secondMessages.find(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls)
    );
    expect(assistantTurn).toBeDefined();
    expect(assistantTurn?.tool_calls).toHaveLength(1);
    expect(
      (assistantTurn?.tool_calls as Array<{ function: { name: string } }>)[0].function.name
    ).toBe('readFile');
    const toolTurn = secondMessages.find((m) => m.role === 'tool');
    expect(toolTurn).toBeDefined();
    expect(toolTurn?.tool_call_id).toBe('call_0_0');
    expect(toolTurn?.content).toContain('文件内容');
  });

  it('does not loop forever when model keeps returning tool_calls (rounds capped)', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => {
      async function* g() {
        yield {
          delta: '',
          toolCalls: [{ index: 0, name: 'listFiles', arguments: '{}' }],
        };
      }
      return g();
    });
    toolMock.executeTool.mockResolvedValue({ content: '[]', status: 'ok' });

    const controller = new AbortController();
    const res = await runAgentFlow(makeEvent(), payload(), makeConfig(), 'enc:key', controller, {
      consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    });

    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(6); // MAX_ROUNDS=6
    // 收敛 assistant 落库（提示文案）
    const assistantCalls = dbMock.appendMessage.mock.calls.filter(
      (c) => c[0].role === 'assistant'
    );
    expect(assistantCalls.length).toBeGreaterThan(0);
    expect(res.roundsUsed).toBe(6);
  });

  it('degrades to direct answer + hint when a tool fails', async () => {
    let call = 0;
    llmMock.streamChatCompletion.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return (async function* () {
          yield {
            delta: '',
            toolCalls: [{ index: 0, name: 'readFile', arguments: '{"file_id":"f1"}' }],
          };
        })();
      }
      return (async function* () {
        yield { delta: '兜底作答' };
      })();
    });
    toolMock.executeTool.mockResolvedValue({
      content: '',
      status: 'error',
      errorDesc: '文件不存在',
    });

    const controller = new AbortController();
    await runAgentFlow(makeEvent(), payload(), makeConfig(), 'enc:key', controller, {
      consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    });
    // 失败工具：tool 落库含失败标记 + tool 事件 status:error
    const toolWrites = dbMock.appendMessage.mock.calls.filter(
      (c) => c[0].role === 'tool'
    );
    expect(toolWrites.length).toBe(1);
    expect(toolWrites[0][0].content).toContain('失败');
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_TOOL,
      expect.objectContaining({ status: 'error' })
    );
    // 仍续轮并交给模型作答（不死循环）
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('kbQa + useKnowledgeBase + allowSend granted -> injects searchKB tool', async () => {
    intentMock.classifyIntent.mockReturnValue({ intent: 'kbQa', confidence: 0.9 });

    // allowSend 已授权：needsKbSendConsent 返回 false -> 提供 searchKB
    consentMock.needsKbSendConsent.mockReturnValue(false);

    let call = 0;
    llmMock.streamChatCompletion.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return (async function* () {
          yield {
            delta: '',
            toolCalls: [{ index: 0, name: 'searchKB', arguments: '{"query":"q"}' }],
          };
        })();
      }
      return (async function* () {
        yield { delta: '结果回复' };
      })();
    });
    toolMock.executeTool.mockResolvedValue({ content: '来源内容', status: 'ok' });

    const controller = new AbortController();
    await runAgentFlow(
      makeEvent(),
      payload({ useKnowledgeBase: true }),
      makeConfig(),
      'enc:key',
      controller,
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
    );
    // 首轮携带 searchKB 工具
    const firstCallOpts = llmMock.streamChatCompletion.mock.calls[0][0] as { tools?: Array<{ function: { name: string } }> };
    expect(firstCallOpts.tools?.map((t) => t.function.name)).toContain('searchKB');
    // 工具被实际执行
    expect(toolMock.executeTool).toHaveBeenCalledWith(
      'searchKB',
      '{"query":"q"}',
      expect.anything()
    );
  });

  it('useKnowledgeBase 但 allowSend 未授权 -> 不注入 searchKB 工具（降级普通作答）', async () => {
    intentMock.classifyIntent.mockReturnValue({ intent: 'kbQa', confidence: 0.9 });

    // 默认 allowSend 未授权：needsKbSendConsent = true -> 不提供 searchKB，笔记不外发
    consentMock.needsKbSendConsent.mockReturnValue(true);

    llmMock.streamChatCompletion.mockImplementation(() => {
      async function* g() {
        yield { delta: '普通作答（未检索笔记）' };
      }
      return g();
    });

    const controller = new AbortController();
    const res = await runAgentFlow(
      makeEvent(),
      payload({ useKnowledgeBase: true }),
      makeConfig(),
      'enc:key',
      controller,
      { consent: { allowNetwork: true, allowSend: false, consentUpdatedAt: null } }
    );
    // 未传 tools（纯生成，不触发 searchKB/executeTool）
    const callOpts = llmMock.streamChatCompletion.mock.calls[0][0] as { tools?: Array<{ function: { name: string } }> };
    expect(callOpts.tools).toBeUndefined();
    expect(toolMock.executeTool).not.toHaveBeenCalled();
    // 正常收敛，不抛错
    const assistantCalls = dbMock.appendMessage.mock.calls.filter(
      (c) => c[0].role === 'assistant'
    );
    expect(assistantCalls.length).toBeGreaterThan(0);
    expect(res.roundsUsed).toBe(1);
  });

  // ============================================================
  // 第 7 期 A1a：当前文档上下文注入 LLM messages（主循环首轮 system）
  // ============================================================

  it('A1a: injects a system message containing currentDocument when provided (first LLM call)', async () => {
    intentMock.classifyIntent.mockReturnValue({ intent: 'rewrite', confidence: 0.9 });
    llmMock.streamChatCompletion.mockImplementation(() => {
      async function* g() {
        yield { delta: '基于文档的优化建议' };
      }
      return g();
    });
    const controller = new AbortController();
    await runAgentFlow(
      makeEvent(),
      payload({ currentDocument: '# 标题\n\n首段内容' }),
      makeConfig(),
      'enc:key',
      controller,
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
    );

    const firstMessages = llmMock.streamChatCompletion.mock.calls[0][0].messages as Array<{
      role: string;
      content: string;
    }>;
    // 首条注入 system 且包含文档内容（只读上下文）
    const docSystem = firstMessages[0];
    expect(docSystem.role).toBe('system');
    expect(docSystem.content).toContain('当前编辑文档内容');
    expect(docSystem.content).toContain('# 标题\n\n首段内容');
  });

  it('A1a: truncates an over-long currentDocument with a cut marker', async () => {
    // 20008 字符 → estimateTokens((20008)/4 = 5002) > 5000 → 触发截断到 20000 + 尾部标记
    const huge = '字'.repeat(20_008);
    intentMock.classifyIntent.mockReturnValue({ intent: 'rewrite', confidence: 0.9 });
    llmMock.streamChatCompletion.mockImplementation(() => {
      async function* g() {
        yield { delta: 'ok' };
      }
      return g();
    });
    const controller = new AbortController();
    await runAgentFlow(
      makeEvent(),
      payload({ currentDocument: huge }),
      makeConfig(),
      'enc:key',
      controller,
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
    );

    const firstMessages = llmMock.streamChatCompletion.mock.calls[0][0].messages as Array<{
      content: string;
    }>;
    const docSystem = firstMessages[0];
    // 截断到 20000 字符 + 尾部标记
    expect(docSystem.content).toContain('文档过长已截断');
    expect(docSystem.content.length).toBeLessThan(huge.length + 200);
  });

  it('A1a: no currentDocument -> no document system context injected', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => {
      async function* g() {
        yield { delta: '无文档上下文' };
      }
      return g();
    });
    const controller = new AbortController();
    await runAgentFlow(
      makeEvent(),
      payload(), // 不传 currentDocument
      makeConfig(),
      'enc:key',
      controller,
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
    );

    const firstMessages = llmMock.streamChatCompletion.mock.calls[0][0].messages as Array<{
      role: string;
      content: string;
    }>;
    // 不注入任何 document 上下文 system 消息（无 currentDocument）
    expect(firstMessages.some((m) => m.content.includes('当前编辑文档内容'))).toBe(false);
  });
});

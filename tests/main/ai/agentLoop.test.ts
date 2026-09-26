import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
  getMessagesByConversationPaginated: vi.fn(() => []),
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
  // B6 五-1：content 数组贯通所需的新导出（mock 补齐，避免 agentLoop 运行期 undefined）
  contentToText: (c: unknown) =>
    typeof c === 'string'
      ? c
      : Array.isArray(c)
        ? (c as Array<{ type: string; text?: string }>)
            .map((p) => (p.type === 'text' ? (p.text ?? '') : '[图片]'))
            .join('')
        : '',
  estimateContentTokens: (c: unknown) =>
    Math.ceil((typeof c === 'string' ? c : JSON.stringify(c ?? '')).length / 4),
  KEEP_RECENT_IMAGES: 3,
  countImageParts: () => 0,
  countMessageImages: () => 0,
  IMAGE_DEGRADED_PLACEHOLDER: '[图片已省略：超出上下文压缩保留上限（最近 3 张）]',
  shouldCompress: contextMock.shouldCompress,
  summarizeViaLlm: contextMock.summarizeViaLlm,
}));

const skillMock = vi.hoisted(() => ({ loadSkills: vi.fn(() => []), CORE_SKILLS: [] }));
vi.mock('@main/ai/skills/skillLoader', () => skillMock);

const intentMock = vi.hoisted(() => ({
  classifyIntent: vi.fn(() => ({ intent: 'create', confidence: 0.9 })),
}));
vi.mock('@main/ai/intentRouter', () => intentMock);

// --- llmClient mock ---
const llmMock = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  streamChatCompletionWithRetry: vi.fn(),
}));
vi.mock('@main/ai/llm/llmClient', () => llmMock);

// --- toolRegistry mock (only executeTool trusted impl mocked via vi.mock of executeTool + real defineCoreTools) ---
const toolMock = vi.hoisted(() => ({
  executeTool: vi.fn(),
  defineCoreTools: vi.fn(() => [
    { type: 'function', function: { name: 'listFiles', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'readFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'searchKB', description: 'x', parameters: {} } },
  ]),
  buildToolListForPrompt: vi.fn((tools: unknown[]) => tools),
  isDeferredTool: vi.fn((_name: string): boolean => false),
  getDeferredToolSchema: vi.fn((_name: string) => undefined as { type: string; function: { name: string; description: string; parameters: Record<string, unknown> } } | undefined),
}));
vi.mock('@main/ai/toolRegistry', () => toolMock);

// --- agentEventStore mock (R5-1) ---
const eventStoreMock = vi.hoisted(() => ({
  persistAndSend: vi.fn(),
}));
vi.mock('@main/ai/agent/agentEventStore', () => eventStoreMock);

// --- agentLoopGuard mock (R7a) ---
const guardMock = vi.hoisted(() => {
  class FakeDeadLoopDetector {
    private maxRounds: number;
    constructor(config?: { maxRounds?: number }) {
      this.maxRounds = config?.maxRounds ?? 12;
    }
    checkRoundLimit(round: number): boolean {
      return round >= this.maxRounds;
    }
    isNearRoundLimit(): boolean {
      return false;
    }
    checkSameResult(_result: unknown) {
      return { detected: false };
    }
    checkConsecutiveFailure(_toolName: string, _success: boolean, _argsHash?: string) {
      return { detected: false };
    }
    getStats() {
      return {
        roundsUsed: 0,
        maxRounds: this.maxRounds,
        sameResultCount: 0,
        consecutiveFailureCount: 0,
      };
    }
  }
  return { DeadLoopDetector: FakeDeadLoopDetector };
});
vi.mock('@main/ai/agent/agentLoopGuard', () => guardMock);

// --- agentCheckpoint mock (R7b) ---
const checkpointMock = vi.hoisted(() => ({
  saveCheckpoint: vi.fn(),
  saveCheckpointIncremental: vi.fn(),
}));
vi.mock('@main/ai/agent/agentCheckpoint', () => checkpointMock);

import { runAgentFlow } from '@main/ai/agent/agentLoop';
import { collectCitations, mergeCitations, type CitationEntry } from '@main/ai/agent/agentToolExecutor';
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
  // streamChatCompletionWithRetry 直接委托给 streamChatCompletion（测试不验证重试逻辑）
  llmMock.streamChatCompletionWithRetry.mockReset().mockImplementation(
    (opts: unknown) => llmMock.streamChatCompletion(opts),
  );
  toolMock.executeTool.mockReset();
  consentMock.needsConsent.mockReset().mockReturnValue(false);
  // 铁律二已移除：needsKbSendConsent 恒返回 false
  consentMock.needsKbSendConsent.mockReset().mockReturnValue(false);
  intentMock.classifyIntent.mockReset().mockReturnValue({ intent: 'create', confidence: 0.9 });
  eventStoreMock.persistAndSend.mockReset();
  checkpointMock.saveCheckpoint.mockReset();
});

describe('runAgentFlow', () => {
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

  it('does not loop forever when model keeps returning tool_calls (rounds capped at maxRounds)', async () => {
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

    // 消息"写一个 react 组件"被分类为 create/tech intent，maxRounds=12
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(12);
    // 收敛 assistant 落库（提示文案）
    const assistantCalls = dbMock.appendMessage.mock.calls.filter(
      (c) => c[0].role === 'assistant'
    );
    expect(assistantCalls.length).toBeGreaterThan(0);
    expect(res.roundsUsed).toBe(12);
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

  it('useKnowledgeBase 且 kbQa 意图 -> searchKB 始终注入（铁律二已移除）', async () => {
    intentMock.classifyIntent.mockReturnValue({ intent: 'kbQa', confidence: 0.9 });

    llmMock.streamChatCompletion.mockImplementation(() => {
      async function* g() {
        yield { delta: '基于知识库的回答' };
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
    // searchKB 始终注入（KB 外发限制已移除）
    const callOpts = llmMock.streamChatCompletion.mock.calls[0][0] as { tools?: Array<{ function: { name: string } }> };
    const toolNames = callOpts.tools?.map((t) => t.function.name) ?? [];
    expect(toolNames).toContain('searchKB');
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
    // 20008 字符 -> estimateTokens((20008)/4 = 5002) > 5000 -> 触发截断到 20000 + 尾部标记
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

  // ============================================================
  // R5-1：persistAndSend 集成（当 sessionId + db + mainWindow 存在时走持久化路径）
  // ============================================================

  it('R5-1: uses persistAndSend when sessionId + db + mainWindow are provided', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => {
      async function* g() {
        yield { delta: '持久化回复' };
      }
      return g();
    });

    const fakeMainWindow = { webContents: { send: vi.fn() } } as unknown as import('electron').BrowserWindow;
    const fakeDb = {} as import('better-sqlite3').Database;

    const controller = new AbortController();
    await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(),
      'enc:key',
      controller,
      {
        consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
        sessionId: 'sess-1',
        db: fakeDb,
        mainWindow: fakeMainWindow,
      }
    );

    // persistAndSend 应被调用（progress + chunk + done）
    expect(eventStoreMock.persistAndSend).toHaveBeenCalled();
    // 首次调用应该是 progress 事件（thinking），第二次是 chunk
    const firstCall = eventStoreMock.persistAndSend.mock.calls[0];
    expect(firstCall[2]).toBe('sess-1'); // sessionId
    expect(firstCall[4]).toBe('tool'); // eventType (progress via AI_STREAM_TOOL)
  });

  it('R5-1: falls back to sendStream when persistAndSend throws', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => {
      async function* g() {
        yield { delta: 'fallback 回复' };
      }
      return g();
    });

    // DB 写入失败
    eventStoreMock.persistAndSend.mockImplementation(() => {
      throw new Error('DB write failed');
    });

    const fakeMainWindow = { webContents: { send: vi.fn() } } as unknown as import('electron').BrowserWindow;
    const fakeDb = {} as import('better-sqlite3').Database;

    const controller = new AbortController();
    await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(),
      'enc:key',
      controller,
      {
        consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
        sessionId: 'sess-1',
        db: fakeDb,
        mainWindow: fakeMainWindow,
      }
    );

    // 降级到 sendStream（webContents.send 被调用）
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_CHUNK,
      expect.anything()
    );
  });

  // ============================================================
  // R7b：saveCheckpoint 每轮结束时被调用
  // ============================================================

  it('R7b: saves checkpoint at end of each round when sessionId + db are provided', async () => {
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
        yield { delta: '最终回复' };
      })();
    });
    toolMock.executeTool.mockResolvedValue({ content: '文件内容', status: 'ok' });

    const fakeDb = {} as import('better-sqlite3').Database;
    const controller = new AbortController();
    await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(),
      'enc:key',
      controller,
      {
        consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
        sessionId: 'sess-1',
        db: fakeDb,
      }
    );

    // 工具执行那轮结束后应保存 checkpoint（使用增量写入）
    expect(checkpointMock.saveCheckpointIncremental).toHaveBeenCalledWith(
      fakeDb,
      'sess-1',
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant' }),
        expect.objectContaining({ role: 'tool' }),
      ]),  // newMessages (assistant + tool)
      expect.arrayContaining([
        expect.objectContaining({ name: 'readFile', status: 'ok' }),
      ]),  // toolCallsHistory
      1,  // roundsUsed
      null,  // reasoningTokenCount
      expect.objectContaining({ intent: 'create' }),  // intent
      expect.any(Array),  // existingMessages (memory path)
      expect.any(Number),  // roundIndex
    );
  });

  // ============================================================
  // P1-6：延迟工具重发优化（保留非延迟工具结果 + 重发上限修正）
  // ============================================================

  it('P1-6: deferred retry preserves non-deferred tool results and executes them immediately', async () => {
    // isDeferredTool: editBlocks 是延迟工具，readFile 不是
    toolMock.isDeferredTool.mockImplementation((name: string) => name === 'editBlocks');
    toolMock.getDeferredToolSchema.mockImplementation((name: string) => {
      if (name === 'editBlocks') {
        return {
          type: 'function',
          function: {
            name: 'editBlocks',
            description: '编辑文档块',
            parameters: { type: 'object', properties: { blocks: { type: 'array' } } },
          },
        };
      }
      return undefined;
    });

    let call = 0;
    llmMock.streamChatCompletion.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        // 第 1 次 LLM：返回 readFile（非延迟）+ editBlocks（延迟）
        return (async function* () {
          yield {
            delta: '',
            toolCalls: [
              { index: 0, name: 'readFile', arguments: '{"file_id":"f1"}' },
              { index: 1, name: 'editBlocks', arguments: '{"blocks":[]}' },
            ],
          };
        })();
      }
      if (call === 2) {
        // 第 2 次 LLM（schema 已升级，editBlocks 不再被视为新延迟工具）：调用 editBlocks
        return (async function* () {
          yield {
            delta: '',
            toolCalls: [
              { index: 0, name: 'editBlocks', arguments: '{"blocks":[{"id":"b1"}]}' },
            ],
          };
        })();
      }
      // 第 3 次 LLM：最终文本回答
      return (async function* () {
        yield { delta: '操作完成' };
      })();
    });

    // executeTool 统一返回（延迟块 + 正常轮各执行一次 editBlocks）
    toolMock.executeTool.mockResolvedValue({ content: '文件内容', status: 'ok' });

    const controller = new AbortController();
    const res = await runAgentFlow(makeEvent(), payload(), makeConfig(), 'enc:key', controller, {
      consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    });

    // LLM 被调用 3 次（1 原始 + 1 重试 + 1 最终）
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(3);
    // executeTool 至少被调用 2 次（readFile + editBlocks）
    expect(toolMock.executeTool.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(toolMock.executeTool).toHaveBeenCalledWith(
      'readFile',
      '{"file_id":"f1"}',
      expect.anything()
    );

    // IPC 事件包含 readFile 结果（延迟块执行时实时推送）
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_TOOL,
      expect.objectContaining({ name: 'readFile', status: 'ok' })
    );
    // IPC 事件包含 editBlocks 结果
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_TOOL,
      expect.objectContaining({ name: 'editBlocks', status: 'ok' })
    );

    // readFile 结果被注入到 LLM 上下文（第 2 次 LLM 调用的 messages 中包含 readFile 结果）
    const secondCallMessages = llmMock.streamChatCompletion.mock.calls[1][0].messages as Array<
      Record<string, unknown>
    >;
    const readFileResultMsg = secondCallMessages.find(
      (m) => m.role === 'tool' && m.content === '文件内容'
    );
    expect(readFileResultMsg).toBeDefined();
    expect(readFileResultMsg?.tool_call_id).toBe('call_0_0');

    expect(res.roundsUsed).toBe(2);
  });

  it('P1-6: deferred retry upgrades schema and avoids redundant retries', async () => {
    // 所有工具都是延迟工具（isDeferredTool 始终返回 true）
    toolMock.isDeferredTool.mockReturnValue(true);
    // getDeferredToolSchema 返回完整 schema（第 1 次重试时替换）
    toolMock.getDeferredToolSchema.mockReturnValue({
      type: 'function',
      function: {
        name: 'listFiles',
        description: '列出文件',
        parameters: { type: 'object', properties: {} },
      },
    });

    let call = 0;
    llmMock.streamChatCompletion.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        // 第 1 次 LLM：延迟工具（schema 是 stub）
        return (async function* () {
          yield {
            delta: '',
            toolCalls: [{ index: 0, name: 'listFiles', arguments: '{}' }],
          };
        })();
      }
      if (call === 2) {
        // 第 2 次 LLM：schema 已升级，不再视为新延迟工具，正常调用
        return (async function* () {
          yield {
            delta: '',
            toolCalls: [{ index: 0, name: 'listFiles', arguments: '{}' }],
          };
        })();
      }
      // 第 3 次 LLM：最终文本回答
      return (async function* () {
        yield { delta: '操作完成' };
      })();
    });
    // executeTool 统一返回（每次调用都返回，因为 while 循环 + 外层循环各执行一次）
    toolMock.executeTool.mockResolvedValue({ content: '[]', status: 'ok' });

    const controller = new AbortController();
    const res = await runAgentFlow(makeEvent(), payload(), makeConfig(), 'enc:key', controller, {
      consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    });

    // 延迟工具 schema 升级后不重复重试：while 循环 2 次 + 工具执行后外层循环 1 次 = 3 次 LLM
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(3);
    // executeTool 被调用 2 次（while 循环退出后执行 1 次 + 外层循环 round 1 执行 1 次）
    expect(toolMock.executeTool).toHaveBeenCalledTimes(2);
    expect(res.roundsUsed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// B8 六-2②：citation 收集（searchKB/searchDocument → refsJson 落库 + done 透传）
// ---------------------------------------------------------------------------

describe('B8 六-2 citation 收集与透传', () => {
  it('searchKB 命中 → assistant appendMessage 带 refsJson，done 事件同步携带', async () => {
    let call = 0;
    llmMock.streamChatCompletion.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return (async function* () {
          yield {
            delta: '',
            toolCalls: [{ index: 0, name: 'searchKB', arguments: '{"query":"收入"}' }],
          };
        })();
      }
      return (async function* () {
        yield { delta: '结论正文' };
      })();
    });
    const results = JSON.stringify([
      {
        docId: 'd1',
        chunkId: 'c1',
        fileName: 'report.pdf',
        content: '收入增长 12%',
        seq: 0,
        score: 0.9,
        pinned: false,
        sourceRef: JSON.stringify({ fileName: 'report.pdf', attachmentId: 'att-1', page: 2 }),
      },
    ]);
    toolMock.executeTool.mockResolvedValue({ content: results, status: 'ok' });

    const controller = new AbortController();
    await runAgentFlow(makeEvent(), payload(), makeConfig(), 'enc:key', controller, {
      consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    });

    const assistantWrite = dbMock.appendMessage.mock.calls.find(
      (c) => c[0].role === 'assistant' && c[0].content.includes('结论正文')
    );
    expect(assistantWrite).toBeDefined();
    const refsJson = (assistantWrite![0] as { refsJson?: string | null }).refsJson;
    expect(refsJson).toBeTruthy();
    const parsedRefs = JSON.parse(refsJson!) as Array<{ fileName: string; sourceRef?: string }>;
    expect(parsedRefs).toHaveLength(1);
    expect(parsedRefs[0].fileName).toBe('report.pdf');
    expect(parsedRefs[0].sourceRef).toContain('"attachmentId":"att-1"');
    expect(parsedRefs[0].sourceRef).toContain('"page":2');

    const doneCall = electronMock.webContentsSend.mock.calls.find(
      (c) => c[0] === IPC_CHANNELS.AI_STREAM_DONE
    );
    expect(doneCall).toBeDefined();
    expect((doneCall![1] as { refsJson?: string | null }).refsJson).toContain('report.pdf');
  });

  it('无检索工具调用 → assistant refsJson 为 null（不写空数组）', async () => {
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
        yield { delta: '直接回答' };
      })();
    });
    toolMock.executeTool.mockResolvedValue({ content: '文件内容', status: 'ok' });

    const controller = new AbortController();
    await runAgentFlow(makeEvent(), payload(), makeConfig(), 'enc:key', controller, {
      consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    });
    const assistantWrite = dbMock.appendMessage.mock.calls.find(
      (c) => c[0].role === 'assistant' && c[0].content.includes('直接回答')
    );
    expect(assistantWrite![0].refsJson ?? null).toBeNull();
  });
});

describe('collectCitations / mergeCitations（B8 六-2 收集器）', () => {
  const kbResult = JSON.stringify([
    {
      docId: 'd1',
      chunkId: 'c1',
      fileName: 'report.pdf',
      content: 'x'.repeat(500),
      seq: 3,
      score: 0.88,
      pinned: false,
      sourceRef: JSON.stringify({ fileName: 'report.pdf', page: 2 }),
    },
  ]);

  it('searchKB 数组结果 → 裁剪为轻量 {fileName, sourceRef, seq, score}', () => {
    const entries = collectCitations('searchKB', kbResult);
    expect(entries).toHaveLength(1);
    expect(entries![0].fileName).toBe('report.pdf');
    expect(entries![0].seq).toBe(3);
    expect(entries![0].sourceRef).toContain('"page":2');
    // 不携带 chunk 正文（refs_json 保持轻量）
    expect(entries![0]).not.toHaveProperty('content');
  });

  it('searchKB clarification 包装结果 → 取内层 results', () => {
    const wrapped = JSON.stringify({ results: JSON.parse(kbResult), clarificationNeeded: true });
    expect(collectCitations('searchKB', wrapped)).toHaveLength(1);
  });

  it('searchKB refused（无 results）→ null', () => {
    expect(collectCitations('searchKB', JSON.stringify({ refused: true, threshold: 0.6 }))).toBeNull();
  });

  it('searchDocument 命中 → 每条 sourceRef 含 attachmentId + page', () => {
    const content = JSON.stringify({
      attachmentId: 'att-1',
      fileName: 'report.pdf',
      query: '收入',
      matchCount: 2,
      matches: [
        { offset: 10, snippet: 'a', page: 1, sectionPath: ['季度报告'] },
        { offset: 900, snippet: 'b', page: 2, sectionPath: ['季度报告'] },
      ],
    });
    const entries = collectCitations('searchDocument', content);
    expect(entries).toHaveLength(2);
    for (const e of entries!) {
      const ref = JSON.parse(e.sourceRef!);
      expect(ref.attachmentId).toBe('att-1');
      expect(typeof ref.page).toBe('number');
    }
  });

  it('非引用工具 / 非法 JSON → null（不收集）', () => {
    expect(collectCitations('readPage', '{"page":1}')).toBeNull();
    expect(collectCitations('searchKB', 'not-json')).toBeNull();
    expect(collectCitations('searchKB', JSON.stringify({ foo: 1 }))).toBeNull();
  });

  it('mergeCitations 按 sourceRef 去重并封顶 10 条', () => {
    const make = (i: number): CitationEntry => ({
      fileName: `f${i}.md`,
      sourceRef: JSON.stringify({ fileName: `f${i}.md`, line: i }),
    });
    let merged: CitationEntry[] = [];
    for (let i = 0; i < 12; i++) {
      merged = mergeCitations(merged, [make(i)]);
    }
    // 重复注入同一条 → 仍去重
    merged = mergeCitations(merged, [make(0)]);
    expect(merged).toHaveLength(10);
    expect(new Set(merged.map((e) => e.sourceRef)).size).toBe(10);
  });
});

describe('B6 降级补齐（B8 六-3）：vision 不支持 → 显式提示注入', () => {
  it('附件含图片且模型不支持 vision → system 消息注入 VISION_DEGRADED_NOTICE（不静默丢图）', async () => {
    llmMock.streamChatCompletion.mockImplementation(() =>
      (async function* () {
        yield { delta: '完成' };
      })()
    );
    const controller = new AbortController();
    await runAgentFlow(
      makeEvent(),
      payload({
        attachments: [
          { id: 'i1', type: 'image', name: 'a.png', parseStatus: 'done', path: 'attachments/u1/c1/i1.png' },
        ],
      }),
      makeConfig(), // deepseek-chat 不支持 vision
      'enc:key',
      controller,
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
    );
    const msgs = llmMock.streamChatCompletion.mock.calls[0][0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    const systemTexts = msgs.filter((m) => m.role === 'system').map((m) => String(m.content));
    expect(systemTexts.some((t) => t.includes('当前模型不支持图片理解'))).toBe(true);
    // 图片本身未产 part（content 保持纯文本）
    const userMsg = msgs.filter((m) => m.role === 'user').pop();
    expect(typeof userMsg?.content).toBe('string');
  });
});

// ============================================================
// B9 三-1② / 三-3②：树 md 发会话只带文件名+路径+摘要（不整篇内联）
// + md 相对路径图片注入（五链路）
// ============================================================

describe('B9 文件树 md 发送（三-1 摘要引用 + 三-3 图片注入）', () => {
  const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

  it('超长 md + currentFileRef → 首条 system 只带文件名+路径+摘要，正文不整篇内联', async () => {
    intentMock.classifyIntent.mockReturnValue({ intent: 'rewrite', confidence: 0.9 });
    llmMock.streamChatCompletion.mockImplementation(() =>
      (async function* () {
        yield { delta: 'ok' };
      })()
    );
    const doc = [
      '# 深度指南',
      '',
      '开头段落。',
      ...Array.from({ length: 30 }, (_, i) => `第${i + 4}行内容。`),
      'TAIL_MARKER_XYZ',
      '结尾行。',
    ].join('\n');

    const controller = new AbortController();
    await runAgentFlow(
      makeEvent(),
      payload({
        currentDocument: doc,
        currentFileRef: { name: 'huge.md', path: '/ws/docs/huge.md' },
      }),
      makeConfig(),
      'enc:key',
      controller,
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
    );

    const msgs = llmMock.streamChatCompletion.mock.calls[0][0].messages as Array<{
      role: string;
      content: string;
    }>;
    const docSystem = msgs[0];
    expect(docSystem.role).toBe('system');
    // 只带文件名 + 路径 + 摘要
    expect(docSystem.content).toContain('huge.md');
    expect(docSystem.content).toContain('/ws/docs/huge.md');
    expect(docSystem.content).toContain('readLocalFile');
    expect(docSystem.content).toMatch(/共\s*\d+\s*行/);
    // 正文深处不内联（超长 md 摘要发送断言）
    expect(docSystem.content).not.toContain('TAIL_MARKER_XYZ');
    expect(docSystem.content.length).toBeLessThan(2500);
  });

  it('md 相对路径图片走五链路注入：vision 模型收到 image_url part（基准 md 所在目录）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'weavemd-b9-loop-'));
    const docs = join(root, 'docs');
    mkdirSync(join(docs, 'img'), { recursive: true });
    const png = join(docs, 'img', 'a.png');
    writeFileSync(png, PNG_BYTES);
    try {
      llmMock.streamChatCompletion.mockImplementation(() =>
        (async function* () {
          yield { delta: 'ok' };
        })()
      );
      const controller = new AbortController();
      await runAgentFlow(
        makeEvent(),
        payload({
          currentDocument: '![架构图](img/a.png)',
          currentFileRef: { name: 'n.md', path: join(docs, 'n.md') },
          fileTreePaths: { files: [], folders: [root] },
        }),
        makeConfig({ model: 'claude-sonnet-4' }), // supportsVision = true
        'enc:key',
        controller,
        { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
      );

      const msgs = llmMock.streamChatCompletion.mock.calls[0][0].messages as Array<{
        role: string;
        content: unknown;
      }>;
      const userMsg = msgs.filter((m) => m.role === 'user').pop();
      expect(Array.isArray(userMsg?.content)).toBe(true);
      const parts = userMsg?.content as Array<{ type: string; image_url?: { url: string } }>;
      const imagePart = parts.find((p) => p.type === 'image_url');
      expect(imagePart?.image_url?.url).toBe(png.replace(/\\/g, '/'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('md 图片存在但模型不支持 vision → 显式降级提示（不静默丢图）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'weavemd-b9-loop-'));
    const docs = join(root, 'docs');
    mkdirSync(join(docs, 'img'), { recursive: true });
    writeFileSync(join(docs, 'img', 'a.png'), PNG_BYTES);
    try {
      llmMock.streamChatCompletion.mockImplementation(() =>
        (async function* () {
          yield { delta: 'ok' };
        })()
      );
      const controller = new AbortController();
      await runAgentFlow(
        makeEvent(),
        payload({
          currentDocument: '![架构图](img/a.png)',
          currentFileRef: { name: 'n.md', path: join(docs, 'n.md') },
        }),
        makeConfig(), // deepseek-chat 不支持 vision
        'enc:key',
        controller,
        { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
      );
      const msgs = llmMock.streamChatCompletion.mock.calls[0][0].messages as Array<{
        role: string;
        content: unknown;
      }>;
      const systemTexts = msgs.filter((m) => m.role === 'system').map((m) => String(m.content));
      expect(systemTexts.some((t) => t.includes('当前模型不支持图片理解'))).toBe(true);
      const userMsg = msgs.filter((m) => m.role === 'user').pop();
      expect(typeof userMsg?.content).toBe('string');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('md 图片缺失（md 移动后相对路径失效）→ 降级提示随当前轮消息注入', async () => {
    llmMock.streamChatCompletion.mockImplementation(() =>
      (async function* () {
        yield { delta: 'ok' };
      })()
    );
    const controller = new AbortController();
    await runAgentFlow(
      makeEvent(),
      payload({
        currentDocument: '![丢失](gone.png)',
        currentFileRef: { name: 'n.md', path: '/ws/docs/n.md' },
      }),
      makeConfig({ model: 'claude-sonnet-4' }),
      'enc:key',
      controller,
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
    );
    const msgs = llmMock.streamChatCompletion.mock.calls[0][0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    const userMsg = msgs.filter((m) => m.role === 'user').pop();
    const text = typeof userMsg?.content === 'string'
      ? userMsg.content
      : JSON.stringify(userMsg?.content);
    expect(text).toContain('gone.png');
    expect(text).toContain('缺失');
  });
});

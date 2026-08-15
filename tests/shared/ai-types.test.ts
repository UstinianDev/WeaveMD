import { describe, expect, it } from 'vitest';
import {
  IPC_CHANNELS,
} from '@shared/constants';
import type {
  AgentRunResult,
  IAgentStreamEvent,
  IAgentStreamToolEvent,
  IAgentToolCall,
  IIntent,
  IKbDocumentStatus,
  IKbImportResult,
  IKbSearchResult,
  IKbSettings,
  IntentName,
  ToolDef,
} from '@shared/ai';

/**
 * 批次 0 共享类型编译期/运行时 sanity。
 * 编译期：import 处 TS 已强校验类型存在且可用（typecheck 兜底）。
 * 运行时：构造各类型最小合法实例 + IAgentStreamEvent 判别联合的 tool 变体可判别。
 */
describe('共享 AI 类型（批次 0 新增）', () => {
  it('ToolDef 为 OpenAI 兼容 {type:"function", function:{name,description,parameters}} 结构', () => {
    const tool: ToolDef = {
      type: 'function',
      function: {
        name: 'searchKB',
        description: '检索知识库',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '查询词' },
          },
          required: ['query'],
        },
      },
    };
    expect(tool.type).toBe('function');
    expect(tool.function.name).toBe('searchKB');
    expect(tool.function.parameters.required).toContain('query');
  });

  it('IIntent 6 类意图名封闭 + 可选 candidates/reason', () => {
    const names: IntentName[] = ['create', 'rewrite', 'kbQa', 'tech', 'web', 'chat'];
    const intent: IIntent = { intent: 'kbQa', confidence: 0.9, candidates: ['kbQa', 'tech'] };
    expect(names).toContain(intent.intent);
    expect(intent.candidates?.length).toBe(2);
    const low: IIntent = { intent: 'chat', confidence: 0.4, reason: '模糊' };
    expect(low.confidence).toBeLessThan(0.6);
  });

  it('IKbSearchResult 含出处定位（sourceRef string|null）与评分', () => {
    const r: IKbSearchResult = {
      docId: 'd1',
      chunkId: 'c1',
      fileName: 'note.md',
      content: '内容',
      seq: 0,
      score: 0.8,
      pinned: true,
      sourceRef: '{"line":3}',
    };
    expect(r.sourceRef).toBeTruthy();
    const noRef: IKbSearchResult = { ...r, sourceRef: null };
    expect(noRef.sourceRef).toBeNull();
  });

  it('IKbDocumentStatus 状态流转集合合法 + IKbImportResult 结构', () => {
    const status: IKbDocumentStatus = {
      docId: 'd1',
      fileId: null,
      title: 'note.md',
      sourceType: 'disk',
      pinned: false,
      status: 'pending',
      chunkCount: 0,
    };
    expect(['pending', 'importing', 'done', 'error']).toContain(status.status);

    const imp: IKbImportResult = { docId: 'd1', title: 'a.md', chunks: 3, status: 'done' };
    expect(imp.chunks).toBe(3);
  });

  it('IAgentToolCall 携带参数原始 JSON 与状态', () => {
    const call: IAgentToolCall = {
      toolCallId: 'tc1',
      name: 'readFile',
      args: '{"fileId":"f1"}',
      status: 'ok',
      result: 'content',
    };
    expect(JSON.parse(call.args).fileId).toBe('f1');
    const err: IAgentToolCall = { ...call, status: 'error', errorDesc: '缺失' };
    expect(err.status).toBe('error');
  });

  it('AgentRunResult 汇总含轮数/意图/拒答/降级提示', () => {
    const run: AgentRunResult = {
      conversationId: 'c1',
      assistantId: 'a1',
      roundsUsed: 2,
      intent: { intent: 'kbQa', confidence: 0.9 },
      usage: { reasoningTokenCount: null },
      agentBackendHint: 'ollama 降级纯生成',
    };
    expect(run.roundsUsed).toBeLessThanOrEqual(6);
    expect(run.intent?.intent).toBe('kbQa');
    expect(run.agentBackendHint).toBeTruthy();
  });

  it('IAgentStreamEvent 判别联合：tool 变体可与 chunk/done/error 判别', () => {
    const toolEvt: IAgentStreamEvent = {
      type: 'tool',
      conversationId: 'c1',
      toolCallId: 'tc1',
      name: 'searchKB',
      args: '{"query":"知识库"}',
      status: 'ok',
      result: '{"hits":1}',
    };
    // type 判别：只有 tool 变体才有 toolCallId
    if (toolEvt.type === 'tool') {
      const t: IAgentStreamToolEvent = toolEvt;
      expect(t.toolCallId).toBe('tc1');
      expect(t.status).toBe('ok');
    } else {
      expect.fail('tool 变体应可判别为 type:"tool"');
    }
    // 与既有 chunk/done/error 共存
    const chunk: IAgentStreamEvent = { type: 'chunk', conversationId: 'c1', delta: 'x' };
    const done: IAgentStreamEvent = { type: 'done', conversationId: 'c1' };
    const err: IAgentStreamEvent = { type: 'error', conversationId: 'c1', code: 'network', message: 'm' };
    for (const e of [chunk, done, err]) {
      expect(e.type).not.toBe('tool');
    }
  });

  it('IKbSettings 最小字段齐全', () => {
    const s: IKbSettings = {
      topK: 5,
      fuse: 0.5,
      threshold: 0.6,
      pinnedWeight: 1.5,
      embeddingHost: 'http://localhost:11434',
      embeddingModel: 'nomic-embed-text',
    };
    expect(s.topK).toBe(5);
    expect(s.fuse + 0.5).toBe(1);
  });

  it('新增 IPC 通道与流式事件常量已注册', () => {
    expect(IPC_CHANNELS.KB_LIST).toBe('kb:list');
    expect(IPC_CHANNELS.KB_IMPORT_FILE).toBe('kb:import:file');
    expect(IPC_CHANNELS.KB_IMPORT_DIR).toBe('kb:import:dir');
    expect(IPC_CHANNELS.KB_REINDEX).toBe('kb:reindex');
    expect(IPC_CHANNELS.KB_DELETE).toBe('kb:delete');
    expect(IPC_CHANNELS.KB_STATUS).toBe('kb:status');
    expect(IPC_CHANNELS.AGENT_RUN).toBe('agent:run');
    expect(IPC_CHANNELS.AGENT_ABORT).toBe('agent:abort');
    expect(IPC_CHANNELS.AI_STREAM_TOOL).toBe('ai:stream:tool');
  });
});

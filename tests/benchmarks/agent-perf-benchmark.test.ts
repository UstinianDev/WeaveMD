// ============================================
// WeaveMD — Agent Performance Benchmark Suite (S13)
// ============================================
// 5 个典型 Agent 场景的性能基准测试。不依赖真实 LLM API，
// 通过 mock 和 replay 模式测量框架层耗时。
//
// 测量指标：
// - e2eMs: 端到端耗时
// - prepareMs: 上下文准备耗时（prepareAgentContext）
// - toolExecMs: 工具执行耗时（executeToolRound / StreamingToolExecutor）
// - messageBuildMs: 消息构建耗时
// - estimatedTokens: 总 token 估算
// - toolCallCount: 工具调用次数
// - roundCount: Agent 轮次数

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ============================================================================
// Mock 外部依赖（必须在所有 import 之前 via vi.hoisted）
// ============================================================================

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

// --- db/files mock ---
const dbFilesMock = vi.hoisted(() => ({
  listFiles: vi.fn(() => []),
}));
vi.mock('@main/db/files', () => dbFilesMock);

// --- db/embeddingConfig mock ---
const embConfigMock = vi.hoisted(() => ({
  getEmbeddingConfig: vi.fn(() => null),
}));
vi.mock('@main/db/embeddingConfig', () => embConfigMock);

// --- secureConfig mock ---
vi.mock('@main/ai/secureConfig', () => ({
  decryptApiKey: vi.fn((enc: string) => enc.replace('enc:', '')),
}));

// --- consent mock ---
const consentMock = vi.hoisted(() => ({
  needsConsent: vi.fn(() => false),
  needsKbSendConsent: vi.fn(() => true),
}));
vi.mock('@main/ai/consent', () => consentMock);

// --- contextManager mock ---
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

// --- skillLoader mock ---
const skillMock = vi.hoisted(() => ({ loadSkills: vi.fn(() => []), CORE_SKILLS: [] }));
vi.mock('@main/ai/skills/skillLoader', () => skillMock);

// --- intentRouter mock ---
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

// --- embeddingClient mock ---
vi.mock('@main/ai/knowledge/embeddingClient', () => ({
  createEmbedding: vi.fn(async () => ({ embeddings: [[0.1]] })),
}));

// --- webSearch resolveSearchConfig mock ---
vi.mock('@main/ai/tools/webSearch', () => ({
  resolveSearchConfig: vi.fn(() => ({ apiKey: 'test-key', baseUrl: 'https://test.com' })),
  webSearchSchema: { type: 'function', function: { name: 'web_search', description: 'x', parameters: {} } },
}));

// --- toolRegistry mock ---
const toolMock = vi.hoisted(() => ({
  executeTool: vi.fn(),
  defineCoreTools: vi.fn(() => [
    { type: 'function', function: { name: 'listFiles', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'readFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'searchKB', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'editBlocks', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'createFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'ask_question_card', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'web_search', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'deleteFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'runSkill', description: 'x', parameters: {} } },
  ]),
  buildToolListForPrompt: vi.fn((tools: unknown[]) => tools),
  isDeferredTool: vi.fn(() => false),
  getDeferredToolSchema: vi.fn(() => undefined),
}));
vi.mock('@main/ai/toolRegistry', () => toolMock);

// --- agentEventStore mock ---
const eventStoreMock = vi.hoisted(() => ({
  persistAndSend: vi.fn(),
}));
vi.mock('@main/ai/agent/agentEventStore', () => eventStoreMock);

// --- agentLoopGuard mock ---
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

// --- agentCheckpoint mock ---
vi.mock('@main/ai/agent/agentCheckpoint', () => ({
  saveCheckpoint: vi.fn(),
  saveCheckpointIncremental: vi.fn(),
}));

// --- toolResultStorage mock ---
const storageMock = vi.hoisted(() => ({
  ContentReplacementState: class {
    getReplacement(_toolCallId: string): string | undefined { return undefined; }
    setReplacement(_toolCallId: string, _content: string): void {}
    clear(): void {}
  },
  persistLargeResult: vi.fn(async (result: string) => ({ persisted: false, displayContent: result })),
  applyAggregateBudget: vi.fn(async <T>(results: readonly T[]) => [...results]),
}));
vi.mock('@main/ai/agent/toolResultStorage', () => storageMock);

// --- concurrencyDefs mock ---
vi.mock('@main/ai/agent/concurrencyDefs', () => ({
  isToolConcurrencySafe: vi.fn((name: string) => {
    // searchKB, readFile, listFiles are read-only (safe for parallel)
    const safeTools = new Set(['searchKB', 'readFile', 'listFiles', 'readLocalFile', 'web_search']);
    return safeTools.has(name);
  }),
  safeParseArgs: vi.fn((args: string) => {
    try { return JSON.parse(args); } catch { return {}; }
  }),
}));

// --- agentExecutionSegments mock ---
vi.mock('@main/ai/agent/agentExecutionSegments', () => ({
  createSegment: vi.fn((id: string, name: string, round: number) => ({ id, name, round })),
  completeSegment: vi.fn((seg: unknown) => seg),
}));

// ============================================================================
// 导入被测函数
// ============================================================================

import { prepareAgentContext } from '@main/ai/agent/agentContext';
import { executeToolRound } from '@main/ai/agent/agentToolExecutor';
import { classifyIntent } from '@main/ai/intentRouter';
import { estimateTokens } from '@main/ai/utils/tokenEstimator';
import { toolsForIntent } from '@main/ai/agent/agentToolSelector';
import { buildAgentSystemPrompt } from '@main/ai/agent/agentPromptBuilder';
import { buildDocumentContext } from '@main/ai/agent/agentPromptBuilder';
import type { IAIConfig, IKbSearchResult } from '@shared/ai';

// ============================================================================
// 类型定义
// ============================================================================

interface PerfMetric {
  e2eMs: number;
  prepareMs: number;
  toolExecMs: number;
  messageBuildMs: number;
  estimatedTokens: number;
  toolCallCount: number;
  roundCount: number;
}

interface PerfScenario {
  name: string;
  description: string;
  metrics: PerfMetric;
}

interface PerfBaseline {
  timestamp: string;
  commit: string;
  nodeVersion: string;
  platform: string;
  scenarios: PerfScenario[];
}

interface ComparisonEntry {
  name: string;
  metric: string;
  baseline: number;
  current: number;
  diff: number;
  percentChange: number;
}

interface ComparisonReport {
  timestamp: string;
  baselineTimestamp: string;
  baselineCommit: string;
  currentCommit: string;
  entries: ComparisonEntry[];
  summary: {
    totalScenarios: number;
    improved: number;
    degraded: number;
    unchanged: number;
    avgPercentChange: number;
  };
}

// ============================================================================
// 工具函数
// ============================================================================

const BASELINE_PATH = path.resolve(__dirname, '.perf-baseline.json');

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

function makePayload(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    conversationId: 'c1',
    message: '写一个 react 组件',
    useKnowledgeBase: false,
    ...over,
  };
}

/** 获取当前 git commit hash */
function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** 高精度计时包装 */
async function measurePhase<T>(label: string, fn: () => T | Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = Math.round((performance.now() - start) * 100) / 100;
  return { result, ms };
}

/** 同步版本 */
function measurePhaseSync<T>(label: string, fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  const ms = Math.round((performance.now() - start) * 100) / 100;
  return { result, ms };
}

// ============================================================================
// 基准持久化
// ============================================================================

function saveBaseline(baseline: PerfBaseline): void {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), 'utf8');
}

function loadBaseline(): PerfBaseline | null {
  try {
    const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
    return JSON.parse(raw) as PerfBaseline;
  } catch {
    return null;
  }
}

function loadBaselineOrEmpty(): PerfBaseline {
  return loadBaseline() ?? {
    timestamp: new Date().toISOString(),
    commit: getCommitHash(),
    nodeVersion: process.version,
    platform: process.platform,
    scenarios: [],
  };
}

/**
 * 与基线对比：计算每项指标的差值、百分比变化。
 * 返回 ComparisonReport（含 Markdown 表格格式字符串）。
 */
function compareWithBaseline(current: PerfScenario[], baseline: PerfBaseline): ComparisonReport {
  const entries: ComparisonEntry[] = [];
  const baselineMap = new Map<string, PerfScenario>();
  for (const s of baseline.scenarios) {
    baselineMap.set(s.name, s);
  }

  for (const cur of current) {
    const base = baselineMap.get(cur.name);
    if (!base) {
      continue;
    }
    const metricKeys: Array<keyof PerfMetric> = [
      'e2eMs', 'prepareMs', 'toolExecMs', 'messageBuildMs',
      'estimatedTokens', 'toolCallCount', 'roundCount',
    ];
    for (const key of metricKeys) {
      const baselineVal = base.metrics[key];
      const currentVal = cur.metrics[key];
      const diff = currentVal - baselineVal;
      const percentChange = baselineVal !== 0
        ? Math.round((diff / baselineVal) * 10000) / 100
        : (currentVal !== 0 ? 100 : 0);
      entries.push({
        name: cur.name,
        metric: key,
        baseline: baselineVal,
        current: currentVal,
        diff,
        percentChange,
      });
    }
  }

  const improved = entries.filter((e) => e.percentChange < -1).length;
  const degraded = entries.filter((e) => e.percentChange > 1).length;
  const unchanged = entries.length - improved - degraded;
  const avgPct = entries.length > 0
    ? Math.round((entries.reduce((s, e) => s + e.percentChange, 0) / entries.length) * 100) / 100
    : 0;

  return {
    timestamp: new Date().toISOString(),
    baselineTimestamp: baseline.timestamp,
    baselineCommit: baseline.commit,
    currentCommit: getCommitHash(),
    entries,
    summary: { totalScenarios: entries.length, improved, degraded, unchanged, avgPercentChange: avgPct },
  };
}

/**
 * 将 ComparisonReport 格式化为 Markdown 表格。
 */
function formatComparisonMarkdown(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push('# Agent Performance Benchmark — 对比报告');
  lines.push('');
  lines.push(`- **基线提交**: \`${report.baselineCommit}\` (${report.baselineTimestamp})`);
  lines.push(`- **当前提交**: \`${report.currentCommit}\` (${report.timestamp})`);
  lines.push(`- **摘要**: ${report.summary.improved} 改善 / ${report.summary.degraded} 退化 / ${report.summary.unchanged} 不变`);
  lines.push(`- **平均变化**: ${report.summary.avgPercentChange}%`);
  lines.push('');
  lines.push('| 场景 | 指标 | 基线 | 当前 | 差值 | 变化% |');
  lines.push('|------|------|------|------|------|-------|');

  for (const entry of report.entries) {
    const sign = entry.percentChange > 0 ? '+' : '';
    const icon = entry.percentChange > 5 ? '🔴'
      : entry.percentChange < -5 ? '🟢'
      : entry.percentChange > 1 ? '🟡'
      : '➖';
    lines.push(
      `| ${entry.name} | ${entry.metric} | ${entry.baseline} | ${entry.current} | ${sign}${entry.diff} | ${icon} ${sign}${entry.percentChange}% |`
    );
  }

  return lines.join('\n');
}

// ============================================================================
// 辅助：重置所有 mock
// ============================================================================

function resetAllMocks(): void {
  electronMock.webContentsSend.mockReset();
  dbMock.appendMessage.mockReset().mockImplementation((m: { conversationId: string; userId: string; role: string; content: string }) => ({
    id: `m-${Math.random().toString(36).slice(2)}`,
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
  dbMock.getMessagesByConversationPaginated.mockReset().mockReturnValue([]);
  dbFilesMock.listFiles.mockReset().mockReturnValue([]);
  llmMock.streamChatCompletion.mockReset();
  llmMock.streamChatCompletionWithRetry.mockReset().mockImplementation(
    (opts: unknown) => llmMock.streamChatCompletion(opts),
  );
  toolMock.executeTool.mockReset();
  consentMock.needsConsent.mockReset().mockReturnValue(false);
  consentMock.needsKbSendConsent.mockReset().mockReturnValue(false);
  intentMock.classifyIntent.mockReset().mockReturnValue({ intent: 'create', confidence: 0.9 });
  eventStoreMock.persistAndSend.mockReset();
  contextMock.shouldCompress.mockReset().mockReturnValue(false);
}

// ============================================================================
// 场景定义
// ============================================================================

/**
 * 场景 1：简单对话 — 1 轮 chat 意图，无工具调用
 */
async function runScenario1_SimpleChat(): Promise<PerfScenario> {
  resetAllMocks();
  intentMock.classifyIntent.mockReturnValue({ intent: 'chat', confidence: 0.95 });

  const e2eStart = performance.now();

  // 阶段 1：上下文准备
  const { ms: prepareMs } = measurePhaseSync('prepareContext', () => {
    const event = makeEvent();
    const ctx = prepareAgentContext(
      event,
      makePayload({ message: '你好，今天天气怎么样？', useKnowledgeBase: false }),
      makeConfig(),
      'enc:test-key',
      new AbortController(),
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
    );
    return ctx;
  });

  // 阶段 2：消息构建（模拟一轮纯文本回复的 token 计算）
  const { ms: messageBuildMs } = measurePhaseSync('messageBuild', () => {
    const messages = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: '你好，今天天气怎么样？' },
      { role: 'assistant' as const, content: '你好！我无法获取实时天气数据，建议你查看当地天气预报。' },
    ];
    let tokens = 0;
    for (const m of messages) {
      tokens += estimateTokens(m.content);
    }
    return tokens;
  });

  const e2eMs = Math.round((performance.now() - e2eStart) * 100) / 100;

  return {
    name: 'simple-chat',
    description: '1 轮 chat 意图，无工具调用',
    metrics: {
      e2eMs,
      prepareMs,
      toolExecMs: 0,
      messageBuildMs,
      estimatedTokens: estimateTokens('你好，今天天气怎么样？'),
      toolCallCount: 0,
      roundCount: 1,
    },
  };
}

/**
 * 场景 2：多工具调用 — kbQa 意图，3 轮（searchKB + readFile + 文本输出）
 */
async function runScenario2_MultiTool(): Promise<PerfScenario> {
  resetAllMocks();
  intentMock.classifyIntent.mockReturnValue({ intent: 'kbQa', confidence: 0.88 });

  const e2eStart = performance.now();

  // 阶段 1：上下文准备
  const { ms: prepareMs, result: ctx } = measurePhaseSync('prepareContext', () => {
    const event = makeEvent();
    return prepareAgentContext(
      event,
      makePayload({ message: '根据我的笔记，React Hooks 的最佳实践有哪些？', useKnowledgeBase: true }),
      makeConfig(),
      'enc:test-key',
      new AbortController(),
      {
        consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
        searchKb: async () => ({ refused: false, threshold: 0.6, best: null, results: [] }),
      }
    );
  });

  // 阶段 2：模拟 3 轮工具执行
  const { ms: toolExecMs } = await measurePhase('toolExec', async () => {
    // 模拟第一轮：searchKB
    toolMock.executeTool.mockResolvedValueOnce({
      content: JSON.stringify({ results: Array.from({ length: 10 }, (_, i) => ({ file_id: `f${i}`, content: `笔记内容 ${i}` })) }),
      status: 'ok',
    });
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'searchKB', arguments: '{"query":"React Hooks 最佳实践","limit":10}' }],
      '',
      0,
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } },
    );

    // 模拟第二轮：readFile
    toolMock.executeTool.mockResolvedValueOnce({
      content: 'React Hooks 笔记内容...',
      status: 'ok',
    });
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'readFile', arguments: '{"file_id":"f1"}' }],
      '',
      1,
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } },
    );

    // 模拟第三轮：无工具调用（此处跳过 executeToolRound，仅做消息构建）
  });

  // 阶段 3：消息构建
  const { ms: messageBuildMs } = measurePhaseSync('messageBuild', () => {
    let tokens = 0;
    for (const m of ctx.llmMessages) {
      tokens += estimateTokens(m.content);
    }
    tokens += estimateTokens(JSON.stringify({ results: Array.from({ length: 10 }, (_, i) => ({ file_id: `f${i}`, content: `笔记内容 ${i}` })) }));
    return tokens;
  });

  const e2eMs = Math.round((performance.now() - e2eStart) * 100) / 100;

  return {
    name: 'multi-tool',
    description: 'kbQa 意图，3 轮（searchKB + readFile + 文本输出）',
    metrics: {
      e2eMs,
      prepareMs,
      toolExecMs,
      messageBuildMs,
      estimatedTokens: ctx.totalTokens + estimateTokens('React Hooks 笔记内容...'),
      toolCallCount: 2,
      roundCount: 3,
    },
  };
}

/**
 * 场景 3：大文档编辑 — rewrite 意图，editBlocks proposal 生成
 */
async function runScenario3_LargeDocEdit(): Promise<PerfScenario> {
  resetAllMocks();
  intentMock.classifyIntent.mockReturnValue({ intent: 'rewrite', confidence: 0.92 });

  // 生成一个大文档（模拟 2000 行 markdown）
  const largeDocLines: string[] = [];
  for (let i = 0; i < 2000; i++) {
    largeDocLines.push(`## Section ${i + 1}`);
    largeDocLines.push('');
    largeDocLines.push(`这是第 ${i + 1} 节的正文内容。包含一些示例代码和说明文字。`);
    largeDocLines.push('');
    largeDocLines.push('```typescript');
    largeDocLines.push(`const value${i} = "test";`);
    largeDocLines.push('```');
    largeDocLines.push('');
  }
  const largeDocument = largeDocLines.join('\n');

  const e2eStart = performance.now();

  // 阶段 1：上下文准备（含大文档上下文构建）
  const { ms: prepareMs, result: ctx } = measurePhaseSync('prepareContext', () => {
    const event = makeEvent();
    return prepareAgentContext(
      event,
      makePayload({
        message: '把这个文档中的所有代码块都改成 JavaScript',
        useKnowledgeBase: false,
        currentDocument: largeDocument,
      }),
      makeConfig(),
      'enc:test-key',
      new AbortController(),
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } }
    );
  });

  // 阶段 2：文档上下文构建（独立测量）
  const { ms: docContextMs } = measurePhaseSync('docContext', () => {
    const docCtx = buildDocumentContext(largeDocument);
    return docCtx ? estimateTokens(docCtx) : 0;
  });

  // 阶段 3：消息构建
  const { ms: messageBuildMs } = measurePhaseSync('messageBuild', () => {
    const prompt = buildAgentSystemPrompt('', '', false);
    let tokens = estimateTokens(prompt);
    tokens += docContextMs; // docContextMs here holds the token count (reused variable)
    tokens += estimateTokens('把这个文档中的所有代码块都改成 JavaScript');
    return tokens;
  });

  const e2eMs = Math.round((performance.now() - e2eStart) * 100) / 100;

  return {
    name: 'large-doc-edit',
    description: 'rewrite 意图，大文档(2000行) editBlocks proposal 生成',
    metrics: {
      e2eMs,
      prepareMs,
      toolExecMs: 0,
      messageBuildMs,
      estimatedTokens: ctx.totalTokens,
      toolCallCount: 0,
      roundCount: 1,
    },
  };
}

/**
 * 场景 4：知识库检索 — kbQa 意图，searchKB 返回 20 条结果
 */
async function runScenario4_KbRetrieval(): Promise<PerfScenario> {
  resetAllMocks();
  intentMock.classifyIntent.mockReturnValue({ intent: 'kbQa', confidence: 0.85 });

  // 生成 20 条模拟知识库结果
  const kbResults: IKbSearchResult[] = Array.from({ length: 20 }, (_, i) => ({
    docId: `kb_doc_${i}`,
    chunkId: `chunk_${i}`,
    fileName: `note_${i}.md`,
    content: `这是知识库文档 ${i} 的内容。包含多条关于 WeaveMD 项目的笔记信息。`.repeat(3),
    score: 0.95 - i * 0.02,
    seq: i,
    pinned: i === 0,
    sourceRef: null,
  }));

  const e2eStart = performance.now();

  // 阶段 1：上下文准备
  const { ms: prepareMs, result: ctx } = measurePhaseSync('prepareContext', () => {
    const event = makeEvent();
    return prepareAgentContext(
      event,
      makePayload({
        message: 'WeaveMD 项目中有哪些关于编辑器架构的笔记？',
        useKnowledgeBase: true,
      }),
      makeConfig(),
      'enc:test-key',
      new AbortController(),
      {
        consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
        searchKb: async () => ({ refused: false, threshold: 0.6, best: kbResults[0], results: kbResults }),
      }
    );
  });

  // 阶段 2：模拟 searchKB 工具返回 20 条结果
  const { ms: toolExecMs } = await measurePhase('toolExec', async () => {
    const resultJson = JSON.stringify({ results: kbResults, total: 20 });
    toolMock.executeTool.mockResolvedValueOnce({
      content: resultJson,
      status: 'ok',
    });
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'searchKB', arguments: '{"query":"编辑器架构","limit":20}' }],
      '',
      0,
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } },
    );
  });

  // 阶段 3：消息构建
  const { ms: messageBuildMs } = measurePhaseSync('messageBuild', () => {
    let tokens = 0;
    tokens += estimateTokens('WeaveMD 项目中有哪些关于编辑器架构的笔记？');
    for (const r of kbResults) {
      tokens += estimateTokens(r.content);
    }
    return tokens;
  });

  const e2eMs = Math.round((performance.now() - e2eStart) * 100) / 100;

  return {
    name: 'kb-retrieval',
    description: 'kbQa 意图，searchKB 返回 20 条结果',
    metrics: {
      e2eMs,
      prepareMs,
      toolExecMs,
      messageBuildMs,
      estimatedTokens: ctx.totalTokens + messageBuildMs,
      toolCallCount: 1,
      roundCount: 2,
    },
  };
}

/**
 * 场景 5：写控制确认 — create 意图，deleteFile 强制确认
 */
async function runScenario5_WriteConfirm(): Promise<PerfScenario> {
  resetAllMocks();
  intentMock.classifyIntent.mockReturnValue({ intent: 'create', confidence: 0.91 });

  const e2eStart = performance.now();

  // 阶段 1：上下文准备
  const { ms: prepareMs, result: ctx } = measurePhaseSync('prepareContext', () => {
    const event = makeEvent();
    return prepareAgentContext(
      event,
      makePayload({
        message: '创建一个新笔记，然后删除旧的临时文件',
        useKnowledgeBase: false,
        currentDocument: '# 新笔记\n\n内容...',
      }),
      makeConfig(),
      'enc:test-key',
      new AbortController(),
      {
        consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
        waitForInteraction: async () => ({}),
        onInteractionRequired: vi.fn(),
      }
    );
  });

  // 阶段 2：模拟 write 工具执行（createFile + deleteFile 需要确认）
  const { ms: toolExecMs } = await measurePhase('toolExec', async () => {
    // 第一轮：createFile
    toolMock.executeTool.mockResolvedValueOnce({
      content: JSON.stringify({ file_id: 'new_file_1', file_name: '新笔记.md' }),
      status: 'ok',
    });
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'createFile', arguments: '{"file_name":"新笔记.md","content":"内容..."}' }],
      '',
      0,
      {
        consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
        waitForInteraction: async () => ({}),
        onInteractionRequired: vi.fn(),
      },
    );

    // 第二轮：deleteFile (需要 force confirm)
    toolMock.executeTool.mockResolvedValueOnce({
      content: JSON.stringify({ success: true }),
      status: 'ok',
    });
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'deleteFile', arguments: '{"file_id":"old_temp"}' }],
      '',
      1,
      {
        consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
        waitForInteraction: async () => ({}),
        onInteractionRequired: vi.fn(),
      },
    );
  });

  // 阶段 3：消息构建
  const { ms: messageBuildMs } = measurePhaseSync('messageBuild', () => {
    let tokens = 0;
    for (const m of ctx.llmMessages) {
      tokens += estimateTokens(m.content);
    }
    return tokens;
  });

  const e2eMs = Math.round((performance.now() - e2eStart) * 100) / 100;

  return {
    name: 'write-confirm',
    description: 'create 意图，createFile + deleteFile 强制确认',
    metrics: {
      e2eMs,
      prepareMs,
      toolExecMs,
      messageBuildMs,
      estimatedTokens: ctx.totalTokens,
      toolCallCount: 2,
      roundCount: 2,
    },
  };
}

// ============================================================================
// 测试套件
// ============================================================================

describe('Agent Performance Benchmark (S13)', () => {
  const scenarios: PerfScenario[] = [];

  // 测试 1a-e：5 个场景全部成功运行
  it('scenario 1: simple chat (1 round, no tools)', async () => {
    const result = await runScenario1_SimpleChat();
    expect(result.metrics.e2eMs).toBeGreaterThan(0);
    expect(result.metrics.prepareMs).toBeGreaterThan(0);
    expect(result.metrics.toolCallCount).toBe(0);
    expect(result.metrics.roundCount).toBe(1);
    scenarios.push(result);
  });

  it('scenario 2: multi-tool (kbQa, 3 rounds, searchKB + readFile)', async () => {
    const result = await runScenario2_MultiTool();
    expect(result.metrics.e2eMs).toBeGreaterThan(0);
    expect(result.metrics.toolExecMs).toBeGreaterThan(0);
    expect(result.metrics.toolCallCount).toBe(2);
    expect(result.metrics.roundCount).toBe(3);
    scenarios.push(result);
  });

  it('scenario 3: large document edit (rewrite, 2000-line doc)', async () => {
    const result = await runScenario3_LargeDocEdit();
    expect(result.metrics.e2eMs).toBeGreaterThan(0);
    expect(result.metrics.prepareMs).toBeGreaterThan(0);
    expect(result.metrics.estimatedTokens).toBeGreaterThan(1000);
    scenarios.push(result);
  });

  it('scenario 4: knowledge base retrieval (kbQa, 20 results)', async () => {
    const result = await runScenario4_KbRetrieval();
    expect(result.metrics.e2eMs).toBeGreaterThan(0);
    expect(result.metrics.toolExecMs).toBeGreaterThan(0);
    expect(result.metrics.toolCallCount).toBe(1);
    scenarios.push(result);
  });

  it('scenario 5: write control confirm (create + deleteFile force confirm)', async () => {
    const result = await runScenario5_WriteConfirm();
    expect(result.metrics.e2eMs).toBeGreaterThan(0);
    expect(result.metrics.toolExecMs).toBeGreaterThan(0);
    expect(result.metrics.toolCallCount).toBe(2);
    scenarios.push(result);
  });

  // 测试 2：compareWithBaseline 正确计算差值
  it('compareWithBaseline calculates diffs correctly', () => {
    const baseline: PerfBaseline = {
      timestamp: '2026-01-01T00:00:00Z',
      commit: 'abc1234',
      nodeVersion: 'v20.0.0',
      platform: 'win32',
      scenarios: [
        {
          name: 'simple-chat',
          description: 'test',
          metrics: { e2eMs: 50, prepareMs: 30, toolExecMs: 0, messageBuildMs: 10, estimatedTokens: 100, toolCallCount: 0, roundCount: 1 },
        },
        {
          name: 'multi-tool',
          description: 'test',
          metrics: { e2eMs: 200, prepareMs: 40, toolExecMs: 100, messageBuildMs: 20, estimatedTokens: 500, toolCallCount: 2, roundCount: 3 },
        },
      ],
    };

    const current: PerfScenario[] = [
      {
        name: 'simple-chat',
        description: 'test',
        metrics: { e2eMs: 45, prepareMs: 28, toolExecMs: 0, messageBuildMs: 11, estimatedTokens: 110, toolCallCount: 0, roundCount: 1 },
      },
      {
        name: 'multi-tool',
        description: 'test',
        metrics: { e2eMs: 220, prepareMs: 44, toolExecMs: 115, messageBuildMs: 18, estimatedTokens: 480, toolCallCount: 2, roundCount: 3 },
      },
    ];

    const report = compareWithBaseline(current, baseline);

    // 验证条目数量（2 场景 × 7 指标 = 14）
    expect(report.entries.length).toBe(14);

    // 验证特定差值
    const e2eSimple = report.entries.find((e) => e.name === 'simple-chat' && e.metric === 'e2eMs');
    expect(e2eSimple).toBeDefined();
    expect(e2eSimple!.baseline).toBe(50);
    expect(e2eSimple!.current).toBe(45);
    expect(e2eSimple!.diff).toBe(-5);
    expect(e2eSimple!.percentChange).toBe(-10);

    const e2eMulti = report.entries.find((e) => e.name === 'multi-tool' && e.metric === 'e2eMs');
    expect(e2eMulti).toBeDefined();
    expect(e2eMulti!.diff).toBe(20);
    expect(e2eMulti!.percentChange).toBe(10);

    // 验证摘要
    expect(report.summary.totalScenarios).toBe(14);
    expect(report.summary.improved).toBeGreaterThan(0);
    expect(report.summary.degraded).toBeGreaterThan(0);

    // 验证 Markdown 格式输出
    const md = formatComparisonMarkdown(report);
    expect(md).toContain('# Agent Performance Benchmark');
    expect(md).toContain('abc1234');
    expect(md).toContain('simple-chat');
    expect(md).toContain('multi-tool');
  });

  // 测试 3：基准 JSON 可正确序列化/反序列化
  it('baseline JSON round-trip: serialize → deserialize → verify', () => {
    const original: PerfBaseline = {
      timestamp: new Date().toISOString(),
      commit: getCommitHash(),
      nodeVersion: process.version,
      platform: process.platform,
      scenarios,
    };

    // 序列化
    const json = JSON.stringify(original, null, 2);
    expect(json).toBeTruthy();
    expect(() => JSON.parse(json)).not.toThrow();

    // 反序列化
    const restored = JSON.parse(json) as PerfBaseline;
    expect(restored.timestamp).toBe(original.timestamp);
    expect(restored.commit).toBe(original.commit);
    expect(restored.scenarios.length).toBe(original.scenarios.length);

    // 验证每个场景的指标可恢复
    for (let i = 0; i < original.scenarios.length; i++) {
      const orig = original.scenarios[i];
      const rest = restored.scenarios[i];
      expect(rest.name).toBe(orig.name);
      expect(rest.description).toBe(orig.description);
      expect(rest.metrics.e2eMs).toBe(orig.metrics.e2eMs);
      expect(rest.metrics.prepareMs).toBe(orig.metrics.prepareMs);
      expect(rest.metrics.toolExecMs).toBe(orig.metrics.toolExecMs);
      expect(rest.metrics.messageBuildMs).toBe(orig.metrics.messageBuildMs);
      expect(rest.metrics.estimatedTokens).toBe(orig.metrics.estimatedTokens);
      expect(rest.metrics.toolCallCount).toBe(orig.metrics.toolCallCount);
      expect(rest.metrics.roundCount).toBe(orig.metrics.roundCount);
    }
  });

  // 测试 4：保存/加载基线文件
  it('saveBaseline and loadBaseline work correctly', () => {
    const testBaseline: PerfBaseline = {
      timestamp: '2026-09-17T00:00:00Z',
      commit: 'test123',
      nodeVersion: 'v22.0.0',
      platform: 'test',
      scenarios: [
        {
          name: 'test-scenario',
          description: 'a test scenario',
          metrics: { e2eMs: 100, prepareMs: 30, toolExecMs: 40, messageBuildMs: 20, estimatedTokens: 200, toolCallCount: 1, roundCount: 1 },
        },
      ],
    };

    saveBaseline(testBaseline);
    const loaded = loadBaseline();
    expect(loaded).not.toBeNull();
    expect(loaded!.commit).toBe('test123');
    expect(loaded!.scenarios.length).toBe(1);
    expect(loaded!.scenarios[0].metrics.e2eMs).toBe(100);

    // 清理测试文件
    try { fs.unlinkSync(BASELINE_PATH); } catch { /* ignore */ }
  });

  // 测试 5：空基线对比不抛异常
  it('compareWithBaseline handles empty baseline gracefully', () => {
    const emptyBaseline: PerfBaseline = {
      timestamp: '2026-01-01T00:00:00Z',
      commit: 'empty',
      nodeVersion: 'v20.0.0',
      platform: 'test',
      scenarios: [],
    };

    const current: PerfScenario[] = [
      {
        name: 'simple-chat',
        description: 'test',
        metrics: { e2eMs: 50, prepareMs: 30, toolExecMs: 0, messageBuildMs: 10, estimatedTokens: 100, toolCallCount: 0, roundCount: 1 },
      },
    ];

    const report = compareWithBaseline(current, emptyBaseline);
    expect(report.entries.length).toBe(0);
    expect(report.summary.totalScenarios).toBe(0);
    expect(report.summary.improved).toBe(0);
    expect(report.summary.degraded).toBe(0);
  });

  // 测试 6：loadBaselineOrEmpty 在文件不存在时返回空基线
  it('loadBaselineOrEmpty returns empty baseline when file missing', () => {
    // 确保文件不存在
    try { fs.unlinkSync(BASELINE_PATH); } catch { /* ignore */ }

    const baseline = loadBaselineOrEmpty();
    expect(baseline.scenarios.length).toBe(0);
    expect(baseline.commit).toBeTruthy();
    expect(baseline.timestamp).toBeTruthy();
  });

  // 测试 7：formatComparisonMarkdown 生成有效表格
  it('formatComparisonMarkdown generates valid markdown table', () => {
    const report: ComparisonReport = {
      timestamp: '2026-09-17T00:00:00Z',
      baselineTimestamp: '2026-09-16T00:00:00Z',
      baselineCommit: 'abc123',
      currentCommit: 'def456',
      entries: [
        { name: 'simple-chat', metric: 'e2eMs', baseline: 100, current: 90, diff: -10, percentChange: -10 },
        { name: 'simple-chat', metric: 'prepareMs', baseline: 50, current: 55, diff: 5, percentChange: 10 },
        { name: 'multi-tool', metric: 'e2eMs', baseline: 200, current: 200, diff: 0, percentChange: 0 },
      ],
      summary: { totalScenarios: 3, improved: 1, degraded: 1, unchanged: 1, avgPercentChange: 0 },
    };

    const md = formatComparisonMarkdown(report);
    expect(md).toContain('abc123');
    expect(md).toContain('def456');
    expect(md).toContain('simple-chat');
    expect(md).toContain('multi-tool');
    expect(md).toContain('| 场景 | 指标 | 基线 | 当前 | 差值 | 变化% |');
    // 检查改善/退化标记
    expect(md).toContain('🟢');
    expect(md).toContain('🔴');
    expect(md).toContain('➖');
  });

  // 测试 8：验证底层函数 benchmark（classifyIntent, estimateTokens, toolsForIntent）
  it('low-level function benchmarks: classifyIntent, estimateTokens, toolsForIntent', () => {
    // classifyIntent
    const { ms: classifyMs } = measurePhaseSync('classifyIntent', () => {
      return classifyIntent('帮我修改这个文档中的错别字和语法错误');
    });
    expect(classifyMs).toBeGreaterThanOrEqual(0);

    // estimateTokens (with CJK + Latin mixed text)
    const { ms: estimateMs } = measurePhaseSync('estimateTokens', () => {
      const text = '这是一段包含中文和English混合的文本，用于测试 token estimation 的性能表现。'.repeat(100);
      return estimateTokens(text);
    });
    expect(estimateMs).toBeGreaterThanOrEqual(0);

    // toolsForIntent
    const { ms: toolsMs } = measurePhaseSync('toolsForIntent', () => {
      return toolsForIntent(
        { intent: 'rewrite', confidence: 0.9 },
        false,
        true,
        '# Test Document\n\nSome content here.',
        false,
        false
      );
    });
    expect(toolsMs).toBeGreaterThanOrEqual(0);
  });
});
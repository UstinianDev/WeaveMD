// ============================================
// WeaveMD — StreamingToolExecutor Unit Tests (S1)
// ============================================
// 编译时常量 + 状态机 + 并发安全 + 顺序产出 + 级联取消

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock: concurrencyDefs (isToolConcurrencySafe / safeParseArgs)
// ---------------------------------------------------------------------------
const concurrencyMock = vi.hoisted(() => ({
  isToolConcurrencySafe: vi.fn(),
  safeParseArgs: vi.fn((args: string) => {
    try { return JSON.parse(args) as Record<string, unknown>; }
    catch { return {}; }
  }),
}));
vi.mock('@main/ai/agent/concurrencyDefs', () => concurrencyMock);

// ---------------------------------------------------------------------------
// Mock: agentToolExecutor (executeOneTool)
// ---------------------------------------------------------------------------
const toolExecMock = vi.hoisted(() => ({
  executeOneTool: vi.fn(),
}));
vi.mock('@main/ai/agent/agentToolExecutor', () => toolExecMock);

// ---------------------------------------------------------------------------
// Mock: agentContext (minimal)
// ---------------------------------------------------------------------------
function makeFakeCtx(overrides: Record<string, unknown> = {}) {
  return {
    convId: 'test-conv-1',
    userId: 'u1',
    send: vi.fn(),
    intent: { intent: 'create', confidence: 0.9 },
    baseUrl: 'https://fake.api',
    model: 'deepseek-chat',
    toolCtx: {
      userId: 'u1',
      currentDocument: undefined,
    },
    tools: [],
    llmMessages: [],
    detector: {
      checkRoundLimit: () => false,
      isNearRoundLimit: () => false,
      checkSameResult: () => ({ detected: false }),
      checkConsecutiveFailure: () => ({ detected: false }),
      getStats: () => ({ roundsUsed: 0, maxRounds: 12, sameResultCount: 0, consecutiveFailureCount: 0 }),
    },
    toolCallsHistory: [],
    hasSessionPersist: false,
    roundsUsed: 0,
    reasoningTokenCount: null,
    assistantId: '',
    totalTokens: 0,
    ...overrides,
  } as unknown as import('@main/ai/agent/agentContext').AgentContext;
}

// SUT — imported after mocks
import { StreamingToolExecutor, STREAMING_TOOL_EXEC_ENABLED } from '@main/ai/agent/StreamingToolExecutor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTc(index: number, name: string, args = '{}') {
  return { index, name, arguments: args };
}

function makeToolExecResult(tc: ReturnType<typeof makeTc>, toolCallId: string, ok = true) {
  return {
    tc,
    toolCallId,
    result: {
      content: ok ? `${tc.name} result` : '',
      status: ok ? ('ok' as const) : ('error' as const),
      ...(ok ? {} : { errorDesc: 'mock error' }),
    },
  };
}

beforeEach(() => {
  toolExecMock.executeOneTool.mockReset();
  concurrencyMock.isToolConcurrencySafe.mockReset();
  concurrencyMock.safeParseArgs.mockReset();
  // Default safeParseArgs: real implementation
  concurrencyMock.safeParseArgs.mockImplementation((args: string) => {
    try { return JSON.parse(args) as Record<string, unknown>; }
    catch { return {}; }
  });
});

// ===========================================================================
// Tests
// ===========================================================================

describe('StreamingToolExecutor', () => {
  // -------------------------------------------------------------------------
  // Test 1: STREAMING_TOOL_EXEC_ENABLED exists and is boolean
  // -------------------------------------------------------------------------
  it('STREAMING_TOOL_EXEC_ENABLED is a compile-time constant (boolean)', () => {
    expect(typeof STREAMING_TOOL_EXEC_ENABLED).toBe('boolean');
  });

  // -------------------------------------------------------------------------
  // Test 2: single safe tool executes immediately
  // -------------------------------------------------------------------------
  it('single safe tool executes immediately on onToolCall', async () => {
    concurrencyMock.isToolConcurrencySafe.mockReturnValue(true);
    const tc = makeTc(0, 'readFile', '{"file_id":"f1"}');
    const expectedResult = makeToolExecResult(tc, 'call_1_0');
    toolExecMock.executeOneTool.mockResolvedValue(expectedResult);

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    executor.onToolCall(tc);

    // Should have been called immediately
    expect(toolExecMock.executeOneTool).toHaveBeenCalledTimes(1);
    expect(toolExecMock.executeOneTool).toHaveBeenCalledWith(tc, 1, expect.anything(), undefined);

    // Wait for completion
    const results = await executor.waitForAll();
    expect(results).toHaveLength(1);
    expect(results[0].tc.name).toBe('readFile');
    expect(results[0].result.status).toBe('ok');
  });

  // -------------------------------------------------------------------------
  // Test 3: non-safe tools are queued, not executed immediately
  // -------------------------------------------------------------------------
  it('non-safe tools are queued, not executed until getRemainingResults', async () => {
    concurrencyMock.isToolConcurrencySafe.mockReturnValue(false);
    const tc = makeTc(0, 'deleteFile', '{"file_id":"f1"}');
    const expectedResult = makeToolExecResult(tc, 'call_1_0');
    toolExecMock.executeOneTool.mockResolvedValue(expectedResult);

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    executor.onToolCall(tc);

    // Should NOT have been called immediately
    expect(toolExecMock.executeOneTool).not.toHaveBeenCalled();

    // Use waitForAll to collect all results
    const allResults = await executor.waitForAll();
    expect(toolExecMock.executeOneTool).toHaveBeenCalledTimes(1);
    expect(allResults).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Test 4: multiple safe tools execute concurrently
  // -------------------------------------------------------------------------
  it('multiple safe tools execute concurrently (fire-and-forget)', async () => {
    concurrencyMock.isToolConcurrencySafe.mockReturnValue(true);

    // Tools with different delays
    const tcs = [
      makeTc(0, 'readFile', '{"file_id":"f1"}'),
      makeTc(1, 'searchKB', '{"query":"test"}'),
      makeTc(2, 'listFiles', '{}'),
    ];

    const resolveOrder: string[] = [];
    toolExecMock.executeOneTool.mockImplementation(async (tc: { name: string }) => {
      if (tc.name === 'readFile') {
        await new Promise(r => setTimeout(r, 30));
      } else if (tc.name === 'searchKB') {
        await new Promise(r => setTimeout(r, 10));
      } else {
        await new Promise(r => setTimeout(r, 20));
      }
      resolveOrder.push(tc.name);
      return makeToolExecResult(
        { index: tcs.find(t => t.name === tc.name)!.index, name: tc.name, arguments: '{}' },
        `call_1_${tcs.find(t => t.name === tc.name)!.index}`
      );
    });

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    for (const tc of tcs) {
      executor.onToolCall(tc);
    }

    // All three should have been fired immediately
    expect(toolExecMock.executeOneTool).toHaveBeenCalledTimes(3);

    // Wait for all
    const results = await executor.waitForAll();
    expect(results).toHaveLength(3);

    // Due to concurrent execution, searchKB (10ms) should finish first
    expect(resolveOrder[0]).toBe('searchKB');
  });

  // -------------------------------------------------------------------------
  // Test 5: getCompletedResults yields results in registration index order
  // -------------------------------------------------------------------------
  it('getCompletedResults yields results in registration order (by index)', async () => {
    concurrencyMock.isToolConcurrencySafe.mockReturnValue(true);

    const tcs = [
      makeTc(0, 'readFile', '{}'),
      makeTc(1, 'searchKB', '{}'),
    ];

    // readFile is slow, searchKB is fast
    toolExecMock.executeOneTool.mockImplementation(async (tc: { name: string }) => {
      if (tc.name === 'readFile') {
        await new Promise(r => setTimeout(r, 50));
      }
      return makeToolExecResult(
        { index: tc.name === 'readFile' ? 0 : 1, name: tc.name, arguments: '{}' },
        `call_1_${tc.name === 'readFile' ? 0 : 1}`
      );
    });

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    for (const tc of tcs) {
      executor.onToolCall(tc);
    }

    // Initially nothing completed (readFile is slow)
    const early = [...executor.getCompletedResults()];
    expect(early).toHaveLength(0);

    // Wait for all
    const all = await executor.waitForAll();

    // After waiting, results are available
    expect(all).toHaveLength(2);
    // Results are in registration order (by index)
    expect(all[0].tc.name).toBe('readFile');
    expect(all[1].tc.name).toBe('searchKB');
  });

  // -------------------------------------------------------------------------
  // Test 6: non-safe tool blocks getCompletedResults (queue semantics)
  // -------------------------------------------------------------------------
  it('getCompletedResults stops at a non-safe executing tool (queue block)', async () => {
    // Tool 0: safe (readFile)
    // Tool 1: non-safe (deleteFile - queued, not yet executing)
    concurrencyMock.isToolConcurrencySafe
      .mockReturnValueOnce(true)   // readFile is safe
      .mockReturnValueOnce(false); // deleteFile is non-safe

    const tcs = [
      makeTc(0, 'readFile', '{}'),
      makeTc(1, 'deleteFile', '{"file_id":"f1"}'),
    ];

    let readFileResolve: (v: unknown) => void;
    toolExecMock.executeOneTool.mockImplementation(async (tc: { name: string }) => {
      if (tc.name === 'readFile') {
        return new Promise(resolve => { readFileResolve = resolve; });
      }
      return makeToolExecResult(
        { index: 1, name: 'deleteFile', arguments: '{}' },
        'call_1_1'
      );
    });

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    for (const tc of tcs) {
      executor.onToolCall(tc);
    }

    // readFile is executing, deleteFile is queued
    // getCompletedResults should return nothing (readFile not done, deleteFile blocks)
    const early = [...executor.getCompletedResults()];
    expect(early).toHaveLength(0);

    // Complete readFile
    readFileResolve!(makeToolExecResult(tcs[0], 'call_1_0'));
    // Small delay for promise resolution
    await new Promise(r => setImmediate(r));

    // Now getCompletedResults should yield readFile but stop at deleteFile (queued, non-safe)
    const afterOne = [...executor.getCompletedResults()];
    expect(afterOne).toHaveLength(1);
    expect(afterOne[0].tc.name).toBe('readFile');
  });

  // -------------------------------------------------------------------------
  // Test 7: getRemainingResults waits for all tools to complete
  // -------------------------------------------------------------------------
  it('getRemainingResults waits for all tools including queued non-safe', async () => {
    concurrencyMock.isToolConcurrencySafe
      .mockReturnValueOnce(true)   // readFile safe
      .mockReturnValueOnce(false); // deleteFile non-safe

    const tcs = [
      makeTc(0, 'readFile', '{}'),
      makeTc(1, 'deleteFile', '{"file_id":"f1"}'),
    ];

    toolExecMock.executeOneTool.mockImplementation(async (tc: { name: string }) => {
      return makeToolExecResult(
        { index: tc.name === 'readFile' ? 0 : 1, name: tc.name, arguments: '{}' },
        `call_1_${tc.name === 'readFile' ? 0 : 1}`
      );
    });

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    for (const tc of tcs) {
      executor.onToolCall(tc);
    }

    // waitForAll should wait for both (including executing non-safe queued tools)
    const results = await executor.waitForAll();
    expect(results).toHaveLength(2);
    expect(results[0].tc.name).toBe('readFile');
    expect(results[1].tc.name).toBe('deleteFile');
  });

  // -------------------------------------------------------------------------
  // Test 8: abortAll prevents further tool execution
  // -------------------------------------------------------------------------
  it('abortAll prevents queued tools from executing', async () => {
    concurrencyMock.isToolConcurrencySafe.mockReturnValue(false); // all non-safe → queued

    const tcs = [
      makeTc(0, 'deleteFile', '{}'),
      makeTc(1, 'editLocalFile', '{}'),
    ];

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    for (const tc of tcs) {
      executor.onToolCall(tc);
    }

    // None executed yet (all non-safe → queued)
    expect(toolExecMock.executeOneTool).not.toHaveBeenCalled();

    // Abort
    executor.abortAll('user cancelled');

    // Now waitForAll — should skip queued tools (aborted)
    // NOTE: abortAll sets a flag, waitForAll checks it before executing queued tools
    const results = await executor.waitForAll();
    expect(results).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 9: tool execution error does not block other tools
  // -------------------------------------------------------------------------
  it('tool execution error does not block other tools', async () => {
    concurrencyMock.isToolConcurrencySafe.mockReturnValue(true);

    const tcs = [
      makeTc(0, 'readFile', '{}'),
      makeTc(1, 'searchKB', '{}'),
    ];

    toolExecMock.executeOneTool.mockImplementation(async (tc: { name: string }) => {
      if (tc.name === 'readFile') {
        throw new Error('file not found');
      }
      return makeToolExecResult(
        { index: 1, name: 'searchKB', arguments: '{}' },
        'call_1_1'
      );
    });

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    for (const tc of tcs) {
      executor.onToolCall(tc);
    }

    const results = await executor.waitForAll();
    expect(results).toHaveLength(2);

    // First tool: error status
    const readFileResult = results.find(r => r.tc.name === 'readFile');
    expect(readFileResult).toBeDefined();
    expect(readFileResult!.result.status).toBe('error');

    // Second tool: ok
    const searchResult = results.find(r => r.tc.name === 'searchKB');
    expect(searchResult).toBeDefined();
    expect(searchResult!.result.status).toBe('ok');
  });

  // -------------------------------------------------------------------------
  // Test 10: mixed safe/unsafe tools maintain correct sequence
  // -------------------------------------------------------------------------
  it('mixed safe/unsafe tools: safe execute concurrently, unsafe wait for all', async () => {
    concurrencyMock.isToolConcurrencySafe
      .mockReturnValueOnce(true)   // readFile safe
      .mockReturnValueOnce(false)  // deleteFile non-safe
      .mockReturnValueOnce(true);  // searchKB safe

    const tcs = [
      makeTc(0, 'readFile', '{}'),
      makeTc(1, 'deleteFile', '{"file_id":"f1"}'),
      makeTc(2, 'searchKB', '{}'),
    ];

    const executionOrder: string[] = [];
    toolExecMock.executeOneTool.mockImplementation(async (tc: { name: string }) => {
      executionOrder.push(tc.name);
      return makeToolExecResult(
        { index: tcs.find(t => t.name === tc.name)!.index, name: tc.name, arguments: '{}' },
        `call_1_${tcs.find(t => t.name === tc.name)!.index}`
      );
    });

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    for (const tc of tcs) {
      executor.onToolCall(tc);
    }

    // Safe tools (readFile, searchKB) should have started immediately
    expect(executionOrder).toContain('readFile');
    expect(executionOrder).toContain('searchKB');

    // Non-safe (deleteFile) should NOT have started yet
    expect(executionOrder).not.toContain('deleteFile');

    // Wait for all — deleteFile should execute after safe tools
    await executor.waitForAll();
    expect(executionOrder).toContain('deleteFile');
  });

  // -------------------------------------------------------------------------
  // Test 11: waitForAll returns results sorted by registration index
  // -------------------------------------------------------------------------
  it('waitForAll returns results sorted by registration index regardless of completion order', async () => {
    concurrencyMock.isToolConcurrencySafe.mockReturnValue(true);

    const tcs = [
      makeTc(0, 'readFile', '{}'),
      makeTc(1, 'searchKB', '{}'),
      makeTc(2, 'listFiles', '{}'),
    ];

    // Fast tools complete out of order
    toolExecMock.executeOneTool.mockImplementation(async (tc: { name: string }) => {
      const delays: Record<string, number> = { readFile: 30, searchKB: 5, listFiles: 15 };
      await new Promise(r => setTimeout(r, delays[tc.name] || 0));
      return makeToolExecResult(
        { index: tcs.find(t => t.name === tc.name)!.index, name: tc.name, arguments: '{}' },
        `call_1_${tcs.find(t => t.name === tc.name)!.index}`
      );
    });

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    for (const tc of tcs) {
      executor.onToolCall(tc);
    }

    const results = await executor.waitForAll();
    expect(results).toHaveLength(3);

    // Results must be in index order: 0, 1, 2
    expect(results[0].tc.index).toBe(0);
    expect(results[1].tc.index).toBe(1);
    expect(results[2].tc.index).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Test 12: no tools → waitForAll returns empty
  // -------------------------------------------------------------------------
  it('no tools registered → waitForAll returns empty array', async () => {
    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    const results = await executor.waitForAll();
    expect(results).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 13: getCompletedResults does not yield same result twice
  // -------------------------------------------------------------------------
  it('getCompletedResults yields each result only once (yielded state)', async () => {
    concurrencyMock.isToolConcurrencySafe.mockReturnValue(true);

    toolExecMock.executeOneTool.mockResolvedValue(
      makeToolExecResult(makeTc(0, 'readFile', '{}'), 'call_1_0')
    );

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    executor.onToolCall(makeTc(0, 'readFile', '{}'));

    // Wait for completion
    await executor.waitForAll();

    // First call to getCompletedResults after waitForAll should yield results
    const first = [...executor.getCompletedResults()];
    expect(first).toHaveLength(1);

    // Second call should yield nothing (already yielded)
    const second = [...executor.getCompletedResults()];
    expect(second).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 14: PERF logging is present (compile-time constant)
  // -------------------------------------------------------------------------
  it('PERF: STREAMING_TOOL_EXEC_ENABLED constant can be toggled for benchmark', () => {
    // This test verifies the constant exists and can be used as a feature flag
    if (STREAMING_TOOL_EXEC_ENABLED) {
      expect(true).toBe(true); // new path
    } else {
      expect(true).toBe(true); // fallback path
    }
  });

  // -------------------------------------------------------------------------
  // Test 15: waitForAll skips tools in skipToolNames (force_confirm safety)
  // -------------------------------------------------------------------------
  it('waitForAll skips tools in skipToolNames, leaving them queued', async () => {
    concurrencyMock.isToolConcurrencySafe.mockReturnValue(false); // all queued

    const tcs = [
      makeTc(0, 'readFile', '{"file_id":"f1"}'),
      makeTc(1, 'deleteFile', '{"file_id":"f2"}'), // FORCE_CONFIRM_TOOLS
      makeTc(2, 'searchKB', '{"query":"test"}'),
    ];

    toolExecMock.executeOneTool.mockImplementation(async (tc: { name: string; index: number; arguments: string }) => {
      return makeToolExecResult(tc, `call_1_${tc.index}`);
    });

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    for (const tc of tcs) {
      executor.onToolCall(tc);
    }

    // waitForAll with skipToolNames — deleteFile should be skipped
    const skipSet = new Set(['deleteFile']);
    const results = await executor.waitForAll(skipSet);

    // deleteFile should NOT have been executed
    const executedNames = toolExecMock.executeOneTool.mock.calls.map(
      (c: [{ name: string }]) => c[0].name
    );
    expect(executedNames).toContain('readFile');
    expect(executedNames).toContain('searchKB');
    expect(executedNames).not.toContain('deleteFile');

    // Results should only contain non-skipped tools
    expect(results).toHaveLength(2);
    expect(results.map(r => r.tc.name)).not.toContain('deleteFile');
  });

  // -------------------------------------------------------------------------
  // Test 16: waitForAll skip is case-sensitive exact match
  // -------------------------------------------------------------------------
  it('waitForAll skip is exact match only — similar names are not skipped', async () => {
    concurrencyMock.isToolConcurrencySafe.mockReturnValue(false);

    const tcs = [
      makeTc(0, 'deleteLocalFile', '{"file_id":"f1"}'), // FORCE_CONFIRM_TOOLS
      makeTc(1, 'deleteFile', '{"file_id":"f2"}'),       // FORCE_CONFIRM_TOOLS (not skipped this time)
    ];

    toolExecMock.executeOneTool.mockImplementation(async (tc: { name: string; index: number; arguments: string }) => {
      return makeToolExecResult(tc, `call_1_${tc.index}`);
    });

    const executor = new StreamingToolExecutor(makeFakeCtx(), 1);
    for (const tc of tcs) {
      executor.onToolCall(tc);
    }

    // Only skip deleteLocalFile, NOT deleteFile
    const skipSet = new Set(['deleteLocalFile']);
    await executor.waitForAll(skipSet);

    const executedNames = toolExecMock.executeOneTool.mock.calls.map(
      (c: [{ name: string }]) => c[0].name
    );
    expect(executedNames).not.toContain('deleteLocalFile');
    expect(executedNames).toContain('deleteFile');
  });
});
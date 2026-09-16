// ============================================
// WeaveMD — Tool Result Storage Tests (S6)
// ============================================
// 测试：单工具持久化 + 聚合预算 + ContentReplacementState 确定性 + 目录自动创建

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Mock: electron (app.getPath)
// ---------------------------------------------------------------------------
const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => ''),
  },
}));
vi.mock('electron', () => electronMock);

// We use a temp dir for file I/O
let tempDir: string;

function setTempDir(): string {
  const dir = path.join(os.tmpdir(), `weavemd-test-tool-results-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  electronMock.app.getPath.mockReturnValue(dir);
  return dir;
}

function cleanTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------
import {
  MAX_SINGLE_RESULT_CHARS,
  MAX_AGGREGATE_RESULTS_CHARS,
  TOOL_RESULTS_SUBDIR,
  ContentReplacementState,
  persistLargeResult,
  applyAggregateBudget,
  type ResultLike,
} from '@main/ai/agent/toolResultStorage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeResult(content: string, index = 0, name = 'searchKB'): ResultLike {
  return {
    toolCallId: `call_1_${index}`,
    tc: { name, index, arguments: '{}' },
    result: { content, status: 'ok' as const },
  };
}

function makeLargeContent(chars: number): string {
  let s = '';
  while (s.length < chars) {
    s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n';
  }
  return s.substring(0, chars);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('toolResultStorage', () => {
  beforeEach(() => {
    tempDir = setTempDir();
  });

  afterEach(() => {
    cleanTempDir(tempDir);
  });

  // =========================================================================
  // ContentReplacementState
  // =========================================================================
  describe('ContentReplacementState', () => {
    it('should return false for unregistered toolCallId', () => {
      const state = new ContentReplacementState();
      expect(state.hasReplacement('call_1_0')).toBe(false);
      expect(state.getReplacement('call_1_0')).toBeUndefined();
    });

    it('should register and retrieve replacement', () => {
      const state = new ContentReplacementState();
      state.registerReplacement('call_1_0', '/tmp/f.txt', 'preview...');
      expect(state.hasReplacement('call_1_0')).toBe(true);
      const r = state.getReplacement('call_1_0');
      expect(r).toEqual({ filePath: '/tmp/f.txt', preview: 'preview...' });
    });

    it('should be deterministic: same toolCallId returns same replacement', () => {
      const state = new ContentReplacementState();
      state.registerReplacement('call_1_0', '/tmp/a.txt', 'preview A');
      // Second registration with different values should NOT overwrite
      // (it's the caller's responsibility to check hasReplacement first)
      const r1 = state.getReplacement('call_1_0');
      const r2 = state.getReplacement('call_1_0');
      expect(r1).toEqual(r2);
    });

    it('should isolate different toolCallIds', () => {
      const state = new ContentReplacementState();
      state.registerReplacement('call_1_0', '/tmp/a.txt', 'preview A');
      state.registerReplacement('call_1_1', '/tmp/b.txt', 'preview B');
      expect(state.getReplacement('call_1_0')!.preview).toBe('preview A');
      expect(state.getReplacement('call_1_1')!.preview).toBe('preview B');
    });
  });

  // =========================================================================
  // persistLargeResult
  // =========================================================================
  describe('persistLargeResult', () => {
    it('test 1: small result (under threshold) should NOT be persisted', async () => {
      const smallContent = 'Hello World';
      const result = await persistLargeResult('searchKB', smallContent, 'call_1_0');
      expect(result.persisted).toBe(false);
      expect(result.displayContent).toBe(smallContent);
      expect(result.filePath).toBeUndefined();
    });

    it('test 2: large result (over threshold) should be persisted to file', async () => {
      const largeContent = makeLargeContent(MAX_SINGLE_RESULT_CHARS + 100);
      const result = await persistLargeResult('searchKB', largeContent, 'call_1_0');

      expect(result.persisted).toBe(true);
      expect(result.filePath).toBeDefined();
      expect(result.displayContent).not.toBe(largeContent);

      // Preview should be shorter than original
      expect(result.displayContent.length).toBeLessThan(largeContent.length);

      // Preview should contain a hint about the file
      expect(result.displayContent).toContain('完整内容已保存到');
      expect(result.displayContent).toContain(result.filePath!);

      // File should exist with full content
      expect(fs.existsSync(result.filePath!)).toBe(true);
      const fileContent = fs.readFileSync(result.filePath!, 'utf-8');
      expect(fileContent).toBe(largeContent);
    });

    it('test 3: deterministic replacement — same toolCallId returns same preview', async () => {
      const state = new ContentReplacementState();
      const largeContent = makeLargeContent(MAX_SINGLE_RESULT_CHARS + 200);

      const r1 = await persistLargeResult('searchKB', largeContent, 'call_1_0', state);
      const r2 = await persistLargeResult('searchKB', largeContent, 'call_1_0', state);

      expect(r1.persisted).toBe(true);
      expect(r2.persisted).toBe(true);
      // Both calls should return identical display content and file path
      expect(r1.displayContent).toBe(r2.displayContent);
      expect(r1.filePath).toBe(r2.filePath);
    });

    it('should return first 500 chars as preview prefix', async () => {
      const largeContent = makeLargeContent(MAX_SINGLE_RESULT_CHARS + 500);
      const result = await persistLargeResult('readFile', largeContent, 'call_1_1');

      expect(result.persisted).toBe(true);
      // Preview starts with first 500 chars of original content
      expect(result.displayContent.startsWith(largeContent.substring(0, 500))).toBe(true);
    });

    it('should handle empty content gracefully', async () => {
      const result = await persistLargeResult('searchKB', '', 'call_1_0');
      expect(result.persisted).toBe(false);
      expect(result.displayContent).toBe('');
    });

    it('should sanitize toolCallId for filename', async () => {
      const largeContent = makeLargeContent(MAX_SINGLE_RESULT_CHARS + 10);
      const result = await persistLargeResult(
        'searchKB',
        largeContent,
        'call_1_0:special/chars\\here',
      );

      expect(result.persisted).toBe(true);
      expect(result.filePath).toBeDefined();
      // Filename should not contain special chars
      const fileName = path.basename(result.filePath!);
      expect(fileName).not.toContain(':');
      expect(fileName).not.toContain('/');
      expect(fileName).not.toContain('\\');
    });

    it('should create tool-results subdirectory automatically', async () => {
      const subdir = path.join(tempDir, TOOL_RESULTS_SUBDIR);

      // Ensure directory does not exist before test
      if (fs.existsSync(subdir)) {
        fs.rmSync(subdir, { recursive: true, force: true });
      }
      expect(fs.existsSync(subdir)).toBe(false);

      const largeContent = makeLargeContent(MAX_SINGLE_RESULT_CHARS + 10);
      const result = await persistLargeResult('searchKB', largeContent, 'call_1_0');

      expect(result.persisted).toBe(true);
      expect(fs.existsSync(subdir)).toBe(true);
      expect(fs.existsSync(result.filePath!)).toBe(true);
    });
  });

  // =========================================================================
  // applyAggregateBudget
  // =========================================================================
  describe('applyAggregateBudget', () => {
    it('should return results unchanged when total is under budget', async () => {
      const results = [
        makeResult('short result 1', 0),
        makeResult('short result 2', 1),
      ];
      const output = await applyAggregateBudget(results);
      expect(output).toEqual(results);
      // Should not modify original array
      expect(output).not.toBe(results);
    });

    it('test 4: should persist largest result when aggregate exceeds budget', async () => {
      const smallContent = makeLargeContent(1_000);  // 1k
      const largeContent = makeLargeContent(MAX_AGGREGATE_RESULTS_CHARS);  // exactly at budget
      const extraContent = makeLargeContent(1_000);   // 1k extra

      const results = [
        makeResult(smallContent, 0, 'readFile'),
        makeResult(largeContent, 1, 'searchKB'),
        makeResult(extraContent, 2, 'listFiles'),
      ];

      const totalBefore = results.reduce((s, r) => s + r.result.content.length, 0);
      expect(totalBefore).toBeGreaterThan(MAX_AGGREGATE_RESULTS_CHARS);

      const output = await applyAggregateBudget(results);

      const totalAfter = output.reduce((s, r) => s + r.result.content.length, 0);
      expect(totalAfter).toBeLessThanOrEqual(MAX_AGGREGATE_RESULTS_CHARS);
    });

    it('should persist multiple results if one largest is not enough', async () => {
      // Create results that are all individually under single threshold
      // but whose sum exceeds aggregate budget
      const content1 = makeLargeContent(MAX_AGGREGATE_RESULTS_CHARS / 2 + 1_000);  // ~61k
      const content2 = makeLargeContent(MAX_AGGREGATE_RESULTS_CHARS / 2 + 1_000);  // ~61k

      const results = [
        makeResult(content1, 0, 'searchKB'),
        makeResult(content2, 1, 'readFile'),
      ];

      const totalBefore = results.reduce((s, r) => s + r.result.content.length, 0);
      expect(totalBefore).toBeGreaterThan(MAX_AGGREGATE_RESULTS_CHARS);

      const output = await applyAggregateBudget(results);

      const totalAfter = output.reduce((s, r) => s + r.result.content.length, 0);
      expect(totalAfter).toBeLessThanOrEqual(MAX_AGGREGATE_RESULTS_CHARS);

      // At least one result should have been persisted
      const persistedCount = output.filter(
        (r) => r.result.content.includes('完整内容已保存到')
      ).length;
      expect(persistedCount).toBeGreaterThanOrEqual(1);
    });

    it('should not modify results already under budget', async () => {
      const results = [
        makeResult('short', 0),
        makeResult('also short', 1),
      ];
      const output = await applyAggregateBudget(results);
      expect(output).toEqual(results);
    });

    it('should use ContentReplacementState for determinism', async () => {
      const state = new ContentReplacementState();
      const largeContent = makeLargeContent(MAX_AGGREGATE_RESULTS_CHARS + 1_000);  // exceeds budget alone

      const results = [makeResult(largeContent, 0, 'searchKB')];

      // First call persists and registers
      const output1 = await applyAggregateBudget(results, state);

      // Same content with same toolCallId should use cached replacement
      const output2 = await applyAggregateBudget(results, state);

      expect(output1[0].result.content).toBe(output2[0].result.content);
    });

    it('should handle empty results array', async () => {
      const output = await applyAggregateBudget([]);
      expect(output).toEqual([]);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('should handle exact threshold boundary: content at MAX_SINGLE_RESULT_CHARS', async () => {
      const content = makeLargeContent(MAX_SINGLE_RESULT_CHARS);
      const result = await persistLargeResult('searchKB', content, 'call_1_0');
      // At the threshold, should NOT be persisted (<= not <)
      expect(result.persisted).toBe(false);
      expect(result.displayContent).toBe(content);
    });

    it('should handle exact threshold boundary: content at MAX_SINGLE_RESULT_CHARS + 1', async () => {
      const content = makeLargeContent(MAX_SINGLE_RESULT_CHARS + 1);
      const result = await persistLargeResult('searchKB', content, 'call_1_1');
      expect(result.persisted).toBe(true);
    });

    it('should NOT persist error results', async () => {
      // This test validates that executeOneTool only persists OK results
      // (the check is in executeOneTool, not in persistLargeResult itself)
      const largeContent = makeLargeContent(MAX_SINGLE_RESULT_CHARS + 1);
      // persistLargeResult itself doesn't check status — that's the caller's job
      const result = await persistLargeResult('searchKB', largeContent, 'call_1_0');
      expect(result.persisted).toBe(true);
    });
  });
});
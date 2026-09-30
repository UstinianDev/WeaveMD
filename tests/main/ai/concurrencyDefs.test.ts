import { describe, expect, it } from 'vitest';
import { defineCoreTools } from '@main/ai/toolRegistry';
import { isToolConcurrencySafe } from '@main/ai/agent/agentToolSelector';
import { hasConcurrencyDef } from '@main/ai/agent/concurrencyDefs';

// ---------------------------------------------------------------------------
// safeParseArgs 内联复现（与 concurrencyDefs 中行为一致）
// ---------------------------------------------------------------------------
function safeParseArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// 阶段 1 TOP10 高频工具（并发安全——只读或 proposal-only）
// ---------------------------------------------------------------------------
const TOP10_SAFE = new Set([
  'listFiles',
  'readFile',
  'searchKB',
  'editBlocks',
  'list_skills',
  'get_skill_details',
  'analyze_folder',
  'check_links',
  'get_task_activity',
  'readLocalFile',
]);

// 写入工具——全部应返回 false（串行执行）
const WRITE_TOOLS = new Set([
  'createFile',
  'createFolder',
  'renameFile',
  'moveFile',
  'deleteFile',
  'editLocalFile',
  'deleteLocalFile',
]);

// 其余工具（阶段 1 默认 false，fail-closed）：
// listLocalDirectory / web_search / research_search / runSkill
// / ask_question_card / preview_file_revision / preview_patch_files
// → 全部在 Test 7 中逐条验证返回 false
// （B8 六-1②：陈旧名 readFileRevision/listFileRevisions/getFileInfo 已清理——
//   不在定义表中即 fail-closed 串行，Test 7 断言语义保持）
// B8 文档四工具：searchDocument/readPage/extractTable/analyzeChart → 并发安全 true

describe('concurrencyDefs', () => {
  // -------------------------------------------------------------------------
  // Test 1: TOP10 high-frequency tools all return true
  // -------------------------------------------------------------------------
  it('TOP10 high-frequency tools all return true', () => {
    for (const name of TOP10_SAFE) {
      expect(
        isToolConcurrencySafe(name, safeParseArgs('{}')),
        `${name} should be concurrency safe`,
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Test 2: Write tools all return false
  // -------------------------------------------------------------------------
  it('write tools all return false', () => {
    for (const name of WRITE_TOOLS) {
      expect(
        isToolConcurrencySafe(name, safeParseArgs('{}')),
        `${name} should NOT be concurrency safe`,
      ).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: Unknown tools return false (fail-closed)
  // -------------------------------------------------------------------------
  it('unknown tools return false (fail-closed)', () => {
    expect(isToolConcurrencySafe('nonExistentTool', {})).toBe(false);
    expect(isToolConcurrencySafe('', {})).toBe(false);
    expect(isToolConcurrencySafe('123', {})).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 4: safeParseArgs with invalid JSON → {} → fail-closed
  // -------------------------------------------------------------------------
  it('safeParseArgs returns {} for invalid JSON, triggering fail-closed', () => {
    // 非法 JSON → safeParseArgs 返回 {} → 任何写入/未知工具都返回 false
    const badArgs = '{invalid json{{{';
    const parsed = safeParseArgs(badArgs);
    expect(parsed).toEqual({});

    // 即使是只读工具，如果 checkArgs 需要解析参数也会 fall back
    // 但当前没有 checkArgs 实现，所以验证 fail-closed 对写入工具生效
    for (const name of WRITE_TOOLS) {
      expect(
        isToolConcurrencySafe(name, parsed),
        `${name} with invalid args should return false`,
      ).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: searchKB / editBlocks / readFile with no-args work correctly
  // -------------------------------------------------------------------------
  it('searchKB, editBlocks, readFile return true with empty args', () => {
    expect(isToolConcurrencySafe('searchKB', {})).toBe(true);
    expect(isToolConcurrencySafe('editBlocks', {})).toBe(true);
    expect(isToolConcurrencySafe('readFile', {})).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: isToolConcurrencySafe covers ALL 30 tools from registry
  // -------------------------------------------------------------------------
  it('covers all 30 tools from defineCoreTools (no throw, defined value)', () => {
    const registryTools = defineCoreTools().map((t) => t.function.name);
    expect(registryTools).toHaveLength(30);

    for (const name of registryTools) {
      // 不抛异常，返回值必须是 boolean
      const result = isToolConcurrencySafe(name, safeParseArgs('{}'));
      expect(typeof result, `${name} should return boolean`).toBe('boolean');
    }
  });

  // -------------------------------------------------------------------------
  // Test 6b: C1 记忆两工具已入并发表（不入表即 fail-closed 串行）
  // -------------------------------------------------------------------------
  it('memory_read / memory_write are both registered in the concurrency table', () => {
    expect(hasConcurrencyDef('memory_read')).toBe(true);
    expect(hasConcurrencyDef('memory_write')).toBe(true);
    // 只读查询 → 可并发；写入 → 按本表「写入工具始终串行」约定显式 false
    expect(isToolConcurrencySafe('memory_read', {})).toBe(true);
    expect(isToolConcurrencySafe('memory_write', {})).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 7: correctness for all 27 entries in the definition table
  // -------------------------------------------------------------------------
  it('all 27 defined entries have correct defaultSafe values', () => {
    expect(isToolConcurrencySafe('listFiles', {})).toBe(true);
    expect(isToolConcurrencySafe('readFile', {})).toBe(true);
    expect(isToolConcurrencySafe('searchKB', {})).toBe(true);
    expect(isToolConcurrencySafe('editBlocks', {})).toBe(true);
    expect(isToolConcurrencySafe('list_skills', {})).toBe(true);
    expect(isToolConcurrencySafe('get_skill_details', {})).toBe(true);
    expect(isToolConcurrencySafe('analyze_folder', {})).toBe(true);
    expect(isToolConcurrencySafe('check_links', {})).toBe(true);
    expect(isToolConcurrencySafe('get_task_activity', {})).toBe(true);
    expect(isToolConcurrencySafe('readLocalFile', {})).toBe(true);

    // B8 文档四工具：只读 → 并发安全（不落 fail-closed 串行陷阱）
    expect(isToolConcurrencySafe('searchDocument', {})).toBe(true);
    expect(isToolConcurrencySafe('readPage', {})).toBe(true);
    expect(isToolConcurrencySafe('extractTable', {})).toBe(true);
    expect(isToolConcurrencySafe('analyzeChart', {})).toBe(true);

    // Phase 2: read tools still serial
    expect(isToolConcurrencySafe('listLocalDirectory', {})).toBe(false);
    expect(isToolConcurrencySafe('web_search', {})).toBe(false);
    expect(isToolConcurrencySafe('research_search', {})).toBe(false);
    expect(isToolConcurrencySafe('runSkill', {})).toBe(false);
    // 陈旧工具名（已清理出定义表）→ 未知工具 fail-closed 串行
    expect(isToolConcurrencySafe('readFileRevision', {})).toBe(false);
    expect(isToolConcurrencySafe('listFileRevisions', {})).toBe(false);
    expect(isToolConcurrencySafe('getFileInfo', {})).toBe(false);

    // Write tools: serial
    expect(isToolConcurrencySafe('createFile', {})).toBe(false);
    expect(isToolConcurrencySafe('createFolder', {})).toBe(false);
    expect(isToolConcurrencySafe('renameFile', {})).toBe(false);
    expect(isToolConcurrencySafe('moveFile', {})).toBe(false);
    expect(isToolConcurrencySafe('deleteFile', {})).toBe(false);
    expect(isToolConcurrencySafe('editLocalFile', {})).toBe(false);
    expect(isToolConcurrencySafe('deleteLocalFile', {})).toBe(false);

    // Special tools: serial
    expect(isToolConcurrencySafe('ask_question_card', {})).toBe(false);
    expect(isToolConcurrencySafe('preview_file_revision', {})).toBe(false);
    expect(isToolConcurrencySafe('preview_patch_files', {})).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 8: args are passed through to checkArgs (future-proof)
  // -------------------------------------------------------------------------
  it('passes args to the function (checkArgs slot for future use)', () => {
    // 当前没有 checkArgs 实现，仅验证函数签名正确接收 args
    const result = isToolConcurrencySafe('searchKB', { query: 'test' });
    expect(result).toBe(true);

    // 额外参数不应影响结果（无 checkArgs）
    const resultExtra = isToolConcurrencySafe('searchKB', { extra: 'param' });
    expect(resultExtra).toBe(true);
  });
});
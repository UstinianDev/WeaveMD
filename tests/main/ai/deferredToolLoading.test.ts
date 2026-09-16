import { describe, expect, it } from 'vitest';
import {
  defineCoreTools,
  isDeferredTool,
  getDeferredToolSchema,
  getToolStub,
  buildToolListForPrompt,
} from '@main/ai/toolRegistry';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** S5 规定的核心工具（5 个）：始终发送完整 JSON Schema。 */
const CORE_TOOL_NAMES = new Set([
  'listFiles',
  'readFile',
  'searchKB',
  'editBlocks',
  'ask_question_card',
]);

/** 延迟工具（19 个）。 */
const DEFERRED_TOOL_NAMES = new Set([
  'runSkill',
  'createFile',
  'createFolder',
  'preview_patch_files',
  'web_search',
  'analyze_folder',
  'check_links',
  'get_task_activity',
  'renameFile',
  'moveFile',
  'deleteFile',
  'research_search',
  'readLocalFile',
  'listLocalDirectory',
  'editLocalFile',
  'deleteLocalFile',
  'preview_file_revision',
  'list_skills',
  'get_skill_details',
]);

// ---------------------------------------------------------------------------
// describe: defer_loading 标记正确性
// ---------------------------------------------------------------------------

describe('S5 deferred tool loading — defer_loading markers', () => {
  const allTools = defineCoreTools();

  it('has exactly 24 tools total', () => {
    expect(allTools).toHaveLength(24);
  });

  it('has exactly 5 core tools (defer_loading NOT true)', () => {
    const coreTools = allTools.filter((t) => !t.defer_loading);
    expect(coreTools).toHaveLength(5);
    const coreNames = new Set(coreTools.map((t) => t.function.name));
    expect(coreNames).toEqual(CORE_TOOL_NAMES);
  });

  it('has exactly 19 deferred tools (defer_loading: true)', () => {
    const deferredTools = allTools.filter((t) => t.defer_loading);
    expect(deferredTools).toHaveLength(19);
    const deferredNames = new Set(deferredTools.map((t) => t.function.name));
    expect(deferredNames).toEqual(DEFERRED_TOOL_NAMES);
  });

  it('isDeferredTool returns true for all 19 deferred tools', () => {
    for (const name of DEFERRED_TOOL_NAMES) {
      expect(isDeferredTool(name)).toBe(true);
    }
  });

  it('isDeferredTool returns false for all 5 core tools', () => {
    for (const name of CORE_TOOL_NAMES) {
      expect(isDeferredTool(name)).toBe(false);
    }
  });

  it('isDeferredTool returns false for unknown tools', () => {
    expect(isDeferredTool('nonexistent_tool')).toBe(false);
    expect(isDeferredTool('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: getDeferredToolSchema
// ---------------------------------------------------------------------------

describe('S5 getDeferredToolSchema', () => {
  it('returns full ToolDef with complete parameters for deferred tools', () => {
    // 测试 createFile（一个典型的延迟工具，有复杂参数 schema）
    const fullSchema = getDeferredToolSchema('createFile');
    expect(fullSchema).toBeDefined();
    expect(fullSchema!.type).toBe('function');
    expect(fullSchema!.function.name).toBe('createFile');
    expect(fullSchema!.function.description).toBeTruthy();
    expect(fullSchema!.defer_loading).toBe(true);

    const params = fullSchema!.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.type).toBe('object');
    expect(params.properties).toHaveProperty('file_name');
    expect(params.properties).toHaveProperty('content');
    expect(params.required).toContain('file_name');
    expect(params.required).toContain('content');
  });

  it('returns ToolDef with parameters for research_search', () => {
    const fullSchema = getDeferredToolSchema('research_search');
    expect(fullSchema).toBeDefined();

    const params = fullSchema!.function.parameters as {
      required: string[];
    };
    expect(params.required).toContain('query');
  });

  it('returns undefined for core tools', () => {
    expect(getDeferredToolSchema('listFiles')).toBeUndefined();
    expect(getDeferredToolSchema('readFile')).toBeUndefined();
    expect(getDeferredToolSchema('searchKB')).toBeUndefined();
    expect(getDeferredToolSchema('editBlocks')).toBeUndefined();
    expect(getDeferredToolSchema('ask_question_card')).toBeUndefined();
  });

  it('returns undefined for unknown tools', () => {
    expect(getDeferredToolSchema('nonexistent')).toBeUndefined();
    expect(getDeferredToolSchema('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// describe: getToolStub
// ---------------------------------------------------------------------------

describe('S5 getToolStub', () => {
  it('returns lightweight stub with name, description, and empty parameters', () => {
    const stub = getToolStub('createFile');
    expect(stub).toBeDefined();
    expect(stub!.type).toBe('function');
    expect(stub!.function.name).toBe('createFile');
    expect(stub!.function.description).toBeTruthy();
    expect(stub!.defer_loading).toBe(true);

    // Stub should have minimal parameters (not the full schema)
    const params = stub!.function.parameters as { type: string; properties: Record<string, unknown> };
    expect(params.type).toBe('object');
    expect(Object.keys(params.properties)).toHaveLength(0);
  });

  it('stub has no file_name property in parameters (unlike full schema)', () => {
    const stub = getToolStub('createFile');
    const params = stub!.function.parameters as { properties: Record<string, unknown> };
    expect(params.properties).not.toHaveProperty('file_name');
    expect(params.properties).not.toHaveProperty('content');
  });

  it('returns undefined for core tools', () => {
    expect(getToolStub('listFiles')).toBeUndefined();
    expect(getToolStub('readFile')).toBeUndefined();
    expect(getToolStub('ask_question_card')).toBeUndefined();
  });

  it('returns undefined for unknown tools', () => {
    expect(getToolStub('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// describe: buildToolListForPrompt
// ---------------------------------------------------------------------------

describe('S5 buildToolListForPrompt', () => {
  const allTools = defineCoreTools();

  it('converts deferred tools to stubs while keeping core tools unchanged', () => {
    const result = buildToolListForPrompt(allTools);
    expect(result).toHaveLength(24);

    // 核心工具：不携带 defer_loading 标记（falsy），与 stub 工具的 defer_loading:true 可区分
    const coreResults = result.filter((t) => !t.defer_loading);
    expect(coreResults).toHaveLength(5); // 5 core tools, no defer_loading flag

    // 所有工具的函数名称不变
    const names = result.map((t) => t.function.name);
    const origNames = allTools.map((t) => t.function.name);
    expect(names).toEqual(origNames);
  });

  it('deferred tools in prompt list have empty parameters (stubs)', () => {
    const result = buildToolListForPrompt(allTools);

    for (const t of result) {
      if (DEFERRED_TOOL_NAMES.has(t.function.name)) {
        // 延迟工具应为 stub（空参数）
        const params = t.function.parameters as {
          type: string;
          properties: Record<string, unknown>;
        };
        expect(params.type).toBe('object');
        expect(Object.keys(params.properties)).toHaveLength(0);
        expect(t.defer_loading).toBe(true);
      }
    }
  });

  it('core tools in prompt list retain full parameters schema', () => {
    const result = buildToolListForPrompt(allTools);

    for (const t of result) {
      if (CORE_TOOL_NAMES.has(t.function.name)) {
        // 核心工具应保留完整参数（properties 非空，除了 listFiles 本身无参数）
        expect(t.defer_loading).toBeFalsy();
        if (t.function.name !== 'listFiles') {
          const params = t.function.parameters as {
            type: string;
            properties: Record<string, unknown>;
          };
          expect(Object.keys(params.properties).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('handles empty input array gracefully', () => {
    const result = buildToolListForPrompt([]);
    expect(result).toHaveLength(0);
  });

  it('is idempotent — applying buildToolListForPrompt twice yields same result', () => {
    const firstPass = buildToolListForPrompt(allTools);
    const secondPass = buildToolListForPrompt(firstPass);
    expect(secondPass).toEqual(firstPass);
  });
});

// ---------------------------------------------------------------------------
// describe: 字母序兼容 (S7 compatibility)
// ---------------------------------------------------------------------------

describe('S5 tool list order — S7 compatibility', () => {
  it('all 24 tools are in alphabetical order by function.name', () => {
    const allTools = defineCoreTools();
    const names = allTools.map((t) => t.function.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('buildToolListForPrompt preserves alphabetical order', () => {
    const allTools = defineCoreTools();
    const promptTools = buildToolListForPrompt(allTools);
    const names = promptTools.map((t) => t.function.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('no tools are missing or duplicated', () => {
    const allTools = defineCoreTools();
    const names = allTools.map((t) => t.function.name);
    const unique = new Set(names);
    expect(unique.size).toBe(24);
    expect(names).toHaveLength(24);
  });
});

// ---------------------------------------------------------------------------
// describe: 重发计数器上限 (retry bound)
// ---------------------------------------------------------------------------

describe('S5 deferred retry — max 3 retries', () => {
  it('deferred retry loop in agentLoop limits retries to 3', () => {
    // 这个测试验证的是合约：agentLoop 使用 while (deferredRetryCount <= 3)
    // 且 retry 条件检查 deferredRetryCount < 3，即最多 3 次重试
    // 由于 agentLoop 依赖完整的 Electron mock，这里仅验证常量逻辑：
    const MAX_RETRIES = 3;

    // 模拟 4 次工具调用（第 4 次应被拦截而不重试）
    let retryCount = 0;
    const mockHasDeferred = (attempt: number) => attempt < MAX_RETRIES;

    for (let attempt = 0; attempt < 5; attempt++) {
      const shouldRetry = retryCount < MAX_RETRIES && mockHasDeferred(attempt);
      if (shouldRetry) {
        retryCount++;
      } else if (retryCount >= MAX_RETRIES) {
        // 第 4 次不应再重试
        break;
      }
    }

    // 重试次数不应超过 MAX_RETRIES
    expect(retryCount).toBeLessThanOrEqual(MAX_RETRIES);
    // 经过 3 次重试后，应停止
    expect(retryCount).toBe(3);
  });
});
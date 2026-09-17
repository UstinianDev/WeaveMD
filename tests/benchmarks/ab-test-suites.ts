// ============================================
// WeaveMD — Preset A/B Test Suites (S14)
// ============================================
// 预置 4 套 A/B 测试场景，对应阶段 1-3 的优化项。
// 所有套件不依赖真实 LLM API，仅使用 vitest 可用的 Node API。
//
// 套件列表：
//   1. StreamingToolExecutor — 并发 vs 串行工具执行耗时
//   2. Deferred Tool Loading   — 完整 schema vs stub 的 prompt 体积
//   3. Search Cache            — 无缓存 vs 有缓存的搜索耗时
//   4. xxHash vs MD5           — 不同 Hash 算法的计算耗时

import type { ABTestConfig, PerfScenario } from './ab-test-runner';

// ============================================================================
// Suite 1: StreamingToolExecutor — concurrent vs serial tool execution
// ============================================================================

/** 模拟工具数量 */
const SIM_TOOL_COUNT = 10;

/** 每个工具的模拟延迟 (ms) */
const SIM_TOOL_DELAY_MS = 15;

/** 并发安全比例 (0-1)：B 组模拟 70% 工具可并发，其余串行 */
const CONCURRENT_SAFE_RATIO = 0.7;

let s1Mode: 'serial' | 'concurrent' = 'serial';

export const streamingExecutorSuite: ABTestConfig = {
  name: 'S1: Streaming Tool Executor',
  description:
    `${SIM_TOOL_COUNT} tools × ~${SIM_TOOL_DELAY_MS}ms each. ` +
    `A: all serial (one-at-a-time). B: ${Math.round(CONCURRENT_SAFE_RATIO * 100)}% concurrent (parallel safe tools).`,
  higherIsBetter: new Set([]), // lower time = better

  setupA: () => {
    s1Mode = 'serial';
  },

  setupB: () => {
    s1Mode = 'concurrent';
  },

  run: async (): Promise<PerfScenario> => {
    // 模拟两类工具：安全工具（可并发）和非安全工具（必须串行）
    const safeCount = Math.floor(SIM_TOOL_COUNT * CONCURRENT_SAFE_RATIO);
    const unsafeCount = SIM_TOOL_COUNT - safeCount;

    // 每个工具是一个带延迟的 async 任务
    const makeTask = () =>
      new Promise<void>((resolve) => setTimeout(resolve, SIM_TOOL_DELAY_MS));

    const start = performance.now();

    if (s1Mode === 'serial') {
      // A 组：全部串行
      for (let i = 0; i < SIM_TOOL_COUNT; i++) {
        await makeTask();
      }
    } else {
      // B 组：安全工具并发执行，非安全工具串行追加
      // 先并发启动所有安全工具
      const safeTasks: Promise<void>[] = [];
      for (let i = 0; i < safeCount; i++) {
        safeTasks.push(makeTask());
      }
      await Promise.all(safeTasks);

      // 再串行执行非安全工具
      for (let i = 0; i < unsafeCount; i++) {
        await makeTask();
      }
    }

    const elapsed = performance.now() - start;
    return { totalTimeMs: Math.round(elapsed * 100) / 100 };
  },

  teardown: () => {
    s1Mode = 'serial';
  },
};

// ============================================================================
// Suite 2: Deferred Tool Loading — full schema vs stub token estimation
// ============================================================================

/**
 * 构建一组模拟 JSON Schema 数组（近似真实 24 工具的规模）。
 * 核心工具（5 个）完整 schema，延迟工具（19 个）完整或 stub。
 */

function buildFakeToolSchema(name: string, hasParams: boolean): Record<string, unknown> {
  if (!hasParams) {
    return {
      type: 'function',
      function: {
        name,
        description: `Tool ${name} — simulated description for A/B testing. It processes input and returns structured output.`,
        parameters: { type: 'object', properties: {} },
      },
    };
  }
  return {
    type: 'function',
    function: {
      name,
      description: `Tool ${name} — simulated description for A/B testing. Accepts multiple parameters and performs complex operations with structured output.`,
      parameters: {
        type: 'object',
        properties: {
          input: {
            type: 'string',
            description: 'Primary input text to process',
          },
          options: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                enum: ['fast', 'precise', 'balanced'],
                description: 'Processing mode selection',
              },
              threshold: { type: 'number', description: 'Score threshold (0-1)' },
            },
          },
        },
        required: ['input'],
      },
    },
  };
}

const CORE_NAMES = ['listFiles', 'readFile', 'searchKB', 'editBlocks', 'ask_question_card'];

const DEFERRED_NAMES = [
  'runSkill', 'createFile', 'createFolder', 'preview_patch_files', 'web_search',
  'analyze_folder', 'check_links', 'get_task_activity', 'renameFile', 'moveFile',
  'deleteFile', 'research_search', 'readLocalFile', 'listLocalDirectory',
  'editLocalFile', 'deleteLocalFile', 'preview_file_revision', 'list_skills',
  'get_skill_details',
];

let s2Defer: boolean = false;

export const deferredLoadingSuite: ABTestConfig = {
  name: 'S5: Deferred Tool Loading',
  description:
    `24 tools total (5 core + 19 deferred). ` +
    `A: all 24 with full JSON Schema. B: 5 core full schema + 19 stubs (name only).`,
  higherIsBetter: new Set([]), // lower token count = better

  setupA: () => {
    s2Defer = false;
  },

  setupB: () => {
    s2Defer = true;
  },

  run: async (): Promise<PerfScenario> => {
    const schemas: Record<string, unknown>[] = [];

    for (const name of CORE_NAMES) {
      schemas.push(buildFakeToolSchema(name, true));
    }

    for (const name of DEFERRED_NAMES) {
      if (s2Defer) {
        // Stub: 仅名称 + defer_loading 标记
        schemas.push({
          type: 'function',
          defer_loading: true,
          function: { name, description: '', parameters: { type: 'object', properties: {} } },
        });
      } else {
        schemas.push(buildFakeToolSchema(name, true));
      }
    }

    const jsonStr = JSON.stringify(schemas);
    // 粗略 token 估算：4 字符 ≈ 1 token（英文场景适用）
    const approxTokens = Math.ceil(jsonStr.length / 4);
    // 计算节省量
    const totalTools = schemas.length;

    return {
      promptChars: jsonStr.length,
      approxTokens,
      totalTools,
    };
  },

  teardown: () => {
    s2Defer = false;
  },
};

// ============================================================================
// Suite 3: Search Cache — cold vs warm cache
// ============================================================================

/** 查询列表：5 个唯一查询，各重复 2 次 = 10 次搜索 */
const SEARCH_QUERIES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon',
                        'alpha', 'beta',  'gamma', 'delta', 'epsilon'];

/** 每次搜索的模拟耗时 (ms) */
const SEARCH_COST_MS = 8;

let s3CacheEnabled: boolean = false;
const s3CacheStore = new Map<string, unknown>();

export const searchCacheSuite: ABTestConfig = {
  name: 'S3/S10: Search Cache Effect',
  description:
    `${SEARCH_QUERIES.length} searches (5 unique × 2 repeats). ` +
    `A: no cache — every search costs ${SEARCH_COST_MS}ms. B: with cache — repeats are instant.`,
  higherIsBetter: new Set(['cacheHitRate']), // higher hit rate = better

  setupA: () => {
    s3CacheEnabled = false;
    s3CacheStore.clear();
  },

  setupB: () => {
    s3CacheEnabled = true;
    s3CacheStore.clear();
  },

  run: async (): Promise<PerfScenario> => {
    let hits = 0;
    let misses = 0;
    const start = performance.now();

    for (const query of SEARCH_QUERIES) {
      if (s3CacheEnabled && s3CacheStore.has(query)) {
        // Cache hit — instant
        s3CacheStore.get(query);
        hits++;
      } else {
        // Cache miss or cache disabled — simulate search work
        await new Promise<void>((resolve) => setTimeout(resolve, SEARCH_COST_MS));
        s3CacheStore.set(query, { result: `result-${query}`, score: 0.85 });
        misses++;
      }
    }

    const elapsed = performance.now() - start;
    const total = hits + misses;

    return {
      totalTimeMs: Math.round(elapsed * 100) / 100,
      cacheHits: hits,
      cacheMisses: misses,
      cacheHitRate: total > 0 ? hits / total : 0,
    };
  },

  teardown: () => {
    s3CacheEnabled = false;
    s3CacheStore.clear();
  },
};

// ============================================================================
// Suite 4: xxHash vs MD5 — hash algorithm speed
// ============================================================================

/**
 * 模拟 MD5（多轮处理，比 djb2 慢约 3×）。
 * 不是真正的 MD5，仅用于模拟计算量级差异。
 */
function simulateSlowHash(input: string): string {
  // 三轮逐字符处理模拟 MD5 的计算密度
  let result = '';
  for (let round = 0; round < 3; round++) {
    let acc = round;
    for (let i = 0; i < input.length; i++) {
      acc = ((acc << 5) - acc + input.charCodeAt(i)) | 0;
    }
    result += (acc >>> 0).toString(16).padStart(8, '0');
  }
  return result;
}

/** djb2 单轮哈希（xxHash 降级路径使用的算法） */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 测试用的输入大小 */
const HASH_INPUT_SIZES = [
  { label: '1KB', data: 'x'.repeat(1024) },
  { label: '10KB', data: 'x'.repeat(10240) },
  { label: '100KB', data: 'x'.repeat(102400) },
  { label: '1MB', data: 'x'.repeat(1024 * 1024) },
];

let s4Algorithm: 'md5-sim' | 'djb2' = 'djb2';

export const hashComparisonSuite: ABTestConfig = {
  name: 'S4: Hash Algorithm (xxHash vs MD5)',
  description:
    `Hash speed comparison across 4 input sizes (${HASH_INPUT_SIZES.map((s) => s.label).join('/')}). ` +
    `A: simulated MD5 (3-pass). B: djb2 (1-pass, xxHash fallback).`,
  higherIsBetter: new Set([]), // lower time = better

  setupA: () => {
    s4Algorithm = 'md5-sim';
  },

  setupB: () => {
    s4Algorithm = 'djb2';
  },

  run: async (): Promise<PerfScenario> => {
    const result: PerfScenario = {};
    const hashFn = s4Algorithm === 'md5-sim' ? simulateSlowHash : djb2Hash;

    for (const { label, data } of HASH_INPUT_SIZES) {
      const start = performance.now();
      hashFn(data);
      const elapsed = performance.now() - start;
      result[`hash_${label}_ms`] = Math.round(elapsed * 1000) / 1000;
    }

    return result;
  },

  teardown: () => {
    s4Algorithm = 'djb2';
  },
};

// ---------------------------------------------------------------------------
// 聚合导出
// ---------------------------------------------------------------------------

/** 全部预置套件（按 S1/S5/S3/S4 顺序） */
export const ALL_PRESET_SUITES: ABTestConfig[] = [
  streamingExecutorSuite,
  deferredLoadingSuite,
  searchCacheSuite,
  hashComparisonSuite,
];
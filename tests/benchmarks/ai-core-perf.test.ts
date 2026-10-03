// ============================================
// WeaveMD — ai-core-perf 性能基准（devflow-perf Phase 4 证据）
// ============================================
// 运行：npx vitest run tests/benchmarks/ai-core-perf.test.ts
//
// 测量口径（**如实标注，避免把结构指标冒充墙钟数据**）：
//
//  A. 墙钟（wall-clock）：纯 JS 计算路径（无 native / 无 DB）。
//     取 K 次运行的**中位数**（ms），规避单次抖动。
//
//  B. SQL 形状计数（sqlShape）：better-sqlite3 是 Electron ABI 构建，在 vitest（纯 Node）
//     下 ERR_DLOPEN_FAILED，**真实库无法在本环境加载**（全仓测试亦全部使用 fake DB）。
//     因此 SQL 层瓶颈只能计「语句形态」而非「墙钟」：
//       - prepareCount：一次业务调用触发多少次 db.prepare（N+1 的直接度量）
//       - fullScanCount：`SELECT *` 全列扫描次数（投影宽度决定是否读取 vector BLOB）
//       - rowFetchCount：物化行数（配合投影宽度即 I/O 量级模型）
//
// 本文件**不做 ms 阈值断言** —— 纯耗时断言在并行负载下必红（本仓既有
// `cacheMonitor` / `ab-test` 两例已知 flaky，见 .claude/agent-memory）。
// 本文件只输出数据供人工比对，不做门禁。

import { describe, expect, it, vi } from 'vitest';

// electron 隔离（agentContext/agentLoop 链路可能间接引用）
vi.mock('electron', () => ({ app: { getPath: () => ':memory:' } }));

import { analyzePdfLayout, type PdfLayoutItem, type PdfLayoutPage } from '@main/ai/files/pdfLayout';
import { toolsForIntent } from '@main/ai/agent/agentToolSelector';
import { collectHeadingMarks } from '@main/ai/tools/searchDocument';
import { parseWithLimit } from '@main/ai/files/parseLimiter';
import {
  estimateContentTokens,
  estimateTokens,
  type LlmMessage,
} from '@main/ai/contextManager';
import { classifyIntentShared, __resetIntentTierCacheForTest } from '@main/ai/intentTiering';

// ---------------------------------------------------------------------------
// 计时工具
// ---------------------------------------------------------------------------

interface Timing {
  label: string;
  medianMs: number;
  minMs: number;
  runs: number;
}

const timings: Timing[] = [];

/** 跑 warmup + K 次，取中位数（ms，保留 3 位小数）。 */
function bench(label: string, fn: () => void, runs = 9, warmup = 2): Timing {
  for (let i = 0; i < warmup; i += 1) fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const t: Timing = {
    label,
    medianMs: Math.round(samples[Math.floor(samples.length / 2)] * 1000) / 1000,
    minMs: Math.round(samples[0] * 1000) / 1000,
    runs,
  };
  timings.push(t);
  return t;
}

// ---------------------------------------------------------------------------
// 合成样本
// ---------------------------------------------------------------------------

/** 单页 textItems（模拟正文流：每行 2~4 个 item，y 步进 14pt）。 */
function densePage(pageNum: number): PdfLayoutPage {
  const items: PdfLayoutItem[] = [];
  let y = 60;
  for (let line = 0; line < 62; line += 1) {
    const perLine = 2 + (line % 3);
    for (let k = 0; k < perLine; k += 1) {
      const text = `word${pageNum}_${line}_${k}`;
      items.push({ text, x: 72 + k * 140, y, width: text.length * 6, height: 12, fontSize: 12 });
    }
    y += 14;
  }
  return { pageNum, width: 612, height: 792, items };
}

/** 双栏页（gutter 检测路径）。 */
function twoColumnDensePage(pageNum: number): PdfLayoutPage {
  const items: PdfLayoutItem[] = [];
  let y = 60;
  for (let line = 0; line < 50; line += 1) {
    const text = `col${pageNum}_${line}`;
    items.push({ text, x: 72, y, width: text.length * 6, height: 12, fontSize: 12 });
    items.push({ text: text + 'b', x: 330, y, width: text.length * 6, height: 12, fontSize: 12 });
    y += 14;
  }
  return { pageNum, width: 612, height: 792, items };
}

const PDF_PAGES: PdfLayoutPage[] = Array.from({ length: 20 }, (_, i) =>
  i % 2 === 0 ? densePage(i + 1) : twoColumnDensePage(i + 1)
);

/** 大 markdown 正文（约 40 万字符，标题 + 段落 + 围栏混合）。 */
function bigMarkdown(): string {
  const parts: string[] = [];
  for (let i = 1; i <= 2000; i += 1) {
    parts.push(`## Section ${i}`);
    parts.push(
      `Paragraph ${i}: WeaveMD 性能基准合成样本，包含中文与 English mixed content，用于测量文档解析与检索路径。`
    );
    if (i % 100 === 0) {
      parts.push('```ts');
      parts.push('const x = 1;');
      parts.push('```');
    }
  }
  return parts.join('\n');
}

const BIG_MD = bigMarkdown();

/**
 * agent 消息栈（14 条，规模对齐生产：单条 300~3000 字符）。
 * 说明：真实链路里工具结果由 toolResultStorage（S6）落盘、入上下文的是截断版，
 * 因此单条消息不会达到「整篇文档」量级；超长串（> 8K 字符）走
 * `estimateTokens(800k chars)` 一项单独对照（该规模不进缓存）。
 */
const AGENT_MESSAGES: LlmMessage[] = Array.from({ length: 14 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content:
    i === 7
      ? BIG_MD.slice(0, 3000)
      : `第 ${i} 轮消息：mixed 中英文 content 用于 token 估算基准测试。`.repeat(8 + (i % 5) * 6),
}));

function totalTokensOf(messages: LlmMessage[]): number {
  return messages.reduce((s, m) => s + estimateContentTokens(m.content), 0);
}

// ---------------------------------------------------------------------------
// A. 墙钟基准
// ---------------------------------------------------------------------------

describe('A. 墙钟基准（纯 JS 路径）', () => {
  it('DOC-1 analyzePdfLayout（20 页密集版面）', () => {
    const t = bench(
      'DOC-1 analyzePdfLayout(20p, ~1900 items)',
      () => {
        analyzePdfLayout(PDF_PAGES);
      },
      5,
      1
    );
    expect(t.medianMs).toBeGreaterThanOrEqual(0);
  });

  it('TOOL-1 toolsForIntent（rewrite 意图，100 次）', () => {
    const args = [
      { intent: 'rewrite', confidence: 0.9 },
      false,
      true,
      '# Test Document\n\nSome content here.',
      false,
      false,
    ] as unknown as Parameters<typeof toolsForIntent>;
    const t = bench('TOOL-1 toolsForIntent ×100', () => {
      for (let i = 0; i < 100; i += 1) toolsForIntent(...args);
    });
    expect(t.medianMs).toBeGreaterThanOrEqual(0);
  });

  it('DOC-3 collectHeadingMarks（= 零命中检索本来要白付的全量扫描）', () => {
    // 本项测的是「被省掉的工作量」：searchDocument 原先无论是否命中都先跑一遍
    // collectHeadingMarks；惰性化后零命中调用完全不付这份成本。
    const t = bench('DOC-3 collectHeadingMarks(400k chars)', () => {
      collectHeadingMarks(BIG_MD);
    });
    expect(t.medianMs).toBeGreaterThanOrEqual(0);
  });

  it('DOC-4 estimateContentTokens 全量重算（14 条消息，缓存命中路径）', () => {
    const t = bench('DOC-4 Σ estimateContentTokens(14 msgs) 缓存后', () => {
      totalTokensOf(AGENT_MESSAGES);
    });
    expect(t.medianMs).toBeGreaterThanOrEqual(0);
  });

  it('DOC-4 冷路径对照：Σ estimateTokens（绕过缓存）', () => {
    // 与上一项**同一批消息**，只把估算入口换成不带缓存的 estimateTokens ——
    // 用于剥离「缓存命中」的加速，给出同一工作负载的冷/热对照。
    const coldOf = (messages: LlmMessage[]): number =>
      messages.reduce(
        (s, m) =>
          s +
          (typeof m.content === 'string'
            ? estimateTokens(m.content)
            : m.content.reduce(
                (a, p) => a + (p.type === 'text' ? estimateTokens(p.text) : 0),
                0
              )),
        0
      );
    const t = bench('DOC-4 Σ estimateTokens(14 msgs) 冷路径', () => {
      coldOf(AGENT_MESSAGES);
    });
    expect(t.medianMs).toBeGreaterThanOrEqual(0);
  });

  it('DOC-4 单串 estimateTokens（~80 万字符）', () => {
    const t = bench('DOC-4 estimateTokens(800k chars)', () => {
      estimateTokens(BIG_MD.repeat(2));
    });
    expect(t.medianMs).toBeGreaterThanOrEqual(0);
  });

  it('DOC-2 parseWithLimit（60 任务 / limit=3）', async () => {
    const run = async (): Promise<void> => {
      await Promise.all(
        Array.from({ length: 60 }, (_, i) =>
          parseWithLimit(async () => {
            // 微任务让出，模拟异步解析
            await Promise.resolve();
            return i;
          }, 3)
        )
      );
    };
    await run(); // warmup
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      await run();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    timings.push({
      label: 'DOC-2 parseWithLimit(60 tasks, limit=3)',
      medianMs: Math.round(samples[Math.floor(samples.length / 2)] * 1000) / 1000,
      minMs: Math.round(samples[0] * 1000) / 1000,
      runs: 5,
    });
    expect(samples.length).toBe(5);
  });

  it('INT-2 classifyIntentShared（120 条去重输入）', () => {
    __resetIntentTierCacheForTest();
    const inputs = Array.from(
      { length: 120 },
      (_, i) => `帮我优化第 ${i} 章的文档结构与表达，并把结果整理成周报`
    );
    const t = bench('INT-2 classifyIntentShared ×120', () => {
      for (const s of inputs) classifyIntentShared(s, false);
    });
    expect(t.medianMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// B. SQL 形状计数（better-sqlite3 在 vitest 下不可加载，只能计语句形态）
// ---------------------------------------------------------------------------

/** 记录每次 prepare 的 SQL 文本，并按形态分派返回合成行。 */
class ShapeDb {
  readonly prepares: string[] = [];
  readonly agentMemory: Array<Record<string, unknown>> = [];
  /** 上次 `SELECT` 在 agent_memory 上的投影列清单（`SELECT *` 记作 '*'）。 */
  readonly projections: string[] = [];
  /** 命中的 FTS 虚拟表查询次数（与基表扫描分开计，避免混入投影统计）。 */
  ftsQueries = 0;

  private projectionOf(sql: string): string {
    const m = /SELECT\s+([\s\S]*?)\s+FROM\s+/i.exec(sql);
    if (!m) return '?';
    const cols = m[1]
      .trim()
      .split(',')
      .map((c) => c.trim().replace(/^[a-z]+\./i, '').replace(/\s+AS\s+\w+$/i, ''))
      .join(',');
    // 全列形态：`*` 或 `m.*`
    return /^\*$/.test(cols) ? '*' : cols;
  }

  prepare(sql: string): {
    all: (...a: unknown[]) => unknown[];
    get: (...a: unknown[]) => unknown;
    run: (...a: unknown[]) => { changes: number; lastInsertRowid: number };
  } {
    this.prepares.push(sql);
    if (/^\s*SELECT/i.test(sql)) {
      if (/agent_memory_fts/i.test(sql)) this.ftsQueries += 1;
      else this.projections.push(this.projectionOf(sql));
    }
    const rows = (): Array<Record<string, unknown>> => this.rowsFor(sql);
    return {
      all: () => rows(),
      get: () => rows()[0],
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
    };
  }

  private rowsFor(sql: string): Array<Record<string, unknown>> {
    if (/agent_memory_fts/i.test(sql)) return [];
    if (/FROM\s+agent_memory/i.test(sql)) {
      const userId = /user_id\s*=\s*\?/.test(sql) ? 'u1' : null;
      const activeOnly = /valid_to\s+IS\s+NULL/i.test(sql);
      const kindEq = /kind\s*=\s*\?/.test(sql) ? 'fact' : null;
      return this.agentMemory.filter(
        (r) =>
          (!userId || r.user_id === userId) &&
          (!activeOnly || r.valid_to === null) &&
          (!kindEq || r.kind === kindEq)
      );
    }
    if (/FROM\s+agent_task_queue/i.test(sql)) return [];
    return [];
  }
}

/**
 * 造 N 条 active 记忆行（含 vector BLOB 尺寸模型：1536 维 float32 = 6144 B）。
 * `now` = 写入时刻（缺省当天，避免被 90 天时间衰减全量驱逐 —— 那会把
 * 「稳态一次扫描」测成「一次全量驱逐」，不代表生产常见路径）。
 * 缺省 subject/content 全唯一 → 无冲突无合并，聚焦「扫描 + 召回」成本。
 */
function seedMemories(
  n: number,
  opts: { writtenAt?: string; collideEvery?: number } = {}
): Array<Record<string, unknown>> {
  const writtenAt = opts.writtenAt ?? new Date().toISOString().slice(0, 19).replace('T', ' ');
  const collide = opts.collideEvery ?? 0;
  return Array.from({ length: n }, (_, i) => {
    const bucket = collide > 0 ? Math.floor(i / collide) : i;
    return {
      id: i + 1,
      user_id: 'u1',
      kind: 'fact',
      subject: `subject-${bucket}`,
      content: `记忆内容 ${bucket} 这是一条用于基准的合成记忆陈述句，含中文与 English。`,
      source: 'auto',
      conversation_id: 'c1',
      fingerprint: `fp${i}`,
      valid_from: writtenAt,
      valid_to: null,
      written_at: writtenAt,
      access_count: 0,
      last_read_at: null,
      merge_skip: null,
      vector: null,
      embedding_model: null,
    };
  });
}

/** agent_memory 全列宽（含 vector BLOB / embedding_model / merge_skip / last_read_at）。 */
const AGENT_MEMORY_ALL_COLUMNS = 16;

/** 表列字节模型：vector = 1536 维 float32；其余按平均长度估。 */
const COLUMN_BYTES: Record<string, number> = {
  id: 8,
  user_id: 36,
  kind: 8,
  subject: 60,
  content: 400,
  source: 8,
  conversation_id: 36,
  fingerprint: 64,
  valid_from: 19,
  valid_to: 19,
  written_at: 19,
  access_count: 8,
  last_read_at: 19,
  merge_skip: 19,
  vector: 6144,
  embedding_model: 32,
};

function bytesPerRow(columnList: string, allColumns: readonly string[]): number {
  const cols = columnList === '*' ? allColumns : columnList.split(',');
  return cols.reduce((sum, c) => sum + (COLUMN_BYTES[c] ?? 24), 0);
}

const sqlShape: Array<{ label: string; value: string }> = [];

describe('B. SQL 形状计数（结构指标，非墙钟）', () => {
  const N = 200;

  /** 稳态：无冲突、无超龄 → 只度量「扫描 + FTS 召回」成本。 */
  it('MEM-1/MEM-2/MEM-3 稳态 runMemoryPolicy（200 active，无冲突）', async () => {
    const { runMemoryPolicy } = await import('@main/ai/agent/memoryPolicy');
    const db = new ShapeDb();
    db.agentMemory.push(...seedMemories(N));

    runMemoryPolicy(db as never, 'u1');

    const selects = db.projections;
    const narrowBytes = bytesPerRow(
      'id,user_id,kind,subject,content,source,conversation_id,fingerprint,valid_from,valid_to,written_at,access_count',
      []
    );
    const allBytes = bytesPerRow('*', Object.keys(COLUMN_BYTES));
    const usedBytes = selects.reduce(
      (sum, p) => sum + (p === '*' ? allBytes : bytesPerRow(p, [])) * N,
      0
    );
    const allColumnsBytes = allBytes * N * selects.length;

    sqlShape.push(
      { label: `MEM-1 prepare 次数（${N} active）`, value: String(db.prepares.length) },
      {
        label: 'MEM-1/2 UPDATE 次数（逐行 closeMemory）',
        value: String(db.prepares.filter((s) => /^\s*UPDATE/i.test(s)).length),
      },
      { label: 'MEM-4 agent_memory SELECT 次数', value: String(selects.length) },
      { label: 'MEM-4 其中 SELECT * 全列扫描', value: String(selects.filter((p) => p === '*').length) },
      { label: 'MEM-2 FTS 召回查询次数（N+1）', value: String(db.ftsQueries) },
      {
        label: `MEM-4 单次策略读取模型（${N} 行 × ${selects.length} 扫描）`,
        value: `${(usedBytes / 1048576).toFixed(2)} MB；若全列 ${(allColumnsBytes / 1048576).toFixed(2)} MB`,
      },
      {
        label: 'MEM-3 全列/窄投影 B 每行',
        value: `${allBytes} / ${bytesPerRow('id,user_id,kind,subject,content,source,conversation_id,fingerprint,valid_from,valid_to,written_at,access_count', [])}`,
      }
    );

    expect(db.prepares.length).toBeGreaterThan(0);
  });

  /** 冲突场景：每 4 条同 subject → 触发 mergeConflicts 关闭动作。 */
  it('MEM-1 冲突场景 runMemoryPolicy（200 active，每 4 条同 subject）', async () => {
    const { runMemoryPolicy } = await import('@main/ai/agent/memoryPolicy');
    const db = new ShapeDb();
    db.agentMemory.push(...seedMemories(N, { collideEvery: 4 }));

    runMemoryPolicy(db as never, 'u1');

    sqlShape.push({
      label: 'MEM-1 冲突场景 closeMemory UPDATE 次数',
      value: String(db.prepares.filter((s) => /^\s*UPDATE/i.test(s)).length),
    });
    expect(db.prepares.length).toBeGreaterThan(0);
  });

  it('QUE-1 dequeueNext / QUE-2 hasPending 语句形态', async () => {
    const taskDao = await import('@main/db/agentTaskDao');
    const db = new ShapeDb();
    taskDao.dequeueNext(db as never);
    sqlShape.push(
      { label: 'QUE-1 dequeueNext 语句数', value: String(db.prepares.length) },
      {
        label: 'QUE-1 dequeueNext 含 SELECT *',
        value: String(db.prepares.filter((s) => /SELECT\s+\*/i.test(s)).length),
      }
    );

    const queue = await import('@main/ai/agent/agentTaskQueue');
    const db2 = new ShapeDb();
    const q = new queue.AgentTaskQueue(db2 as never);
    q.hasPendingForConversation('c1');
    sqlShape.push({
      label: 'QUE-2 hasPendingForConversation 语句数',
      value: String(db2.prepares.length),
    });
    expect(db.prepares.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

describe('Z. 基准汇总输出', () => {
  it('打印 SQL 形状汇总表', () => {
    const pad = (s: string, n: number): string => s.padEnd(n, ' ');
    const lines = ['', '| SQL 结构指标 | 值 |', '|------|------|'];
    for (const r of sqlShape) lines.push(`| ${pad(r.label, 44)} | ${r.value} |`);
    lines.push('');
    console.log(lines.join('\n'));
    expect(sqlShape.length).toBeGreaterThan(0);
  });

  it('打印墙钟汇总表', () => {
    const pad = (s: string, n: number): string => s.padEnd(n, ' ');
    const lines = [
      '',
      '| 指标 | 中位数 ms | 最小 ms | 轮数 |',
      '|------|-----------|---------|------|',
    ];
    for (const t of timings) {
      lines.push(
        `| ${pad(t.label, 46)} | ${pad(String(t.medianMs), 9)} | ${pad(String(t.minMs), 7)} | ${t.runs} |`
      );
    }
    lines.push('');
    console.log(lines.join('\n'));
    expect(timings.length).toBeGreaterThan(0);
  });
});

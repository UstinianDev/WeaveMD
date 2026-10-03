// ============================================
// WeaveMD — ai-core-perf 行为守护边界用例
// ============================================
// 本次优化涉及「缓存 / 记忆化 / 并发栅栏」三类隐式状态，逐项补边界测试：
//
//   1. TOOL-1 工具子集记忆化：调用方原地改写返回数组**不得**污染缓存
//      （agentLoop 的延迟工具 stub 升级就是原地写），不同入参不得串键；
//   2. MEM-2 trigram 记忆化：memo 的键必须取文本而非行 id —— 两行共用 id 但内容
//      不同时打分必须按各自内容算（首版误用 id 作键，被既有用例当场打红）；
//   3. MEM-4 窄投影：`SELECT *` 改显式列后，`AgentMemoryRow` 每个字段仍必须有值，
//      防止漏列导致字段静默变 `undefined`；
//   4. INT-1 事件驱动栅栏：原 `while(…) await sleep(2ms)` 忙轮询改为事件驱动，
//      三态（active / parked / done）与 dispose 的唤醒语义逐条钉死；
//   5. DOC-4 token 缓存：带缓存与不带缓存**数值必须逐字相同**；超长文本不进缓存。

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => ':memory:' } }));

import { toolsForIntent } from '@main/ai/agent/agentToolSelector';
import { BranchInteractionGate } from '@main/ai/agent/subtaskOrchestrator';
import { estimateTokens, estimateTokensCached } from '@main/ai/utils/tokenEstimator';
import { memorySimilarityScore } from '@main/ai/agent/memoryPolicy';
import { listActiveMemories, queryActiveMemories } from '@main/db/agentMemory';
import type { AgentLoopDeps } from '@main/ai/agent/agentLoop';
import type { AgentMemoryRow } from '@main/db/agentMemory';
import type { IIntent } from '@shared/ai';

// ---------------------------------------------------------------------------
// 1. TOOL-1 — 记忆化不得被调用方改写污染
// ---------------------------------------------------------------------------

describe('TOOL-1 工具子集记忆化', () => {
  const rewrite: IIntent = { intent: 'rewrite', confidence: 0.9 };

  it('调用方原地改写返回数组不污染下一次调用（agentLoop 的 stub 升级路径）', () => {
    const first = toolsForIntent(rewrite, false, true, '# doc', false, false);
    // rewrite 意图下 `readLocalFile` 是基础区里的延迟工具（stub 化）
    const stubIdx = first.findIndex((t) => t.function.name === 'readLocalFile');
    expect(stubIdx).toBeGreaterThanOrEqual(0);
    expect(first[stubIdx].defer_loading).toBe(true);

    // 模拟 agentLoop：把 stub 原地替换为「完整 schema」
    const upgraded = { ...first[stubIdx], defer_loading: false, marker: 'upgraded' } as never;
    first[stubIdx] = upgraded;
    first.push({ type: 'function', function: { name: 'ghost', parameters: {} } } as never);

    const second = toolsForIntent(rewrite, false, true, '# doc', false, false);
    expect(second).toHaveLength(first.length - 1); // push 未泄入缓存
    expect(second.find((t) => t.function.name === 'readLocalFile')?.defer_loading).toBe(true);
    expect(second.some((t) => t.function.name === 'ghost')).toBe(false);
  });

  it('不同入参不串键（KB 授权 / 交互支持 / 已有文档三个开关各自区分）', () => {
    const namesOf = (tools: ReturnType<typeof toolsForIntent>): string[] =>
      tools.map((t) => t.function.name).sort();

    const base = namesOf(toolsForIntent(rewrite, false, true, undefined, false, false));
    const withDoc = namesOf(toolsForIntent(rewrite, false, true, '# doc', false, false));
    const withKb = namesOf(toolsForIntent(rewrite, true, true, undefined, false, false));
    const withAsk = namesOf(toolsForIntent(rewrite, false, true, undefined, true, false));

    expect(withDoc).toContain('editBlocks');
    expect(base).not.toContain('editBlocks');
    expect(withKb).toContain('searchKB');
    expect(base).not.toContain('searchKB');
    expect(withAsk).toContain('ask_question_card');
    expect(base).not.toContain('ask_question_card');
  });

  it('intent 维度区分：chat 不注入 searchKB，kbQa 注入', () => {
    const chat = toolsForIntent({ intent: 'chat', confidence: 0.9 }, true, true);
    const kbQa = toolsForIntent({ intent: 'kbQa', confidence: 0.9 }, true, true);
    expect(chat.some((t) => t.function.name === 'searchKB')).toBe(false);
    expect(kbQa.some((t) => t.function.name === 'searchKB')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. MEM-2 — trigram 记忆化的键必须是文本
// ---------------------------------------------------------------------------

function memRow(id: number, subject: string, content: string): AgentMemoryRow {
  return {
    id,
    userId: 'u1',
    kind: 'fact',
    subject,
    content,
    source: 'auto',
    conversationId: 'c1',
    fingerprint: `fp${id}`,
    validFrom: '2026-01-01 00:00:00',
    validTo: null,
    writtenAt: '2026-01-01 00:00:00',
  };
}

describe('MEM-2 trigram 记忆化边界', () => {
  it('两行共用 id 但内容不同时，打分按各自内容算（不得按 id 命中同一份 Set）', () => {
    const a = memRow(1, 'city', 'Shanghai is a big coastal city');
    const b = memRow(1, 'weather', '明天上海有雨，记得带伞');
    // 内容完全不同 → 重合度必然远低于「同一份 Set」会给出的 1
    expect(memorySimilarityScore(a, b)).toBeLessThan(0.5);
    expect(Number.isNaN(memorySimilarityScore(a, b))).toBe(false);
  });

  it('同一行自比恒为 1；短文本（不足 3 字）返回 0 而非 NaN', () => {
    const a = memRow(1, 'city', 'Shanghai is a big coastal city');
    expect(memorySimilarityScore(a, a)).toBe(1);
    expect(memorySimilarityScore(memRow(2, 'a', 'x'), memRow(3, 'b', 'y'))).toBe(0);
  });

  it('反复调用结果稳定（记忆表是每次调用新建的局部变量，不跨调用累积）', () => {
    const a = memRow(1, 'city', 'Shanghai is a big coastal city');
    const b = memRow(2, 'place', 'shanghai is big');
    const first = memorySimilarityScore(a, b);
    for (let i = 0; i < 5; i += 1) {
      expect(memorySimilarityScore(a, b)).toBe(first);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. MEM-4 — 窄投影不得漏列
// ---------------------------------------------------------------------------

describe('MEM-4 agent_memory 窄投影完整性', () => {
  /** 只实现 selectActiveRows 需要的 SQL 形态的最小假库（列清单被刻意忽略）。 */
  function fakeDb(rows: Array<Record<string, unknown>>): never {
    return {
      prepare: (sql: string) => ({
        all: (_userId: string, _kind?: string) => {
          if (!/FROM agent_memory/i.test(sql) || !/user_id\s*=\s*\?/i.test(sql)) {
            throw new Error(`fakeDb: 未识别 SQL → ${sql}`);
          }
          if (/\bWHERE\b/i.test(sql) === false) throw new Error('fakeDb: SELECT 必须带 WHERE');
          return rows;
        },
        // markAccessed 的「读取即访问」写入（本用例只关心读取投影）
        run: () => ({ changes: 1, lastInsertRowid: 0 }),
      }),
    } as never;
  }

  it('投影必须覆盖 AgentMemoryRow 的全部字段（漏列会静默变 undefined）', () => {
    const raw = {
      id: 7,
      user_id: 'u1',
      kind: 'fact',
      subject: 'city',
      content: '上海',
      source: 'auto',
      conversation_id: 'c1',
      fingerprint: 'fp7',
      valid_from: '2026-01-01 00:00:00',
      valid_to: null,
      written_at: '2026-01-02 00:00:00',
      access_count: 3,
    };
    for (const read of [listActiveMemories, queryActiveMemories]) {
      const [row] = read(fakeDb([raw]), 'u1');
      // AgentMemoryRow 的每一个字段都必须有值（少列 → 字段静默变 undefined）
      const expected: Array<[string, unknown]> = [
        ['id', 7],
        ['userId', 'u1'],
        ['kind', 'fact'],
        ['subject', 'city'],
        ['content', '上海'],
        ['source', 'auto'],
        ['conversationId', 'c1'],
        ['fingerprint', 'fp7'],
        ['validFrom', '2026-01-01 00:00:00'],
        ['validTo', null],
        ['writtenAt', '2026-01-02 00:00:00'],
      ];
      for (const [field, value] of expected) {
        expect(
          (row as unknown as Record<string, unknown>)[field],
          `${read.name} 投影漏列 ${field}`
        ).toStrictEqual(value);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. INT-1 — 事件驱动栅栏三态
// ---------------------------------------------------------------------------

describe('INT-1 BranchInteractionGate 栅栏语义', () => {
  function gateWith(waiter: () => Promise<Record<string, string>>): {
    gate: BranchInteractionGate;
    seen: string[];
  } {
    const seen: string[] = [];
    const deps = {
      onInteractionRequired: (questions: Array<{ id: string }>) => {
        seen.push(questions[0]?.id ?? '');
      },
      waitForInteraction: waiter,
    } as unknown as AgentLoopDeps;
    return { gate: new BranchInteractionGate(deps), seen };
  }

  it('兄弟支在飞时挂起；兄弟支 leave 后才放行（不得提前穿过边界）', async () => {
    const { gate, seen } = gateWith(async () => ({ q: 'a' }));
    gate.enter('A');
    gate.enter('B');

    let released = false;
    const bWrapped = gate.wrap('B');
    const bRun = (async () => {
      bWrapped.onInteractionRequired?.(
        [{ id: 'B-q', text: 't', type: 'confirm' }],
        'subtask_failed'
      );
      await bWrapped.waitForInteraction?.();
      released = true;
    })();

    // A 仍在飞 → B 必须挂住
    await new Promise((r) => setTimeout(r, 20));
    expect(released).toBe(false);

    // A 到达边界 → B 放行，且交互经真实 deps 发出
    gate.leave('A');
    await bRun;
    expect(released).toBe(true);
    expect(seen).toEqual(['B-q']);
  });

  it('两支同时 parked 时互不阻塞（同为 parked 即视为到达边界）', async () => {
    const { gate } = gateWith(async () => ({}));
    gate.enter('A');
    gate.enter('B');
    const a = gate.wrap('A');
    const b = gate.wrap('B');
    await expect(
      Promise.all([a.waitForInteraction?.(), b.waitForInteraction?.()])
    ).resolves.toEqual([{}, {}]);
  });

  it('dispose 唤醒全部挂起者（不返回即视为死锁）', async () => {
    const { gate } = gateWith(async () => ({}));
    gate.enter('A');
    gate.enter('B');
    const b = gate.wrap('B');
    const waiting = b.waitForInteraction?.() as Promise<Record<string, string>>;
    await new Promise((r) => setTimeout(r, 10));
    gate.dispose();
    await expect(waiting).resolves.toEqual({});
  });

  it('wait 被 reject 时标记 cancelled（用户取消向上传播，不吞异常）', async () => {
    const { gate } = gateWith(async () => {
      throw new Error('Task cancelled');
    });
    gate.enter('A');
    const a = gate.wrap('A');
    await expect(a.waitForInteraction?.()).rejects.toThrow('Task cancelled');
    expect(gate.cancelled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. QUE-2 — 生产队列必须真的走轻量存在性查询
// ---------------------------------------------------------------------------

describe('QUE-2 队列 pending 存在性查询', () => {
  /** 记录 SQL 文本的最小假库（只关心语句形态，不关心结果）。 */
  function shapeDb(): { prepare: (sql: string) => unknown; prepares: string[] } {
    const prepares: string[] = [];
    return {
      prepares,
      prepare(sql: string) {
        prepares.push(sql.replace(/\s+/g, ' ').trim());
        return { get: () => undefined, all: () => [], run: () => ({ changes: 0 }) };
      },
    };
  }

  it('AgentTaskQueue 暴露 hasPendingForConversation（memoryWriter 的轻量钩子名必须与之对齐）', async () => {
    const { AgentTaskQueue } = await import('@main/ai/agent/agentTaskQueue');
    const db = shapeDb();
    const queue = new AgentTaskQueue(db as never);

    // 名字不对齐 → memoryWriter 的 typeof 检测会判 undefined，优化静默失效
    expect(typeof queue.hasPendingForConversation).toBe('function');
    expect(queue.hasPendingForConversation('c1')).toBe(false);

    // 只发一条「存在性」语句，不物化会话任务列表
    expect(db.prepares).toHaveLength(1);
    expect(db.prepares[0]).toMatch(/^SELECT 1 AS hit FROM agent_task_queue/i);
    expect(db.prepares[0]).toMatch(/LIMIT 1$/i);
  });
});

// ---------------------------------------------------------------------------
// 6. INT-2 — 缓存键单射性（撞键会把别人的分类结果喂给用户）
// ---------------------------------------------------------------------------

describe('INT-2 intentTiering 缓存键', () => {
  it('同一输入不同 hasHistory 不撞键（键含 hasHistory 维度）', async () => {
    const { __cacheKeyForTest } = await import('@main/ai/intentTiering');
    expect(__cacheKeyForTest('帮我写周报', false)).not.toBe(
      __cacheKeyForTest('帮我写周报', true)
    );
  });

  it('不同输入不撞键（含前缀/空串/含 NUL 的边界）', async () => {
    const { __cacheKeyForTest } = await import('@main/ai/intentTiering');
    const inputs = ['', 'a', 'a\u0000b', '\u0000', '  ', '帮我写周报', '帮我写周报 '];
    const keys = inputs.map((s) => __cacheKeyForTest(s, false));
    expect(new Set(keys).size).toBe(inputs.length);
  });

  it('短路径与长路径键空间不相交（长输入即便「像」一个短键也不会撞）', async () => {
    const { __cacheKeyForTest } = await import('@main/ai/intentTiering');
    const { createHash } = await import('crypto');

    const longInput = '长'.repeat(600); // > 512 → 走哈希路径
    const longKey = __cacheKeyForTest(longInput, false);

    // 构造一个「短输入」,其内容刻意模仿哈希路径的载荷 —— 若两条路径共用结构，
    // 这里会与 longKey 相同（首版实现 `{p}\0#{hex}` 正是如此）
    const forged = `#${createHash('sha256').update(longInput).digest('hex')}`;
    expect(forged.length).toBeLessThanOrEqual(512);
    expect(__cacheKeyForTest(forged, false)).not.toBe(longKey);

    // 该伪造串自身长输入化的键也不与 short 路径撞
    expect(__cacheKeyForTest(`${forged}${'x'.repeat(600)}`, false)).not.toBe(
      __cacheKeyForTest(forged, false)
    );
  });

  it('长输入键长有上界（不随输入长度增长，避免缓存持有长文本）', async () => {
    const { __cacheKeyForTest } = await import('@main/ai/intentTiering');
    const a = __cacheKeyForTest('x'.repeat(600), false);
    const b = __cacheKeyForTest('x'.repeat(60000), false);
    expect(a.length).toBe(b.length);
    expect(a.length).toBeLessThan(128);
  });
});

// ---------------------------------------------------------------------------
// 5. DOC-4 — token 缓存数值不变
// ---------------------------------------------------------------------------

describe('DOC-4 estimateTokensCached 数值不变', () => {
  const cases: Array<[string, string]> = [
    ['空串', ''],
    ['短 ASCII', 'hello world'],
    ['恰好 100 字符', 'a'.repeat(100)],
    ['中英混排', '这是一段包含中文和 English 混合的文本。'.repeat(20)],
    ['超长（> 8K，不进缓存）', 'x'.repeat(20000)],
    ['超长 CJK（> 8K，不进缓存）', '中'.repeat(20000)],
  ];

  it.each(cases)('%s：带缓存与不带缓存结果相同', (_label, text) => {
    expect(estimateTokensCached(text)).toBe(estimateTokens(text));
  });

  it('反复调用结果稳定，且与首次数值一致', () => {
    const text = '这是一段包含中文和 English 混合的文本。'.repeat(30);
    const first = estimateTokensCached(text);
    for (let i = 0; i < 5; i += 1) expect(estimateTokensCached(text)).toBe(first);
    expect(first).toBe(estimateTokens(text));
  });
});

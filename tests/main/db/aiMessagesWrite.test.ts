import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ============================================
// B-a（P0-4 / Q7 / Q14）：appendToolTurnWithAssistant 单事务写入
// + 回写链拆除静态验收
// 真实 better-sqlite3 因 Electron ABI 无法在系统 Node 下加载 → fake DB（计划 §4 fake 约束）
// ============================================

interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
  iterate: (...args: unknown[]) => IterableIterator<Record<string, unknown>>;
}

const fakeDbMock = vi.hoisted(() => {
  type Call = { method: 'get' | 'all' | 'run' | 'iterate' | 'transaction'; sql: string; args: unknown[] };
  const calls: Call[] = [];
  // 内存行表（按插入顺序保留），用于断言幂等与回滚
  const rows = new Map<string, Record<string, unknown>>();
  // 命中该片段的 SQL 抛错（事务回滚用例）
  let failSqlFragment: string | null = null;

  const insertAiMessage = (sql: string, args: unknown[]): number => {
    const [id, conversationId, userId, role, content, refsJson, toolCallId, toolCalls, attachmentsJson, createdAt] =
      args as [string, string, string, string, string, string | null, string | null, string | null, string | null, string];
    const row: Record<string, unknown> = {
      id,
      conversation_id: conversationId,
      user_id: userId,
      role,
      content,
      refs_json: refsJson,
      tool_call_id: toolCallId,
      tool_calls: toolCalls,
      attachments_json: attachmentsJson,
      created_at: createdAt,
    };
    if (sql.includes('OR IGNORE')) {
      if (rows.has(id)) return 0;
      rows.set(id, row);
      return 1;
    }
    if (sql.includes('ON CONFLICT')) {
      const existing = rows.get(id);
      if (existing) {
        // 幂等 upsert：只覆盖正文与 tool_calls，保留原始 created_at（不破坏行序）
        existing.content = content;
        existing.tool_calls = toolCalls;
        return 1;
      }
      rows.set(id, row);
      return 1;
    }
    rows.set(id, row);
    return 1;
  };

  return {
    calls,
    rows,
    setFailSql: (fragment: string | null): void => {
      failSqlFragment = fragment;
    },
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          return undefined;
        },
        all: (...args) => {
          calls.push({ method: 'all', sql, args });
          return [];
        },
        run: (...args) => {
          calls.push({ method: 'run', sql, args });
          if (failSqlFragment && sql.includes(failSqlFragment)) throw new Error('simulated write failure');
          if (sql.includes('INSERT INTO ai_messages') || sql.includes('INSERT OR IGNORE INTO ai_messages')) {
            return { changes: insertAiMessage(sql, args) };
          }
          return { changes: 1 };
        },
        iterate: (...args) => {
          calls.push({ method: 'iterate', sql, args });
          return [][Symbol.iterator]();
        },
      };
      return stmt;
    }),
    reset: (): void => {
      calls.length = 0;
      rows.clear();
      failSqlFragment = null;
      fakeDbMock.prepare.mockClear();
    },
  };
});

class FakeDatabase {
  prepare(sql: string): FakeStatement {
    return fakeDbMock.prepare(sql) as FakeStatement;
  }

  /** fake 事务：记录调用 + 快照回滚（真实 better-sqlite3 语义由 Electron smoke 承担） */
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: never[]): unknown => {
      fakeDbMock.calls.push({ method: 'transaction', sql: 'transaction', args: [] });
      const snapshot = new Map(fakeDbMock.rows);
      try {
        return fn(...args);
      } catch (error) {
        fakeDbMock.rows.clear();
        for (const [key, value] of snapshot) fakeDbMock.rows.set(key, value);
        throw error;
      }
    }) as T;
  }
}

vi.mock('better-sqlite3', () => ({ default: class {} }));
vi.mock('@main/db/index', () => ({ getDatabase: () => new FakeDatabase() }));
const attachmentsMock = vi.hoisted(() => ({ removeParsedAttachment: vi.fn(() => true) }));
vi.mock('@main/db/attachments', () => attachmentsMock);

import { appendToolTurnWithAssistant, updateMessageToolCalls } from '@main/db/ai';

const { calls, rows } = fakeDbMock;

const baseInput = {
  conversationId: 'c1',
  userId: 'u1',
  round: 3,
  assistantContent: '',
  toolCalls: [
    { toolCallId: 'call_1', name: 'searchKB', args: '{}', status: 'ok' as const },
    { toolCallId: 'call_2', name: 'readFile', args: '{}', status: 'ok' as const },
  ],
  tools: [
    { toolCallId: 'call_1', content: '{"hits":1}' },
    { toolCallId: 'call_2', content: '{"path":"a.md"}' },
  ],
};

function runWrites(): Array<{ sql: string; args: unknown[] }> {
  return calls.filter((c) => c.method === 'run' && c.sql.includes('ai_messages'));
}

beforeEach(() => {
  fakeDbMock.reset();
  attachmentsMock.removeParsedAttachment.mockClear();
});

describe('appendToolTurnWithAssistant — 一个工具轮的 assistant + N 条 tool 同事务', () => {
  it('事务边界 = 一个工具轮：db.transaction 内先 upsert assistant 再 INSERT OR IGNORE tool 行', () => {
    appendToolTurnWithAssistant(baseInput);
    const tx = calls.filter((c) => c.method === 'transaction');
    expect(tx).toHaveLength(1);

    const writes = runWrites();
    expect(writes).toHaveLength(3);
    const assistantIdx = writes.findIndex((w) => w.sql.includes('ON CONFLICT'));
    const firstToolIdx = writes.findIndex((w) => w.sql.includes('OR IGNORE'));
    expect(assistantIdx).toBe(0);
    expect(firstToolIdx).toBe(1);
    expect(assistantIdx).toBeLessThan(firstToolIdx);
  });

  it('确定性 id：assistant = aturn_${conv}_${round}，tool = t_${conv}_${round}_${index}', () => {
    const result = appendToolTurnWithAssistant(baseInput);
    expect(result.assistantId).toBe('aturn_c1_3');
    expect(result.toolIds).toEqual(['t_c1_3_0', 't_c1_3_1']);
    expect([...rows.keys()]).toEqual(['aturn_c1_3', 't_c1_3_0', 't_c1_3_1']);
  });

  it('幂等：同参数重跑不增行，且 tool_calls 与正文被覆盖为最新值', () => {
    appendToolTurnWithAssistant(baseInput);
    expect(rows.size).toBe(3);

    appendToolTurnWithAssistant({
      ...baseInput,
      assistantContent: '已收敛正文',
      toolCalls: [{ toolCallId: 'call_1', name: 'searchKB', args: '{}', status: 'ok' as const }],
      tools: [{ toolCallId: 'call_1', content: '{"hits":2}' }],
    });
    expect(rows.size).toBe(3);
    const assistant = rows.get('aturn_c1_3');
    expect(assistant?.content).toBe('已收敛正文');
    expect(JSON.parse(String(assistant?.tool_calls))).toEqual([
      { toolCallId: 'call_1', name: 'searchKB', args: '{}', status: 'ok' },
    ]);
    // 第二轮 tool 行保持原值（INSERT OR IGNORE 不覆盖已有结果）
    expect(rows.get('t_c1_3_1')?.content).toBe('{"path":"a.md"}');
  });

  it('参数化写入：assistant 行带 role/tool_calls，tool 行带 tool_call_id，绝无 SQL 拼接', () => {
    appendToolTurnWithAssistant(baseInput);
    const writes = runWrites();
    const assistantWrite = writes[0];
    expect(assistantWrite.args).toEqual([
      'aturn_c1_3',
      'c1',
      'u1',
      'assistant',
      '',
      null,
      null,
      JSON.stringify(baseInput.toolCalls),
      null,
      expect.any(String),
    ]);
    expect(assistantWrite.sql).not.toContain('aturn_c1_3');
    expect(assistantWrite.sql).toContain('ON CONFLICT(id) DO UPDATE');

    const toolWrite = writes[1];
    expect(toolWrite.args).toEqual([
      't_c1_3_0',
      'c1',
      'u1',
      'tool',
      '{"hits":1}',
      null,
      'call_1',
      null,
      null,
      expect.any(String),
    ]);
    expect(toolWrite.sql).toContain('INSERT OR IGNORE');
    expect(toolWrite.sql).not.toContain('call_1');
  });

  it('会话 updated_at 在同一事务内刷新', () => {
    appendToolTurnWithAssistant(baseInput);
    const upd = calls.find((c) => c.method === 'run' && c.sql.includes('UPDATE ai_conversations'));
    expect(upd).toBeTruthy();
    expect(upd?.args).toEqual(['c1', 'u1']);
    // 刷新与消息写入同处一个事务
    const txIdx = calls.findIndex((c) => c.method === 'transaction');
    const updIdx = calls.findIndex((c) => c.method === 'run' && c.sql.includes('UPDATE ai_conversations'));
    expect(txIdx).toBeGreaterThan(-1);
    expect(updIdx).toBeGreaterThan(txIdx);
  });

  it('任一 tool 行写入失败 → 整体回滚，不留半截轮', () => {
    fakeDbMock.setFailSql('INSERT OR IGNORE');
    expect(() => appendToolTurnWithAssistant(baseInput)).toThrow('simulated write failure');
    expect(rows.size).toBe(0);
  });

  it('IPC 发送不进事务：事务内只有 DB 语句（无 stream 发送痕迹）', () => {
    appendToolTurnWithAssistant(baseInput);
    const insideTx = calls.slice(calls.findIndex((c) => c.method === 'transaction'));
    const sqls = insideTx.map((c) => c.sql);
    expect(sqls.every((s) => s === 'transaction' || s.includes('ai_messages') || s.includes('ai_conversations'))).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// B-e 回写链拆除（Q7 已批准删能力）：静态验收
// ---------------------------------------------------------------------------

describe('B-e 回写链拆除 — 静态验收', () => {
  const chainFiles = [
    'src/main/db/ai.ts',
    'src/render/stores/agentStore.ts',
    'src/main/preload.ts',
    'src/main/ai/ipc/chatHandlers.ts',
    'src/render/utils/weaveMDBridge.ts',
    'tests/setup.ts',
  ];

  it('链上 6 处均不再引用 updateLatestAssistantToolCalls / AI_MESSAGE_UPDATE_TOOL_CALLS', () => {
    for (const rel of chainFiles) {
      const text = readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      expect(text, `${rel} 不应再含回写链标识`).not.toContain('updateLatestAssistantToolCalls');
      expect(text, `${rel} 不应再含回写通道常量`).not.toContain('AI_MESSAGE_UPDATE_TOOL_CALLS');
    }
  });

  it('通道常量仍在 src/shared/constants.ts（避免触碰共享常量）', () => {
    const constants = readFileSync(path.resolve(process.cwd(), 'src/shared/constants.ts'), 'utf8');
    expect(constants).toContain('AI_MESSAGE_UPDATE_TOOL_CALLS');
  });

  it('updateMessageToolCalls（按 messageId 定位）仍在 db/ai.ts，未被误删', () => {
    const ai = readFileSync(path.resolve(process.cwd(), 'src/main/db/ai.ts'), 'utf8');
    expect(ai).toContain('export function updateMessageToolCalls');
  });

  it('updateMessageToolCalls 参数化更新 tool_calls：非空序列化、空置 NULL', () => {
    const sample = [{ toolCallId: 'c1', name: 'searchKB', args: '{}', status: 'ok' as const }];
    expect(updateMessageToolCalls('m1', sample)).toBe(true);
    let upd = calls.find((c) => c.method === 'run' && c.sql.includes('UPDATE ai_messages SET tool_calls'));
    expect(upd?.sql).toContain('WHERE id = ?');
    expect(upd?.args).toEqual([JSON.stringify(sample), 'm1']);

    expect(updateMessageToolCalls('m1', [])).toBe(true);
    upd = calls.filter((c) => c.method === 'run' && c.sql.includes('UPDATE ai_messages SET tool_calls')).at(-1);
    expect(upd?.args).toEqual([null, 'm1']);
  });
});

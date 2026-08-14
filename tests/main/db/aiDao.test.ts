import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Fake better-sqlite3 隔离（沿用 ipcDialogs 实证模式） ---
interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
}

const fakeDbMock = vi.hoisted(() => {
  const calls: Array<{ method: 'get' | 'all' | 'run'; sql: string; args: unknown[] }> = [];
  return {
    calls,
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          // 返回被回读的 INSERT 结果行，便于 createConversation/appendMessage 映射
          if (sql.includes('FROM ai_conversations')) {
            return {
              id: args[0],
              user_id: 'u1',
              mode: 'chat',
              summary: '',
              created_at: 'now',
              updated_at: 'now',
            };
          }
          if (sql.includes('FROM ai_messages')) {
            return {
              id: args[0],
              conversation_id: 'c1',
              user_id: 'u1',
              role: 'assistant',
              content: 'hello',
              refs_json: null,
              created_at: 'now',
            };
          }
          return undefined;
        },
        all: (...args) => {
          calls.push({ method: 'all', sql, args });
          return [];
        },
        run: (...args) => {
          calls.push({ method: 'run', sql, args });
          return { changes: 1 };
        },
      };
      return stmt;
    }),
    reset: () => {
      calls.length = 0;
      fakeDbMock.prepare.mockClear();
    },
  };
});

class FakeDatabase {
  prepare(sql: string): FakeStatement {
    return fakeDbMock.prepare(sql) as FakeStatement;
  }
}

vi.mock('better-sqlite3', () => ({ default: FakeDatabase }));
vi.mock('@main/db/index', () => ({
  getDatabase: () => new FakeDatabase(),
}));

import {
  appendMessage,
  createConversation,
  deleteConversation,
  getAiConfig,
  getMessagesByConversation,
  listConversationsByUser,
  updateConversationSummary,
} from '@main/db/ai';

const { calls } = fakeDbMock;

function callOf(method: 'get' | 'all' | 'run', sqlFragment: string) {
  return calls.find((c) => c.method === method && c.sql.includes(sqlFragment));
}

beforeEach(() => {
  fakeDbMock.reset();
});

describe('ai DAO — SQL 参数化与归属过滤行为', () => {
  it('createConversation binds userId/mode with uuid id', () => {
    createConversation('u1', 'chat');
    const insert = callOf('run', 'INSERT INTO ai_conversations');
    expect(insert?.args[0]).toEqual(expect.stringMatching(/[0-9a-f-]{36}/));
    expect(insert?.args[1]).toBe('u1');
    expect(insert?.args[2]).toBe('chat');
  });

  it('appendMessage binds conversation_id, user_id, role, content in order', () => {
    appendMessage({
      conversationId: 'c1',
      userId: 'u1',
      role: 'assistant',
      content: 'hello',
    });
    const insert = callOf('run', 'INSERT INTO ai_messages');
    expect(insert?.args).toEqual([expect.any(String), 'c1', 'u1', 'assistant', 'hello', null]);
  });

  it('listConversationsByUser filters by user_id + mode and orders by updated_at DESC', () => {
    listConversationsByUser('u1', 'chat');
    const stmt = callOf('all', 'ai_conversations');
    expect(stmt?.sql).toMatch(/WHERE user_id = \? AND mode = \?/);
    expect(stmt?.sql).toContain('ORDER BY updated_at DESC');
    expect(stmt?.args).toEqual(['u1', 'chat']);
  });

  it('listConversationsByUser without mode filters only by user_id', () => {
    listConversationsByUser('u1');
    const stmt = callOf('all', 'ai_conversations');
    expect(stmt?.sql).toMatch(/WHERE user_id = \?/);
    expect(stmt?.sql).not.toContain('AND mode');
    expect(stmt?.args).toEqual(['u1']);
  });

  it('getMessagesByConversation joins conversation to enforce user ownership', () => {
    getMessagesByConversation('c1', 'u1');
    const stmt = callOf('all', 'ai_messages');
    expect(stmt?.sql).toContain('JOIN ai_conversations');
    expect(stmt?.sql).toMatch(/WHERE m\.conversation_id = \? AND c\.user_id = \?/);
    expect(stmt?.sql).toContain('ORDER BY m.created_at ASC');
    expect(stmt?.args).toEqual(['c1', 'u1']);
  });

  it('deleteConversation filters by id AND user_id', () => {
    const deleted = deleteConversation('c1', 'u1');
    expect(deleted).toBe(true);
    const stmt = callOf('run', 'DELETE FROM ai_conversations');
    expect(stmt?.sql).toMatch(/WHERE id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['c1', 'u1']);
  });

  it('updateConversationSummary updates then returns mapped conversation', () => {
    const result = updateConversationSummary('c1', 'u1', 'summary');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('c1');
    const upd = callOf('run', 'UPDATE ai_conversations');
    expect(upd?.sql).toMatch(/WHERE id = \? AND user_id = \?/);
    expect(upd?.args).toEqual(['summary', 'now', 'c1', 'u1']);
  });

  it('getAiConfig SELECT filters by user_id', () => {
    const config = getAiConfig('u1');
    expect(config).toBeNull();
    const stmt = callOf('get', 'SELECT * FROM ai_config');
    expect(stmt?.sql).toMatch(/WHERE user_id = \?/);
    expect(stmt?.args).toEqual(['u1']);
  });
});

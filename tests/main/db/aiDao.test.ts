import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Fake better-sqlite3 隔离（沿用 ipcDialogs 实证模式） ---
interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
}

interface AiConfigRowFixture {
  id?: string;
  user_id: string;
  kb_top_k?: number | null;
  kb_fuse?: number | null;
  kb_threshold?: number | null;
  kb_pinned_weight?: number | null;
  kb_embedding_host?: string | null;
  kb_embedding_model?: string | null;
}

const fakeDbMock = vi.hoisted(() => {
  const calls: Array<{ method: 'get' | 'all' | 'run'; sql: string; args: unknown[] }> = [];
  // 供 getAiConfig SELECT 注入自定义行（覆盖默认 undefined）→ 触发 UPDATE 分支 / mapConfigRow
  // 第一次 ai_config SELECT 用于 upsert 前置判断；之后为 post-write 回读。用计数区分：
  // skipFirst=false 时所有读取都返回该行；skipFirst=true 时首次返回 undefined（触发 INSERT）。
  let aiConfigRow: AiConfigRowFixture | undefined;
  let aiConfigGetCount = 0;
  let skipFirst = false;
  return {
    calls,
    setAiConfigRow: (row: AiConfigRowFixture | undefined): void => {
      aiConfigRow = row;
    },
    setSkipFirstAiConfigGet: (skip: boolean): void => {
      skipFirst = skip;
      aiConfigGetCount = 0;
    },
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
              mode: 'agent',
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
          if (sql.includes('FROM ai_config')) {
            aiConfigGetCount += 1;
            // skipFirst：首次用于 upsert 前置判断，返回 undefined 触发 INSERT；post-write 回读返回行
            const isFirst = aiConfigGetCount === 1;
            if (!aiConfigRow || (skipFirst && isFirst)) return undefined;
            return {
              id: aiConfigRow.id ?? 'cfg1',
              user_id: aiConfigRow.user_id,
              backend: 'remote',
              ollama_base_url: 'http://localhost:11434',
              remote_base_url: 'https://api.deepseek.com',
              model: '',
              api_key_enc: null,
              allow_network: 0,
              allow_send: 0,
              consent_updated_at: null,
              created_at: 'now',
              updated_at: 'now',
              kb_top_k: aiConfigRow.kb_top_k ?? undefined,
              kb_fuse: aiConfigRow.kb_fuse ?? undefined,
              kb_threshold: aiConfigRow.kb_threshold ?? undefined,
              kb_pinned_weight: aiConfigRow.kb_pinned_weight ?? undefined,
              kb_embedding_host: aiConfigRow.kb_embedding_host ?? undefined,
              kb_embedding_model: aiConfigRow.kb_embedding_model ?? undefined,
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
  upsertAiConfig,
} from '@main/db/ai';
import { DEFAULT_KB_SETTINGS } from '@shared/ai';

const { calls } = fakeDbMock;

function callOf(method: 'get' | 'all' | 'run', sqlFragment: string) {
  return calls.find((c) => c.method === method && c.sql.includes(sqlFragment));
}

beforeEach(() => {
  fakeDbMock.reset();
  fakeDbMock.setAiConfigRow(undefined);
  fakeDbMock.setSkipFirstAiConfigGet(false);
});

describe('ai DAO — SQL 参数化与归属过滤行为', () => {
  it('createConversation binds userId/mode with uuid id', () => {
    createConversation('u1', 'agent');
    const insert = callOf('run', 'INSERT INTO ai_conversations');
    expect(insert?.args[0]).toEqual(expect.stringMatching(/[0-9a-f-]{36}/));
    expect(insert?.args[1]).toBe('u1');
    expect(insert?.args[2]).toBe('agent');
  });

  it('appendMessage binds conversation_id, user_id, role, content in order', () => {
    appendMessage({
      conversationId: 'c1',
      userId: 'u1',
      role: 'assistant',
      content: 'hello',
    });
    const insert = callOf('run', 'INSERT INTO ai_messages');
    // 9 args: id, conversation_id, user_id, role, content, refs_json, tool_call_id, tool_calls, created_at
    expect(insert?.args).toEqual([expect.any(String), 'c1', 'u1', 'assistant', 'hello', null, null, null, expect.any(String)]);
  });

  it('listConversationsByUser filters by user_id + mode and orders by updated_at DESC', () => {
    listConversationsByUser('u1', 'agent');
    const stmt = callOf('all', 'ai_conversations');
    expect(stmt?.sql).toMatch(/WHERE user_id = \? AND mode = \?/);
    expect(stmt?.sql).toContain('ORDER BY updated_at DESC');
    expect(stmt?.args).toEqual(['u1', 'agent']);
  });

  it('listConversationsByUser without mode filters only by user_id', () => {
    listConversationsByUser('u1');
    const stmt = callOf('all', 'ai_conversations');
    expect(stmt?.sql).toMatch(/WHERE user_id = \?/);
    expect(stmt?.sql).not.toContain('AND mode');
    expect(stmt?.args).toEqual(['u1']);
  });

  it('getMessagesByConversation filters by conversation_id and user_id', () => {
    getMessagesByConversation('c1', 'u1');
    const stmt = callOf('all', 'ai_messages');
    expect(stmt?.sql).toContain('WHERE conversation_id = ?');
    expect(stmt?.sql).toContain('AND user_id = ?');
    expect(stmt?.sql).toContain('ORDER BY created_at ASC');
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

  // ---- 第 6 期批次 2：KB 参数列（upsert UPDATE/INSERT + mapConfigRow NULL 兜底） ----

  it('upsertAiConfig UPDATE：含纯 FTS KB 列（embedding 遗留列不再写入）', () => {
    // 既有行带 KB 值（触发 UPDATE 分支）
    fakeDbMock.setAiConfigRow({
      user_id: 'u1',
      kb_top_k: 3,
      kb_fuse: 0.4,
      kb_threshold: 0.5,
      kb_pinned_weight: 1.2,
    });
    upsertAiConfig('u1', { kbTopK: 8 });
    const upd = callOf('run', 'UPDATE ai_config');
    expect(upd?.sql).toContain('kb_top_k = ?');
    expect(upd?.sql).toContain('kb_fuse = ?');
    expect(upd?.sql).toContain('kb_threshold = ?');
    expect(upd?.sql).toContain('kb_pinned_weight = ?');
    // 遗留列不再写入
    expect(upd?.sql).not.toContain('kb_embedding_host');
    expect(upd?.sql).not.toContain('kb_embedding_model');
    const kbArgs = upd?.args?.slice(8, 12) as unknown[];
    // 只改传的字段（kbTopK=8 覆盖），其余沿用既有值
    expect(kbArgs).toEqual([8, 0.4, 0.5, 1.2]);
  });

  it('upsertAiConfig INSERT：含纯 FTS KB 列，参数用 update 或 DEFAULT_KB_SETTINGS 兜底', () => {
    // 无既有行 → INSERT 分支；只传部分 KB 字段。post-write 回读需返回行，故 skipFirst
    fakeDbMock.setAiConfigRow({ user_id: 'u1' });
    fakeDbMock.setSkipFirstAiConfigGet(true);
    upsertAiConfig('u1', { kbTopK: 8, kbFuse: 0.7 });
    const ins = callOf('run', 'INSERT INTO ai_config');
    expect(ins?.sql).toContain('kb_top_k');
    expect(ins?.sql).toContain('kb_fuse');
    expect(ins?.sql).toContain('kb_threshold');
    expect(ins?.sql).toContain('kb_pinned_weight');
    // 遗留 embedding 列不再写入
    expect(ins?.sql).not.toContain('kb_embedding_host');
    expect(ins?.sql).not.toContain('kb_embedding_model');
    // col list: id,user_id,backend,ollama_base_url,remote_base_url,model,api_key_enc,
    //           allow_network,allow_send,consent_updated_at,kb_top_k,kb_fuse,...
    const kbArgs = ins?.args?.slice(10, 14) as unknown[];
    expect(kbArgs).toEqual([
      8,
      0.7,
      DEFAULT_KB_SETTINGS.threshold,
      DEFAULT_KB_SETTINGS.pinnedWeight,
    ]);
  });

  it('mapConfigRow：KB 列为 NULL 时兜底 DEFAULT_KB_SETTINGS', () => {
    fakeDbMock.setAiConfigRow({ user_id: 'u1' }); // 未传 KB 字段 → 映射为 undefined/NULL
    const config = getAiConfig('u1');
    expect(config).not.toBeNull();
    expect(config?.kbTopK).toBe(DEFAULT_KB_SETTINGS.topK);
    expect(config?.kbFuse).toBe(DEFAULT_KB_SETTINGS.fuse);
    expect(config?.kbThreshold).toBe(DEFAULT_KB_SETTINGS.threshold);
    expect(config?.kbPinnedWeight).toBe(DEFAULT_KB_SETTINGS.pinnedWeight);
  });

  it('mapConfigRow：KB 列有值时保留持久化值（非法/缺失才兜底）', () => {
    fakeDbMock.setAiConfigRow({
      user_id: 'u1',
      kb_top_k: 7,
      kb_fuse: 0.9,
    });
    const config = getAiConfig('u1');
    expect(config?.kbTopK).toBe(7);
    expect(config?.kbFuse).toBe(0.9);
    expect(config?.kbThreshold).toBe(DEFAULT_KB_SETTINGS.threshold);
    expect(config?.kbPinnedWeight).toBe(DEFAULT_KB_SETTINGS.pinnedWeight);
  });
});

// ============================================
// WeaveMD — mail_config DAO 测试（RED → GREEN）
// 覆盖：getMailAuthEnc 按 user_id 过滤、setMailAuthEnc INSERT/UPDATE 参数化落库、
// MAIL_CONFIG_SCHEMA 建表 SQL 幂等含 user_id 唯一约束。
// 沿用 better-sqlite3 fake（aiDao 实证模式），不触碰真实 DB。
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
}

const fakeDbMock = vi.hoisted(() => {
  const calls: Array<{ method: 'get' | 'all' | 'run'; sql: string; args: unknown[] }> = [];
  // 支持 getMailAuthEnc 前置判断 + setMailAuthEnc 写后回读；hasRow 控制 SELECT 是否命中
  let hasRow = false;
  let authEnc = '';
  return {
    calls,
    setHasRow: (h: boolean): void => {
      hasRow = h;
    },
    setAuthEnc: (enc: string): void => {
      authEnc = enc;
    },
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          if (sql.includes('FROM mail_config')) {
            if (!hasRow) return undefined;
            return { user_id: args[0], auth_code_enc: authEnc };
          }
          return undefined;
        },
        all: () => {
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

import { getMailAuthEnc, MAIL_CONFIG_SCHEMA, setMailAuthEnc } from '@main/db/mail';

const { calls } = fakeDbMock;

function callOf(method: 'get' | 'all' | 'run', sqlFragment: string) {
  return calls.find((c) => c.method === method && c.sql.includes(sqlFragment));
}

beforeEach(() => {
  fakeDbMock.reset();
  fakeDbMock.setHasRow(false);
  fakeDbMock.setAuthEnc('');
});

describe('mail_config DAO — SQL 参数化与 user_id 过滤', () => {
  it('MAIL_CONFIG_SCHEMA 声明 mail_config 建表（user_id UNIQUE + 幂等 IF NOT EXISTS）', () => {
    expect(MAIL_CONFIG_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS mail_config');
    expect(MAIL_CONFIG_SCHEMA).toMatch(/user_id\s+TEXT\s+UNIQUE/);
    expect(MAIL_CONFIG_SCHEMA).toContain('auth_code_enc');
    expect(MAIL_CONFIG_SCHEMA).toContain('REFERENCES users(id) ON DELETE CASCADE');
  });

  it('getMailAuthEnc 按 user_id 参数化 SELECT；无行返回 null', () => {
    const enc = getMailAuthEnc('u1');
    expect(enc).toBeNull();
    const stmt = callOf('get', 'FROM mail_config');
    expect(stmt?.sql).toMatch(/WHERE user_id = \?/);
    expect(stmt?.args).toEqual(['u1']);
  });

  it('setMailAuthEnc 无既有行时 INSERT（参数：id, user_id, auth_code_enc）', () => {
    setMailAuthEnc('u1', 'enc-abc');
    const ins = callOf('run', 'INSERT INTO mail_config');
    expect(ins).toBeDefined();
    expect(ins?.args?.[0]).toEqual(expect.stringMatching(/[0-9a-f-]{36}/)); // uuid id
    expect(ins?.args?.[1]).toBe('u1');
    expect(ins?.args?.[2]).toBe('enc-abc');
  });

  it('setMailAuthEnc 采用 UPSERT：INSERT ... ON CONFLICT(user_id) DO UPDATE（幂等，无需 SELECT 前置）', () => {
    setMailAuthEnc('u1', 'enc-new');
    const upsert = callOf('run', 'INSERT INTO mail_config');
    expect(upsert).toBeDefined();
    expect(upsert?.sql).toContain('ON CONFLICT(user_id)');
    expect(upsert?.sql).toContain('DO UPDATE');
    expect(upsert?.args?.[1]).toBe('u1');
    expect(upsert?.args?.[2]).toBe('enc-new');
  });

  it('setMailAuthEnc 以空串/null 清除授权码（断开连接场景）', () => {
    setMailAuthEnc('u1', null);
    const upsert = callOf('run', 'INSERT INTO mail_config');
    expect(upsert?.args?.[1]).toBe('u1');
    expect(upsert?.args?.[2]).toBeNull();
  });
});

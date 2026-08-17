// ============================================
// WeaveMD — appMeta DAO 测试（fake 模式，不加载 better-sqlite3 原生模块）
// 覆盖：getAppMeta 参数化 SELECT、setAppMeta UPSERT、APP_META_SCHEMA 建表 SQL。
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  run: (...args: unknown[]) => { changes: number };
}

const fakeDbMock = vi.hoisted(() => {
  const calls: Array<{ method: 'get' | 'run'; sql: string; args: unknown[] }> = [];
  let storedValue: string | null = null;
  let hasRow = false;
  return {
    calls,
    setStoredValue: (v: string | null): void => {
      storedValue = v;
      hasRow = v !== null;
    },
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          if (sql.includes('FROM app_meta')) {
            if (!hasRow) return undefined;
            return { value: storedValue };
          }
          return undefined;
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
      storedValue = null;
      hasRow = false;
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

import { getAppMeta, setAppMeta, APP_META_SCHEMA } from '@main/db/appMeta';

const { calls } = fakeDbMock;

function callOf(method: 'get' | 'run', sqlFragment: string) {
  return calls.find((c) => c.method === method && c.sql.includes(sqlFragment));
}

beforeEach(() => {
  fakeDbMock.reset();
});

describe('appMeta DAO', () => {
  it('APP_META_SCHEMA 声明 app_meta 建表（key PRIMARY KEY + 幂等 IF NOT EXISTS）', () => {
    expect(APP_META_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS app_meta');
    expect(APP_META_SCHEMA).toMatch(/key\s+TEXT\s+PRIMARY\s+KEY/);
    expect(APP_META_SCHEMA).toContain('value');
    expect(APP_META_SCHEMA).toContain('updated_at');
  });

  it('getAppMeta 缺失 key 返回 null', () => {
    fakeDbMock.setStoredValue(null);
    const value = getAppMeta('nonexistent');
    expect(value).toBeNull();
    const stmt = callOf('get', 'FROM app_meta');
    expect(stmt?.sql).toMatch(/WHERE key = \?/);
    expect(stmt?.args).toEqual(['nonexistent']);
  });

  it('getAppMeta 存在 key 返回 value', () => {
    fakeDbMock.setStoredValue('test.value');
    const value = getAppMeta('test.key');
    expect(value).toBe('test.value');
  });

  it('setAppMeta INSERT ... ON CONFLICT DO UPDATE（UPSERT 幂等）', () => {
    setAppMeta('license.status', 'activated');
    const upsert = callOf('run', 'INSERT INTO app_meta');
    expect(upsert).toBeDefined();
    expect(upsert?.sql).toContain('ON CONFLICT(key)');
    expect(upsert?.sql).toContain('DO UPDATE SET');
    expect(upsert?.args?.[0]).toBe('license.status');
    expect(upsert?.args?.[1]).toBe('activated');
  });

  it('setAppMeta null 值写入 NULL', () => {
    setAppMeta('test.key', null);
    const upsert = callOf('run', 'INSERT INTO app_meta');
    expect(upsert?.args?.[0]).toBe('test.key');
    expect(upsert?.args?.[1]).toBeNull();
  });
});

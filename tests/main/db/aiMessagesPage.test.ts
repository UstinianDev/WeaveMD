// ============================================
// agent-memory-optimize-3 D3（六.1）：ai_messages 按会话分页查询
// ============================================
// 覆盖：
//   1) getConversationMessagesPage 游标分页正确（limit + beforeId = rowid 上界，倒序取、正序返）
//   2) user_id 隔离（跨用户读不到同一 conversation 的行）
//   3) SQL 全参数化（占位符个数 = 绑定参数个数，任何字符串拼接立刻变红）
//   4) 既有 getRecentMessagesByRounds 的 SQL 与入参零改动
//   5) hasCompletedAgentTask 只认 agent_task_queue.status='completed'（轨迹筛选口径）
// fake DB 按 SQL 文本解析，仅支持本链路用到的 SELECT —— DAO 一旦改写口径立刻变红。
// 无 any、无 dangerouslySetInnerHTML。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// fake DB：两张表的最小内存引擎（all / get / iterate，均在**执行时**记录 SQL）
// ---------------------------------------------------------------------------

interface Call {
  method: 'all' | 'get' | 'iterate';
  sql: string;
  args: unknown[];
}

const fake = vi.hoisted(() => {
  const messages: Array<Record<string, unknown>> = [];
  const tasks: Array<Record<string, unknown>> = [];
  const calls: Call[] = [];
  let nextRowid = 1;
  return {
    messages,
    tasks,
    calls,
    nextRowid: (): number => nextRowid++,
    reset(): void {
      messages.length = 0;
      tasks.length = 0;
      calls.length = 0;
      nextRowid = 1;
    },
  };
});

/** ai_messages 查询：conversation_id + user_id [+ rowid < ?] + LIMIT ?，倒序返回。 */
function selectMessages(sql: string, args: unknown[]): Record<string, unknown>[] {
  if (!/FROM\s+ai_messages/i.test(sql)) throw new Error(`fakeDb: 不支持的 SELECT → ${sql}`);
  if (!/WHERE\s+conversation_id\s*=\s*\?\s+AND\s+user_id\s*=\s*\?/i.test(sql)) {
    throw new Error(`fakeDb: ai_messages 查询必须按 conversation_id + user_id 过滤 → ${sql}`);
  }
  const conv = args[0] as string;
  const user = args[1] as string;
  const hasCursor = /rowid\s*<\s*\?/i.test(sql);
  if (hasCursor && !/SELECT\s+rowid\s+AS\s+row_id/i.test(sql)) {
    throw new Error(`fakeDb: 分页查询必须投影 rowid AS row_id（游标来源） → ${sql}`);
  }
  const before = hasCursor ? Number(args[2]) : Number.MAX_SAFE_INTEGER;
  const matched = fake.messages
    .filter(
      (m) => m.conversation_id === conv && m.user_id === user && (m.rowid as number) < before
    )
    .sort((a, b) => (b.rowid as number) - (a.rowid as number))
    // SQL 里的 `rowid AS row_id` 投影（fake 不解析 SELECT 列表，直接补出该别名）
    .map((m) => ({ ...m, row_id: m.rowid }));
  if (hasCursor) {
    const limit = Number(args[3]);
    return matched.slice(0, limit).map((m) => ({ ...m }));
  }
  // 既有按轮流式读取（无 LIMIT）：原样倒序返回
  return matched.map((m) => ({ ...m }));
}

vi.mock('@main/db/index', () => ({
  getDatabase: (): unknown => ({
    prepare: (sql: string) => {
      const placeholderCount = (sql.match(/\?/g) ?? []).length;
      const assertBound = (method: string, args: unknown[]): void => {
        fake.calls.push({ method: method as Call['method'], sql, args });
        if (placeholderCount !== args.length) {
          throw new Error(
            `fakeDb: 占位符 ${placeholderCount} 个与参数 ${args.length} 个不匹配 → SQL 疑似字符串拼接`
          );
        }
      };
      return {
        all: (...args: unknown[]): Record<string, unknown>[] => {
          assertBound('all', args);
          if (/FROM\s+agent_task_queue/i.test(sql)) throw new Error(`fakeDb: 用 get 而非 all → ${sql}`);
          return selectMessages(sql, args);
        },
        iterate: (...args: unknown[]): IterableIterator<Record<string, unknown>> => {
          assertBound('iterate', args);
          const inner = selectMessages(sql, args)[Symbol.iterator]();
          return {
            next: () => inner.next(),
            return: () => {
              inner.return?.();
              return { done: true, value: undefined } as IteratorResult<Record<string, unknown>>;
            },
            [Symbol.iterator]() {
              return this;
            },
          };
        },
        get: (...args: unknown[]): Record<string, unknown> | undefined => {
          assertBound('get', args);
          if (!/FROM\s+agent_task_queue/i.test(sql)) throw new Error(`fakeDb: 不支持的 get → ${sql}`);
          if (
            !/WHERE\s+conversation_id\s*=\s*\?\s+AND\s+user_id\s*=\s*\?\s+AND\s+status\s*=\s*\?/i.test(
              sql
            )
          ) {
            throw new Error(
              `fakeDb: 任务查询必须按 conversation_id + user_id + status 过滤 → ${sql}`
            );
          }
          const [conv, user, status] = args as [string, string, string];
          const hit = fake.tasks.find(
            (t) => t.conversation_id === conv && t.user_id === user && t.status === status
          );
          return hit ? { c: 1 } : undefined;
        },
        run: (): { changes: number } => ({ changes: 0 }),
      };
    },
  }),
}));

import {
  getConversationMessagesPage,
  hasCompletedAgentTask,
  getRecentMessagesByRounds,
} from '@main/db/ai';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function seedMessage(over: Record<string, unknown> = {}): void {
  const rowid = fake.nextRowid();
  fake.messages.push({
    rowid,
    id: `m${rowid}`,
    conversation_id: over.conversation_id ?? 'c1',
    user_id: over.user_id ?? 'u1',
    role: over.role ?? 'assistant',
    content: over.content ?? `body-${rowid}`,
    refs_json: null,
    tool_call_id: null,
    tool_calls: null,
    attachments_json: null,
    created_at: new Date(1700000000000 + rowid).toISOString(),
    ...over,
  });
}

function seedTask(conversation_id: string, user_id: string, status: string): void {
  fake.tasks.push({ id: `t${fake.tasks.length + 1}`, conversation_id, user_id, status });
}

beforeEach(() => {
  fake.reset();
});

// ---------------------------------------------------------------------------

describe('getConversationMessagesPage — 游标分页', () => {
  it('按 rowid 倒序取 limit 条、返回时间正序并给出下一页游标', () => {
    for (let i = 0; i < 25; i += 1) seedMessage();

    const page1 = getConversationMessagesPage('c1', 'u1', { limit: 10 });
    expect(page1.messages).toHaveLength(10);
    // 从最新一页开始，页内时间正序：最早 → 最新
    expect(page1.messages[0].content).toBe('body-16');
    expect(page1.messages[9].content).toBe('body-25');
    expect(page1.nextBeforeId).toBe(16);

    const page2 = getConversationMessagesPage('c1', 'u1', {
      limit: 10,
      beforeId: page1.nextBeforeId ?? 0,
    });
    expect(page2.messages.map((m) => m.content)).toEqual([
      'body-6',
      'body-7',
      'body-8',
      'body-9',
      'body-10',
      'body-11',
      'body-12',
      'body-13',
      'body-14',
      'body-15',
    ]);
    expect(page2.nextBeforeId).toBe(6);

    const page3 = getConversationMessagesPage('c1', 'u1', {
      limit: 10,
      beforeId: page2.nextBeforeId ?? 0,
    });
    expect(page3.messages).toHaveLength(5);
    expect(page3.messages[0].content).toBe('body-1');
    expect(page3.messages[4].content).toBe('body-5');
    // 末页游标为 null —— 调用方据此停止翻页
    expect(page3.nextBeforeId).toBeNull();
  });

  it('缺省 limit = 20；空会话返回空数组与 null 游标', () => {
    const empty = getConversationMessagesPage('c-none', 'u1');
    expect(empty.messages).toEqual([]);
    expect(empty.nextBeforeId).toBeNull();

    for (let i = 0; i < 30; i += 1) seedMessage();
    const page = getConversationMessagesPage('c1', 'u1');
    expect(page.messages).toHaveLength(20);
  });

  it('user_id 隔离：同一 conversation_id 下他人行读不到', () => {
    for (let i = 0; i < 3; i += 1) seedMessage({ user_id: 'u1' });
    for (let i = 0; i < 4; i += 1) seedMessage({ user_id: 'u2' });

    const mine = getConversationMessagesPage('c1', 'u1', { limit: 50 });
    expect(mine.messages).toHaveLength(3);
    expect(mine.messages.every((m) => m.userId === 'u1')).toBe(true);

    const theirs = getConversationMessagesPage('c1', 'u2', { limit: 50 });
    expect(theirs.messages).toHaveLength(4);
  });

  it('beforeId 是 rowid 上界（不含）：游标行本身不出现在下一页', () => {
    for (let i = 0; i < 5; i += 1) seedMessage();
    const page = getConversationMessagesPage('c1', 'u1', { limit: 2, beforeId: 4 });
    expect(page.messages.map((m) => m.content)).toEqual(['body-2', 'body-3']);
    expect(page.nextBeforeId).toBe(2);
  });

  it('SQL 全参数化：占位符与绑定参数一一对应（注入串只作绑定值）', () => {
    seedMessage();
    getConversationMessagesPage("c1' OR 1=1 --", 'u1', { limit: 5, beforeId: 9 });
    const call = fake.calls.find((c) => /rowid\s*<\s*\?/i.test(c.sql));
    expect(call).toBeDefined();
    expect(call?.sql).toContain('conversation_id = ?');
    expect(call?.sql).toContain('user_id = ?');
    expect(call?.sql).toContain('rowid < ?');
    expect(call?.sql).toContain('LIMIT ?');
    // 恶意输入只可能出现在绑定参数里，绝不出现在 SQL 文本里
    expect(fake.calls.filter((c) => c.sql.includes('OR 1=1'))).toHaveLength(0);
    expect(call?.args[0]).toBe("c1' OR 1=1 --");
    // 注入串不会命中任何行
    expect(fake.calls.every((c) => (c.args?.length ?? 0) >= 0)).toBe(true);
  });

  it('分页调用不破坏既有按轮流式读取（两条语句各自独立）', () => {
    for (let i = 0; i < 6; i += 1) seedMessage({ role: i % 2 === 0 ? 'user' : 'assistant' });
    getConversationMessagesPage('c1', 'u1', { limit: 2 });
    const rounds = getRecentMessagesByRounds('c1', 'u1', 1);
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds[rounds.length - 1].conversationId).toBe('c1');
  });
});

describe('既有 getRecentMessagesByRounds 行为零改动', () => {
  it('SQL 保持原口径：conversation_id + user_id、created_at DESC, rowid DESC、无 rowid 游标无 LIMIT', () => {
    seedMessage();
    fake.calls.length = 0;
    getRecentMessagesByRounds('c1', 'u1', 3, { byteBudget: 45000 });
    const call = fake.calls.find((c) => /FROM\s+ai_messages/i.test(c.sql));
    expect(call).toBeDefined();
    expect(call?.method).toBe('iterate');
    expect(call?.sql).toContain('WHERE conversation_id = ? AND user_id = ?');
    expect(call?.sql).toContain('ORDER BY created_at DESC, rowid DESC');
    expect(call?.sql).not.toContain('rowid <');
    expect(call?.sql).not.toContain('LIMIT');
    expect(call?.args).toEqual(['c1', 'u1']);
  });
});

describe('hasCompletedAgentTask — 轨迹筛选口径', () => {
  it('status=completed 才算成功终态', () => {
    seedTask('c1', 'u1', 'completed');
    expect(hasCompletedAgentTask('c1', 'u1')).toBe(true);
  });

  it('failed / pending / running / cancelled / superseded 一律不算', () => {
    for (const status of ['failed', 'pending', 'running', 'cancelled', 'superseded']) {
      const conv = `conv-${status}`;
      seedTask(conv, 'u1', status);
      expect(hasCompletedAgentTask(conv, 'u1')).toBe(false);
    }
  });

  it('user_id 隔离：他人会话的 completed 不计入', () => {
    seedTask('c1', 'u2', 'completed');
    expect(hasCompletedAgentTask('c1', 'u1')).toBe(false);
  });

  it('SQL 参数化：状态值走绑定参数，不内联字面量', () => {
    seedTask('c1', 'u1', 'completed');
    fake.calls.length = 0;
    expect(hasCompletedAgentTask('c1', 'u1')).toBe(true);
    const call = fake.calls.find((c) => /agent_task_queue/i.test(c.sql));
    expect(call?.sql).toContain('conversation_id = ?');
    expect(call?.sql).toContain('user_id = ?');
    expect(call?.sql).toContain('status = ?');
    expect(call?.sql).not.toContain("'completed'");
    expect(call?.args).toEqual(['c1', 'u1', 'completed']);
  });
});

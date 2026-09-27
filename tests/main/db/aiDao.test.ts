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
  protocol?: string;
  kb_top_k?: number | null;
  kb_fuse?: number | null;
  kb_threshold?: number | null;
  kb_pinned_weight?: number | null;
  kb_embedding_host?: string | null;
  kb_embedding_model?: string | null;
  /** B11 D5：勾选「加入知识库」默认值（0/1/缺省） */
  upload_kb_default?: number | null;
}

const fakeDbMock = vi.hoisted(() => {
  const calls: Array<{ method: 'get' | 'all' | 'run'; sql: string; args: unknown[] }> = [];
  // getMessagesByConversation 的可注入行（B3：attachments_json 解析映射用）
  let messageRows: Record<string, unknown>[] = [];
  // 供 getAiConfig SELECT 注入自定义行（覆盖默认 undefined）→ 触发 UPDATE 分支 / mapConfigRow
  // 第一次 ai_config SELECT 用于 upsert 前置判断；之后为 post-write 回读。用计数区分：
  // skipFirst=false 时所有读取都返回该行；skipFirst=true 时首次返回 undefined（触发 INSERT）。
  let aiConfigRow: AiConfigRowFixture | undefined;
  let aiConfigGetCount = 0;
  let skipFirst = false;
  // B11：run() 返回的 changes 可注入（0 → 触发 setUploadKbDefault 的 INSERT 补建分支）
  let runChanges = 1;
  return {
    calls,
    setAiConfigRow: (row: AiConfigRowFixture | undefined): void => {
      aiConfigRow = row;
    },
    setSkipFirstAiConfigGet: (skip: boolean): void => {
      skipFirst = skip;
      aiConfigGetCount = 0;
    },
    setMessageRows: (rows: Record<string, unknown>[]): void => {
      messageRows = rows;
    },
    setRunChanges: (n: number): void => {
      runChanges = n;
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
              protocol: aiConfigRow.protocol,
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
              upload_kb_default: aiConfigRow.upload_kb_default ?? undefined,
            };
          }
          return undefined;
        },
        all: (...args) => {
          calls.push({ method: 'all', sql, args });
          // 消息列表查询返回可注入行（attachments_json 映射断言用）
          if (sql.includes('FROM ai_messages')) return messageRows;
          return [];
        },
        run: (...args) => {
          calls.push({ method: 'run', sql, args });
          return { changes: runChanges };
        },
      };
      return stmt;
    }),
    reset: () => {
      calls.length = 0;
      messageRows = [];
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
  getUploadKbDefault,
  listConversationsByUser,
  setUploadKbDefault,
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
  fakeDbMock.setRunChanges(1);
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
    // 10 args: id, conversation_id, user_id, role, content, refs_json, tool_call_id, tool_calls,
    //          attachments_json（B3 D1 新列）, created_at
    expect(insert?.args).toEqual([expect.any(String), 'c1', 'u1', 'assistant', 'hello', null, null, null, null, expect.any(String)]);
  });

  it('appendMessage 带附件：attachments_json 白名单序列化（content/thumb 不落消息表）', () => {
    appendMessage({
      conversationId: 'c1',
      userId: 'u1',
      role: 'user',
      content: '[文件: r.pdf]',
      attachments: [
        {
          id: 'a1',
          type: 'file',
          name: 'r.pdf',
          path: 'C:/docs/r.pdf',
          size: 123,
          parseStatus: 'done',
          thumb: 'data:image/png;base64,SHOULD_NOT_PERSIST',
        },
      ],
    });
    const insert = callOf('run', 'INSERT INTO ai_messages');
    const attachmentsJson = insert?.args[8] as string;
    expect(typeof attachmentsJson).toBe('string');
    const parsed = JSON.parse(attachmentsJson) as Array<Record<string, unknown>>;
    expect(parsed).toEqual([
      { id: 'a1', type: 'file', name: 'r.pdf', path: 'C:/docs/r.pdf', size: 123, parseStatus: 'done' },
    ]);
    expect(attachmentsJson).not.toContain('SHOULD_NOT_PERSIST');
    expect(attachmentsJson).not.toContain('thumb');
    // 参数化铁律：JSON 不拼进 SQL
    expect(insert?.sql).not.toContain('attachments_json VALUES');
    expect(insert?.sql).toContain('attachments_json');
  });

  it('mapMessageRow：attachments_json 解析为 IAIMessage.attachments（旧消息 NULL/坏 JSON 向后兼容）', () => {
    fakeDbMock.setMessageRows([
      {
        id: 'm1',
        conversation_id: 'c1',
        user_id: 'u1',
        role: 'user',
        content: '[图片: a.png]',
        refs_json: null,
        tool_call_id: null,
        tool_calls: null,
        attachments_json: JSON.stringify([
          { id: 'i1', type: 'image', name: 'a.png', parseStatus: 'done' },
        ]),
        created_at: 'now',
      },
      {
        id: 'm2',
        conversation_id: 'c1',
        user_id: 'u1',
        role: 'user',
        content: '旧消息（无附件字段）',
        refs_json: null,
        tool_call_id: null,
        tool_calls: null,
        attachments_json: null,
        created_at: 'now',
      },
      {
        id: 'm3',
        conversation_id: 'c1',
        user_id: 'u1',
        role: 'user',
        content: '坏 JSON',
        refs_json: null,
        tool_call_id: null,
        tool_calls: null,
        attachments_json: '{broken',
        created_at: 'now',
      },
    ]);
    const msgs = getMessagesByConversation('c1', 'u1');
    expect(msgs[0].attachments).toEqual([
      { id: 'i1', type: 'image', name: 'a.png', parseStatus: 'done' },
    ]);
    expect(msgs[1].attachments).toBeUndefined();
    expect(msgs[2].attachments).toBeUndefined();
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

  // ---- 协议分流：ai_config 落 protocol（决定 LLM 调用走 openai / anthropic 路径）----

  it('upsertAiConfig UPDATE：含 protocol 列且写入传入值', () => {
    fakeDbMock.setAiConfigRow({ user_id: 'u1', protocol: 'openai' });
    upsertAiConfig('u1', { protocol: 'anthropic' });
    const upd = callOf('run', 'UPDATE ai_config');
    expect(upd?.sql).toContain('protocol = ?');
    expect(upd?.args).toContain('anthropic');
  });

  it('upsertAiConfig UPDATE：未传 protocol 时沿用既有值', () => {
    fakeDbMock.setAiConfigRow({ user_id: 'u1', protocol: 'anthropic' });
    upsertAiConfig('u1', { kbTopK: 8 });
    const upd = callOf('run', 'UPDATE ai_config');
    expect(upd?.args).toContain('anthropic');
    expect(upd?.args).not.toContain('openai');
  });

  it('upsertAiConfig INSERT：含 protocol 列且缺省兜底 openai', () => {
    fakeDbMock.setAiConfigRow({ user_id: 'u1' });
    fakeDbMock.setSkipFirstAiConfigGet(true);
    upsertAiConfig('u1', {});
    const ins = callOf('run', 'INSERT INTO ai_config');
    expect(ins?.sql).toContain('protocol');
    expect(ins?.args).toContain('openai');
  });

  it('mapConfigRow：protocol 有值透出，非法或缺失兜底 openai', () => {
    fakeDbMock.setAiConfigRow({ user_id: 'u1', protocol: 'anthropic' });
    expect(getAiConfig('u1')?.protocol).toBe('anthropic');

    fakeDbMock.setAiConfigRow({ user_id: 'u1', protocol: 'weird' });
    expect(getAiConfig('u1')?.protocol).toBe('openai');

    fakeDbMock.setAiConfigRow({ user_id: 'u1' });
    expect(getAiConfig('u1')?.protocol).toBe('openai');
  });
});

// ---------------------------------------------------------------------------
// B11 Q2/D5：ai_config.upload_kb_default 勾选默认值读写
// ---------------------------------------------------------------------------
describe('ai DAO — upload_kb_default（勾选「加入知识库」默认值）', () => {
  it('GET：值 1 → true；值 0 → false', () => {
    fakeDbMock.setAiConfigRow({ user_id: 'u1', upload_kb_default: 1 });
    expect(getUploadKbDefault('u1')).toBe(true);
    fakeDbMock.setAiConfigRow({ user_id: 'u1', upload_kb_default: 0 });
    expect(getUploadKbDefault('u1')).toBe(false);
  });

  it('GET：列 NULL/缺省（D5 迁移前旧库）→ 默认勾选 true', () => {
    fakeDbMock.setAiConfigRow({ user_id: 'u1', upload_kb_default: null });
    expect(getUploadKbDefault('u1')).toBe(true);
    fakeDbMock.setAiConfigRow({ user_id: 'u1' });
    expect(getUploadKbDefault('u1')).toBe(true);
  });

  it('GET：行不存在（从未保存配置）→ 默认勾选 true', () => {
    fakeDbMock.setAiConfigRow(undefined);
    expect(getUploadKbDefault('u1')).toBe(true);
  });

  it('SET：UPDATE 参数化写入 0/1 + user_id', () => {
    expect(setUploadKbDefault('u1', false)).toBe(true);
    const upd = callOf('run', 'UPDATE ai_config SET upload_kb_default');
    expect(upd).toBeTruthy();
    expect(upd?.sql).toMatch(/upload_kb_default = \?, updated_at = datetime\('now'\) WHERE user_id = \?/);
    expect(upd?.args).toEqual([0, 'u1']);
  });

  it('SET：行不存在（UPDATE 0 行）→ INSERT 补建最小行（参数化 + uuid）', () => {
    fakeDbMock.setRunChanges(0);
    expect(setUploadKbDefault('u1', true)).toBe(true);
    const ins = callOf('run', 'INSERT INTO ai_config (id, user_id, upload_kb_default)');
    expect(ins).toBeTruthy();
    expect(ins?.args[0]).toEqual(expect.stringMatching(/[0-9a-f-]{36}/));
    expect(ins?.args[1]).toBe('u1');
    expect(ins?.args[2]).toBe(1);
  });
});

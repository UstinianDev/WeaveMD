// ============================================
// agent-memory-optimize-3 D3（六.1）：提炼技能草稿三通道 IPC 测试
// ============================================
// 覆盖：
//   1) 三通道（列草稿 / 确认 / 驳回）常量与 handler 注册
//   2) 鉴权四条（照抄第二批 C3 memoryHandlers 范式）：
//      - 调用来源校验（event.sender 必须解析为存活 BrowserWindow）
//      - 当前用户由已签名 JWT 解出，**不接受渲染进程传入的 userId**
//      - 伪造 / 缺失 / 过期 token 一律 fail-closed
//      - token 指向已删除用户 → 拒绝
//   3) 路径穿越 fail-closed：非法 name 一律拒绝且零副作用（文件原样保留）
//   4) 业务链路：确认后草稿 → 生效（_auto/ status: active）；驳回后文件删除
// 无 any、无 dangerouslySetInnerHTML。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { IPC_CHANNELS } from '@shared/constants';

// --- Electron mock（必须先于被测模块 hoisted） ---
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    fromWebContents: vi.fn((): unknown => ({ isDestroyed: () => false })),
    userData: ':memory:',
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown): void => {
      electronMock.handlers.set(channel, fn);
    },
  },
  BrowserWindow: { fromWebContents: electronMock.fromWebContents },
  app: { getPath: (): string => electronMock.userData },
}));

// --- 用户表（JWT 解出后必须能查到用户，C3 同口径 fail-closed） ---
const dbMock = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('@main/db/users', () => ({ findById: dbMock.findById }));

import { registerSkillDraftHandlers } from '@main/ai/ipc/skillDraftHandlers';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const LIST_CHANNEL = 'ai:skilldraft:list';
const APPROVE_CHANNEL = 'ai:skilldraft:approve';
const REJECT_CHANNEL = 'ai:skilldraft:reject';

/** JWT secret 与主进程同口径：sha256(userData 路径)，每例按临时目录重算。 */
let SECRET = '';

let root = '';
let draftsDir = '';
let autoDir = '';

type HandlerResult = { success: boolean; data?: unknown; message?: string };

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const fn = electronMock.handlers.get(channel);
  if (!fn) throw new Error(`handler 未注册 → ${channel}`);
  return fn;
}

function tokenOf(userId: string): string {
  return jwt.sign({ userId, username: userId }, SECRET, { expiresIn: '1d' });
}

function trustedEvent(): unknown {
  return { sender: { id: 1 } };
}

async function list(token: unknown, ...extra: unknown[]): Promise<HandlerResult> {
  return (await getHandler(LIST_CHANNEL)(trustedEvent(), token, ...extra)) as HandlerResult;
}

async function approve(token: unknown, name: unknown, ...extra: unknown[]): Promise<HandlerResult> {
  return (await getHandler(APPROVE_CHANNEL)(trustedEvent(), token, name, ...extra)) as HandlerResult;
}

async function reject(token: unknown, name: unknown, ...extra: unknown[]): Promise<HandlerResult> {
  return (await getHandler(REJECT_CHANNEL)(trustedEvent(), token, name, ...extra)) as HandlerResult;
}

function writeDraft(name: string, description: string, instructions: string): void {
  mkdirSync(draftsDir, { recursive: true });
  writeFileSync(
    join(draftsDir, `${name}.md`),
    ['---', `name: ${name}`, `description: ${description}`, 'status: draft', 'source: auto', '---', '', instructions, ''].join('\n'),
    'utf-8'
  );
}

let warnSpy: MockInstance<any[], void>;

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.fromWebContents.mockImplementation((): unknown => ({ isDestroyed: () => false }));
  root = mkdtempSync(join(tmpdir(), 'wmd-d3-ipc-'));
  electronMock.userData = root;
  SECRET = crypto.createHash('sha256').update(root).digest('hex');
  draftsDir = join(root, 'skills', '_auto', '_drafts');
  autoDir = join(root, 'skills', '_auto');
  mkdirSync(draftsDir, { recursive: true });
  dbMock.findById.mockImplementation((id: unknown) =>
    id === 'u1' || id === 'u2' ? { id, username: String(id) } : undefined
  );
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  registerSkillDraftHandlers();
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('三通道 — 常量与注册', () => {
  it('三条通道常量存在且 handler 已注册', () => {
    expect(IPC_CHANNELS.AI_SKILL_DRAFT_LIST).toBe(LIST_CHANNEL);
    expect(IPC_CHANNELS.AI_SKILL_DRAFT_APPROVE).toBe(APPROVE_CHANNEL);
    expect(IPC_CHANNELS.AI_SKILL_DRAFT_REJECT).toBe(REJECT_CHANNEL);
    expect(() => getHandler(LIST_CHANNEL)).not.toThrow();
    expect(() => getHandler(APPROVE_CHANNEL)).not.toThrow();
    expect(() => getHandler(REJECT_CHANNEL)).not.toThrow();
  });
});

describe('列草稿通道', () => {
  it('合法 token → 返回草稿（name / description / instructions / status）', async () => {
    writeDraft('auto_a', '描述A', '正文A');
    const res = await list(tokenOf('u1'));
    expect(res.success).toBe(true);
    const rows = res.data as Array<{ name: string; status: string; instructions: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('auto_a');
    expect(rows[0].status).toBe('draft');
    expect(rows[0].instructions).toContain('正文A');
  });

  it('无草稿 → 空数组', async () => {
    const res = await list(tokenOf('u1'));
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });

  it('缺失 / 伪造 / 过期 token 一律拒绝', async () => {
    writeDraft('auto_a', 'd', 'i');
    const forged = jwt.sign({ userId: 'u1' }, 'wrong-secret', { expiresIn: '1d' });
    const expired = jwt.sign({ userId: 'u1' }, SECRET, { expiresIn: '-1s' });
    for (const bad of [undefined, null, '', 123, 'not-a-jwt', forged, expired]) {
      const res = await list(bad);
      expect(res.success).toBe(false);
      expect(res.data).toBeUndefined();
    }
  });

  it('token 指向已删除用户 → 拒绝', async () => {
    dbMock.findById.mockImplementation(() => undefined);
    const res = await list(tokenOf('u1'));
    expect(res.success).toBe(false);
  });

  it('调用来源校验：sender 解析不到存活窗口 / 抛错 → 拒绝（fail-closed）', async () => {
    writeDraft('auto_a', 'd', 'i');
    electronMock.fromWebContents.mockImplementation(() => null);
    expect((await list(tokenOf('u1'))).success).toBe(false);

    electronMock.fromWebContents.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await list(tokenOf('u1'));
    expect(res.success).toBe(false);
    expect(res.message).toBe('untrusted caller');
  });

  it('不信任渲染进程传入的 userId：额外参数不改变结果', async () => {
    writeDraft('auto_a', 'd', 'i');
    const res = await list(tokenOf('u1'), 'u2');
    expect(res.success).toBe(true);
    expect((res.data as unknown[]).length).toBe(1);
  });
});

describe('确认通道（草稿 → 生效）', () => {
  it('合法 name → 移入 _auto/ 且 status: active，草稿消失', async () => {
    writeDraft('auto_ok', '描述', '正文');
    const res = await approve(tokenOf('u1'), 'auto_ok');
    expect(res.success).toBe(true);
    expect((res.data as { approved: boolean }).approved).toBe(true);
    expect(existsSync(join(draftsDir, 'auto_ok.md'))).toBe(false);
    expect(existsSync(join(autoDir, 'auto_ok.md'))).toBe(true);
    const raw = readFileSync(join(autoDir, 'auto_ok.md'), 'utf-8');
    expect(raw).toContain('status: active');
    expect(raw).toContain('source: auto');
    expect(raw).toContain('正文');
    expect(((await list(tokenOf('u1'))).data as unknown[]).length).toBe(0);
  });

  it('非法 name（路径穿越 / 大小写 / 分隔符 / 非字符串）一律拒绝且零副作用', async () => {
    writeDraft('auto_ok', '描述', '正文');
    const badNames: unknown[] = [
      '../evil',
      '..\\evil',
      'auto_ok/../../evil',
      'auto_ok.md',
      'Auto_Ok',
      '',
      '   ',
      null,
      undefined,
      123,
      { toString: () => 'auto_ok' },
      'auto_..',
      '/etc/passwd',
    ];
    for (const name of badNames) {
      const res = await approve(tokenOf('u1'), name);
      expect(res.success, `应拒绝 name=${String(name)}`).toBe(false);
      const res2 = await reject(tokenOf('u1'), name);
      expect(res2.success, `驳回应拒绝 name=${String(name)}`).toBe(false);
    }
    // 草稿原样保留，_auto/ 下没有被写入任何文件
    expect(existsSync(join(draftsDir, 'auto_ok.md'))).toBe(true);
    expect(existsSync(join(autoDir, 'auto_ok.md'))).toBe(false);
  });

  it('伪造 token 的确认被拒且草稿原样保留', async () => {
    writeDraft('auto_ok', '描述', '正文');
    const res = await approve('not-a-jwt', 'auto_ok');
    expect(res.success).toBe(false);
    expect(existsSync(join(draftsDir, 'auto_ok.md'))).toBe(true);
  });

  it('sender 不可信的确认被拒且草稿原样保留', async () => {
    writeDraft('auto_ok', '描述', '正文');
    electronMock.fromWebContents.mockImplementation(() => null);
    const res = await approve(tokenOf('u1'), 'auto_ok');
    expect(res.success).toBe(false);
    expect(existsSync(join(draftsDir, 'auto_ok.md'))).toBe(true);
  });

  it('草稿不存在 → success:false（not_found，不抛穿 IPC）', async () => {
    const res = await approve(tokenOf('u1'), 'auto_missing');
    expect(res.success).toBe(false);
    expect(res.message).toContain('not_found');
  });
});

describe('驳回通道（删除草稿）', () => {
  it('合法 name → 删除草稿文件', async () => {
    writeDraft('auto_bad', '描述', '正文');
    const res = await reject(tokenOf('u1'), 'auto_bad');
    expect(res.success).toBe(true);
    expect((res.data as { rejected: boolean }).rejected).toBe(true);
    expect(existsSync(join(draftsDir, 'auto_bad.md'))).toBe(false);
  });

  it('草稿不存在 → success:false', async () => {
    const res = await reject(tokenOf('u1'), 'auto_missing');
    expect(res.success).toBe(false);
  });

  it('伪造 token / 不可信 sender → 拒绝且文件保留', async () => {
    writeDraft('auto_bad', '描述', '正文');
    expect((await reject('not-a-jwt', 'auto_bad')).success).toBe(false);
    electronMock.fromWebContents.mockImplementation(() => null);
    expect((await reject(tokenOf('u1'), 'auto_bad')).success).toBe(false);
    expect(existsSync(join(draftsDir, 'auto_bad.md'))).toBe(true);
  });

  it('确认后再驳回同名 → not_found（不存在的草稿不能删除生效技能）', async () => {
    writeDraft('auto_ok', '描述', '正文');
    expect((await approve(tokenOf('u1'), 'auto_ok')).success).toBe(true);
    const res = await reject(tokenOf('u1'), 'auto_ok');
    expect(res.success).toBe(false);
    expect(existsSync(join(autoDir, 'auto_ok.md'))).toBe(true);
  });
});

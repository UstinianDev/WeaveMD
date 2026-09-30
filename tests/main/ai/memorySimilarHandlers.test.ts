// ============================================
// WeaveMD — agent-memory-optimize-3 D5 防线二：三态审核 IPC 测试
// ============================================
// 覆盖（req §二 D5 验收 4）：
//   三通道（列合并建议 / 确认采纳 / 驳回）+ 鉴权四条（**逐条照抄第二批 C3 memoryHandlers 范式**）：
//     1) 调用来源校验：event.sender 必须解析为存活 BrowserWindow；
//     2) 当前用户由已签名 JWT 解出，**不接受渲染层传入的 userId**；
//     3) JWT 缺失 / 签名不符 / 用户已删除 → 一律 fail-closed；
//     4) ids 参数校验：必须是长度 ≥2 的安全整数数组，非法即拒且**不落到策略层**。
//   以及采纳执行合并 / 驳回打标记 / 组不相似时的成功标志回退。
// 策略层（相似度、合并、标记）由 tests/main/ai/memorySimilarMerge.test.ts 覆盖，
// 本文件 mock 之以聚焦鉴权与参数边界。
// 无 any、无 dangerouslySetInnerHTML。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { IPC_CHANNELS } from '@shared/constants';

// --- Electron mocks（必须先于被测模块 hoisted） ---
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  // sender.id === 99 模拟「非本应用窗口」→ fromWebContents 返回 null（不可信）
  const fromWebContents = vi.fn((sender: { id?: number } | null): unknown =>
    sender?.id === 99 ? null : { isDestroyed: () => false }
  );
  return { handlers, fromWebContents };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, fn);
    },
  },
  BrowserWindow: { fromWebContents: electronMock.fromWebContents },
  app: { getPath: () => '/tmp/weavemd-d5-userdata' },
}));

// --- 受控 DB / 用户 / 策略层 ---
const dbMock = vi.hoisted(() => ({ getDatabase: vi.fn(), findById: vi.fn() }));
vi.mock('@main/db/index', () => ({ getDatabase: dbMock.getDatabase }));
vi.mock('@main/db/users', () => ({ findById: dbMock.findById }));
vi.mock('@main/db/agentMemory', () => ({
  listMemories: vi.fn(() => []),
  deleteMemory: vi.fn(() => true),
}));

const policyMock = vi.hoisted(() => ({
  findSimilarMergeGroups: vi.fn(
    (_db: unknown, _userId: string, _opts?: unknown): unknown[] => []
  ),
  mergeMemoryGroup: vi.fn(
    (_db: unknown, _userId: string, _ids: number[], _opts?: unknown): unknown => ({
      merged: 1,
      winnerId: 2,
    })
  ),
  rejectMemoryGroup: vi.fn(
    (_db: unknown, _userId: string, _ids: number[], _opts?: unknown): unknown => 2
  ),
}));
vi.mock('@main/ai/agent/memoryPolicy', () => policyMock);

import { registerMemoryHandlers } from '@main/ai/ipc/memoryHandlers';

type HandlerResult = { success: boolean; data?: unknown; message?: string };

const LIST = 'ai:memory:similar:list';
const ACCEPT = 'ai:memory:similar:accept';
const REJECT = 'ai:memory:similar:reject';

const SECRET = crypto.createHash('sha256').update('/tmp/weavemd-d5-userdata').digest('hex');

function tokenOf(userId: string): string {
  return jwt.sign({ userId, username: userId }, SECRET, { expiresIn: '1d' });
}

function trustedEvent(): unknown {
  return { sender: { id: 1 } };
}

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const fn = electronMock.handlers.get(channel);
  if (!fn) throw new Error(`handler 未注册 → ${channel}`);
  return fn;
}

async function call(
  channel: string,
  token: unknown,
  payload: unknown,
  event: unknown = trustedEvent(),
  ...extra: unknown[]
): Promise<HandlerResult> {
  return (await getHandler(channel)(event, token, payload, ...extra)) as HandlerResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  electronMock.handlers.clear();
  electronMock.fromWebContents.mockImplementation(
    (sender: { id?: number } | null): unknown =>
      sender?.id === 99 ? null : { isDestroyed: () => false }
  );
  dbMock.getDatabase.mockImplementation(() => ({ prepare: () => ({}) }));
  dbMock.findById.mockImplementation((id: unknown) =>
    id === 'u1' || id === 'u2' ? { id, username: String(id) } : undefined
  );
  policyMock.findSimilarMergeGroups.mockImplementation((): unknown[] => []);
  policyMock.mergeMemoryGroup.mockImplementation((): unknown => ({ merged: 1, winnerId: 2 }));
  policyMock.rejectMemoryGroup.mockImplementation((): unknown => 2);
  registerMemoryHandlers();
});

describe('D5 三态审核 — 通道与常量', () => {
  it('三条通道常量存在且 handler 已注册', () => {
    expect(IPC_CHANNELS.AI_MEMORY_SIMILAR_LIST).toBe(LIST);
    expect(IPC_CHANNELS.AI_MEMORY_SIMILAR_ACCEPT).toBe(ACCEPT);
    expect(IPC_CHANNELS.AI_MEMORY_SIMILAR_REJECT).toBe(REJECT);
    for (const ch of [LIST, ACCEPT, REJECT]) expect(() => getHandler(ch)).not.toThrow();
  });

  it('既有 C3 两通道仍注册（零回归）', () => {
    expect(() => getHandler('ai:memory:list')).not.toThrow();
    expect(() => getHandler('ai:memory:delete')).not.toThrow();
  });
});

describe('D5 三态审核 — 鉴权四条（fail-closed）', () => {
  it('① 非本应用窗口（伪造 sender）→ 三条通道一律拒绝', async () => {
    for (const ch of [LIST, ACCEPT, REJECT]) {
      const res = await call(ch, tokenOf('u1'), ch === LIST ? [] : [1, 2], {
        sender: { id: 99 },
      });
      expect(res.success).toBe(false);
      expect(res.message).toBe('untrusted caller');
    }
    expect(policyMock.mergeMemoryGroup).not.toHaveBeenCalled();
    expect(policyMock.rejectMemoryGroup).not.toHaveBeenCalled();
  });

  it('① sender 已销毁 → 拒绝', async () => {
    electronMock.fromWebContents.mockImplementation((): unknown => ({ isDestroyed: () => true }));
    const res = await call(LIST, tokenOf('u1'), []);
    expect(res.success).toBe(false);
    expect(res.message).toBe('untrusted caller');
  });

  it('② 伪造 token（签名不符）→ unauthorized', async () => {
    const forged = jwt.sign({ userId: 'u1' }, 'wrong-secret');
    for (const ch of [LIST, ACCEPT, REJECT]) {
      const res = await call(ch, forged, ch === LIST ? [] : [1, 2]);
      expect(res.success).toBe(false);
      expect(res.message).toBe('unauthorized');
    }
    expect(policyMock.mergeMemoryGroup).not.toHaveBeenCalled();
  });

  it('② 缺失 / 非字符串 token → unauthorized', async () => {
    for (const token of [undefined, null, 42, '']) {
      const res = await call(LIST, token, []);
      expect(res.success).toBe(false);
      expect(res.message).toBe('unauthorized');
    }
  });

  it('② JWT 合法但用户已删除 → unauthorized（findById fail-closed）', async () => {
    dbMock.findById.mockImplementation(() => undefined);
    const res = await call(LIST, tokenOf('u1'), []);
    expect(res.success).toBe(false);
    expect(res.message).toBe('unauthorized');
  });

  it('② 不接受渲染层传入 userId（多传参数也不生效，仍按 JWT 解出的用户）', async () => {
    policyMock.findSimilarMergeGroups.mockImplementation(
      (_db: unknown, userId: string): unknown[] => [
        {
          key: String(userId),
          kind: 'profile',
          score: 0.9,
          winnerId: 1,
          members: [{
            id: 1,
            kind: 'profile',
            subject: '主题偏好',
            content: '用户偏好深色主题',
            source: 'auto',
            validFrom: '2026-09-01 00:00:00',
            validTo: null,
            writtenAt: '2026-09-01 00:00:00',
          }],
        },
      ]
    );
    const res = await call(LIST, tokenOf('u1'), [], trustedEvent(), 'u7', 'u8');
    expect(res.success).toBe(true);
    // userId 恒来自 JWT（'u1'），多传的 'u7'/'u8' 既不进策略层也不进回包
    expect(policyMock.findSimilarMergeGroups).toHaveBeenCalledWith(expect.anything(), 'u1');
    expect(JSON.stringify(res.data)).toContain('主题偏好');
    expect(JSON.stringify(res.data)).not.toContain('u7');
  });

  it('② 越权：以 u2 身份只能拿到 u2 的组（userId 恒来自 JWT）', async () => {
    policyMock.findSimilarMergeGroups.mockImplementation(
      (_db: unknown, userId: string): unknown[] => [
        { key: userId, kind: 'profile', score: 0.9, winnerId: 1, members: [{
            id: 1,
            kind: 'profile',
            subject: '主题偏好',
            content: '用户偏好深色主题',
            source: 'auto',
            validFrom: '2026-09-01 00:00:00',
            validTo: null,
            writtenAt: '2026-09-01 00:00:00',
          }] },
      ]
    );
    const res = await call(LIST, tokenOf('u2'), []);
    expect(res.success).toBe(true);
    expect(policyMock.findSimilarMergeGroups.mock.calls[0][1]).toBe('u2');
  });
});

describe('D5 三态审核 — 参数校验（非法即拒，不落到策略层）', () => {
  it('ids 非数组 / 空 / 单元素 / 含非法值 → invalid ids', async () => {
    const bad: unknown[] = [
      '1,2',
      { ids: [1, 2] },
      [],
      [1],
      [0, 1],
      [-1, 2],
      [1.5, 2],
      [1, Number.MAX_SAFE_INTEGER + 10],
      [1, '2'],
      [1, null],
    ];
    for (const payload of bad) {
      for (const ch of [ACCEPT, REJECT]) {
        const res = await call(ch, tokenOf('u1'), payload);
        expect(res.success).toBe(false);
        expect(res.message).toBe('invalid ids');
      }
    }
    expect(policyMock.mergeMemoryGroup).not.toHaveBeenCalled();
    expect(policyMock.rejectMemoryGroup).not.toHaveBeenCalled();
  });

  it('ids 数组过长 → invalid ids（组规模上限）', async () => {
    const ids = Array.from({ length: 33 }, (_, i) => i + 1);
    const res = await call(ACCEPT, tokenOf('u1'), ids);
    expect(res.success).toBe(false);
    expect(res.message).toBe('invalid ids');
    expect(policyMock.mergeMemoryGroup).not.toHaveBeenCalled();
  });
});

describe('D5 三态审核 — 采纳 / 驳回 回包', () => {
  it('采纳：策略返回 { merged, winnerId } → success', async () => {
    policyMock.mergeMemoryGroup.mockImplementation(() => ({ merged: 2, winnerId: 7 }));
    const res = await call(ACCEPT, tokenOf('u1'), [3, 7]);
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ merged: 2, winnerId: 7 });
    expect(policyMock.mergeMemoryGroup).toHaveBeenCalledWith(expect.anything(), 'u1', [3, 7]);
  });

  it('采纳：id 不构成相似组（策略返回 null）→ success:false', async () => {
    policyMock.mergeMemoryGroup.mockImplementation(() => null);
    const res = await call(ACCEPT, tokenOf('u1'), [1, 2]);
    expect(res.success).toBe(false);
    expect(res.message).toBe('not a similar group');
  });

  it('采纳：策略抛错 → success:false（IPC 必须 try/catch）', async () => {
    policyMock.mergeMemoryGroup.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await call(ACCEPT, tokenOf('u1'), [1, 2]);
    expect(res.success).toBe(false);
    expect(res.message).toBe('Failed to accept memory merge');
  });

  it('驳回：策略返回标记条数 → success', async () => {
    policyMock.rejectMemoryGroup.mockImplementation(() => 3);
    const res = await call(REJECT, tokenOf('u1'), [1, 2, 3]);
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ rejected: 3 });
    expect(policyMock.rejectMemoryGroup).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      [1, 2, 3]
    );
  });

  it('驳回：不构成相似组 → success:false', async () => {
    policyMock.rejectMemoryGroup.mockImplementation(() => null);
    const res = await call(REJECT, tokenOf('u1'), [1, 2]);
    expect(res.success).toBe(false);
    expect(res.message).toBe('not a similar group');
  });

  it('列表：策略抛错 → success:false', async () => {
    policyMock.findSimilarMergeGroups.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await call(LIST, tokenOf('u1'), []);
    expect(res.success).toBe(false);
    expect(res.message).toBe('Failed to list memory merge suggestions');
  });
});

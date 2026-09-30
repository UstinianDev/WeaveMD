// ============================================
// WeaveMD — preload 桥 ai.memory 通道测试（agent-memory-optimize 第二批 C3）
// ============================================
// 断言 contextBridge 暴露的 `ai.memory.list / delete` 把
// 「认证上下文 + id」原样转发到正确的 IPC 通道（渲染层不传 userId）。
// 无 any。

import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/constants';
import type { WeaveMDApi } from '@main/preload';

const electronMock = vi.hoisted(() => ({
  exposed: null as unknown,
  invoke: vi.fn(async (): Promise<unknown> => ({ success: true, data: [] })),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown): void => {
      electronMock.exposed = api;
    },
  },
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

async function loadApi(): Promise<WeaveMDApi> {
  await import('@main/preload');
  return electronMock.exposed as WeaveMDApi;
}

describe('preload — ai.memory 桥', () => {
  it('list 转发认证上下文到 ai:memory:list（不带 userId）', async () => {
    const api = await loadApi();
    await api.ai.memory.list('the-jwt');

    expect(electronMock.invoke).toHaveBeenCalledWith(IPC_CHANNELS.AI_MEMORY_LIST, 'the-jwt');
    expect(electronMock.invoke).toHaveBeenCalledTimes(1);
  });

  it('delete 转发认证上下文 + 数字 id 到 ai:memory:delete', async () => {
    const api = await loadApi();
    electronMock.invoke.mockClear();
    await api.ai.memory.delete('the-jwt', 7);

    expect(electronMock.invoke).toHaveBeenCalledWith(IPC_CHANNELS.AI_MEMORY_DELETE, 'the-jwt', 7);
  });
});

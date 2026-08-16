// ============================================
// WeaveMD — fileTreeStore persist + restore() 测试（TDD strict·先 RED）
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFileTreeStore, useFileTreeStore } from '@render/stores/fileTreeStore';

describe('fileTreeStore persist + restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFileTreeStore();
    window.localStorage.clear();
  });

  it('persist partialize 不含 content（looseFiles/folders 节点只存路径结构）', () => {
    useFileTreeStore.getState().addFile({
      id: '/leaf.md',
      name: 'leaf.md',
      path: '/leaf.md',
      content: 'SHOULD NOT PERSIST',
    });
    useFileTreeStore.getState().addFolder({
      id: '/root',
      name: 'root',
      path: '/root',
      isDirectory: true,
      children: [
        {
          id: '/root/nested.md',
          name: 'nested.md',
          path: '/root/nested.md',
          isDirectory: false,
          children: [],
          expanded: false,
          isRoot: false,
        },
      ],
      expanded: true,
      isRoot: true,
    });

    const persistedRaw = window.localStorage.getItem('weavemd_filetree');
    expect(persistedRaw).not.toBeNull();
    const parsed = JSON.parse(persistedRaw as string);
    // lazy hydration 采用 partialize：持久化 state 不含 content
    for (const node of parsed.state.looseFiles ?? []) {
      expect(Object.prototype.hasOwnProperty.call(node, 'content')).toBe(false);
    }
    for (const folder of parsed.state.folders ?? []) {
      expect(Object.prototype.hasOwnProperty.call(folder, 'content')).toBe(false);
      for (const child of folder.children ?? []) {
        expect(Object.prototype.hasOwnProperty.call(child, 'content')).toBe(false);
      }
    }
  });

  it('restore() 剔除 readDisk 失败的 looseFile', async () => {
    // 预置持久化状态：两个 looseFile，一个磁盘存在、一个失效
    const fresh = { success: true as const, data: { path: '/alive.md', name: 'alive.md', content: 'x' } };
    const dead = { success: false as const, data: undefined };
    const readDiskMock = vi
      .fn()
      .mockImplementation(async (p: string) => (p === '/alive.md' ? fresh : dead));
    (window.weaveMD.file.readDisk as ReturnType<typeof vi.fn>).mockImplementation(
      readDiskMock
    );

    // 先写入持久化状态（模拟重启前留下的树）
    window.localStorage.setItem(
      'weavemd_filetree',
      JSON.stringify({
        state: {
          folders: [],
          looseFiles: [
            { id: '/alive.md', name: 'alive.md', path: '/alive.md' },
            { id: '/ghost.md', name: 'ghost.md', path: '/ghost.md' },
          ],
          activeTab: 'files',
          selectedIds: [],
        },
        version: 0,
      })
    );
    // 模拟冷启动：从 persisted 重新 hydration
    await useFileTreeStore.persist.rehydrate();
    expect(useFileTreeStore.getState().looseFiles).toHaveLength(2);

    // 收集失效提示（restore 应能通过返回值或状态报告失效项）
    const summary = await useFileTreeStore.getState().restore();

    // 失效 ghost 被剔除
    const remaining = useFileTreeStore.getState().looseFiles.map((f) => f.id);
    expect(remaining).not.toContain('/ghost.md');
    expect(remaining).toContain('/alive.md');
    // 失效项被报告（供上层 setErrorMessage 提示）
    expect(summary.removed).toContain('/ghost.md');
    expect(summary.removed).not.toContain('/alive.md');
  });

  it('restore() root folder 失效剔除、有效则丢弃 persisted 子节点并实读重建', async () => {
    const folderOk = { success: true as const, data: [{ name: 'a.md', path: '/root/a.md', isDirectory: false }] };
    const folderDead = { success: false as const, data: undefined as unknown };
    // folder.readFolder 同时驱动 restore 校验与 loadFolderContents 实读（/root 有效，其余失效）
    const folderMock = vi
      .fn()
      .mockImplementation(async (p: string) => (p === '/root' ? folderOk : folderDead));
    (window.weaveMD.folder.readFolder as ReturnType<typeof vi.fn>).mockImplementation(
      folderMock
    );

    window.localStorage.setItem(
      'weavemd_filetree',
      JSON.stringify({
        state: {
          folders: [
            {
              id: '/root',
              name: 'root',
              path: '/root',
              isDirectory: true,
              isRoot: true,
              expanded: true,
              // 过期的持久化子节点（磁盘漂移，不应信任）
              children: [
                { id: '/root/old.md', name: 'old.md', path: '/root/old.md', isDirectory: false },
              ],
            },
            {
              id: '/gone',
              name: 'gone',
              path: '/gone',
              isDirectory: true,
              isRoot: true,
              expanded: true,
              children: [],
            },
          ],
          looseFiles: [],
          activeTab: 'files',
          selectedIds: [],
        },
        version: 0,
      })
    );
    // 从 persisted 重新 hydration
    await useFileTreeStore.persist.rehydrate();
    expect(useFileTreeStore.getState().folders).toHaveLength(2);

    const summary = await useFileTreeStore.getState().restore();

    // 失效 root folder 被剔除
    const folderIds = useFileTreeStore.getState().folders.map((f) => f.path);
    expect(folderIds).not.toContain('/gone');
    expect(folderIds).toContain('/root');
    expect(summary.removed).toContain('/gone');

    // 有效 folder 丢弃 persisted 子节点，改用 loadFolderContents 实读重建
    const root = useFileTreeStore.getState().folders.find((f) => f.path === '/root');
    expect(root).toBeDefined();
    const childIds = (root?.children ?? []).map((c) => c.id);
    expect(childIds).not.toContain('/root/old.md');
    expect(childIds).toContain('/root/a.md');
  });
});

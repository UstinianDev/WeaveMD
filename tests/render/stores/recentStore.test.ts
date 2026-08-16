// ============================================
// WeaveMD — recentStore 编辑历史（最近打开）测试（TDD strict·先 RED）
// ============================================
import { beforeEach, describe, expect, it } from 'vitest';
import type { RecentFileEntry } from '@render/stores/recentStore';
import {
  RECENT_MAX,
  getRecentList,
  clearRecent,
  removeRecent,
  resetRecentStore,
  useRecentStore,
  touchRecent,
} from '@render/stores/recentStore';

describe('recentStore 最近打开列表', () => {
  beforeEach(() => {
    resetRecentStore();
  });

  it('touchRecent 按 lastOpenedAt 倒序排列', () => {
    touchRecent({ id: 'a', path: '/a.md', name: 'a' });
    touchRecent({ id: 'b', path: '/b.md', name: 'b' });
    touchRecent({ id: 'c', path: '/c.md', name: 'c' });

    const list = getRecentList();
    expect(list.map((f) => f.id)).toEqual(['c', 'b', 'a']);
  });

  it('同一 id 重复打开去重置顶，不产生重复项', () => {
    touchRecent({ id: 'a', path: '/a.md', name: 'a' });
    touchRecent({ id: 'b', path: '/b.md', name: 'b' });
    touchRecent({ id: 'a', path: '/a.md', name: 'a' });

    const list = getRecentList();
    expect(list.filter((f) => f.id === 'a')).toHaveLength(1);
    // 重新 touch 的 a 置顶
    expect(list[0].id).toBe('a');
  });

  it('超过上限时剔除最旧（lastOpenedAt 最早）', () => {
    for (let i = 0; i < RECENT_MAX + 5; i += 1) {
      touchRecent({ id: `f${i}`, path: `/f${i}.md`, name: `f${i}` });
    }
    const list = getRecentList();
    expect(list).toHaveLength(RECENT_MAX);
    // 最新 20 个保留，最旧 5 个被剔除（即最早被 touch 的 id 消失）
    expect(list.map((f) => f.id)).not.toContain('f0');
    expect(list.map((f) => f.id)).toContain(`f${RECENT_MAX + 4}`);
  });

  it('removeRecent 按 id 移除', () => {
    touchRecent({ id: 'a', path: '/a.md', name: 'a' });
    touchRecent({ id: 'b', path: '/b.md', name: 'b' });
    removeRecent('a');
    expect(getRecentList().map((f) => f.id)).toEqual(['b']);
  });

  it('clearRecent 清空', () => {
    touchRecent({ id: 'a', path: '/a.md', name: 'a' });
    clearRecent();
    expect(getRecentList()).toEqual([]);
  });

  it('persist partialize 只存 recent，且重新 hydration 后还原', async () => {
    touchRecent({ id: 'a', path: '/a.md', name: 'a' });
    touchRecent({ id: 'b', path: '/b.md', name: 'b' });

    // 读取 localStorage 中持久化的值：只含 recent，不含其它状态切片
    const persistedRaw = localStorage.getItem('weavemd_recent');
    expect(persistedRaw).not.toBeNull();
    const parsed = JSON.parse(persistedRaw as string);
    expect(parsed.state).toHaveProperty('recent');
    // partialize 只暴露 recent
    expect(Object.keys(parsed.state)).toEqual(['recent']);

    // 持久化的 JSON 即冷启动后的还原源：从 persisted 重建内存态应还原 recent
    const parsedFromStorage = JSON.parse(
      localStorage.getItem('weavemd_recent') as string
    ) as { state: { recent: RecentFileEntry[] } };
    useRecentStore.setState({ recent: parsedFromStorage.state.recent });
    expect(getRecentList()).toHaveLength(2);
    expect(getRecentList()[0].id).toBe('b');
  });
});

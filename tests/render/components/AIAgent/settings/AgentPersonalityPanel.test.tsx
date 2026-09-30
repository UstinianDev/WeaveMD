// ============================================
// WeaveMD — AgentPersonalityPanel「自动记忆」tab 测试（agent-memory-optimize 第二批 C3）
// ============================================
// 覆盖：第 4 个 tab 渲染、只读列表（kind 标签 / subject / content / 时间 / 已失效）、
// 单条删除二次确认（取消不调 API、确认才调）、空态、加载失败态，
// 以及原三 tab 编辑功能不回归。
// 无 any、无 dangerouslySetInnerHTML。
// ============================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentPersonalityPanel from '@render/components/AIAgent/settings/AgentPersonalityPanel';
import { useAgentStore } from '@render/stores/agentStore';
import { useAuthStore } from '@render/stores/authStore';

vi.mock('@render/i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? `[${key}]`,
    language: 'zh-CN',
    setLanguage: () => {},
  }),
}));

interface MemoryRow {
  id: number;
  kind: 'profile' | 'fact' | 'entity';
  subject: string;
  content: string;
  source: 'auto' | 'manual';
  validFrom: string;
  validTo: string | null;
  writtenAt: string;
}

const ACTIVE_ROW: MemoryRow = {
  id: 1,
  kind: 'profile',
  subject: '现居城市',
  content: '上海',
  source: 'auto',
  validFrom: '2026-09-30 08:00:00',
  validTo: null,
  writtenAt: '2026-09-30 08:00:00',
};

const STALE_ROW: MemoryRow = {
  id: 2,
  kind: 'fact',
  subject: '旧职业',
  content: '设计师',
  source: 'auto',
  validFrom: '2026-08-01 08:00:00',
  validTo: '2026-09-10 08:00:00',
  writtenAt: '2026-08-01 08:00:00',
};

/** 每例新建 spy（afterEach restoreAllMocks 后必须重新 spyOn）。 */
function spyList() {
  return vi.spyOn(window.weaveMD.ai.memory, 'list');
}

function spyDelete() {
  return vi.spyOn(window.weaveMD.ai.memory, 'delete');
}

describe('AgentPersonalityPanel — 自动记忆 tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: 'u1', username: 'tester', createdAt: '', lastLogin: null },
      token: 'tok',
      isAuthenticated: true,
      recentAccounts: [],
    });
    useAgentStore.setState({
      globalFiles: { soul: '', style: '', memory: '' },
      memories: [],
      memoriesLoading: false,
      memoriesError: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('SegmentedTabs 下有第 4 个「自动记忆」栏，且原三栏保留', () => {
    render(<AgentPersonalityPanel />);
    for (const label of ['Agent 性格', '写作风格', '全局记忆', '自动记忆']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('切到「自动记忆」→ 拉取列表并只读渲染 kind 标签 / subject / content / 时间', async () => {
    const list = spyList();
    list.mockResolvedValue({ success: true, data: [ACTIVE_ROW, STALE_ROW] });

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));

    // 通过 store 传的是当前用户认证上下文，不传 userId
    await waitFor(() => expect(list).toHaveBeenCalledWith('tok'));

    expect(await screen.findByText('现居城市')).toBeInTheDocument();
    expect(screen.getByText('上海')).toBeInTheDocument();
    expect(screen.getByText('画像')).toBeInTheDocument();
    expect(screen.getByText('2026-09-30 08:00:00')).toBeInTheDocument();
    // 已关闭行展示「已失效」
    expect(await screen.findByText('旧职业')).toBeInTheDocument();
    expect(screen.getAllByText('已失效')).toHaveLength(1);
    // 只读：没有可编辑输入面
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('列表为空 → 空态文案', async () => {
    const list = spyList();
    list.mockResolvedValue({ success: true, data: [] });

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));

    expect(await screen.findByText(/暂无自动记忆/)).toBeInTheDocument();
  });

  it('加载失败 → 失败态且不显示列表', async () => {
    const list = spyList();
    list.mockResolvedValue({ success: false, message: 'unauthorized' });

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));

    expect(await screen.findByText(/加载失败/)).toBeInTheDocument();
    expect(screen.queryByText('现居城市')).not.toBeInTheDocument();
  });

  it('单条删除必须二次确认：取消不调 IPC、列表不变', async () => {
    const list = spyList();
    const del = spyDelete();
    list.mockResolvedValue({ success: true, data: [ACTIVE_ROW] });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));
    await screen.findByText('现居城市');

    fireEvent.click(screen.getAllByText('删除')[0]);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByText('现居城市')).toBeInTheDocument();
  });

  it('确认删除 → 调 IPC（带认证上下文与数字 id）并从列表移除', async () => {
    const list = spyList();
    const del = spyDelete();
    list.mockResolvedValue({ success: true, data: [ACTIVE_ROW] });
    del.mockResolvedValue({ success: true, data: { deleted: true } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));
    await screen.findByText('现居城市');

    fireEvent.click(screen.getAllByText('删除')[0]);

    await waitFor(() => expect(del).toHaveBeenCalledWith('tok', 1));
    await waitFor(() => expect(screen.queryByText('现居城市')).not.toBeInTheDocument());
  });

  it('删除被服务端拒绝 → 行保留（不静默吞掉）', async () => {
    const list = spyList();
    const del = spyDelete();
    list.mockResolvedValue({ success: true, data: [ACTIVE_ROW] });
    del.mockResolvedValue({ success: true, data: { deleted: false } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));
    await screen.findByText('现居城市');

    fireEvent.click(screen.getAllByText('删除')[0]);

    await waitFor(() => expect(del).toHaveBeenCalled());
    expect(screen.getByText('现居城市')).toBeInTheDocument();
  });

  it('回归：原三 tab 仍是 textarea 编辑面（切回后可用）', async () => {
    const list = spyList();
    list.mockResolvedValue({ success: true, data: [ACTIVE_ROW] });

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));
    await screen.findByText('现居城市');

    fireEvent.click(screen.getByText('Agent 性格'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByText('保存修改')).toBeInTheDocument();
    expect(screen.queryByText('现居城市')).not.toBeInTheDocument();
  });

  it('回归：文件 tab 上保存与恢复默认两条路径仍可达', async () => {
    const update = vi
      .spyOn(useAgentStore.getState(), 'updateGlobalFiles')
      .mockResolvedValue(undefined);
    render(<AgentPersonalityPanel />);

    const textarea = screen.getByRole('textbox');
    await waitFor(() => expect(textarea).not.toBeDisabled());
    fireEvent.change(textarea, { target: { value: 'hi' } });
    fireEvent.click(screen.getByText('保存修改'));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ soul: 'hi' }));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByText('恢复默认'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

// ============================================
// agent-memory-optimize-3 D5 六.3 防线二：相似合并建议三态审核
// ============================================
// 覆盖：进入自动记忆 tab 同时拉取建议、建议组渲染（subject/content/相似度/成员数）、
// 采纳与驳回各自的 window.confirm 二次确认（取消不调 IPC）、确认后带认证上下文回传 ids、
// 空态与失败态。鉴权四条在 tests/main/ai/memorySimilarHandlers.test.ts 覆盖。
// ============================================

interface MergeMember {
  id: number;
  kind: 'profile' | 'fact' | 'entity';
  subject: string;
  content: string;
  source: 'auto' | 'manual';
  validFrom: string;
  validTo: string | null;
  writtenAt: string;
}

interface MergeGroup {
  key: string;
  kind: 'profile' | 'fact' | 'entity';
  score: number;
  winnerId: number;
  members: MergeMember[];
}

const member = (id: number, subject: string, writtenAt: string): MergeMember => ({
  id,
  kind: 'profile',
  subject,
  content: '用户偏好深色主题，界面使用暗色背景',
  source: 'auto',
  validFrom: '2026-01-01 00:00:00',
  validTo: null,
  writtenAt,
});

const MERGE_GROUP: MergeGroup = {
  key: '1,3',
  kind: 'profile',
  score: 0.78,
  winnerId: 3,
  members: [member(1, '主题偏好', '2026-01-01 00:00:00'), member(3, '外观设置', '2026-09-01 00:00:00')],
};

function spySimilarList() {
  return vi.spyOn(window.weaveMD.ai.memory, 'similarList');
}
function spyAccept() {
  return vi.spyOn(window.weaveMD.ai.memory, 'acceptSimilar');
}
function spyReject() {
  return vi.spyOn(window.weaveMD.ai.memory, 'rejectSimilar');
}

describe('AgentPersonalityPanel — 相似合并建议（D5 三态审核）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: 'u1', username: 'tester', createdAt: '', lastLogin: null },
      token: 'tok',
      isAuthenticated: true,
      recentAccounts: [],
    });
    useAgentStore.setState({
      globalFiles: { soul: '', style: '', memory: '' },
      memories: [],
      memoriesLoading: false,
      memoriesError: null,
      mergeSuggestions: [],
      mergeSuggestionsLoading: false,
      mergeSuggestionsError: null,
    });
    spyList().mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('切到自动记忆 → 同时拉取合并建议（只传认证上下文，不传 userId）并渲染组', async () => {
    const similarList = spySimilarList();
    similarList.mockResolvedValue({ success: true, data: [MERGE_GROUP] });

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));

    await waitFor(() => expect(similarList).toHaveBeenCalledWith('tok'));
    expect(await screen.findByText('主题偏好')).toBeInTheDocument();
    expect(screen.getByText('外观设置')).toBeInTheDocument();
    expect(screen.getByText(/相似度/)).toBeInTheDocument();
    expect(screen.getByText(/78%/)).toBeInTheDocument();
    expect(screen.getByText('采纳合并')).toBeInTheDocument();
    expect(screen.getByText('驳回')).toBeInTheDocument();
  });

  it('建议为空 → 空态文案', async () => {
    spySimilarList().mockResolvedValue({ success: true, data: [] });
    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));
    expect(await screen.findByText(/暂无相似合并建议/)).toBeInTheDocument();
  });

  it('建议读取失败 → 建议区失败态，且不影响记忆列表渲染', async () => {
    spyList().mockResolvedValue({ success: true, data: [ACTIVE_ROW] });
    spySimilarList().mockResolvedValue({ success: false, message: 'unauthorized' });

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));

    expect(await screen.findByText(/合并建议读取失败/)).toBeInTheDocument();
    expect(await screen.findByText('现居城市')).toBeInTheDocument();
    expect(screen.queryByText('主题偏好')).not.toBeInTheDocument();
  });

  it('采纳必须二次确认：取消不调 IPC', async () => {
    const similarList = spySimilarList();
    const accept = spyAccept();
    similarList.mockResolvedValue({ success: true, data: [MERGE_GROUP] });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));
    await screen.findByText('主题偏好');

    fireEvent.click(screen.getByText('采纳合并'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled();
    expect(screen.getByText('主题偏好')).toBeInTheDocument();
  });

  it('确认采纳 → 回传认证上下文与组内全部 id', async () => {
    const similarList = spySimilarList();
    const accept = spyAccept();
    similarList.mockResolvedValue({ success: true, data: [MERGE_GROUP] });
    accept.mockResolvedValue({ success: true, data: { merged: 1, winnerId: 3 } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));
    await screen.findByText('主题偏好');

    fireEvent.click(screen.getByText('采纳合并'));
    await waitFor(() => expect(accept).toHaveBeenCalledWith('tok', [1, 3]));
  });

  it('驳回：取消不调 IPC，确认才回传 ids', async () => {
    const similarList = spySimilarList();
    const reject = spyReject();
    similarList.mockResolvedValue({ success: true, data: [MERGE_GROUP] });
    reject.mockResolvedValue({ success: true, data: { rejected: 2 } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));
    await screen.findByText('主题偏好');

    fireEvent.click(screen.getByText('驳回'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByText('驳回'));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('tok', [1, 3]));
  });

  it('采纳被服务端拒绝（success:false）→ 不抛错、建议组保留', async () => {
    const similarList = spySimilarList();
    const accept = spyAccept();
    similarList.mockResolvedValue({ success: true, data: [MERGE_GROUP] });
    accept.mockResolvedValue({ success: false, message: 'not a similar group' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AgentPersonalityPanel />);
    fireEvent.click(screen.getByText('自动记忆'));
    await screen.findByText('主题偏好');

    fireEvent.click(screen.getByText('采纳合并'));
    await waitFor(() => expect(accept).toHaveBeenCalled());
    expect(screen.getByText('主题偏好')).toBeInTheDocument();
  });
});

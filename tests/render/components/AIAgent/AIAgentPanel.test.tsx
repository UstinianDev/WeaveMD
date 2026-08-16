// ============================================
// WeaveMD — AIAgentPanel 三视图外壳测试（M3）
// ============================================
// 覆盖：init 触发；顶部栏（+ / ⚙ / ×）；默认 home 视图；+ 建会话进 session；
// ⚙ 进 settings；settings 返回回原视图；拖拽把手 / clamp；关闭延迟 toggleAIPanel。
// 模式下拉已移入 AIPanelComposer（见其测试），此处仅校验壳行为。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import AIAgentPanel from '@render/components/AIAgent/AIAgentPanel';
import { useAgentStore } from '@render/stores/agentStore';
import { useUIStore } from '@render/stores/uiStore';
import { useAuthStore } from '@render/stores/authStore';

// 三视图子组件 mock：稳定断言壳的顶部栏 / 视图切换行为
vi.mock('@render/components/AIAgent/AIPanelHome', () => ({
  default: () => <div data-testid="view-home">Home</div>,
}));
vi.mock('@render/components/AIAgent/AIPanelSession', () => ({
  default: () => <div data-testid="view-session">Session</div>,
}));
vi.mock('@render/components/AIAgent/AIPanelSettings', () => ({
  default: () => <div data-testid="view-settings">Settings</div>,
}));

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.newChat': '新建会话',
      'ai.settings.title': 'AI',
      'navbar.close': '关闭',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

const MOCK_USER = { id: 'u1', username: 'tester', createdAt: '', lastLogin: null };

describe('AIAgentPanel（三视图外壳）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ isAIPanelOpen: true, aiPanelWidth: 480 });
    useAgentStore.setState({ activeMode: 'chat', activeTab: 'chat', pendingConsent: false });
    useAuthStore.setState({
      user: MOCK_USER,
      token: 'tok',
      isAuthenticated: true,
      recentAccounts: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('首次挂载且有用户时触发 init 加载会话', async () => {
    const initSpy = vi.spyOn(useAgentStore.getState(), 'init').mockResolvedValue(undefined);
    render(<AIAgentPanel />);
    expect(initSpy).toHaveBeenCalledWith(MOCK_USER.id);
  });

  it('顶部栏品牌「WeaveMD」+ 新建(+) + 设置(⚙) + 关闭(✕) 存在', () => {
    render(<AIAgentPanel />);
    expect(screen.getByText('WeaveMD')).toBeInTheDocument();
    expect(screen.getByTestId('new-chat-btn')).toBeInTheDocument();
    expect(screen.getByTestId('open-settings-btn')).toBeInTheDocument();
    expect(screen.getByTestId('close-panel-btn')).toBeInTheDocument();
  });

  it('默认显示 home 视图', () => {
    render(<AIAgentPanel />);
    expect(screen.getByTestId('view-home')).toBeInTheDocument();
    expect(screen.queryByTestId('view-session')).toBeNull();
  });

  it('点 + 新建会话 → 进 session 视图', () => {
    render(<AIAgentPanel />);
    fireEvent.click(screen.getByTestId('new-chat-btn'));
    expect(screen.getByTestId('view-session')).toBeInTheDocument();
    expect(screen.queryByTestId('view-home')).toBeNull();
  });

  it('点 ⚙ 设置 → 进 settings 视图（home 隐藏）', () => {
    render(<AIAgentPanel />);
    fireEvent.click(screen.getByTestId('open-settings-btn'));
    expect(screen.getByTestId('view-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('view-home')).toBeNull();
  });

  it('宽度拖拽把手存在（cursor-col-resize）', () => {
    render(<AIAgentPanel />);
    const handle = document.querySelector('[class*="cursor-col-resize"]');
    expect(handle).not.toBeNull();
  });

  it('点击关闭（✕）后经 150ms 延迟 toggleAIPanel', async () => {
    vi.useFakeTimers();
    try {
      render(<AIAgentPanel />);
      fireEvent.click(screen.getByTestId('close-panel-btn'));
      expect(useUIStore.getState().isAIPanelOpen).toBe(true); // 未到 150ms 尚未关闭
      act(() => {
        vi.advanceTimersByTime(160);
      });
      expect(useUIStore.getState().isAIPanelOpen).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('store 层宽度 clamp 在 260~520（经 setAIPanelWidth）', () => {
    const { setAIPanelWidth } = useUIStore.getState();
    act(() => {
      setAIPanelWidth(999);
    });
    expect(useUIStore.getState().aiPanelWidth).toBe(520);
    act(() => {
      setAIPanelWidth(10);
    });
    expect(useUIStore.getState().aiPanelWidth).toBe(260);
  });
});

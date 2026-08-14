// ============================================
// WeaveMD — AIAgentPanel 测试（TDD strict）
// 覆盖：面板头部 Tab 切换 / 关闭回调 / 宽度拖拽把手存在与店宽 clamp / init 触发
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import AIAgentPanel from '@render/components/AIAgent/AIAgentPanel';
import { useAgentStore } from '@render/stores/agentStore';
import { useUIStore } from '@render/stores/uiStore';
import { useAuthStore } from '@render/stores/authStore';

// 子 Tab 使用真实实现（ChatTab/AgentTab 内部依赖 store，已在各自测试覆盖）；
// 此处专注面板容器行为，将 AgentTab 替换为轻量占位便于稳定断言。
vi.mock('@render/components/AIAgent/AgentTab', () => ({
  default: () => <div data-testid="mock-agent-tab">Agent Placeholder</div>,
}));

vi.mock('@render/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => `[${key}]`,
    language: 'zh-CN',
  }),
}));

const MOCK_USER = { id: 'u1', username: 'tester', createdAt: '', lastLogin: null };

describe('AIAgentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 确保每个用例从干净的 store 状态出发
    useUIStore.setState({ isAIPanelOpen: true, aiPanelWidth: 320 });
    useAgentStore.setState({ activeTab: 'chat', pendingConsent: false });
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

  it('点击 Agent Tab 切换 activeTab', () => {
    useAgentStore.setState({ activeTab: 'chat' });
    render(<AIAgentPanel />);
    // 当前 tab 应为 chat，切换到 agent
    fireEvent.click(screen.getByText('[ai.tab.agent]'));
    expect(useAgentStore.getState().activeTab).toBe('agent');
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
      fireEvent.click(screen.getByTitle('[navbar.close]'));
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

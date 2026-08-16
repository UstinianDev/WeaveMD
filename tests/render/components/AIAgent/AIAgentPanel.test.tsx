// ============================================
// WeaveMD — AIAgentPanel 测试（TDD strict，第 7 期批次⑥ B3：单面板 + 模式下拉）
// 覆盖：面板头部无双 Tab 按钮、有模式下拉；下拉切 chat/agent触发 store 域切换；
// 关闭回调 / 宽度拖拽把手存在与店宽 clamp / init 触发
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import AIAgentPanel from '@render/components/AIAgent/AIAgentPanel';
import { useAgentStore } from '@render/stores/agentStore';
import { useUIStore } from '@render/stores/uiStore';
import { useAuthStore } from '@render/stores/authStore';

// B3：面板统一渲染单个 body（原 AgentTab 承担双模式）；此处 mock 为轻量占位，
// 便于稳定断言「无 tab / 有下拉 / 切换触发 store 域切换」的壳行为。
vi.mock('@render/components/AIAgent/AgentTab', () => ({
  default: () => <div data-testid="mock-body">Body Placeholder</div>,
}));

vi.mock('@render/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => `[${key}]`,
    language: 'zh-CN',
  }),
}));

const MOCK_USER = { id: 'u1', username: 'tester', createdAt: '', lastLogin: null };

describe('AIAgentPanel (B3 单面板 + 模式下拉)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ isAIPanelOpen: true, aiPanelWidth: 320 });
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

  it('面板头部不再有 Chat/Agent 双 Tab 按钮（B3 无 Tab 割裂）', () => {
    render(<AIAgentPanel />);
    // 无「对话」「智能体」按钮（模式改由下拉选择，不复用 tab 按钮）
    expect(screen.queryByRole('button', { name: '[ai.tab.chat]' })).toBeNull();
    expect(screen.queryByRole('button', { name: '[ai.tab.agent]' })).toBeNull();
  });

  it('面板头部存在模式下拉（select，含 对话/智能体 两项）', () => {
    render(<AIAgentPanel />);
    const select = screen.getByTestId('ai-mode-select');
    expect(select).toBeInstanceOf(HTMLSelectElement);
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['[ai.tab.chat]', '[ai.tab.agent]']);
  });

  it('下拉切到智能体 → store activeMode 域切换（chat → agent）', () => {
    render(<AIAgentPanel />);
    fireEvent.change(screen.getByTestId('ai-mode-select'), { target: { value: 'agent' } });
    expect(useAgentStore.getState().activeMode).toBe('agent');
  });

  it('下拉切回 对话 → store activeMode 域回切（agent → chat）', () => {
    useAgentStore.setState({ activeMode: 'agent', activeTab: 'agent' });
    render(<AIAgentPanel />);
    fireEvent.change(screen.getByTestId('ai-mode-select'), { target: { value: 'chat' } });
    expect(useAgentStore.getState().activeMode).toBe('chat');
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

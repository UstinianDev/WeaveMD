// ============================================
// WeaveMD — AIAgentPanel 三视图外壳测试（M3）
// ============================================
// 覆盖：init 触发；顶部栏（+ / ⚙ / ×）；默认 home 视图；+ 建会话进 session；
// ⚙ 打开统一设置面板（toggleSettings）；拖拽把手 / clamp；关闭延迟 toggleAIPanel。
// 模式下拉已移入 AIPanelComposer（见其测试），此处仅校验壳行为。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import AIAgentPanel from '@render/components/AIAgent/AIAgentPanel';
import AIPanelComposer from '@render/components/AIAgent/AIPanelComposer';
import { useAgentStore } from '@render/stores/agentStore';
import { useUIStore } from '@render/stores/uiStore';
import { useAuthStore } from '@render/stores/authStore';

/** 记录 AIPanelHome / AIPanelSession 收到的最新的受控 draft 值（用于断言跨视图保留/清空）。 */
let lastHomeDraft = '';
let lastSessionDraft = '';

// 三视图子组件 mock：home/session 透传真实 AIPanelComposer（受控），记录 draft 变化；
// settings 保持简单占位（focus 在 home↔settings 停留时 draft 保留）。
vi.mock('@render/components/AIAgent/AIPanelHome', () => ({
  default: ({ draft, setDraft, onCreateSession, onOpenConversation, onViewAll }: {
    draft: string;
    setDraft: (v: string) => void;
    onCreateSession?: () => void;
    onOpenConversation?: (id: string) => void;
    onViewAll?: () => void;
  }) => {
    lastHomeDraft = draft;
    return (
      <div data-testid="view-home">
        <button
          type="button"
          data-testid="mock-recent-item"
          onClick={() => onOpenConversation?.('c1')}
        >
          recent-item
        </button>
        <button type="button" data-testid="mock-view-all" onClick={onViewAll}>
          view-all
        </button>
        <AIPanelComposer
          value={draft}
          onChange={(v: string) => setDraft(v)}
          onCompose={onCreateSession}
          onSend={() => setDraft('')}
        />
      </div>
    );
  },
}));
vi.mock('@render/components/AIAgent/AIPanelSession', () => ({
  default: ({ draft, setDraft, onCloseConversation }: {
    draft: string;
    setDraft: (v: string) => void;
    onCloseConversation?: () => void;
  }) => {
    lastSessionDraft = draft;
    return (
      <div data-testid="view-session">
        <button type="button" data-testid="mock-close-conv" onClick={onCloseConversation}>
          X
        </button>
        <AIPanelComposer
          value={draft}
          onChange={(v: string) => setDraft(v)}
          onSend={() => setDraft('')}
        />
      </div>
    );
  },
}));
vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.newChat': '新建会话',
      'ai.settings.title': 'AI',
      'navbar.close': '关闭',
      'ai.placeholder': '输入你的问题...',
      'ai.rewrite.selectionHint': '描述如何改写选中内容',
      'ai.send': '发送',
      'ai.stop': '停止',
      'ai.tab.chat': '对话',
      'ai.tab.agent': '智能体',
      'ai.modeSelectLabel': '切换对话 / 智能体模式',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

vi.mock('@render/components/AIAgent/ModelDropdown', () => ({
  default: () => <span data-testid="mock-model">Model</span>,
}));

const MOCK_USER = { id: 'u1', username: 'tester', createdAt: '', lastLogin: null };

describe('AIAgentPanel（三视图外壳）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastHomeDraft = '';
    lastSessionDraft = '';
    // 让 agentStore.init 的 IPC 拉取 resolve，避免未捕获的 Promise 拒绝污染断言
    const ai = (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai;
    const kb = (window.weaveMD as unknown as { kb: Record<string, unknown> }).kb;
    (ai.getConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: null });
    (ai.getConsent as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: null,
    });
    (ai.listConversations as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [],
    });
    (kb.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: null });
    // 发送分流只关心「调度 + 清空草稿 + 切视图」，底层的 chat/agent 网络副作用与断言无关：
    // spy 掉 sendMessage/sendAgentMessage，避免真实 send 触发网络同意弹层盖住视图断言。
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockResolvedValue(undefined);
    useUIStore.setState({ isAIPanelOpen: true, aiPanelWidth: 480 });
    useAgentStore.setState({ activeMode: 'agent', pendingConsent: false });
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

  it('点 ⚙ 设置 → toggleSettings 打开统一设置面板', () => {
    render(<AIAgentPanel />);
    expect(useUIStore.getState().isSettingsOpen).toBe(false);
    fireEvent.click(screen.getByTestId('open-settings-btn'));
    expect(useUIStore.getState().isSettingsOpen).toBe(true);
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

  // —— M4：composer 草稿跨视图保留 / 清空时机 ——

  it('M4: home 输入草稿 →切 history→返回 → 草稿保留（视图切换不触发清空）', () => {
    render(<AIAgentPanel />);
    // home 输入
    fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
      target: { value: '跨视图草稿' },
    });
    expect(lastHomeDraft).toBe('跨视图草稿');
    // 切 history（home 卸载）
    fireEvent.click(screen.getByTestId('mock-view-all'));
    // 返回 home（history → home，通过点返回按钮）
    const backBtn = screen.getByText('←');
    fireEvent.click(backBtn);
    expect(screen.getByTestId('view-home')).toBeInTheDocument();
    // 草稿保留：home composer 重新挂载后受控 value 仍为原草稿
    expect(lastHomeDraft).toBe('跨视图草稿');
    expect((screen.getByPlaceholderText('输入你的问题...') as HTMLTextAreaElement).value).toBe(
      '跨视图草稿'
    );
  });

  it('M4: home↔history↔home 共享同一草稿（切换视图不丢失）', () => {
    render(<AIAgentPanel />);
    fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
      target: { value: '共享草稿' },
    });
    expect(lastHomeDraft).toBe('共享草稿');
    // 点 view-all 进 history（home → history，不触发清空）
    fireEvent.click(screen.getByTestId('mock-view-all'));
    // history 返回 → 回 home，草稿仍在
    fireEvent.click(screen.getByText('←'));
    expect(screen.getByTestId('view-home')).toBeInTheDocument();
    expect(lastHomeDraft).toBe('共享草稿');
    expect((screen.getByPlaceholderText('输入你的问题...') as HTMLTextAreaElement).value).toBe(
      '共享草稿'
    );
  });

  it('M4: 新建会话（new-chat）后清空草稿', () => {
    render(<AIAgentPanel />);
    fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
      target: { value: '要清空的草稿' },
    });
    // 新建会话 → draft 清空
    fireEvent.click(screen.getByTestId('new-chat-btn'));
    expect(lastSessionDraft).toBe('');
  });

  it('M4: 打开最近会话（loadConversation）后清空草稿', () => {
    const loadConversation = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useAgentStore.getState(), 'loadConversation').mockImplementation(loadConversation);
    render(<AIAgentPanel />);
    fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
      target: { value: '会话前草稿' },
    });
    expect(lastHomeDraft).toBe('会话前草稿');
    // 点 RECENT 项 → handleOpenConversation → loadConversation + 进 session + 草稿清空
    fireEvent.click(screen.getByTestId('mock-recent-item'));
    expect(loadConversation).toHaveBeenCalledWith('c1', 'agent');
    expect(screen.getByTestId('view-session')).toBeInTheDocument();
    expect(lastSessionDraft).toBe('');
  });

  it('M4: 关闭会话（close-conversation）后回 home 且草稿清空', () => {
    render(<AIAgentPanel />);
    fireEvent.click(screen.getByTestId('new-chat-btn')); // 进 session
    fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
      target: { value: '会话内草稿' },
    });
    expect(lastSessionDraft).toBe('会话内草稿');
    // 关闭会话 → 回 home + 清空
    fireEvent.click(screen.getByTestId('mock-close-conv'));
    expect(screen.getByTestId('view-home')).toBeInTheDocument();
    expect(lastHomeDraft).toBe('');
  });

  it('M4: session 发送成功（onSend）→ 草稿清空', () => {
    render(<AIAgentPanel />);
    fireEvent.click(screen.getByTestId('new-chat-btn')); // 进 session
    fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
      target: { value: '发送后清空' },
    });
    expect(lastSessionDraft).toBe('发送后清空');
    // session composer onSend = () => setDraft('')
    fireEvent.click(screen.getByText('发送'));
    expect(lastSessionDraft).toBe('');
  });

  it('M4: home 发送成功（onCreateSession）→ 建会话 + 草稿清空', () => {
    render(<AIAgentPanel />);
    fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
      target: { value: 'home发送' },
    });
    expect(lastHomeDraft).toBe('home发送');
    // home 发送：onCompose 切 session + onSend 清空草稿
    fireEvent.click(screen.getByText('发送'));
    expect(screen.getByTestId('view-session')).toBeInTheDocument();
    expect(lastSessionDraft).toBe('');
  });

  it('M4: 关闭面板（✕ 150ms 后）→ 草稿清空', async () => {
    vi.useFakeTimers();
    try {
      render(<AIAgentPanel />);
      fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
        target: { value: '关面板要清空' },
      });
      expect(lastHomeDraft).toBe('关面板要清空');
      fireEvent.click(screen.getByTestId('close-panel-btn'));
      act(() => {
        vi.advanceTimersByTime(160);
      });
      // 面板关闭后 draft 已重置为空
      expect(lastHomeDraft).toBe('');
      expect(useUIStore.getState().isAIPanelOpen).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

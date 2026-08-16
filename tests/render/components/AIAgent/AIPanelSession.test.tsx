// ============================================
// WeaveMD — AIPanelSession 组件测试（M3：标题行 + × 关闭 + agent 模式 KB 显示）
// ============================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AIPanelSession from '@render/components/AIAgent/AIPanelSession';
import { useAgentStore } from '@render/stores/agentStore';
import type { IAIConversation } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.session.close': '关闭当前会话',
      'ai.tab.agent': '智能体',
      'ai.tab.chat': '对话',
      'ai.agent.useKnowledgeBase': '依照知识库创作',
      'ai.agent.compress': '压缩上下文',
      'ai.agent.kbSettings': '知识库',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

vi.mock('@render/components/AIAgent/AgentTab', () => ({
  default: () => <div data-testid="mock-message-flow">MessageFlow</div>,
}));

vi.mock('@render/components/AIAgent/KnowledgeBaseSettings', () => ({
  default: () => <div data-testid="mock-kbsettings">KB Settings</div>,
}));

vi.mock('@render/components/AIAgent/AIPanelComposer', () => ({
  default: () => <div data-testid="mock-composer">Composer</div>,
}));

const conv = (id: string, summary: string): IAIConversation => ({
  id,
  userId: 'u1',
  summary,
  mode: 'agent',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-10T00:00:00Z',
});

describe('AIPanelSession', () => {
  afterEach(() => {
    cleanup();
  });

  const closeFn = vi.fn();

  it('标题行显示当前会话 summary；× 关闭会话触发 onCloseConversation', () => {
    useAgentStore.setState({
      conversations: [conv('c1', '当前标题')],
      activeConversationId: 'c1',
      activeMode: 'agent',
      useKnowledgeBase: false,
    });
    render(<AIPanelSession onCloseConversation={closeFn} />);
    expect(screen.getByTestId('session-title').textContent).toContain('当前标题');
    fireEvent.click(screen.getByTestId('close-conversation'));
    expect(closeFn).toHaveBeenCalled();
  });

  it('无 summary 标题用模式名兜底（智能体）', () => {
    useAgentStore.setState({
      conversations: [conv('c1', '')],
      activeConversationId: 'c1',
      activeMode: 'agent',
      useKnowledgeBase: false,
    });
    render(<AIPanelSession onCloseConversation={closeFn} />);
    expect(screen.getByTestId('session-title').textContent).toContain('智能体');
  });

  it('agent 模式：显示消息流 + composer + KB 控件；切换 KB 设置抽屉显示 KnowledgeBaseSettings', () => {
    useAgentStore.setState({
      conversations: [conv('c1', '标题')],
      activeConversationId: 'c1',
      activeMode: 'agent',
      useKnowledgeBase: false,
    });
    render(<AIPanelSession onCloseConversation={closeFn} />);
    expect(screen.getByTestId('mock-message-flow')).toBeInTheDocument();
    expect(screen.getByTestId('mock-composer')).toBeInTheDocument();
    // 知识库设置抽屉初始隐藏
    expect(screen.queryByTestId('mock-kbsettings')).toBeNull();
    fireEvent.click(screen.getByText('知识库', { exact: true }));
    expect(screen.getByTestId('mock-kbsettings')).toBeInTheDocument();
  });

  it('chat 模式：不显示 KB 控件（KB 开关/知识库按钮），仅消息流 + composer', () => {
    useAgentStore.setState({
      conversations: [conv('c1', '标题')],
      activeConversationId: 'c1',
      activeMode: 'chat',
      useKnowledgeBase: false,
    });
    render(<AIPanelSession onCloseConversation={closeFn} />);
    expect(screen.getByTestId('mock-message-flow')).toBeInTheDocument();
    expect(screen.queryByLabelText('依照知识库创作')).toBeNull();
    expect(screen.queryByText('知识库', { exact: true })).toBeNull();
  });
});

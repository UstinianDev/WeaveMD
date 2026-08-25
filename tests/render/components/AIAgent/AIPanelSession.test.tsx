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

/** 捕获 AIPanelSession 传给 composer 的受控 value / onSend（M4 草稿透传断言用）。 */
let composerValue = '';
let composerOnSend: (() => void) | undefined;

vi.mock('@render/components/AIAgent/AIPanelComposer', () => ({
  default: ({ value, onSend }: {
    value: string;
    onSend?: () => void;
  }) => {
    composerValue = value;
    composerOnSend = onSend;
    return <div data-testid="mock-composer">Composer</div>;
  },
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
    render(<AIPanelSession draft="" setDraft={() => undefined} onCloseConversation={closeFn} />);
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
    render(<AIPanelSession draft="" setDraft={() => undefined} onCloseConversation={closeFn} />);
    expect(screen.getByTestId('session-title').textContent).toContain('智能体');
  });

  it('agent 模式：显示消息流 + composer；KB 开关已移除（Module 10）', () => {
    useAgentStore.setState({
      conversations: [conv('c1', '标题')],
      activeConversationId: 'c1',
      activeMode: 'agent',
      useKnowledgeBase: false,
    });
    render(<AIPanelSession draft="" setDraft={() => undefined} onCloseConversation={closeFn} />);
    expect(screen.getByTestId('mock-message-flow')).toBeInTheDocument();
    expect(screen.getByTestId('mock-composer')).toBeInTheDocument();
    // Module 10: KB 开关已移除，不再显示 KnowledgeBaseSettings
    expect(screen.queryByTestId('mock-kbsettings')).toBeNull();
    expect(screen.queryByText('知识库', { exact: true })).toBeNull();
  });

  it('agent 模式：KB 开关已移除，仅显示消息流 + composer', () => {
    useAgentStore.setState({
      conversations: [conv('c1', '标题')],
      activeConversationId: 'c1',
      activeMode: 'agent',
      useKnowledgeBase: false,
    });
    render(<AIPanelSession draft="" setDraft={() => undefined} onCloseConversation={closeFn} />);
    expect(screen.getByTestId('mock-message-flow')).toBeInTheDocument();
    expect(screen.queryByLabelText('依照知识库创作')).toBeNull();
    expect(screen.queryByText('知识库', { exact: true })).toBeNull();
  });

  it('M4: 接收 draft 受控透传 composer；onSend 清空草稿', () => {
    useAgentStore.setState({
      conversations: [conv('c1', '标题')],
      activeConversationId: 'c1',
      activeMode: 'agent',
      useKnowledgeBase: false,
    });
    const onSend = vi.fn();
    render(
      <AIPanelSession draft="会话草稿" setDraft={() => undefined} onSend={onSend} onCloseConversation={closeFn} />
    );
    expect(composerValue).toBe('会话草稿');
    // 发送成功 onSend → parent handles clearing draft + IndexedDB
    composerOnSend?.();
    expect(onSend).toHaveBeenCalled();
  });
});

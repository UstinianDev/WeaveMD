// ============================================
// WeaveMD — ChatTab 测试（TDD strict）
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ChatTab from '@render/components/AIAgent/ChatTab';
import { useAgentStore } from '@render/stores/agentStore';
import type { IAIMessage } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => `[${key}]`,
    language: 'zh-CN',
  }),
}));

const userMsg: IAIMessage = {
  id: 'm1',
  conversationId: 'c1',
  role: 'user',
  content: 'Hello AI',
  refsJson: null,
  createdAt: '2026-08-14T00:00:00Z',
};

const assistantMsg: IAIMessage = {
  id: 'm2',
  conversationId: 'c1',
  role: 'assistant',
  content: '**Hi** there',
  refsJson: null,
  createdAt: '2026-08-14T00:00:01Z',
};

describe('ChatTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const defaultState = {
    conversations: [],
    activeConversationId: null,
    messages: [],
    isStreaming: false,
    streamBuffer: '',
    pendingConsent: false,
  };

  it('无会话空态提示', () => {
    useAgentStore.setState(defaultState);
    render(<ChatTab />);
    expect(screen.getByText('[ai.empty.noConversation]')).toBeInTheDocument();
  });

  it('渲染 user 与 assistant 消息', () => {
    useAgentStore.setState({ ...defaultState, messages: [userMsg, assistantMsg] });
    render(<ChatTab />);
    expect(screen.getByText('Hello AI')).toBeInTheDocument();
    // assistant 内容经安全富文本渲染（**Hi** → <strong>Hi</strong>，无 dangerouslySetInnerHTML）
    expect(screen.getByText('Hi')).toBeInTheDocument();
    expect(document.body.textContent).toContain('there');
  });

  it('输入并回车发送,调用 sendMessage 并清空输入', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    // 通过 store 桩替换 sendMessage
    useAgentStore.setState({ ...defaultState, messages: [userMsg] });
    vi.spyOn(useAgentStore.getState(), 'sendMessage').mockImplementation(sendMessage);

    render(<ChatTab />);
    fireEvent.change(screen.getByPlaceholderText('[ai.placeholder]'), {
      target: { value: '  new question  ' },
    });
    fireEvent.click(screen.getByText('[ai.send]'));

    expect(sendMessage).toHaveBeenCalledWith('new question');
    // 输入框应清空
    expect((screen.getByPlaceholderText('[ai.placeholder]') as HTMLTextAreaElement).value).toBe('');
  });

  it('流式增量:streamBuffer 显示打字指示', () => {
    useAgentStore.setState({
      ...defaultState,
      messages: [userMsg],
      isStreaming: true,
      streamBuffer: 'part',
    });
    render(<ChatTab />);
    expect(screen.getByText('[ai.stop]')).toBeInTheDocument();
    // 打字指示/流文本可见
    expect(screen.getByText(/part/)).toBeInTheDocument();
  });

  it('停止按钮调用 stopStream', () => {
    useAgentStore.setState({
      ...defaultState,
      messages: [userMsg],
      isStreaming: true,
      streamBuffer: 'part',
    });
    const stopStream = vi.fn();
    vi.spyOn(useAgentStore.getState(), 'stopStream').mockImplementation(stopStream);

    render(<ChatTab />);
    fireEvent.click(screen.getByText('[ai.stop]'));
    expect(stopStream).toHaveBeenCalled();
  });

  it('无消息时显示空态', () => {
    useAgentStore.setState({ ...defaultState, conversations: [{ id: 'c1', userId: 'u1', mode: 'chat', summary: '', createdAt: '', updatedAt: '' }] });
    render(<ChatTab />);
    expect(screen.getByText('[ai.empty.noMessage]')).toBeInTheDocument();
  });
});

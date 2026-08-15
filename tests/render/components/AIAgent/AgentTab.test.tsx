// ============================================
// WeaveMD — AgentTab 组件测试（TDD strict）
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AgentTab from '@render/components/AIAgent/AgentTab';
import { useAgentStore } from '@render/stores/agentStore';
import { resetRewriteStore, useRewriteStore } from '@render/stores/rewriteStore';
import { useEditorStore } from '@render/stores/editorStore';
import type { IAgentToolCall, IAIMessage, IIntent, SelectionRef } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.empty.noConversation': '新建会话',
      'ai.empty.noMessage': '暂无消息',
      'ai.placeholder': '输入问题',
      'ai.send': '发送',
      'ai.stop': '停止',
      'ai.newChat': '新建',
      'ai.agent.useKnowledgeBase': '依照知识库创作',
      'ai.agent.compress': '压缩',
      'ai.agent.kbSettings': '知识库',
      'ai.intent.hint': '你想做什么？',
      'ai.intent.create': '创作',
      'ai.intent.rewrite': '改写',
      'ai.intent.create.prompt': '请帮我创作一篇文章',
      'ai.rewrite.selectionHint': '描述如何改写选中内容',
      'ai.tab.agent': '代理',
      'navbar.confirmDeleteFile': '删除',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

const userMsg: IAIMessage = {
  id: 'm1',
  conversationId: 'c1',
  role: 'user',
  content: '帮我写',
  refsJson: null,
  createdAt: '2026-08-14T00:00:00Z',
};

const assistantMsg: IAIMessage = {
  id: 'm2',
  conversationId: 'c1',
  role: 'assistant',
  content: '**好的**，我来写。',
  refsJson: null,
  createdAt: '2026-08-14T00:00:01Z',
};

const toolCall: IAgentToolCall = {
  toolCallId: 'tc1',
  name: 'searchKB',
  args: '{"query":"weavemd"}',
  status: 'ok',
  result: '{"fileName":"a.md"}',
};

const ambiguousIntent: IIntent = {
  intent: 'chat',
  confidence: 0.3,
  candidates: ['create', 'rewrite'],
};

describe('AgentTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    resetRewriteStore();
  });

  const defaultState = {
    conversations: [],
    activeConversationId: null,
    messages: [],
    isStreaming: false,
    streamBuffer: '',
    pendingConsent: false,
    toolCalls: [],
    intentCard: null,
    agentBackendHint: null,
    useKnowledgeBase: false,
  };

  it('渲染消息列表（assistant 富文本）', () => {
    useAgentStore.setState({ ...defaultState, messages: [userMsg, assistantMsg] });
    render(<AgentTab />);
    expect(screen.getByText('帮我写')).toBeInTheDocument();
    // 富文本 markdown：**好的** 渲染为 strong
    expect(screen.getByText('好的')).toBeInTheDocument();
    expect(screen.getByText('，我来写。')).toBeInTheDocument();
  });

  it('渲染工具轨迹 toolCalls', () => {
    useAgentStore.setState({ ...defaultState, toolCalls: [toolCall] });
    render(<AgentTab />);
    expect(screen.getByText('searchKB')).toBeInTheDocument();
  });

  it('渲染意图候选卡片并点击重发', () => {
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    useAgentStore.setState({ ...defaultState, intentCard: ambiguousIntent });
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockImplementation(sendAgentMessage);

    render(<AgentTab />);
    expect(screen.getByText('你想做什么？')).toBeInTheDocument();
    fireEvent.click(screen.getByText('创作'));
    // 意图提示模板重发
    expect(sendAgentMessage).toHaveBeenCalledWith('请帮我创作一篇文章');
  });

  it('「依照知识库创作」开关切换调用 setUseKnowledgeBase', () => {
    const setUseKnowledgeBase = vi.fn();
    vi.spyOn(useAgentStore.getState(), 'setUseKnowledgeBase').mockImplementation(setUseKnowledgeBase);
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    fireEvent.click(screen.getByLabelText('依照知识库创作'));
    expect(setUseKnowledgeBase).toHaveBeenCalledWith(true);
  });

  it('手动压缩按钮调用 runManualCompress', () => {
    const runManualCompress = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useAgentStore.getState(), 'runManualCompress').mockImplementation(runManualCompress);
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    fireEvent.click(screen.getByText('压缩'));
    expect(runManualCompress).toHaveBeenCalled();
  });

  it('后端降级提示条可见', () => {
    useAgentStore.setState({ ...defaultState, agentBackendHint: 'Agent 需远程后端' });
    render(<AgentTab />);
    expect(screen.getByText('Agent 需远程后端')).toBeInTheDocument();
  });

  it('发送消息调用 sendAgentMessage 并清空输入', () => {
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    useAgentStore.setState({ ...defaultState });
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockImplementation(sendAgentMessage);
    render(<AgentTab />);
    fireEvent.change(screen.getByPlaceholderText('输入问题'), { target: { value: ' 新的请求 ' } });
    fireEvent.click(screen.getByText('发送'));
    expect(sendAgentMessage).toHaveBeenCalledWith('新的请求');
    expect((screen.getByPlaceholderText('输入问题') as HTMLTextAreaElement).value).toBe('');
  });

  it('有选区上下文 → composer 发送走 runSelectionRewrite（选区改写）', () => {
    const runSelectionRewrite = vi.fn().mockResolvedValue(undefined);
    const sel: SelectionRef = {
      startLeafIndex: 0,
      startOffset: 0,
      endLeafIndex: 0,
      endOffset: 3,
    };
    vi.spyOn(useRewriteStore.getState(), 'runSelectionRewrite').mockImplementation(
      runSelectionRewrite
    );
    useRewriteStore.setState({ selectionContext: { md: 'abc', sel } });

    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    // placeholder 切为选区改写提示
    expect(screen.getByPlaceholderText('描述如何改写选中内容')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('描述如何改写选中内容'), {
      target: { value: '改成大写' },
    });
    fireEvent.click(screen.getByText('发送'));
    expect(runSelectionRewrite).toHaveBeenCalledWith('改成大写');
  });

  it('无选区上下文 + `@描述` → document scope 改写（startDocumentRewrite）', () => {
    const startDocumentRewrite = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useRewriteStore.getState(), 'startDocumentRewrite').mockImplementation(
      startDocumentRewrite
    );
    useEditorStore.setState({ content: '文档全文' });
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    fireEvent.change(screen.getByPlaceholderText('输入问题'), {
      target: { value: '@ 把全文改写成学术风格' },
    });
    fireEvent.click(screen.getByText('发送'));
    expect(startDocumentRewrite).toHaveBeenCalledWith('文档全文', '把全文改写成学术风格');
  });
});

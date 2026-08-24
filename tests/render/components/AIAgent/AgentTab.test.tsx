// ============================================
// WeaveMD — AgentTab 组件测试（M3：AgentTab 精瘦为消息流展示区）
// ============================================
// 覆盖：消息列表（user/assistant 富文本）、工具轨迹、意图候选卡、后端降级提示、
// assistant「预览写入文档」（文档已打开显示/未打开隐藏）。
// 原 composer 发送分流 / KB 控件 已移交 AIPanelComposer / AIPanelSession（见各自测试）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AgentTab from '@render/components/AIAgent/AgentTab';
import { useAgentStore } from '@render/stores/agentStore';
import { resetRewriteStore, useRewriteStore } from '@render/stores/rewriteStore';
import { useEditorStore } from '@render/stores/editorStore';
import type { IAgentToolCall, IAIMessage, IIntent } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.empty.noMessage': '暂无消息',
      'ai.rewrite.previewWrite': '预览写入文档',
      'ai.intent.hint': '你想做什么？',
      'ai.intent.create': '创作',
      'ai.intent.create.prompt': '请帮我创作一篇文章',
      'ai.tab.agent': '代理',
      'ai.msg.copy': '复制',
      'ai.msg.edit': '编辑',
      'ai.msg.retry': '重试',
      'ai.status.thinking': '正在思考...',
      'ai.status.toolCalling': '正在调用工具...',
      'ai.step.round': '第 {n} 轮',
      'ai.step.toolCount': '个工具',
      'ai.step.viewThinking': '查看本轮思考文本',
      'ai.tool.name.searchKB': '知识库检索',
      'ai.tool.name.editBlocks': '编辑文档',
      'ai.tool.name.listFiles': '列出文件',
      'ai.tool.name.readFile': '读取文件',
      'ai.tool.name.runSkill': '运行技能',
      'ai.tool.collapse': '收起',
      'ai.tool.expand': '展开',
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

describe('AgentTab (消息流展示区)', () => {
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
    useKnowledgeBase: false,
    activeMode: 'agent' as const,
    processStatus: 'idle' as const,
    setProcessStatus: vi.fn(),
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
    // AgentStepTimeline 按轮次分组展示，工具名显示为本地化标签
    expect(screen.getByText('知识库检索')).toBeInTheDocument();
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

  it('A1c: assistant 消息且文档已打开 → 「预览写入文档」按钮点击调用 previewDocumentFromReply', () => {
    const previewDocumentFromReply = vi.fn();
    vi.spyOn(useRewriteStore.getState(), 'previewDocumentFromReply').mockImplementation(
      previewDocumentFromReply
    );
    useEditorStore.setState({
      currentFile: { id: 'f1', name: 'doc', content: '当前文档' } as never,
    });
    useAgentStore.setState({ ...defaultState, messages: [assistantMsg] });
    render(<AgentTab />);
    const btn = screen.getByText('预览写入文档');
    fireEvent.click(btn);
    expect(previewDocumentFromReply).toHaveBeenCalledWith('**好的**，我来写。');
  });

  it('A1c: 未打开文档 → assistant 消息不显示「预览写入文档」按钮', () => {
    useEditorStore.setState({ currentFile: null, content: '' });
    useAgentStore.setState({ ...defaultState, messages: [assistantMsg] });
    render(<AgentTab />);
    expect(screen.queryByText('预览写入文档')).not.toBeInTheDocument();
  });
});

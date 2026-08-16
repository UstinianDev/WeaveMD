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
      'ai.rewrite.previewWrite': '预览写入文档',
      'ai.tab.agent': '代理',
      'navbar.confirmDeleteFile': '删除',
      'ai.completion.skillsTitle': '运行技能',
      'ai.completion.refTitle': '引用',
      'ai.completion.currentDoc': '当前文档',
      'ai.completion.currentDocDesc': '整篇改写',
      'ai.completion.kbDoc': '知识库文档',
      'ai.completion.kbDocDesc': '检索限定',
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
    // B3：AgentTab 现为统一 body，agent 专属控件仅在 activeMode==='agent' 显示
    activeMode: 'agent' as 'chat' | 'agent',
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

  it('A1c: 整篇写诉求（从 0 到 1 写一篇）→ 走 runFullDocumentRewrite，不 sendAgentMessage', () => {
    const runFullDocumentRewrite = vi.fn().mockResolvedValue(undefined);
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useRewriteStore.getState(), 'runFullDocumentRewrite').mockImplementation(
      runFullDocumentRewrite
    );
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockImplementation(sendAgentMessage);
    useAgentStore.setState({ ...defaultState });
    useEditorStore.setState({ content: '', currentFile: null });
    render(<AgentTab />);
    fireEvent.change(screen.getByPlaceholderText('输入问题'), {
      target: { value: '帮我从 0 到 1 写一篇关于 AI 的文档' },
    });
    fireEvent.click(screen.getByText('发送'));
    expect(runFullDocumentRewrite).toHaveBeenCalledWith('帮我从 0 到 1 写一篇关于 AI 的文档');
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it('A1c: 非整篇写诉求（如「帮我优化」）→ 仍走 agent 对话（不误拦截）', () => {
    const runFullDocumentRewrite = vi.fn().mockResolvedValue(undefined);
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useRewriteStore.getState(), 'runFullDocumentRewrite').mockImplementation(
      runFullDocumentRewrite
    );
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockImplementation(sendAgentMessage);
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    // 「优化这篇文档」是 rewrite 意图，不开整篇写协议（整篇写协议仅掐从 0 到 1 / 写整篇）
    fireEvent.change(screen.getByPlaceholderText('输入问题'), {
      target: { value: '帮我优化这篇文档' },
    });
    fireEvent.click(screen.getByText('发送'));
    expect(runFullDocumentRewrite).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith('帮我优化这篇文档');
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
    // 打开文档时按钮可见
    fireEvent.click(btn);
    expect(previewDocumentFromReply).toHaveBeenCalledWith('**好的**，我来写。');
  });

  it('A1c: 未打开文档 → assistant 消息不显示「预览写入文档」按钮', () => {
    useEditorStore.setState({ currentFile: null, content: '' });
    useAgentStore.setState({ ...defaultState, messages: [assistantMsg] });
    render(<AgentTab />);
    expect(screen.queryByText('预览写入文档')).not.toBeInTheDocument();
  });

  // ---- 第 7 期批次④ B1：/ 与 @ 自动补全 ----

  it('输入 `/` → 从 listSkills 加载技能并弹出补全菜单', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      success: true,
      data: [
        { name: 'polish_rewrite', description: '润色文本' },
        { name: 'tech_organize', description: '整理技术资料' },
      ],
    });
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listSkills = listSkills;
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    const ta = screen.getByPlaceholderText('输入问题');
    fireEvent.change(ta, { target: { value: '/' } });
    // 菜单标题「运行技能」出现
    expect(await screen.findByText('运行技能')).toBeInTheDocument();
    expect(listSkills).toHaveBeenCalledWith(expect.any(String));
    expect(screen.getByText('polish_rewrite')).toBeInTheDocument();
  });

  it('输入 `@` → 弹出引用补全菜单（当前文档 + 知识库文档）', () => {
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    const ta = screen.getByPlaceholderText('输入问题');
    fireEvent.change(ta, { target: { value: '@' } });
    expect(screen.getByText('引用', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('当前文档')).toBeInTheDocument();
    expect(screen.getByText('知识库文档')).toBeInTheDocument();
  });

  it('`@` 菜单点击「知识库文档」→ 注入 `@知识库 ` 前缀', () => {
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    const ta = screen.getByPlaceholderText('输入问题');
    fireEvent.change(ta, { target: { value: '@' } });
    fireEvent.click(screen.getByText('知识库文档'));
    expect((ta as HTMLTextAreaElement).value).toBe('@知识库 ');
  });

  it('`@` 菜单点击「当前文档」→ 注入 `@文档 ` 前缀（复用 document scope 协议）', () => {
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    const ta = screen.getByPlaceholderText('输入问题');
    fireEvent.change(ta, { target: { value: '@' } });
    fireEvent.click(screen.getByText('当前文档'));
    expect((ta as HTMLTextAreaElement).value).toBe('@文档 ');
  });

  it('`/` 菜单选择技能 → 注入 `/技能名 ` 前缀', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      success: true,
      data: [{ name: 'polish_rewrite', description: '润色文本' }],
    });
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listSkills = listSkills;
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    const ta = screen.getByPlaceholderText('输入问题');
    fireEvent.change(ta, { target: { value: '/' } });
    await screen.findByText('运行技能');
    fireEvent.click(screen.getByText('polish_rewrite'));
    expect((ta as HTMLTextAreaElement).value).toBe('/polish_rewrite ');
  });

  it('`@文档 ` 前缀 + 补充指令 → 发送走 startDocumentRewrite（现有 document scope 分流）', () => {
    const startDocumentRewrite = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useRewriteStore.getState(), 'startDocumentRewrite').mockImplementation(
      startDocumentRewrite
    );
    useEditorStore.setState({ content: '文档全文' });
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    fireEvent.change(screen.getByPlaceholderText('输入问题'), {
      target: { value: '@文档 改成学术风格' },
    });
    fireEvent.click(screen.getByText('发送'));
    expect(startDocumentRewrite).toHaveBeenCalledWith('文档全文', '改成学术风格');
  });

  it('`/polish_rewrite 把这段润色` → 剥前缀后走 sendAgentMessage（runSkill 意图）', () => {
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockImplementation(sendAgentMessage);
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    fireEvent.change(screen.getByPlaceholderText('输入问题'), {
      target: { value: '/polish_rewrite 把这段润色' },
    });
    fireEvent.click(screen.getByText('发送'));
    // `/技能名 ` 剥除后，指令正文走 agent 对话
    expect(sendAgentMessage).toHaveBeenCalledWith('把这段润色');
  });

  it('`Esc` 关闭补全菜单', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      success: true,
      data: [{ name: 'polish_rewrite', description: '润色文本' }],
    });
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listSkills = listSkills;
    useAgentStore.setState({ ...defaultState });
    render(<AgentTab />);
    const ta = screen.getByPlaceholderText('输入问题');
    fireEvent.change(ta, { target: { value: '/' } });
    await screen.findByText('运行技能');
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByText('运行技能')).not.toBeInTheDocument();
  });

  // ---- 第 7 期批次⑥ B3：统一 body 模式专属控件归属 ----

  const chatState = {
    ...defaultState,
    activeMode: 'chat' as 'chat' | 'agent',
  };

  it('chat 模式：KB 开关/压缩/KB 设置/工具轨迹/意图卡不显示，走 sendMessage', () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useAgentStore.getState(), 'sendMessage').mockImplementation(sendMessage);
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockImplementation(sendAgentMessage);
    useAgentStore.setState({
      ...chatState,
      toolCalls: [toolCall],
      intentCard: ambiguousIntent,
      agentBackendHint: 'hint',
    });
    render(<AgentTab />);

    // 纯对话：agent 专属控件不显示
    expect(screen.queryByLabelText('依照知识库创作')).toBeNull();
    expect(screen.queryByText('压缩')).toBeNull();
    expect(screen.queryByText('知识库', { exact: true })).toBeNull();
    expect(screen.queryByText('searchKB')).toBeNull();
    expect(screen.queryByText('你想做什么？')).toBeNull();
    expect(screen.queryByText('hint')).toBeNull();

    // 发送走 sendMessage（不 sendAgentMessage）
    fireEvent.change(screen.getByPlaceholderText('输入问题'), {
      target: { value: '普通对话' },
    });
    fireEvent.click(screen.getByText('发送'));
    expect(sendMessage).toHaveBeenCalledWith('普通对话');
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it('chat 模式：无 `/` `@` 自动补全菜单（输入 / 不弹技能菜单）', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      success: true,
      data: [{ name: 'polish_rewrite', description: '润色文本' }],
    });
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listSkills = listSkills;
    useAgentStore.setState({ ...chatState });
    render(<AgentTab />);
    const ta = screen.getByPlaceholderText('输入问题');
    fireEvent.change(ta, { target: { value: '/' } });
    // B1 补全仅在智能体模式可用；chat 模式输入 / 不弹菜单
    expect(screen.queryByText('运行技能')).toBeNull();
    expect(screen.queryByTestId('completion-menu')).toBeNull();
  });

  it('agent 模式：KB 开关/压缩/KB 设置/工具轨迹/意图卡/降级提示显示', () => {
    useAgentStore.setState({ ...defaultState, toolCalls: [toolCall] });
    render(<AgentTab />);
    expect(screen.getByLabelText('依照知识库创作')).toBeInTheDocument();
    expect(screen.getByText('压缩')).toBeInTheDocument();
    expect(screen.getByText('知识库', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('searchKB')).toBeInTheDocument();
  });
});

// ---- 第 7 期批次⑥ B3 回归：chat 挂载 → 切 agent 后 / 补全仍可用 ----
it('B3: chat 模式挂载 → 切 agent 后输入 / 仍弹技能补全（模式切换不丢失单面板补全能力）', async () => {
  const listSkills = vi.fn().mockResolvedValue({
    success: true,
    data: [{ name: 'polish_rewrite', description: '润色文本' }],
  });
  (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listSkills = listSkills;
  useAgentStore.setState({
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
    activeMode: 'chat',
  });
  const { rerender } = render(<AgentTab />);
  await new Promise((r) => setTimeout(r, 0)); // 让 listSkills 微任务 + [skills] effect 落地
  // 切到 agent（模拟下拉切换 activeMode 域）
  useAgentStore.setState({ activeMode: 'agent', activeTab: 'agent' });
  rerender(<AgentTab />);
  const ta = screen.getByPlaceholderText('输入问题');
  fireEvent.change(ta, { target: { value: '/' } });
  expect(useAgentStore.getState().activeMode).toBe('agent');
  expect(screen.getByText('运行技能')).toBeInTheDocument();
});

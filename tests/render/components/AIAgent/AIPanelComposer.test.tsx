// ============================================
// WeaveMD — AIPanelComposer 组件测试（M3：共享 composer，handleSendAgent 自 AgentTab 逐字移入）
// ============================================
// 关键：分流协议不改写——选区改写 / @文档 / 整篇写 / 纯 agent / chat sendMessage 归属；
// `/` `@` 补全菜单；模式下拉切换。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AIPanelComposer from '@render/components/AIAgent/AIPanelComposer';
import { useAgentStore } from '@render/stores/agentStore';
import { resetRewriteStore, useRewriteStore } from '@render/stores/rewriteStore';
import { useEditorStore } from '@render/stores/editorStore';
import type { SelectionRef } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.placeholder': '输入你的问题...',
      'ai.rewrite.selectionHint': '描述如何改写选中内容',
      'ai.send': '发送',
      'ai.stop': '停止',
      'ai.tab.chat': '对话',
      'ai.tab.agent': '智能体',
      'ai.modeSelectLabel': '切换对话 / 智能体模式',
      'ai.completion.skillsTitle': '运行技能',
      'ai.completion.refTitle': '引用',
      'ai.completion.currentDoc': '当前文档',
      'ai.completion.currentDocDesc': '整篇改写',
      'ai.completion.kbDoc': '知识库文档',
      'ai.completion.kbDocDesc': '检索限定',
      'ai.modelDropdown.label': '模型',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

const defaultState = {
  activeMode: 'agent' as 'chat' | 'agent',
  messages: [],
  isStreaming: false,
  streamBuffer: '',
  toolCalls: [],
  pendingConsent: false,
};

describe('AIPanelComposer（handleSendAgent 分流）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock：listSkills + listModels 返回空/不可用，避免干扰分流测试
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listSkills = vi
      .fn()
      .mockResolvedValue({ success: true, data: [] });
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listModels = vi
      .fn()
      .mockResolvedValue({ success: false });
  });

  afterEach(() => {
    cleanup();
    resetRewriteStore();
  });

  const sendAgent = (value: string) => {
    useAgentStore.setState({ ...defaultState, activeMode: 'agent' });
    fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
      target: { value },
    });
    fireEvent.click(screen.getByText('发送'));
  };

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
    useAgentStore.setState({ ...defaultState, activeMode: 'agent' });

    render(<AIPanelComposer />);
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
    render(<AIPanelComposer />);
    sendAgent('@ 把全文改写成学术风格');
    expect(startDocumentRewrite).toHaveBeenCalledWith('文档全文', '把全文改写成学术风格');
  });

  it('A1c: 整篇写诉求（从 0 到 1 写一篇）→ 走 runFullDocumentRewrite，不 sendAgentMessage', () => {
    const runFullDocumentRewrite = vi.fn().mockResolvedValue(undefined);
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useRewriteStore.getState(), 'runFullDocumentRewrite').mockImplementation(
      runFullDocumentRewrite
    );
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockImplementation(sendAgentMessage);
    useEditorStore.setState({ content: '', currentFile: null });
    render(<AIPanelComposer />);
    sendAgent('帮我从 0 到 1 写一篇关于 AI 的文档');
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
    render(<AIPanelComposer />);
    sendAgent('帮我优化这篇文档');
    expect(runFullDocumentRewrite).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledWith('帮我优化这篇文档');
  });

  it('`@文档 ` 前缀 + 补充指令 → 发送走 startDocumentRewrite（document scope 分流）', () => {
    const startDocumentRewrite = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useRewriteStore.getState(), 'startDocumentRewrite').mockImplementation(
      startDocumentRewrite
    );
    useEditorStore.setState({ content: '文档全文' });
    render(<AIPanelComposer />);
    sendAgent('@文档 改成学术风格');
    expect(startDocumentRewrite).toHaveBeenCalledWith('文档全文', '改成学术风格');
  });

  it('`/polish_rewrite 把这段润色` → 剥前缀后走 sendAgentMessage（runSkill 意图）', () => {
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockImplementation(sendAgentMessage);
    render(<AIPanelComposer />);
    sendAgent('/polish_rewrite 把这段润色');
    expect(sendAgentMessage).toHaveBeenCalledWith('把这段润色');
  });

  it('`/技能名 ` 前缀 + 知识库前缀 @知识库 → kbQa 走 sendAgentMessage', () => {
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockImplementation(sendAgentMessage);
    render(<AIPanelComposer />);
    sendAgent('@知识库 检索 weavemd 相关信息');
    expect(sendAgentMessage).toHaveBeenCalledWith('检索 weavemd 相关信息');
  });

  it('chat 模式：发送走 sendMessage（不 sendAgentMessage）', () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useAgentStore.getState(), 'sendMessage').mockImplementation(sendMessage);
    vi.spyOn(useAgentStore.getState(), 'sendAgentMessage').mockImplementation(sendAgentMessage);
    useAgentStore.setState({ ...defaultState, activeMode: 'chat' });
    render(<AIPanelComposer />);
    fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
      target: { value: '普通对话' },
    });
    // 切换模式下拉后 placeholder 仍为通用（chat）
    fireEvent.click(screen.getByText('发送'));
    expect(sendMessage).toHaveBeenCalledWith('普通对话');
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it('模式下拉切换 chat/agent → store activeMode 域切换', () => {
    useAgentStore.setState({ ...defaultState, activeMode: 'chat' });
    render(<AIPanelComposer />);
    fireEvent.change(screen.getByTestId('ai-mode-select'), { target: { value: 'agent' } });
    expect(useAgentStore.getState().activeMode).toBe('agent');
  });

  it('chat 模式：无 `/` `@` 自动补全菜单（输入 / 不弹技能菜单）', async () => {
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listSkills = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: [{ name: 'polish_rewrite', description: '润色文本' }],
      });
    useAgentStore.setState({ ...defaultState, activeMode: 'chat' });
    render(<AIPanelComposer />);
    const ta = screen.getByPlaceholderText('输入你的问题...');
    fireEvent.change(ta, { target: { value: '/' } });
    expect(screen.queryByTestId('completion-menu')).toBeNull();
  });

  it('agent 模式输入 `/` → 弹出技能补全菜单', async () => {
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listSkills = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: [{ name: 'polish_rewrite', description: '润色文本' }],
      });
    useAgentStore.setState({ ...defaultState, activeMode: 'agent' });
    render(<AIPanelComposer />);
    const ta = screen.getByPlaceholderText('输入你的问题...');
    fireEvent.change(ta, { target: { value: '/' } });
    expect(await screen.findByText('运行技能')).toBeInTheDocument();
    expect(screen.getByText('polish_rewrite')).toBeInTheDocument();
  });

  it('agent 模式输入 `@` → 弹出引用补全菜单（当前文档 + 知识库文档）', () => {
    useAgentStore.setState({ ...defaultState, activeMode: 'agent' });
    render(<AIPanelComposer />);
    fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
      target: { value: '@' },
    });
    expect(screen.getByText('当前文档')).toBeInTheDocument();
    expect(screen.getByText('知识库文档')).toBeInTheDocument();
  });

  it('`@` 菜单点击「知识库文档」→ 注入 `@知识库 ` 前缀', () => {
    useAgentStore.setState({ ...defaultState, activeMode: 'agent' });
    render(<AIPanelComposer />);
    const ta = screen.getByPlaceholderText('输入你的问题...');
    fireEvent.change(ta, { target: { value: '@' } });
    fireEvent.click(screen.getByText('知识库文档'));
    expect((ta as HTMLTextAreaElement).value).toBe('@知识库 ');
  });
});

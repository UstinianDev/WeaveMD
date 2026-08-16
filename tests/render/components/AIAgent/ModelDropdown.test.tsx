// ============================================
// WeaveMD — ModelDropdown 组件测试（M3：拉取 / 选中持久化 / 失败降级手动输入）
// ============================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ModelDropdown from '@render/components/AIAgent/ModelDropdown';
import { useAgentStore } from '@render/stores/agentStore';
import { useAuthStore } from '@render/stores/authStore';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.modelDropdown.label': '模型',
      'ai.modelDropdown.loadFailed': '获取模型列表失败',
      'ai.modelDropdown.manual': '手动输入模型',
      'ai.modelDropdown.manualPlaceholder': '输入模型 ID',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

describe('ModelDropdown', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('拉取成功：列出模型，点击选中 → 调 ai.setConfig({ model }) 持久化', async () => {
    useAuthMock('u1');
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listModels = vi
      .fn()
      .mockResolvedValue({ success: true, data: ['qwen3.5:0.8b', 'deepseek-chat'] });
    const setConfig = vi.fn().mockResolvedValue({
      success: true,
      data: { backend: 'remote', remoteBaseUrl: '', model: 'deepseek-chat', hasApiKey: false },
    });
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.setConfig = setConfig;
    useAgentStore.setState({ config: null });

    render(<ModelDropdown />);
    fireEvent.click(screen.getByTestId('model-dropdown'));
    expect(await screen.findByText('qwen3.5:0.8b')).toBeInTheDocument();

    fireEvent.click(screen.getByText('deepseek-chat'));
    await waitFor(() =>
      expect(setConfig).toHaveBeenCalledWith('u1', { model: 'deepseek-chat' })
    );
  });

  it('拉取失败/为空：降级为手动输入，输入 Enter 后落盘', async () => {
    useAuthMock('u1');
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.listModels = vi
      .fn()
      .mockResolvedValue({ success: false });
    const setConfig = vi.fn().mockResolvedValue({
      success: true,
      data: { backend: 'remote', remoteBaseUrl: '', model: 'my-model', hasApiKey: false },
    });
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.setConfig = setConfig;
    useAgentStore.setState({ config: null });

    render(<ModelDropdown />);
    fireEvent.click(screen.getByTestId('model-dropdown'));
    expect(await screen.findByText('获取模型列表失败')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('model-manual-toggle'));
    const input = screen.getByTestId('model-manual-input');
    fireEvent.change(input, { target: { value: 'my-model' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(setConfig).toHaveBeenCalledWith('u1', { model: 'my-model' }));
  });
});

// 轻量注入 authStore user（ModelDropdown 经 useAuthStore 取 userId）
function useAuthMock(id: string) {
  useAuthStore.setState({
    user: { id, username: 'tester', createdAt: '', lastLogin: null },
    token: 't',
    isAuthenticated: true,
    recentAccounts: [],
  } as never);
}

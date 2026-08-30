// ============================================
// WeaveMD — ModelDropdown 组件测试（Phase 5：modelConfigs 数据源）
// 覆盖：配置列表渲染 / 选中激活 / 降级手动输入。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IAIModelConfig } from '@shared/ai';
import ModelDropdown from '@render/components/AIAgent/composer/ModelDropdown';
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

const MOCK_CONFIGS: IAIModelConfig[] = [
  {
    id: 'cfg-1',
    name: 'OpenAI - gpt-4o',
    protocol: 'openai',
    provider: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    hasApiKey: true,
    hint: '',
  },
  {
    id: 'cfg-2',
    name: 'Anthropic - claude-sonnet-4-20250514',
    protocol: 'anthropic',
    provider: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    hasApiKey: false,
    hint: '',
  },
];

describe('ModelDropdown (Phase 5: modelConfigs 数据源)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: 'u1', username: 'tester', createdAt: '', lastLogin: null },
      token: 't',
      isAuthenticated: true,
      recentAccounts: [],
    });
    // Stub refreshModelConfigs to prevent async overwrite of test state
    vi.spyOn(useAgentStore.getState(), 'refreshModelConfigs').mockResolvedValue();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染激活配置的 provider - model 标签', () => {
    useAgentStore.setState({
      config: {
        backend: 'remote',
        remoteBaseUrl: '',
        model: 'gpt-4o',
        hasApiKey: true,
        activeModelConfigId: 'cfg-1',
      },
      modelConfigs: MOCK_CONFIGS,
      activeModelConfigId: 'cfg-1',
    });
    render(<ModelDropdown />);
    expect(screen.getByText(/OpenAI/)).toBeInTheDocument();
    expect(screen.getByText(/gpt-4o/)).toBeInTheDocument();
  });

  it('点击下拉 → 显示配置列表 → 选中 → 调用 modelConfigs.activate', async () => {
    useAgentStore.setState({
      config: {
        backend: 'remote',
        remoteBaseUrl: '',
        model: 'gpt-4o',
        hasApiKey: true,
        activeModelConfigId: 'cfg-1',
      },
      modelConfigs: MOCK_CONFIGS,
      activeModelConfigId: 'cfg-1',
    });
    const activateMock = vi.fn().mockResolvedValue({
      success: true,
      data: { backend: 'remote', remoteBaseUrl: '', model: 'claude-sonnet-4-20250514', hasApiKey: false },
    });
    (window.weaveMD.ai.modelConfigs.activate as ReturnType<typeof vi.fn>) = activateMock;

    render(<ModelDropdown />);
    // Wait for useEffect to complete (loadState transitions loading -> ok)
    await waitFor(() => {
      fireEvent.click(screen.getByTestId('model-dropdown'));
    });
    expect(screen.getByTestId('model-dropdown-panel')).toBeInTheDocument();

    // 第二项可见
    const opt2 = screen.getByTestId('model-config-option-cfg-2');
    expect(opt2).toBeInTheDocument();

    fireEvent.click(opt2);
    await waitFor(() => expect(activateMock).toHaveBeenCalledWith('u1', 'cfg-2'));
  });

  it('降级：modelConfigs 为空时显示手动输入', async () => {
    useAgentStore.setState({ modelConfigs: [], activeModelConfigId: null, config: null });
    const setConfigMock = vi.fn().mockResolvedValue({
      success: true,
      data: { backend: 'remote', remoteBaseUrl: '', model: 'my-model', hasApiKey: false },
    });
    (window.weaveMD.ai as unknown as Record<string, unknown>).setConfig = setConfigMock;

    render(<ModelDropdown />);
    // Wait for useEffect to complete and set loadState to 'manual'
    await waitFor(() => {
      fireEvent.click(screen.getByTestId('model-dropdown'));
    });
    expect(screen.getAllByText('未配置模型').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByTestId('model-manual-toggle'));
    const input = screen.getByTestId('model-manual-input');
    fireEvent.change(input, { target: { value: 'my-model' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(setConfigMock).toHaveBeenCalledWith('u1', { model: 'my-model' }));
  });
});

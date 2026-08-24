// ============================================
// WeaveMD — ModelForm 测试（Phase 5：双视图模型配置）
// 覆盖：视图 A 配置列表渲染/激活/删除；视图 B 新建配置表单提交。
// 无 dangerouslySetInnerHTML、无 any。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IAIModelConfig } from '@shared/ai';
import ModelForm from '@render/components/AIAgent/settings/ModelForm';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.settings.modelConfigs.title': 'AI 模型配置',
      'ai.settings.modelConfigs.new': '+ 新建配置',
      'ai.settings.modelConfigs.empty': '暂无配置，点击上方按钮新建',
      'ai.settings.modelConfigs.protocol': '兼容协议',
      'ai.settings.modelConfigs.provider': '提供商',
      'ai.settings.modelConfigs.baseUrl': 'Base URL',
      'ai.settings.modelConfigs.model': '模型名称',
      'ai.settings.modelConfigs.apiKey': 'API Key',
      'ai.settings.modelConfigs.hint': '提供商会根据 Base URL 和模型名自动识别',
      'ai.settings.modelConfigs.add': '添加配置',
      'ai.settings.modelConfigs.cancel': '取消',
      'ai.settings.modelConfigs.activate': '激活',
      'ai.settings.modelConfigs.active': '当前',
      'ai.settings.modelConfigs.delete': '删除',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

const MOCK_USER = { id: 'u1', username: 'tester', createdAt: '', lastLogin: null };

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

describe('ModelForm (Phase 5: 双视图模型配置)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: MOCK_USER,
      token: 'tok',
      isAuthenticated: true,
      recentAccounts: [],
    });
    useAgentStore.setState({
      config: {
        backend: 'remote',
        remoteBaseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        hasApiKey: true,
        activeModelConfigId: 'cfg-1',
      },
      modelConfigs: MOCK_CONFIGS,
      activeModelConfigId: 'cfg-1',
    });
    // mock modelConfigs IPC
    const ai = window.weaveMD.ai as unknown as Record<string, unknown>;
    (ai.modelConfigs as Record<string, ReturnType<typeof vi.fn>>).list = vi
      .fn()
      .mockResolvedValue({ success: true, data: MOCK_CONFIGS });
    (ai.modelConfigs as Record<string, ReturnType<typeof vi.fn>>).activate = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: { backend: 'remote', remoteBaseUrl: '', model: 'gpt-4o', hasApiKey: true },
      });
    (ai.modelConfigs as Record<string, ReturnType<typeof vi.fn>>).delete = vi
      .fn()
      .mockResolvedValue({ success: true, data: { deleted: true } });
    (ai.modelConfigs as Record<string, ReturnType<typeof vi.fn>>).create = vi
      .fn()
      .mockResolvedValue({ success: true, data: MOCK_CONFIGS[0] });
    ai.getConfig = vi.fn().mockResolvedValue({
      success: true,
      data: { backend: 'remote', remoteBaseUrl: '', model: 'gpt-4o', hasApiKey: true },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('视图 A：渲染配置列表，当前激活项高亮显示「当前」', () => {
    render(<ModelForm />);
    expect(screen.getByText('AI 模型配置')).toBeInTheDocument();
    expect(screen.getByText('+ 新建配置')).toBeInTheDocument();
    // 激活项显示「当前」
    expect(screen.getByText('当前')).toBeInTheDocument();
    // 两项均渲染
    expect(screen.getByText(/gpt-4o/)).toBeInTheDocument();
    expect(screen.getByText(/claude-sonnet-4-20250514/)).toBeInTheDocument();
  });

  it('视图 A：点击激活按钮 → 调用 modelConfigs.activate', async () => {
    render(<ModelForm />);
    const activateBtn = screen.getByTestId('model-config-activate-cfg-2');
    fireEvent.click(activateBtn);
    await waitFor(() => {
      expect(
        (window.weaveMD.ai.modelConfigs.activate as ReturnType<typeof vi.fn>)
      ).toHaveBeenCalledWith('u1', 'cfg-2');
    });
  });

  it('视图 A：点击删除按钮 → 调用 modelConfigs.delete', async () => {
    render(<ModelForm />);
    const deleteBtn = screen.getByTestId('model-config-delete-cfg-2');
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(
        (window.weaveMD.ai.modelConfigs.delete as ReturnType<typeof vi.fn>)
      ).toHaveBeenCalledWith('cfg-2');
    });
  });

  it('视图 A：空态提示', () => {
    useAgentStore.setState({ modelConfigs: [], activeModelConfigId: null });
    render(<ModelForm />);
    expect(screen.getByText('暂无配置，点击上方按钮新建')).toBeInTheDocument();
  });

  it('视图 B：点击新建 → 显示表单 → 填写并提交', async () => {
    render(<ModelForm />);
    fireEvent.click(screen.getByTestId('model-config-new'));

    // 表单字段可见
    expect(screen.getByText('兼容协议')).toBeInTheDocument();
    expect(screen.getByText('提供商')).toBeInTheDocument();
    expect(screen.getByText('Base URL')).toBeInTheDocument();
    expect(screen.getByText('模型名称')).toBeInTheDocument();
    expect(screen.getByText('API Key')).toBeInTheDocument();

    // 填写模型名
    const modelInput = screen.getByPlaceholderText('e.g. gpt-4o / claude-sonnet-4-20250514');
    fireEvent.change(modelInput, { target: { value: 'gpt-4o-mini' } });

    // 提交
    fireEvent.click(screen.getByTestId('model-config-add'));
    await waitFor(() => {
      expect(
        (window.weaveMD.ai.modelConfigs.create as ReturnType<typeof vi.fn>)
      ).toHaveBeenCalled();
    });
  });

  it('视图 B：取消返回列表', () => {
    render(<ModelForm />);
    fireEvent.click(screen.getByTestId('model-config-new'));
    expect(screen.getByText('兼容协议')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('model-config-cancel'));
    expect(screen.getByText('+ 新建配置')).toBeInTheDocument();
  });
});

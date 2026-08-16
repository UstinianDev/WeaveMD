// ============================================
// WeaveMD — ModelForm 测试（M3：自 SettingsModal ai Tab 迁入）
// 覆盖：加载 config/consent；保存恒 backend:'remote'；④断开连接清 key；
// 不渲染 ollama/embedding 控件；不落明文 key 到渲染进程（load 只读 hasApiKey 布尔）。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IAIConsent } from '@shared/ai';
import ModelForm from '@render/components/AIAgent/settings/ModelForm';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.settings.backend': '后端',
      'ai.settings.backend.remote': '远程 API',
      'ai.settings.remoteBaseUrl': '远程 API 地址',
      'ai.settings.model': '模型 ID',
      'ai.settings.apiKey': 'API 密钥',
      'ai.settings.apiKeySet': '已设置（隐藏）',
      'ai.settings.allowNetwork': '允许联网',
      'ai.settings.allowSend': '允许将笔记发送给 AI',
      'ai.settings.provider.connected': '已连接：远程 API',
      'ai.settings.provider.disconnected': '未配置 API key，AI 不可用',
      'ai.settings.disconnect': '断开连接',
      'ai.settings.reconnect': '重新连接',
      'settings.save': '保存',
      'ai.security.weakKeyring': '密钥加密降级',
      'ai.settings.kb.title': '知识库检索（Agent）',
      'ai.settings.kb.hint': '知识库提示',
      'ai.settings.kb.topK': '召回条数 (topK)',
      'ai.settings.kb.fuse': '融合权重 (fuse)',
      'ai.settings.kb.threshold': '拒答阈值 (threshold)',
      'ai.settings.kb.pinnedWeight': '置顶权重 (pinnedWeight)',
      'ai.settings.kb.saving': '正在保存',
      'ai.settings.kb.saved': '已保存',
      'ai.settings.kb.saveFailed': '保存失败',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

const MOCK_USER = { id: 'u1', username: 'tester', createdAt: '', lastLogin: null };

/** setup.ts 的 window.weaveMD.ai 以 vi.fn 实现；类型层面 cast 为可 mock 形态。 */
type MockFn = ReturnType<typeof vi.fn>;
const aiMock = () => window.weaveMD.ai as unknown as Record<keyof typeof window.weaveMD.ai, MockFn>;

/** M2 收敛后的 IAIConfig：仅 remote 后端，无 ollamaBaseUrl。 */
function loadAiMock(overrides: { hasApiKey?: boolean; remoteBaseUrl?: string } = {}) {
  const ai = aiMock();
  ai.getConfig.mockResolvedValue({
    success: true,
    data: {
      backend: 'remote',
      remoteBaseUrl: overrides.remoteBaseUrl ?? 'https://api.deepseek.com',
      model: 'deepseek-chat',
      hasApiKey: overrides.hasApiKey ?? true,
    },
  });
  ai.getConsent.mockResolvedValue({
    success: true,
    data: { allowNetwork: false, allowSend: false, consentUpdatedAt: null } satisfies IAIConsent,
  });
}

describe('ModelForm (AI 配置，迁自 SettingsModal ai Tab)', () => {
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
        remoteBaseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        hasApiKey: true,
      },
      kbSettings: {
        topK: 5,
        fuse: 0.5,
        threshold: 0.6,
        pinnedWeight: 1.5,
      },
      kbSettingsSaveState: 'idle',
    });
    const ai = aiMock();
    ai.setConfig.mockResolvedValue({
      success: true,
      data: {
        backend: 'remote',
        remoteBaseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        hasApiKey: false,
      },
    });
    ai.setConsent.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it('加载 config 与 consent 并渲染表单字段（无 Ollama/Embedding 控件）', async () => {
    loadAiMock();
    render(<ModelForm />);
    await waitFor(() => {
      expect(aiMock().getConfig).toHaveBeenCalledWith(MOCK_USER.id);
      expect(aiMock().getConsent).toHaveBeenCalledWith(MOCK_USER.id);
    });
    // 保留：remote 地址 / 模型 / 知识库检索 / 提供商状态区
    expect(screen.getByText('远程 API 地址')).toBeInTheDocument();
    expect(screen.getByText('知识库检索（Agent）')).toBeInTheDocument();
    // 已移除：Ollama 后端选择 / Ollama 地址 / Embedding 地址与模型
    expect(screen.queryByText('Ollama（本地）')).not.toBeInTheDocument();
    expect(screen.queryByText('Ollama 地址')).not.toBeInTheDocument();
    expect(screen.queryByText('Embedding 服务地址')).not.toBeInTheDocument();
    expect(screen.queryByText('Embedding 模型 ID')).not.toBeInTheDocument();
  });

  it('④ 断开连接：mock hasApiKey=true → 点「断开连接」→ setConfig({apiKey:""}) → 状态行变「未配置」', async () => {
    loadAiMock({ hasApiKey: true });
    render(<ModelForm />);
    await waitFor(() => expect(aiMock().getConfig).toHaveBeenCalled());
    // 连接态（hasApiKey=true）：显示「已连接」+ 断开按钮（文案含 host，用 substring 匹配）
    expect(screen.getByText(/已连接：远程 API/)).toBeInTheDocument();
    const disconnBtn = screen.getByTestId('provider-disconnect');
    fireEvent.click(disconnBtn);

    await waitFor(() => {
      expect(aiMock().setConfig).toHaveBeenCalledWith(MOCK_USER.id, { apiKey: '' });
      expect(screen.getByText('未配置 API key，AI 不可用')).toBeInTheDocument();
    });
    // 断开后不再有断开按钮与连接状态
    expect(screen.queryByTestId('provider-disconnect')).not.toBeInTheDocument();
    expect(screen.queryByText(/已连接：远程 API/)).not.toBeInTheDocument();
  });

  it('保存：恒调用 setConfig 传 backend:"remote" + setConsent（apiKey 未填不传，避免误清已存 key）', async () => {
    loadAiMock();
    render(<ModelForm />);
    await waitFor(() => expect(aiMock().getConfig).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText('允许联网'));

    const setKbSettings = vi.spyOn(useAgentStore.getState(), 'setKbSettings').mockResolvedValue(undefined);

    fireEvent.click(screen.getByText('保存'));

    const ai = aiMock();
    await waitFor(() => {
      expect(ai.setConfig).toHaveBeenCalled();
      expect(ai.setConsent).toHaveBeenCalled();
    });

    const cfgArg = ai.setConfig.mock.calls[0][1] as {
      backend?: string;
      apiKey?: string;
    };
    expect(cfgArg.backend).toBe('remote');
    // apiKey 未填时不主动传 key（保存不清已存 key，断开由显式按钮触发）
    expect(cfgArg.apiKey).toBeUndefined();

    const consentArg = ai.setConsent.mock.calls[0][1] as {
      allowNetwork: boolean;
      allowSend: boolean;
      consentUpdatedAt: string;
    };
    expect(consentArg.allowNetwork).toBe(true);
    expect(consentArg.allowSend).toBe(false);
    expect(typeof consentArg.consentUpdatedAt).toBe('string');

    // KB 参数同步写回 agentStore.kbSettings（setKbSettings）
    await waitFor(() => expect(setKbSettings).toHaveBeenCalled());
  });
});

// ============================================
// WeaveMD — ModelForm 测试（M3：自 SettingsModal ai Tab 迁入）
// 覆盖：加载 config/consent；保存后端为 remote 时调用 setConfig/setConsent。
// 不落明文 key 到渲染进程（load 只读 hasApiKey 布尔）。等价于原 SettingsModal.ai.test.tsx 断言。
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
      'ai.settings.backend.ollama': 'Ollama（本地）',
      'ai.settings.backend.remote': '远程 API',
      'ai.settings.allowNetwork': '允许联网',
      'ai.settings.allowSend': '允许将笔记发送给 AI',
      'settings.save': '保存',
      'ai.settings.kb.title': '知识库检索（Agent）',
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

function loadAiMock() {
  const ai = aiMock();
  ai.getConfig.mockResolvedValue({
    success: true,
    data: {
      backend: 'ollama',
      ollamaBaseUrl: 'http://localhost:11434',
      remoteBaseUrl: 'https://api.deepseek.com',
      model: 'qwen2.5',
      hasApiKey: true,
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
      kbSettings: {
        topK: 5,
        fuse: 0.5,
        threshold: 0.6,
        pinnedWeight: 1.5,
        embeddingHost: 'http://localhost:11434',
        embeddingModel: 'nomic-embed-text',
      },
      kbSettingsSaveState: 'idle',
    });
    const ai = aiMock();
    ai.setConfig.mockResolvedValue({ success: true, data: {} });
    ai.setConsent.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it('加载 config 与 consent 并渲染表单字段', async () => {
    loadAiMock();
    render(<ModelForm />);
    await waitFor(() => {
      expect(aiMock().getConfig).toHaveBeenCalledWith(MOCK_USER.id);
      expect(aiMock().getConsent).toHaveBeenCalledWith(MOCK_USER.id);
    });
    // 后端 radio 已渲染（含 remote 项）
    expect(screen.getByText('Ollama（本地）')).toBeInTheDocument();
    expect(screen.getByText('远程 API')).toBeInTheDocument();
    expect(screen.getByText('知识库检索（Agent）')).toBeInTheDocument();
  });

  it('保存：切到 remote 后端，调用 setConfig 传 remote + setConsent 传完整 consent（不落明文 key）', async () => {
    loadAiMock();
    render(<ModelForm />);
    await waitFor(() => expect(aiMock().getConfig).toHaveBeenCalled());

    // 选择 remote 后端并勾选「允许联网」
    fireEvent.click(screen.getByText('远程 API'));
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
    // apiKey 未填时不传 key（不落明文）
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

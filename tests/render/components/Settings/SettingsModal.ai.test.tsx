// ============================================
// WeaveMD — SettingsModal 'ai' 分支测试（TDD strict）
// 覆盖：切到 AI tab 后加载 config/consent；保存后端为 remote 时调用 setConfig/setConsent。
// 不落明文 key 到渲染进程（ai.load 只读 hasApiKey 布尔）。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IAIConsent } from '@shared/ai';
import SettingsModal from '@render/components/Settings/SettingsModal';
import { useAuthStore } from '@render/stores/authStore';
import { useUIStore } from '@render/stores/uiStore';

vi.mock('@render/i18n', () => ({
  useI18n: () => ({ t: (key: string) => `[${key}]`, language: 'zh-CN' }),
}));

vi.mock('@render/components/Common/Modal', () => ({
  default: ({ children, footer }: { children?: React.ReactNode; footer?: React.ReactNode }) => (
    <div data-testid="mock-modal">
      {children}
      {footer}
    </div>
  ),
}));

vi.mock('@render/components/Common/Button', () => ({
  default: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

const MOCK_USER = { id: 'u1', username: 'tester', createdAt: '', lastLogin: null };
const onClose = vi.fn();

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

describe('SettingsModal ai branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: MOCK_USER,
      token: 'tok',
      isAuthenticated: true,
      recentAccounts: [],
    });
    useUIStore.setState({
      theme: 'light-header',
      language: 'zh-CN',
      activeModal: null,
    });
    const ai = aiMock();
    ai.setConfig.mockResolvedValue({ success: true });
    ai.setConsent.mockResolvedValue({ success: true });
    // handleSave 还会写系统 settings，需返回 Promise 才可 .catch
    (window as unknown as { weaveMD: { settings: { update: MockFn } } }).weaveMD.settings.update.mockResolvedValue(
      { success: true }
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('切到 AI tab 时加载 config 与 consent 并渲染表单', async () => {
    loadAiMock();
    render(<SettingsModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByText('[ai.settings.title]'));

    await waitFor(() => {
      expect(aiMock().getConfig).toHaveBeenCalledWith(MOCK_USER.id);
      expect(aiMock().getConsent).toHaveBeenCalledWith(MOCK_USER.id);
    });
    expect(screen.getByText('[ai.settings.backend.ollama]')).toBeInTheDocument();
    expect(screen.getByText('[ai.settings.backend.remote]')).toBeInTheDocument();
  });

  it('AI tab 保存：切到 remote 后端，调用 setConfig 传 remote + setConsent 传完整 consent', async () => {
    loadAiMock();
    render(<SettingsModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByText('[ai.settings.title]'));
    await waitFor(() => expect(aiMock().getConfig).toHaveBeenCalled());

    // 选择 remote 后端并勾选联网
    fireEvent.click(screen.getByText('[ai.settings.backend.remote]'));
    fireEvent.click(screen.getByLabelText('[ai.settings.allowNetwork]'));

    fireEvent.click(screen.getByText('[settings.save]'));

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
  });
});

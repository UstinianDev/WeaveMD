// ============================================
// WeaveMD — LoginPage 四小人物驱动测试（focus/error/onPasswordVisibleChange）
// ============================================

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@render/components/Auth/LoginPage';

vi.mock('@render/i18n', () => {
  const t = (key: string, fallback?: string) => (fallback ? `${key}:${fallback}` : `key:${key}`);
  return {
    useI18n: () => ({ t, language: 'zh-CN', setLanguage: vi.fn() }),
    I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock('@render/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      login: vi.fn(),
      recentAccounts: [],
      loadRecentAccounts: vi.fn().mockResolvedValue([]),
    }),
}));

vi.mock('@render/utils/crypto', () => ({
  getRememberedCredentials: vi.fn(() => null),
  saveRememberedCredentials: vi.fn(),
  clearRememberedCredentials: vi.fn(),
}));

function renderLogin(overrides: {
  onMascotStateChange?: (s: string) => void;
  onPasswordVisibleChange?: (v: boolean) => void;
}) {
  const props = {
    onSwitchToRegister: vi.fn(),
    onCreateNewAccount: vi.fn(),
    onMascotStateChange: overrides.onMascotStateChange ?? vi.fn(),
    onPasswordVisibleChange: overrides.onPasswordVisibleChange ?? vi.fn(),
  };
  return render(<LoginPage {...props} />);
}

describe('LoginPage — 四小人物 mascot 状态驱动', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('邮箱 focus → onMascotStateChange(focus-username)', () => {
    const onMascot = vi.fn();
    renderLogin({ onMascotStateChange: onMascot });
    const usernameInput = screen.getByPlaceholderText('key:auth.enterUsername');
    fireEvent.focus(usernameInput);
    expect(onMascot).toHaveBeenCalledWith('focus-username');
  });

  it('空用户名提交 → onMascotStateChange(error)', () => {
    const onMascot = vi.fn();
    renderLogin({ onMascotStateChange: onMascot });
    fireEvent.click(screen.getByRole('button', { name: 'key:auth.login' }));
    expect(onMascot).toHaveBeenCalledWith('error');
  });

  it('输入密码 focus → focus-password', () => {
    const onMascot = vi.fn();
    renderLogin({ onMascotStateChange: onMascot });
    const pw = screen.getByPlaceholderText('key:auth.enterPassword');
    fireEvent.focus(pw);
    expect(onMascot).toHaveBeenCalledWith('focus-password');
  });

  it('onPasswordVisibleChange 透传给密码框 onVisibilityToggle（显示→true）', () => {
    const onVisible = vi.fn();
    renderLogin({ onPasswordVisibleChange: onVisible });
    // 定位密码框的眼睛 toggle：密码 input 向上找含 button 的容器
    const pwInput = document.querySelector('input[type="password"]')!;
    const toggle = pwInput.closest('div')!.querySelector('button[type="button"]')!;
    fireEvent.click(toggle);
    expect(onVisible).toHaveBeenCalledWith(true);
  });

  it('填写合法用户名+密码 + remember → login 成功 → success', async () => {
    window.weaveMD.auth.login = vi.fn().mockResolvedValue({
      success: true,
      data: { token: 't', user: { id: 1, username: 'bob' } },
    });
    const onMascot = vi.fn();
    renderLogin({ onMascotStateChange: onMascot });

    fireEvent.change(screen.getByPlaceholderText('key:auth.enterUsername'), {
      target: { value: 'bob01' },
    });
    fireEvent.change(screen.getByPlaceholderText('key:auth.enterPassword'), {
      target: { value: 'Secret123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'key:auth.login' }));

    await waitFor(() => expect(onMascot).toHaveBeenCalledWith('success'));
  });
});

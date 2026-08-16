// ============================================
// WeaveMD — FeedbackModal 测试（RED → GREEN）
// 覆盖：加载授权码状态(仅 hasAuthCode)；描述必填；多图 pick-images 列表 + 删单个；
// 无授权码发送首拦提示；配置授权码后发送成功/失败 toast；断开连接。
// window.weaveMD.mail 全 mock，不触碰真实 IPC/SMTP。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FeedbackModal from '@render/components/Feedback/FeedbackModal';
import { useAuthStore } from '@render/stores/authStore';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'feedback.title': '问题反馈',
      'feedback.description': '问题描述',
      'feedback.descriptionPlaceholder': '请描述您遇到的问题...',
      'feedback.descriptionRequired': '请填写问题描述',
      'feedback.addImages': '添加图片',
      'feedback.imagesTooMany': '最多 {max} 张图片',
      'feedback.removeImage': '移除',
      'feedback.authCode': 'SMTP 授权码',
      'feedback.authCodePlaceholder': '16 位 QQ 邮箱授权码',
      'feedback.authCodeSet': '已配置（隐藏）',
      'feedback.authCodeRequired': '请先配置授权码',
      'feedback.disconnect': '断开连接',
      'feedback.reconnect': '重新连接',
      'feedback.send': '发送反馈',
      'feedback.sending': '正在发送...',
      'feedback.sendSuccess': '反馈已发送',
      'feedback.sendFailed': '发送失败',
      'feedback.error.authFailed': '授权码错误，请检查 QQ 邮箱授权码',
      'feedback.error.network': '网络连接失败，请检查网络后重试',
      'feedback.error.timeout': '发送超时，请稍后重试',
      'feedback.error.invalidImage': '图片无效或超出大小/数量限制',
      'feedback.error.generic': '发送失败，请稍后重试',
      'feedback.cancel': '取消',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

const MOCK_USER = { id: 'u1', username: 'tester', createdAt: '', lastLogin: null };

type MailApi = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  pickImages: ReturnType<typeof vi.fn>;
};

function mailMock(): MailApi {
  return window.weaveMD.mail as unknown as MailApi;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: MOCK_USER,
    token: 'tok',
    isAuthenticated: true,
    recentAccounts: [],
  });
  const m = mailMock();
  m.get.mockResolvedValue({ success: true, data: { hasAuthCode: false } });
  m.pickImages.mockResolvedValue({ success: true, data: null });
  m.send.mockResolvedValue({ success: true, data: { success: true, messageId: '<id>' } });
  m.set.mockResolvedValue({ success: true, data: { hasAuthCode: true } });
});

afterEach(() => {
  cleanup();
});

function renderModal() {
  render(<FeedbackModal open onClose={() => {}} />);
}

describe('FeedbackModal', () => {
  it('打开时加载授权码状态：mail.get(userId) 且仅拿布尔 hasAuthCode', async () => {
    renderModal();
    await waitFor(() => {
      expect(mailMock().get).toHaveBeenCalledWith(MOCK_USER.id);
    });
    // hasAuthCode=false → 显示授权码输入区（未配置）
    await waitFor(() => {
      expect(screen.getByTestId('feedback-auth-input')).toBeInTheDocument();
    });
    // 渲染层不落明文授权码：无含明文的输入预先填充
    expect(screen.getByTestId('feedback-auth-input')).toHaveValue('');
  });

  it('无授权码时点发送 → 首拦提示，不调用 mail.send', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByLabelText('问题描述')).toBeInTheDocument());
    // 填描述但不配授权码
    fireEvent.change(screen.getByLabelText('问题描述'), { target: { value: '有个 bug' } });
    fireEvent.click(screen.getByRole('button', { name: '发送反馈' }));
    await waitFor(() => {
      expect(screen.getByText('请先配置授权码')).toBeInTheDocument();
    });
    expect(mailMock().send).not.toHaveBeenCalled();
  });

  it('描述为空点发送 → 提示必填，不调用 mail.send', async () => {
    mailMock().get.mockResolvedValue({ success: true, data: { hasAuthCode: true } });
    renderModal();
    await waitFor(() => expect(screen.getByLabelText('问题描述')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '发送反馈' }));
    await waitFor(() => {
      expect(screen.getByText('请填写问题描述')).toBeInTheDocument();
    });
    expect(mailMock().send).not.toHaveBeenCalled();
  });

  it('配置授权码后填写描述 → 发送成功 toast（mail.send 携带 body + imagePaths）', async () => {
    mailMock().get.mockResolvedValue({ success: true, data: { hasAuthCode: true } });
    mailMock().send.mockResolvedValue({ success: true, data: { success: true, messageId: '<id>' } });
    renderModal();
    await waitFor(() => expect(screen.getByLabelText('问题描述')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('问题描述'), { target: { value: '崩溃了' } });
    fireEvent.click(screen.getByRole('button', { name: '发送反馈' }));
    await waitFor(() => {
      expect(mailMock().send).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: MOCK_USER.id,
          body: '崩溃了',
          imagePaths: [],
        })
      );
      expect(screen.getByText('反馈已发送')).toBeInTheDocument();
    });
  });

  it('发送失败（授权码错误）→ 分类文案 toast，不泄露原始 SMTP 细节', async () => {
    mailMock().get.mockResolvedValue({ success: true, data: { hasAuthCode: true } });
    mailMock().send.mockResolvedValue({
      success: true,
      data: { success: false, error: { code: 'auth_failed', message: '535 Authentication failed' } },
    });
    renderModal();
    await waitFor(() => expect(screen.getByLabelText('问题描述')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('问题描述'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '发送反馈' }));
    await waitFor(() => {
      // auth_failed → 专属分类文案（需求⑤：授权码错误明确提示）
      expect(screen.getByText('授权码错误，请检查 QQ 邮箱授权码')).toBeInTheDocument();
    });
    // 原始 SMTP 错误细节不外透到渲染：服务层返回的原始 error.message 不出现
    expect(screen.queryByText('535 Authentication failed')).not.toBeInTheDocument();
  });

  it('多图选择：pickImages 追加路径列表，渲染 media:// 缩略图并支持删除单个', async () => {
    mailMock().pickImages.mockResolvedValue({ success: true, data: ['C:/a.png', 'C:/b.png'] });
    renderModal();
    await waitFor(() => expect(screen.getByLabelText('问题描述')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '添加图片' }));
    await waitFor(() => {
      expect(mailMock().pickImages).toHaveBeenCalled();
    });
    // 两张缩略图
    expect(screen.getAllByTestId('feedback-img-thumb')).toHaveLength(2);
    // 删除其中一张
    const removeBtns = screen.getAllByRole('button', { name: '移除' });
    fireEvent.click(removeBtns[0]);
    await waitFor(() => {
      expect(screen.getAllByTestId('feedback-img-thumb')).toHaveLength(1);
    });
  });

  it('断开连接：渲染 mail.set({authCode:""}) → hasAuthCode=false → 显示授权码输入', async () => {
    mailMock().get.mockResolvedValue({ success: true, data: { hasAuthCode: true } });
    mailMock().set.mockResolvedValue({ success: true, data: { hasAuthCode: false } });
    renderModal();
    await waitFor(() => expect(screen.getByText('已配置（隐藏）')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }));
    await waitFor(() => {
      expect(mailMock().set).toHaveBeenCalledWith({ userId: MOCK_USER.id, authCode: '' });
      // 断开后回到未配置：显示授权码输入
      expect(screen.getByTestId('feedback-auth-input')).toBeInTheDocument();
    });
  });
});

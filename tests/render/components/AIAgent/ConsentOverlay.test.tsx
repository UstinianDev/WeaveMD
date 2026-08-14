// ============================================
// WeaveMD — ConsentOverlay 测试（TDD strict）
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ConsentOverlay from '@render/components/AIAgent/ConsentOverlay';

// Mock i18n for key-based label resolution
vi.mock('@render/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => `[${key}]`,
    language: 'zh-CN',
  }),
}));

describe('ConsentOverlay', () => {
  const onRemember = vi.fn();
  const onDeny = vi.fn();

  beforeEach(() => {
    onRemember.mockReset();
    onDeny.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('不可见时不渲染内容（惰性）', () => {
    const { container } = render(
      <ConsentOverlay visible={false} onRemember={onRemember} onDeny={onDeny} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('可见时渲染标题与两个勾选', () => {
    render(<ConsentOverlay visible onRemember={onRemember} onDeny={onDeny} />);
    expect(screen.getByText('[ai.consent.title]')).toBeInTheDocument();
    expect(screen.getByLabelText('[ai.consent.allowNetwork]')).toBeInTheDocument();
    expect(screen.getByLabelText('[ai.consent.allowSend]')).toBeInTheDocument();
    expect(screen.getByText('[ai.consent.remember]')).toBeInTheDocument();
    expect(screen.getByText('[ai.consent.deny]')).toBeInTheDocument();
    // 防穿透回归：父容器 pointer-events-none，此遮罩必须可交互（pointer-events-auto）
    expect(screen.getByText('[ai.consent.title]').closest('.pointer-events-auto')).not.toBeNull();
  });

  it('点击「同意并记住」将勾选状态传给 onRemember', () => {
    render(<ConsentOverlay visible onRemember={onRemember} onDeny={onDeny} />);

    // 勾选两个选项
    fireEvent.click(screen.getByLabelText('[ai.consent.allowNetwork]'));
    fireEvent.click(screen.getByLabelText('[ai.consent.allowSend]'));

    fireEvent.click(screen.getByText('[ai.consent.remember]'));

    expect(onRemember).toHaveBeenCalledTimes(1);
    expect(onRemember).toHaveBeenCalledWith({ allowNetwork: true, allowSend: true });
  });

  it('点击拒绝回调 onDeny', () => {
    render(<ConsentOverlay visible onRemember={onRemember} onDeny={onDeny} />);
    fireEvent.click(screen.getByText('[ai.consent.deny]'));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });
});

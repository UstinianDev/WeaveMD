// ============================================
// WeaveMD — InsertUrlModal 单测
// 覆盖：open 渲染/关闭、确定/取消、空 URL 校验、
// Escape 关闭、showPickImage 本地选图回填
// ============================================
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import InsertUrlModal from '@render/components/Editor/v2/InsertUrlModal';

interface Props {
  title: string;
  open: boolean;
  showPickImage?: boolean;
  onConfirm: (url: string) => void;
  onCancel: () => void;
  pickImage?: () => Promise<string | null>;
}

function setup(overrides: Partial<Props> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const props: Props = {
    title: '插入链接',
    open: true,
    onConfirm,
    onCancel,
    ...overrides,
  };
  const utils = render(<InsertUrlModal {...props} />);
  return { props, onConfirm, onCancel, ...utils };
}

describe('InsertUrlModal — 渲染', () => {
  it('open=false → 返回 null，不渲染任何内容', () => {
    const { container } = setup({ open: false });
    expect(container.querySelector('.insert-url-modal-overlay')).toBeNull();
    expect(container.querySelector('.insert-url-modal')).toBeNull();
  });

  it('open=true → 渲染标题/输入框/确定/取消按钮', () => {
    setup({ title: '插入图片' });
    expect(screen.getByText('插入图片')).not.toBeNull();
    expect(screen.getByRole('textbox')).not.toBeNull();
    expect(screen.getByRole('button', { name: '确定' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '取消' })).not.toBeNull();
  });

  it('open=true → 卡片含三色窗口控件 dot（红黄绿）', () => {
    const { container } = setup();
    const dots = container.querySelectorAll('.insert-url-modal-dot');
    expect(dots.length).toBe(3);
  });

  it('open=true → 输入框自动聚焦', () => {
    setup();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });
});

describe('InsertUrlModal — 确定/取消', () => {
  it('输入 URL 后点确定 → onConfirm(trim 后 url)', () => {
    const { onConfirm } = setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  https://example.com/img.png  ' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('https://example.com/img.png');
  });

  it('空 URL 点确定 → onConfirm 不被调用，输入框聚焦并提示', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/URL 不能为空/)).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('全空白 URL 点确定 → 视为空，onConfirm 不被调用', () => {
    const { onConfirm } = setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('点取消 → onCancel', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('点 X 关闭按钮 → onCancel', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape 键 → onCancel', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('非 Escape 键 → onCancel 不被调用', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  // ============================================================
  // R5：输入框内回车直接提交，不丢选中内容。
  // 期待：onConfirm(trim url)、事件 defaultPrevented、不发 onCancel，
  // 且默认行为（触发编辑层 selectionchange 竞态）被阻止。
  // fireEvent 返回 false 当且仅当事件 defaultPrevented === true。
  // ============================================================
  it('R5: 输入 URL 后回车 → onConfirm 被调一次(trim 后 url)，事件被阻止，onCancel 不被调', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  https://example.com  ' } });
    // 捕获实际 KeyboardEvent，直接断言其 defaultPrevented 状态
    const captured: { ev: KeyboardEvent | null } = { ev: null };
    const input = screen.getByRole('textbox') as HTMLElement;
    const spy = (e: KeyboardEvent) => {
      captured.ev = e;
    };
    input.addEventListener('keydown', spy);
    const prevented = fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    // (b) 事件已 defaultPrevented（锁定 preventDefault 修复）
    expect(prevented).toBe(false);
    expect(captured.ev?.defaultPrevented).toBe(true);
    // (a) onConfirm 命中同一 handleConfirm 路径，trim url
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('https://example.com');
    // (c) 未取消
    expect(onCancel).not.toHaveBeenCalled();
    input.removeEventListener('keydown', spy);
  });

  it('R5: 空 URL 回车 → onConfirm 不被调，onCancel 不被调，输入框聚焦并提示（G3 保持）', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText(/URL 不能为空/)).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });
});

describe('InsertUrlModal — showPickImage 本地选图', () => {
  it('showPickImage=true → 渲染「选择文件」按钮；点击调用 pickImage 并回填 input', async () => {
    const pickImage = vi.fn().mockResolvedValue('C:/pics/demo.png');
    setup({ title: '插入图片', showPickImage: true, pickImage });
    const btn = screen.getByRole('button', { name: '选择文件' });
    expect(btn).not.toBeNull();
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(pickImage).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('C:/pics/demo.png');
  });

  it('pickImage 返回 null（取消文件对话框）→ 不回填不崩溃', async () => {
    const pickImage = vi.fn().mockResolvedValue(null);
    setup({ title: '插入图片', showPickImage: true, pickImage });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    });
    expect(pickImage).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });

  it('showPickImage=false → 不渲染「选择文件」按钮', () => {
    setup();
    expect(screen.queryByRole('button', { name: '选择文件' })).toBeNull();
  });

  it('pickImage 未提供但 showPickImage=true → 点击不崩溃', async () => {
    setup({ title: '插入图片', showPickImage: true });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });
});

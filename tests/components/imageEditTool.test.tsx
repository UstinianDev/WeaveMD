// ============================================
// WeaveMD — ImageEditTool 单测
// 覆盖：双 Tab 切换 / 本地选图（resolve 路径、取消、无实现兜底）/
// link Tab（autoFocus 全选、空 src 校验与 Enter 提交、Escape、
// open=false 渲染 null）/ 定位与事件传播防冒泡 / 重开重置状态
// ============================================
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImageEditTool, {
  type ImageEditToolProps,
} from '@render/components/Editor/v2/ImageEditTool';

function setup(overrides: Partial<ImageEditToolProps> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const props: ImageEditToolProps = {
    open: true,
    position: { top: 120, left: 80 },
    onConfirm,
    onCancel,
    ...overrides,
  };
  const utils = render(<ImageEditTool {...props} />);
  return { props, onConfirm, onCancel, ...utils };
}

function getSrcInput(): HTMLInputElement {
  return screen.getByPlaceholderText('输入图片 URL') as HTMLInputElement;
}

function getAltInput(): HTMLInputElement {
  return screen.getByPlaceholderText('可选描述 (alt)') as HTMLInputElement;
}

function getTitleInput(): HTMLInputElement {
  return screen.getByPlaceholderText('可选标题 (title)') as HTMLInputElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ImageEditTool — 渲染与双 Tab 切换', () => {
  it('open=false → 渲染 null', () => {
    const { container } = setup({ open: false });
    expect(container.querySelector('[data-testid="image-edit-tool"]')).toBeNull();
  });

  it('默认 link Tab：渲染双 Tab 头部 + src/alt/title 输入 + 「嵌入」按钮', () => {
    setup();
    expect(screen.getByRole('button', { name: '嵌入链接' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '本地选择' })).not.toBeNull();
    expect(getSrcInput()).not.toBeNull();
    expect(getAltInput()).not.toBeNull();
    expect(getTitleInput()).not.toBeNull();
    expect(screen.getByRole('button', { name: '嵌入' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '选择图片' })).toBeNull();
  });

  it('点击「本地选择」→ 显示「选择图片」，src 输入隐藏；切回 link 恢复', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '本地选择' }));
    expect(screen.getByRole('button', { name: '选择图片' })).not.toBeNull();
    expect(screen.queryByPlaceholderText('输入图片 URL')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '嵌入链接' }));
    expect(getSrcInput()).not.toBeNull();
  });

  it('alt 输入初值为 initialAlt', () => {
    setup({ initialAlt: '截图描述' });
    expect(getAltInput().value).toBe('截图描述');
  });

  // K5：「修改图片」模式——initialSrc/initialTitle 与 initialAlt 一并预填
  it('initialSrc / initialTitle / initialAlt 一并预填三个输入框', () => {
    setup({ initialSrc: 'C:/pics/a.png', initialAlt: '截图', initialTitle: '标题' });
    expect(getSrcInput().value).toBe('C:/pics/a.png');
    expect(getAltInput().value).toBe('截图');
    expect(getTitleInput().value).toBe('标题');
  });

  it('标题为「修改图片」', () => {
    setup();
    expect(screen.getByText('修改图片')).not.toBeNull();
  });

  it('fixed 定位使用 position.top/left', () => {
    const { container } = setup({ position: { top: 123, left: 456 } });
    const root = container.querySelector('[data-testid="image-edit-tool"]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.style.position).toBe('fixed');
    expect(root.style.top).toBe('123px');
    expect(root.style.left).toBe('456px');
  });
});

describe('ImageEditTool — 事件传播', () => {
  it('点击弹层内部不冒泡到 document；弹层 mousedown preventDefault', () => {
    const clickSpy = vi.fn();
    document.addEventListener('click', clickSpy);
    const { container } = setup();
    const root = container.querySelector('[data-testid="image-edit-tool"]') as HTMLElement;
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    root.dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true);
    fireEvent.click(root);
    expect(clickSpy).not.toHaveBeenCalled();
    document.removeEventListener('click', clickSpy);
  });
});

describe('ImageEditTool — link Tab 提交/校验/Escape', () => {
  it('打开时 src 输入框 autoFocus 并全选（setSelectionRange）', () => {
    const selSpy = vi.spyOn(HTMLInputElement.prototype, 'setSelectionRange');
    setup();
    expect(selSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(getSrcInput());
  });

  it('空 src 按 Enter → 显示「URL 不能为空」且不调 onConfirm', () => {
    const { onConfirm } = setup();
    fireEvent.keyDown(getSrcInput(), { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/URL 不能为空/)).not.toBeNull();
  });

  it('全空白 src 按 Enter → 视为空，不调 onConfirm', () => {
    const { onConfirm } = setup();
    fireEvent.change(getSrcInput(), { target: { value: '   ' } });
    fireEvent.keyDown(getSrcInput(), { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/URL 不能为空/)).not.toBeNull();
  });

  it('非空 src 按 Enter → onConfirm({src, alt, title})（all-mode），提交传 trim 后 src', () => {
    const { onConfirm } = setup({ initialAlt: '图' });
    fireEvent.change(getSrcInput(), { target: { value: '  https://example.com/a.png  ' } });
    fireEvent.change(getAltInput(), { target: { value: '我的图' } });
    fireEvent.change(getTitleInput(), { target: { value: '标题' } });
    fireEvent.keyDown(getSrcInput(), { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      src: 'https://example.com/a.png',
      alt: '我的图',
      title: '标题',
    });
  });

  it('空 src 点「嵌入」→ 提示错误且不提交', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole('button', { name: '嵌入' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/URL 不能为空/)).not.toBeNull();
  });

  it('输入有效 src 点「嵌入」→ onConfirm 提交', () => {
    const { onConfirm } = setup({ initialAlt: '图' });
    fireEvent.change(getSrcInput(), { target: { value: 'https://x.io/i.png' } });
    fireEvent.change(getTitleInput(), { target: { value: 't' } });
    fireEvent.click(screen.getByRole('button', { name: '嵌入' }));
    expect(onConfirm).toHaveBeenCalledWith({ src: 'https://x.io/i.png', alt: '图', title: 't' });
  });

  // K5：未改动字段原样返回（预填值直接进确认回调）
  it('预填后不修改直接「嵌入」→ onConfirm 携带预填值原样返回', () => {
    const { onConfirm } = setup({
      initialSrc: 'C:/pics/a.png',
      initialAlt: '截图',
      initialTitle: '标题',
    });
    fireEvent.click(screen.getByRole('button', { name: '嵌入' }));
    expect(onConfirm).toHaveBeenCalledWith({
      src: 'C:/pics/a.png',
      alt: '截图',
      title: '标题',
    });
  });

  it('Escape → onCancel；点取消按钮 → onCancel；点 × → onCancel', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it('从关闭重新打开 → 重置输入与错误，alt 回到 initialAlt', () => {
    const { props, rerender } = setup({ initialAlt: 'desc' });
    fireEvent.keyDown(getSrcInput(), { key: 'Enter' });
    expect(screen.getByText(/URL 不能为空/)).not.toBeNull();

    rerender(<ImageEditTool {...props} open={false} />);
    expect(screen.queryByTestId('image-edit-tool')).toBeNull();

    rerender(<ImageEditTool {...props} open={true} />);
    expect(screen.queryByText(/URL 不能为空/)).toBeNull();
    expect(getSrcInput().value).toBe('');
    expect(getAltInput().value).toBe('desc');
  });
});

describe('ImageEditTool — select Tab 本地选择', () => {
  async function pick(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '选择图片' }));
    });
  }

  it('pickImage resolve 路径 → 直接 onConfirm({src, alt: initialAlt, title: ""})', async () => {
    const pickImage = vi.fn().mockResolvedValue('C:/pics/demo.png');
    const { onConfirm } = setup({ pickImage, initialAlt: 'alt' });
    fireEvent.click(screen.getByRole('button', { name: '本地选择' }));
    await pick();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      src: 'C:/pics/demo.png',
      alt: 'alt',
      title: '',
    });
  });

  // K5：select Tab 本地选择直接应用——预填的 alt/title 原样保留（src 替换为所选路径）
  it('pickImage resolve 路径 → 预填 alt/title 保留（title 取 initialTitle）', async () => {
    const pickImage = vi.fn().mockResolvedValue('C:/pics/new.png');
    const { onConfirm } = setup({ pickImage, initialAlt: '截图', initialTitle: '标题' });
    fireEvent.click(screen.getByRole('button', { name: '本地选择' }));
    await pick();
    expect(onConfirm).toHaveBeenCalledWith({
      src: 'C:/pics/new.png',
      alt: '截图',
      title: '标题',
    });
  });

  it('pickImage resolve null（用户取消文件对话框）→ 不调 onConfirm，保持弹层打开', async () => {
    const pickImage = vi.fn().mockResolvedValue(null);
    const { onConfirm } = setup({ pickImage });
    fireEvent.click(screen.getByRole('button', { name: '本地选择' }));
    await pick();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '选择图片' })).not.toBeNull();
  });

  it('未提供 pickImage → 点击不抛错，不调 onConfirm', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole('button', { name: '本地选择' }));
    await pick();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
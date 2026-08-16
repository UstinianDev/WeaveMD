// ============================================
// WeaveMD — Input onVisibilityToggle 回调测试
// ============================================

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Input from '@render/components/Common/Input';

describe('Input — onVisibilityToggle（显示密码偷看驱动）', () => {
  it('点击显示密码 toggle 触发 onVisibilityToggle(true)', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Input label="Password" type="password" value="secret" onChange={() => {}} showPasswordToggle onVisibilityToggle={onToggle} />
    );
    const toggleBtn = container.querySelector('button[type="button"]');
    expect(toggleBtn).not.toBeNull();
    fireEvent.click(toggleBtn!);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('再次点击收起 → onVisibilityToggle(false)', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Input label="Password" type="password" value="secret" onChange={() => {}} showPasswordToggle onVisibilityToggle={onToggle} />
    );
    const toggleBtn = container.querySelector('button[type="button"]')!;
    fireEvent.click(toggleBtn); // 显示
    fireEvent.click(toggleBtn); // 收起
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it('onVisibilityToggle 未传时不抛错（向后兼容）', () => {
    const { container } = render(
      <Input label="Password" type="password" value="secret" onChange={() => {}} showPasswordToggle />
    );
    const toggleBtn = container.querySelector('button[type="button"]')!;
    expect(() => fireEvent.click(toggleBtn)).not.toThrow();
  });
});

// ============================================
// WeaveMD — copyPath 工具测试（agent-kb-ux R4）
// ============================================
// 覆盖：绝对/相对/空路径判定、clipboard 缺失、writeText reject → failed、成功 → copied。

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyPathToClipboard, isAbsolutePath } from '@render/utils/copyPath';

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  setClipboard(undefined);
});

describe('copyPath.isAbsolutePath', () => {
  it('正斜杠根路径 → true', () => {
    expect(isAbsolutePath('/disk/a.md')).toBe(true);
  });

  it('Windows 盘符路径 → true', () => {
    expect(isAbsolutePath('C:\\disk\\a.md')).toBe(true);
    expect(isAbsolutePath('D:/disk/a.md')).toBe(true);
  });

  it('UNC 路径 → true', () => {
    expect(isAbsolutePath('\\\\server\\share\\a.md')).toBe(true);
  });

  it('相对路径 / 空串 → false', () => {
    expect(isAbsolutePath('disk/a.md')).toBe(false);
    expect(isAbsolutePath('')).toBe(false);
  });
});

describe('copyPath.copyPathToClipboard', () => {
  it('绝对路径 + writeText 成功 → copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyPathToClipboard('/disk/a.md')).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('/disk/a.md');
  });

  it('相对路径 → failed（不调用 writeText）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyPathToClipboard('relative/a.md')).resolves.toBe('failed');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('空路径 → failed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyPathToClipboard('')).resolves.toBe('failed');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('navigator.clipboard 缺失 → failed', async () => {
    setClipboard(undefined);
    await expect(copyPathToClipboard('/disk/a.md')).resolves.toBe('failed');
  });

  it('writeText reject → failed（不静默抛出）', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    setClipboard({ writeText });
    await expect(copyPathToClipboard('/disk/a.md')).resolves.toBe('failed');
  });
});

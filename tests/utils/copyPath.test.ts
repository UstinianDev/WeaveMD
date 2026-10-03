// ============================================
// WeaveMD — copyPath 工具测试（agent-kb-ux R4 + 热修：主进程剪贴板桥）
// ============================================
// 覆盖：绝对/相对/空路径判定、主进程桥（clipboard.writeText）优先与回落、
// navigator 兜底缺失/reject → failed、成功 → copied。

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyPathToClipboard, isAbsolutePath } from '@render/utils/copyPath';

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

/** 注入 window.weaveMD.clipboard.writeText（主进程桥）；undefined = 桥缺失。 */
function setBridgeWriteText(value: unknown): void {
  const w = window as unknown as { weaveMD?: { clipboard?: { writeText?: unknown } } };
  w.weaveMD = w.weaveMD ?? {};
  w.weaveMD.clipboard = { writeText: value };
}

/** 桥缺失：删除 clipboard 键（还原 setup.ts 的默认 mock 形态）。 */
function clearBridge(): void {
  const w = window as unknown as { weaveMD?: { clipboard?: { writeText?: unknown } } };
  if (w.weaveMD) delete w.weaveMD.clipboard;
}

afterEach(() => {
  vi.restoreAllMocks();
  setClipboard(undefined);
  clearBridge();
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

  it('navigator.clipboard 缺失（且桥缺失）→ failed', async () => {
    clearBridge();
    setClipboard(undefined);
    await expect(copyPathToClipboard('/disk/a.md')).resolves.toBe('failed');
  });

  it('writeText reject（且桥缺失）→ failed（不静默抛出）', async () => {
    clearBridge();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    setClipboard({ writeText });
    await expect(copyPathToClipboard('/disk/a.md')).resolves.toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// 热修（2026-10-03）：复制文件地址走主进程剪贴板桥
// 根因：打包 Electron 的 navigator.clipboard 非安全上下文恒 reject → 恒 'failed'
// ---------------------------------------------------------------------------
describe('copyPath 主进程剪贴板桥（clipboard:write-text）', () => {
  it('桥 writeText 成功 → copied（navigator 不被调用）', async () => {
    const bridgeWrite = vi.fn().mockResolvedValue(true);
    setBridgeWriteText(bridgeWrite);
    const navigatorWrite = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText: navigatorWrite });

    await expect(copyPathToClipboard('/disk/a.md')).resolves.toBe('copied');
    expect(bridgeWrite).toHaveBeenCalledWith('/disk/a.md');
    expect(navigatorWrite).not.toHaveBeenCalled();
  });

  it('桥返回 false → 回落 navigator 成功 → copied（回落被尝试）', async () => {
    const bridgeWrite = vi.fn().mockResolvedValue(false);
    setBridgeWriteText(bridgeWrite);
    const navigatorWrite = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText: navigatorWrite });

    await expect(copyPathToClipboard('/disk/a.md')).resolves.toBe('copied');
    expect(bridgeWrite).toHaveBeenCalledWith('/disk/a.md');
    expect(navigatorWrite).toHaveBeenCalledWith('/disk/a.md');
  });

  it('桥返回 false 且 navigator 也失败 → failed（两端均被尝试，不静默）', async () => {
    const bridgeWrite = vi.fn().mockResolvedValue(false);
    setBridgeWriteText(bridgeWrite);
    const navigatorWrite = vi.fn().mockRejectedValue(new Error('insecure context'));
    setClipboard({ writeText: navigatorWrite });

    await expect(copyPathToClipboard('/disk/a.md')).resolves.toBe('failed');
    expect(bridgeWrite).toHaveBeenCalledWith('/disk/a.md');
    expect(navigatorWrite).toHaveBeenCalledWith('/disk/a.md');
  });

  it('桥抛错 → 回落 navigator 成功 → copied', async () => {
    const bridgeWrite = vi.fn().mockRejectedValue(new Error('ipc down'));
    setBridgeWriteText(bridgeWrite);
    const navigatorWrite = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText: navigatorWrite });

    await expect(copyPathToClipboard('/disk/a.md')).resolves.toBe('copied');
    expect(navigatorWrite).toHaveBeenCalledWith('/disk/a.md');
  });

  it('桥缺失 + navigator 成功 → copied（回落路径）', async () => {
    clearBridge();
    const navigatorWrite = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText: navigatorWrite });

    await expect(copyPathToClipboard('C:\\disk\\a.md')).resolves.toBe('copied');
    expect(navigatorWrite).toHaveBeenCalledWith('C:\\disk\\a.md');
  });

  it('桥抛错且 navigator 缺失 → failed', async () => {
    setBridgeWriteText(vi.fn().mockRejectedValue(new Error('ipc down')));
    setClipboard(undefined);

    await expect(copyPathToClipboard('/disk/a.md')).resolves.toBe('failed');
  });
});

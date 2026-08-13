import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ============================================
// exportService 测试
// - electron mock：dialog.showSaveDialog + BrowserWindow（构造函数返回假隐藏窗口）
// - 用真实 fs + os.tmpdir 写盘并读回验证（魔数/结构），规避 vitest 内建 fs mock 的不可靠
// - docx 用真实 html-to-docx 生成，断言 PK zip 魔数与 word/document.xml 条目
// ============================================

const electronMock = vi.hoisted(() => {
  const showSaveDialog = vi.fn();
  const fromWebContents = vi.fn(() => ({}));
  const hiddenWin = {
    loadFile: vi.fn().mockResolvedValue(undefined),
    setContentSize: vi.fn(),
    destroy: vi.fn(),
    webContents: {
      executeJavaScript: vi.fn(),
      capturePage: vi.fn(),
      printToPDF: vi.fn(),
    },
  };
  const BrowserWindowCtor = vi.fn(() => hiddenWin);
  return { showSaveDialog, fromWebContents, hiddenWin, BrowserWindowCtor };
});

vi.mock('electron', () => ({
  dialog: { showSaveDialog: electronMock.showSaveDialog },
  BrowserWindow: Object.assign(electronMock.BrowserWindowCtor, {
    fromWebContents: electronMock.fromWebContents,
  }),
  app: { getPath: () => ':memory:' },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() },
  shell: {},
}));

import type { BrowserWindow } from 'electron';
import { exportFile } from '@main/export/exportService';
import { EXPORT_IMAGE_WIDTH, EXPORT_MAX_HEIGHT } from '@main/export/types';

/** 测试用假父窗口（electron 已 mock，仅用于满足签名类型） */
const fakeParent = {} as unknown as BrowserWindow;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PDF_MAGIC = Buffer.from('%PDF-1.4\n%test');

let writtenPath: string | null = null;

function uniqueTempPath(ext: string): string {
  const p = path.join(os.tmpdir(), `weavemd-test-export-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  return p;
}

beforeEach(() => {
  electronMock.showSaveDialog.mockReset();
  electronMock.hiddenWin.loadFile.mockResolvedValue(undefined);
  electronMock.hiddenWin.setContentSize.mockReset();
  electronMock.hiddenWin.destroy.mockReset();
  electronMock.hiddenWin.webContents.executeJavaScript.mockReset();
  electronMock.hiddenWin.webContents.capturePage.mockReset();
  electronMock.hiddenWin.webContents.printToPDF.mockReset();
  writtenPath = null;
});

afterEach(() => {
  if (writtenPath) {
    try {
      fs.unlinkSync(writtenPath);
    } catch {
      // 已删除，忽略
    }
  }
});

/** 让 showSaveDialog 落到指定临时路径 */
function stubSaveTo(ext: string): string {
  const p = uniqueTempPath(ext);
  writtenPath = p;
  electronMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath: p });
  return p;
}

const BASE_REQ = {
  content: '# Hello\n\nworld',
  html: '<h1>Hello</h1><p>world</p>',
  filename: 'mydoc',
};

describe('exportFile — 直接写盘格式', () => {
  it('md：写原始 markdown 内容', async () => {
    const p = stubSaveTo('md');
    const result = await exportFile({ ...BASE_REQ, format: 'md' }, fakeParent);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe(BASE_REQ.content);
  });

  it('html：自包含完整文档（DOCTYPE + style + markdown-export + 正文）', async () => {
    const p = stubSaveTo('html');
    const result = await exportFile({ ...BASE_REQ, format: 'html' }, fakeParent);
    expect(result.success).toBe(true);
    const out = fs.readFileSync(p, 'utf-8');
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(out).toContain('<style>');
    expect(out).toContain('markdown-export');
    expect(out).toContain('<h1>Hello</h1>');
  });

  it('doc：Word 兼容 HTML，扩展名 .doc', async () => {
    const p = stubSaveTo('doc');
    const result = await exportFile({ ...BASE_REQ, format: 'doc' }, fakeParent);
    expect(result.success).toBe(true);
    expect(path.extname(p)).toBe('.doc');
    expect(fs.readFileSync(p, 'utf-8').startsWith('<!DOCTYPE html>')).toBe(true);
  });
});

describe('exportFile — docx（真实 html-to-docx）', () => {
  it('生成真实 OOXML：PK 魔数且含 word/document.xml', async () => {
    const p = stubSaveTo('docx');
    const result = await exportFile({ ...BASE_REQ, format: 'docx' }, fakeParent);
    expect(result.success).toBe(true);
    const buf = fs.readFileSync(p);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(buf.includes(Buffer.from('word/document.xml'))).toBe(true);
  });
});

describe('exportFile — 隐藏窗口渲染（pdf/png/jpg）', () => {
  it('pdf：printToPDF 输出以 %PDF 开头，窗口用 A4 逻辑宽', async () => {
    const p = stubSaveTo('pdf');
    electronMock.hiddenWin.webContents.executeJavaScript.mockResolvedValue(800);
    electronMock.hiddenWin.webContents.printToPDF.mockResolvedValue(PDF_MAGIC);

    const result = await exportFile({ ...BASE_REQ, format: 'pdf' }, fakeParent);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(p).subarray(0, 5).toString()).toBe('%PDF-');
    expect(electronMock.hiddenWin.setContentSize).toHaveBeenCalledWith(794, expect.any(Number));
    expect(electronMock.hiddenWin.destroy).toHaveBeenCalled();
  });

  it('png：capturePage → toPNG 输出 PNG 魔数', async () => {
    const p = stubSaveTo('png');
    electronMock.hiddenWin.webContents.executeJavaScript.mockResolvedValue(500);
    electronMock.hiddenWin.webContents.capturePage.mockResolvedValue({
      toPNG: () => PNG_MAGIC,
      toJPEG: () => JPEG_MAGIC,
    });

    const result = await exportFile({ ...BASE_REQ, format: 'png' }, fakeParent);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(p).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('jpg：capturePage → toJPEG(92) 输出 JPEG 魔数', async () => {
    const p = stubSaveTo('jpg');
    electronMock.hiddenWin.webContents.executeJavaScript.mockResolvedValue(300);
    const toJPEG = vi.fn(() => JPEG_MAGIC);
    electronMock.hiddenWin.webContents.capturePage.mockResolvedValue({ toPNG: () => PNG_MAGIC, toJPEG });

    const result = await exportFile({ ...BASE_REQ, format: 'jpg' }, fakeParent);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(p).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(toJPEG).toHaveBeenCalledWith(92);
  });
});

describe('exportFile — 取消与截断', () => {
  it('用户取消保存对话框 → error:"cancelled"，不写盘', async () => {
    electronMock.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    const result = await exportFile({ ...BASE_REQ, format: 'md' }, fakeParent);
    expect(result).toEqual({ success: false, error: 'cancelled' });
    expect(electronMock.hiddenWin.destroy).not.toHaveBeenCalled();
  });

  it('超长文档 png → 截断至 EXPORT_MAX_HEIGHT 且透出 truncatedPx', async () => {
    const p = stubSaveTo('png');
    electronMock.hiddenWin.webContents.executeJavaScript.mockResolvedValue(EXPORT_MAX_HEIGHT + 200);
    electronMock.hiddenWin.webContents.capturePage.mockResolvedValue({
      toPNG: () => PNG_MAGIC,
      toJPEG: () => JPEG_MAGIC,
    });

    const result = await exportFile({ ...BASE_REQ, format: 'png' }, fakeParent);
    expect(result.success).toBe(true);
    expect(result.data?.truncatedPx).toBe(EXPORT_MAX_HEIGHT);
    expect(electronMock.hiddenWin.setContentSize).toHaveBeenCalledWith(
      EXPORT_IMAGE_WIDTH,
      EXPORT_MAX_HEIGHT,
    );
    expect(electronMock.hiddenWin.webContents.capturePage).toHaveBeenCalledWith(
      { x: 0, y: 0, width: EXPORT_IMAGE_WIDTH, height: EXPORT_MAX_HEIGHT },
      { stayHidden: true },
    );
  });

  it('无父窗口时 showSaveDialog 走 options 单参形式', async () => {
    const p = stubSaveTo('md');
    const result = await exportFile({ ...BASE_REQ, format: 'md' }, null);
    expect(result.success).toBe(true);
    expect(electronMock.showSaveDialog).toHaveBeenCalledTimes(1);
    const [, secondArg] = electronMock.showSaveDialog.mock.calls[0] as [unknown, unknown];
    // 单参形式：第一个实参是 options（含 defaultPath），而非父窗口
    expect(secondArg).toBeUndefined();
  });
});

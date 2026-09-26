// ============================================
// B3 一-4②：AIMessageBubble user 分支附件渲染
// chips / 图片缩略图（thumb data URL + media:// 路径）/ 解析三态 /
// 旧消息无 attachments 字段向后兼容（按可选渲染）。
// ============================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AIMessageBubble from '@render/components/AIAgent/message/AIMessageBubble';
import type { IAttachmentMeta } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.msg.copy': '复制',
      'ai.msg.edit': '编辑',
      'ai.msg.save': '保存',
      'ai.msg.cancel': '取消',
      'ai.attachment.parsing': '解析中',
      'ai.attachment.parseFailed': '解析失败',
      'ai.attachment.imageFailed': '图片未成功识别',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

afterEach(() => {
  cleanup();
});

function renderUser(attachments?: IAttachmentMeta[], content = '[文件: report.pdf]') {
  return render(
    <AIMessageBubble role="user" content={content} attachments={attachments} />
  );
}

describe('AIMessageBubble — user 分支附件 chips 与三态', () => {
  it('附件 chips 渲染文件名（file 图标，done 无状态标记）', () => {
    const attachments: IAttachmentMeta[] = [
      { id: 'a1', type: 'file', name: 'report.pdf', parseStatus: 'done' },
      { id: 'a2', type: 'file', name: 'notes.md', parseStatus: 'done' },
    ];
    renderUser(attachments);
    const container = screen.getByTestId('message-attachments');
    expect(container).toBeTruthy();
    expect(screen.getAllByTestId('message-attachment-chip')).toHaveLength(2);
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('notes.md')).toBeTruthy();
    expect(screen.queryByTestId('attachment-status-error')).toBeNull();
    expect(screen.queryByTestId('attachment-status-parsing')).toBeNull();
  });

  it('解析中（processing/pending）渲染「解析中」状态', () => {
    renderUser([
      { id: 'a1', type: 'file', name: 'big.pdf', parseStatus: 'processing' },
      { id: 'a2', type: 'file', name: 'mid.pdf', parseStatus: 'pending' },
    ]);
    expect(screen.getAllByTestId('attachment-status-parsing')).toHaveLength(2);
    expect(screen.getAllByText('解析中')).toHaveLength(2);
    expect(screen.queryByTestId('attachment-status-error')).toBeNull();
  });

  it('解析失败（error）渲染「解析失败」状态', () => {
    renderUser([{ id: 'a1', type: 'file', name: 'bad.pdf', parseStatus: 'error' }]);
    expect(screen.getByTestId('attachment-status-error')).toBeTruthy();
    expect(screen.getByText('解析失败')).toBeTruthy();
    expect(screen.queryByTestId('attachment-status-parsing')).toBeNull();
  });

  it('图片带存活态 thumb（data URL）→ 缩略图渲染', () => {
    renderUser([
      { id: 'i1', type: 'image', name: 'shot.png', parseStatus: 'done', thumb: 'data:image/png;base64,AAA' },
    ]);
    const img = screen.getByTestId('message-attachment-thumb') as HTMLImageElement;
    expect(img.src).toContain('data:image/png');
    expect(img.alt).toBe('shot.png');
  });

  it('图片仅有本地路径 → media:// 协议缩略图（toImgSrc 契约）', () => {
    renderUser([
      { id: 'i2', type: 'image', name: 'pic.png', path: 'C:\\pics\\pic.png', parseStatus: 'done' },
    ]);
    const img = screen.getByTestId('message-attachment-thumb') as HTMLImageElement;
    expect(img.src).toContain('media://');
    expect(img.src).toContain('C%3A');
  });

  it('图片无 thumb 无路径 → 图标降级，不渲染 img', () => {
    renderUser([{ id: 'i3', type: 'image', name: 'lost.png', parseStatus: 'error' }]);
    expect(screen.queryByTestId('message-attachment-thumb')).toBeNull();
    expect(screen.getByTestId('attachment-status-error')).toBeTruthy();
  });

  it('旧消息无 attachments 字段 → 不渲染附件区（向后兼容）', () => {
    renderUser(undefined, '旧的纯文本消息');
    expect(screen.queryByTestId('message-attachments')).toBeNull();
    expect(screen.getByText('旧的纯文本消息')).toBeTruthy();
  });

  it('空数组 attachments → 同样不渲染附件区', () => {
    renderUser([]);
    expect(screen.queryByTestId('message-attachments')).toBeNull();
  });

  it('B6 五-3②：图片识别失败 → 展示「图片未成功识别」（区别于文件解析失败）', () => {
    renderUser([{ id: 'i4', type: 'image', name: 'blurry.png', parseStatus: 'error' }]);
    expect(screen.getByTestId('attachment-status-error').textContent).toBe('图片未成功识别');
  });

  it('B6 五-2②：落盘失败原因随元数据展示（svg 拒绝 / 超限）', () => {
    renderUser([
      {
        id: 'i5',
        type: 'image',
        name: 'logo.svg',
        parseStatus: 'error',
        error: '不支持该图片格式（SVG 请先另存为 PNG）',
      },
    ]);
    expect(screen.getByText('不支持该图片格式（SVG 请先另存为 PNG）')).toBeTruthy();
  });

  it('B6 五-3②：点击缩略图打开 lightbox，点击遮罩关闭', () => {
    renderUser([
      { id: 'i6', type: 'image', name: 'pic.png', path: 'C:/pics/pic.png', parseStatus: 'done' },
    ]);
    expect(screen.queryByTestId('image-lightbox')).toBeNull();
    fireEvent.click(screen.getByTestId('message-attachment-thumb-btn'));
    const lightbox = screen.getByTestId('image-lightbox');
    expect(lightbox).toBeTruthy();
    expect(screen.getByTestId('image-lightbox-img').getAttribute('src')).toContain('media://');
    fireEvent.click(lightbox);
    expect(screen.queryByTestId('image-lightbox')).toBeNull();
  });

  it('B6 五-3②：Esc 关闭 lightbox', () => {
    renderUser([
      { id: 'i7', type: 'image', name: 'pic.png', path: 'C:/pics/pic.png', parseStatus: 'done' },
    ]);
    fireEvent.click(screen.getByTestId('message-attachment-thumb-btn'));
    expect(screen.getByTestId('image-lightbox')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('image-lightbox')).toBeNull();
  });

  it('B6 五-2②：GIF 图片附「GIF 首帧」提示', () => {
    renderUser([
      { id: 'i8', type: 'image', name: 'anim.gif', path: 'C:/pics/anim.gif', parseStatus: 'done' },
    ]);
    expect(screen.getByTestId('attachment-gif-note').textContent).toBe('GIF 首帧');
  });

  it('正文只含占位符（不内联附件正文），chips 与正文并存', () => {
    renderUser([{ id: 'a1', type: 'file', name: 'r.pdf', parseStatus: 'done' }], '[文件: r.pdf]');
    expect(screen.getByText('[文件: r.pdf]')).toBeTruthy();
    expect(screen.getByText('r.pdf')).toBeTruthy();
  });
});

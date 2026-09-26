// ============================================
// B8 六-2②：AIMessageBubble refsJson 页码回链与附件跳转
// 覆盖：page 标签渲染 / attachmentId 点击跳原文 / fileId 既有 openFile 回归 /
// 历史消息（无新字段）向后兼容 / 无锚点仅展示不可点。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AIMessageBubble from '@render/components/AIAgent/message/AIMessageBubble';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.msg.copy': '复制',
      'ai.msg.edit': '编辑',
      'ai.refs.page': '来源：{fileName} · 第{page}页',
      'ai.refs.chunk': '来源：{fileName} · {chunk}',
      'ai.refs.file': '来源：{fileName}',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

const REFS_JSON = JSON.stringify([
  // 附件引用：真实页码 + attachmentId（B8 新增锚点）
  {
    fileName: 'report.pdf',
    sourceRef: JSON.stringify({ fileName: 'report.pdf', attachmentId: 'att-1', page: 2 }),
  },
  // db 笔记引用：fileId + line（既有回链）
  {
    fileName: 'note.md',
    sourceRef: JSON.stringify({ fileName: 'note.md', fileId: 'f-1', line: 5 }),
  },
  // 历史消息：无 sourceRef（向后兼容）
  { fileName: 'legacy.md' },
  // 有页码但无任何 id 锚点 → 仅展示不可点
  { fileName: 'ghost.pdf', sourceRef: JSON.stringify({ fileName: 'ghost.pdf', page: 3 }) },
]);

function renderAssistant(refsJson: string | null) {
  return render(<AIMessageBubble role="assistant" content="回答正文" refsJson={refsJson} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // fileId 回链点击：file.get 需返回 Promise（setup 全局 mock 默认无实现）
  vi.mocked(window.weaveMD.file.get).mockResolvedValue({ success: false });
});

afterEach(() => {
  cleanup();
});

describe('AIMessageBubble — refsJson 页码回链与附件跳转（B8 六-2）', () => {
  it('页码引用渲染「第 N 页」标签（真实页码来自 source_ref.page）', () => {
    renderAssistant(REFS_JSON);
    expect(screen.getByText('来源：report.pdf · 第2页')).toBeTruthy();
  });

  it('附件引用可点击 → attachment.openSource（attachmentId + userId）', () => {
    renderAssistant(REFS_JSON);
    const btn = screen.getByText('来源：report.pdf · 第2页');
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(window.weaveMD.attachment.openSource).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentId: 'att-1' })
    );
  });

  it('db 笔记引用仍走 fileId openFile（既有回链回归）', () => {
    renderAssistant(REFS_JSON);
    const btn = screen.getByText('来源：note.md');
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(window.weaveMD.file.get).toHaveBeenCalledWith('f-1', expect.any(String));
  });

  it('历史消息无 sourceRef → 仍渲染文件名标签（向后兼容）', () => {
    renderAssistant(REFS_JSON);
    expect(screen.getByText('来源：legacy.md')).toBeTruthy();
  });

  it('有页码但无 id 锚点 → 不可点（span 展示仍带页码）', () => {
    renderAssistant(REFS_JSON);
    const span = screen.getByText('来源：ghost.pdf · 第3页');
    expect(span.tagName).toBe('SPAN');
  });

  it('refsJson 为 null → 不渲染出处区（旧消息零回归）', () => {
    renderAssistant(null);
    expect(screen.queryByText(/来源/)).toBeNull();
    expect(screen.getByText('回答正文')).toBeTruthy();
  });
});

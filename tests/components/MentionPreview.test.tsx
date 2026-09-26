// ============================================
// B9 三-1②：MentionPreview 文件预览改「摘要 + 前 N 行」
// ============================================
// 覆盖：统计摘要（行/字）+ 标题大纲 + 只渲染前 20 行（替代 500 字硬截断）。
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MentionPreview from '@render/components/AIAgent/composer/MentionPreview';

/** 100 行长文档：第 1 行标题、第 2 行开头、第 3~100 行为编号行。 */
const LONG_DOC = [
  '# 深度指南',
  '开头段落。',
  ...Array.from({ length: 98 }, (_, i) => `第${i + 3}行。`),
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('MentionPreview — 摘要 + 前 N 行（B9 三-1②）', () => {
  it('展示统计摘要与标题大纲，只渲染前 20 行', async () => {
    vi.mocked(window.weaveMD.file.readDisk).mockResolvedValue({
      success: true,
      data: { path: '/ws/docs/n.md', name: 'n.md', content: LONG_DOC },
    });

    const { container } = render(
      <MentionPreview
        type="file"
        id="/ws/docs/n.md"
        name="n.md"
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain('共 100 行');
    });

    const text = container.textContent ?? '';
    // 摘要构成：统计 + 大纲
    expect(text).toContain('# 深度指南');
    expect(text).toContain('开头段落。');
    // 前 20 行可见
    expect(text).toContain('第20行。');
    // 第 21 行起不再渲染（不再是 500 字硬截断）
    expect(text).not.toContain('第21行。');
    expect(text).not.toContain('第100行。');
    // 预览范围提示
    expect(text).toContain('仅预览');
  });

  it('短文档不显示截断提示，完整展示', async () => {
    vi.mocked(window.weaveMD.file.readDisk).mockResolvedValue({
      success: true,
      data: { path: '/ws/s.md', name: 's.md', content: '# 短文\n\n只有两行。' },
    });

    const { container } = render(
      <MentionPreview
        type="file"
        id="/ws/s.md"
        name="s.md"
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain('只有两行。');
    });
    expect(container.textContent).toContain('共 3 行');
    expect(container.textContent).not.toContain('仅预览');
  });

  it('读取失败展示错误态（既有行为不回归）', async () => {
    vi.mocked(window.weaveMD.file.readDisk).mockResolvedValue({
      success: false,
      message: 'Failed to read file',
    });

    const { container } = render(
      <MentionPreview
        type="file"
        id="/ws/x.md"
        name="x.md"
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain('Failed to read file');
    });
  });

  it('directory 预览：前 20 项 + 总数（既有行为不回归）', async () => {
    vi.mocked(window.weaveMD.folder.readFolder).mockResolvedValue({
      success: true,
      data: Array.from({ length: 25 }, (_, i) => ({
        name: `f${i}.md`,
        path: `/ws/f${i}.md`,
        isDirectory: false,
      })),
    });

    const { container } = render(
      <MentionPreview
        type="directory"
        id="/ws"
        name="ws"
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain('f0.md');
    });
    expect(container.textContent).toContain('25 items');
    expect(container.textContent).not.toContain('f24.md');
  });

  it('skill 预览：展示技能描述（既有行为不回归）', async () => {
    vi.mocked(window.weaveMD.ai.listSkills).mockResolvedValue({
      success: true,
      data: [{ name: 'polish', description: '润色技能' }],
    });

    const { container } = render(
      <MentionPreview
        type="skill"
        id="polish"
        name="polish"
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain('润色技能');
    });
  });
});

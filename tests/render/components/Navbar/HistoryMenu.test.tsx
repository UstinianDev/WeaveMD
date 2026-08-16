// ============================================
// WeaveMD — HistoryMenu 编辑历史组件测试（TDD strict·先 RED）
// 数据源从 historyStore.files 切换为 recent 列表，按 lastOpenedAt 倒序
// ============================================
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { RecentFileEntry } from '@render/stores/recentStore';
import HistoryMenu from '@render/components/Navbar/HistoryMenu';

vi.mock('@render/i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'navbar.history': 'History',
        'history.manageFiles': 'Manage Files',
        'file.noFiles': 'No files',
      })[key] ?? key,
  }),
}));

/** 收集下拉面板内文件按钮的 label 文本（供顺序校验） */
function fileLabels(): string[] {
  const panel = document.querySelector('[data-dropdown-panel]');
  if (!panel) return [];
  const labels = Array.from(panel.querySelectorAll('button')).map((b) =>
    (b.textContent ?? '').replace(/📄/g, '').trim()
  );
  return labels.filter((l) => l.endsWith('.md'));
}

describe('HistoryMenu 编辑历史（最近打开）', () => {
  it('按 lastOpenedAt 倒序渲染文件列表', () => {
    const files: RecentFileEntry[] = [
      { id: 'old', path: '/old.md', name: 'old.md', lastOpenedAt: '2026-08-16T00:00:00Z' },
      { id: 'new', path: '/new.md', name: 'new.md', lastOpenedAt: '2026-08-16T10:00:00Z' },
      { id: 'mid', path: '/mid.md', name: 'mid.md', lastOpenedAt: '2026-08-16T05:00:00Z' },
    ];

    render(<HistoryMenu files={files} onOpenFile={vi.fn()} onOpenHistory={vi.fn()} />);
    // 打开下拉菜单（trigger 文本为 "History ▾"）
    fireEvent.click(screen.getByText(/History/));

    expect(fileLabels()).toEqual(['new.md', 'mid.md', 'old.md']);
  });

  it('点击最近打开文件触发 onOpenFile', () => {
    const files: RecentFileEntry[] = [
      { id: 'a', path: '/a.md', name: 'a.md', lastOpenedAt: '2026-08-16T00:00:00Z' },
    ];
    const onOpenFile = vi.fn();

    render(<HistoryMenu files={files} onOpenFile={onOpenFile} onOpenHistory={vi.fn()} />);
    fireEvent.click(screen.getByText(/History/));
    // 下拉面板内文件按钮
    const panel = document.querySelector('[data-dropdown-panel]');
    expect(panel).not.toBeNull();
    const fileBtn = Array.from((panel as HTMLElement).querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('a.md')
    );
    fireEvent.click(fileBtn as HTMLElement);

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith(files[0]);
  });
});

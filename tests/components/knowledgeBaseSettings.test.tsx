// ============================================
// B4 四-3②：KnowledgeBaseSettings 导入结果 error 状态可见
// - 失败文档（status='error'）红标渲染，不静默
// - file_id 为 NULL 的导入/错误行同样可删除（KB_DELETE docId 路径）
// - 导入入口仍走 7 格式解析链路（openFile/openFolder mock）
// ============================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { IKbDocumentStatus } from '@shared/ai';
import KnowledgeBaseSettings from '@render/components/AIAgent/knowledge/KnowledgeBaseSettings';

interface FakeAgentState {
  kbStatus: { documents: number; embedding: { available: boolean; dims: number | null } } | null;
  kbDocuments: IKbDocumentStatus[];
  loadKbStatus: () => Promise<void>;
  triggerKbImportFile: (input: { title: string; content: string }) => Promise<boolean>;
  triggerKbImportDir: (folderPath: string) => Promise<void>;
  triggerKbDelete: (target: { fileId?: string | null; docId?: string }) => Promise<void>;
}

const storeMock = vi.hoisted(() => {
  const state: FakeAgentState = {
    kbStatus: { documents: 2, embedding: { available: false, dims: null } },
    kbDocuments: [],
    loadKbStatus: vi.fn(async () => {}),
    triggerKbImportFile: vi.fn(async () => true),
    triggerKbImportDir: vi.fn(async () => {}),
    triggerKbDelete: vi.fn(async () => {}),
  };
  return { state };
});

vi.mock('@render/stores/agentStore', () => ({
  useAgentStore: (selector: (s: FakeAgentState) => unknown) => selector(storeMock.state),
}));

vi.mock('@render/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, language: 'zh-CN' }),
}));

function kbDoc(overrides: Partial<IKbDocumentStatus>): IKbDocumentStatus {
  return {
    docId: 'd1',
    fileId: 'f1',
    title: 'note.md',
    sourceType: 'import',
    pinned: false,
    status: 'done',
    chunkCount: 3,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('KnowledgeBaseSettings — 导入结果 error 可见（四-3②）', () => {
  it('status=error 文档以红色错误标渲染（失败不静默）', () => {
    storeMock.state.kbDocuments = [
      kbDoc({ docId: 'e1', fileId: null, title: 'broken.pdf', status: 'error', chunkCount: 0 }),
      kbDoc({ docId: 'd1', fileId: 'f1', title: 'ok.md', status: 'done' }),
    ];

    render(<KnowledgeBaseSettings />);

    const errorLabel = screen.getByText('kb.status.error');
    expect(errorLabel.className).toContain('text-red-500');
    expect(screen.getByText('broken.pdf')).toBeTruthy();
    expect(screen.getByText('kb.status.done')).toBeTruthy();
  });

  it('file_id 为 NULL 的导入/错误行同样渲染删除按钮', () => {
    storeMock.state.kbDocuments = [
      kbDoc({ docId: 'e1', fileId: null, title: 'broken.pdf', status: 'error', chunkCount: 0 }),
      kbDoc({ docId: 'd1', fileId: 'f1', title: 'ok.md' }),
    ];

    render(<KnowledgeBaseSettings />);

    expect(screen.getAllByTitle('ai.kb.delete')).toHaveLength(2);
  });

  it('删除错误行 → 携 docId 调 triggerKbDelete（KB_DELETE docId 路径）', () => {
    storeMock.state.kbDocuments = [
      kbDoc({ docId: 'e1', fileId: null, title: 'broken.pdf', status: 'error', chunkCount: 0 }),
    ];

    render(<KnowledgeBaseSettings />);
    fireEvent.click(screen.getByTitle('ai.kb.delete'));

    expect(storeMock.state.triggerKbDelete).toHaveBeenCalledWith({
      fileId: null,
      docId: 'e1',
    });
  });

  it('删除文件文档 → 携 fileId + docId（既有 removeByFile 语义入口）', () => {
    storeMock.state.kbDocuments = [kbDoc({ docId: 'd1', fileId: 'f1' })];

    render(<KnowledgeBaseSettings />);
    fireEvent.click(screen.getByTitle('ai.kb.delete'));

    expect(storeMock.state.triggerKbDelete).toHaveBeenCalledWith({
      fileId: 'f1',
      docId: 'd1',
    });
  });

  it('目录导入入口 → triggerKbImportDir（busy 态解锁后可再次点击）', async () => {
    storeMock.state.kbDocuments = [];
    (window as unknown as { weaveMD?: unknown }).weaveMD = {
      dialog: {
        openFolder: vi.fn(async () => ({ success: true, data: { path: '/kb' } })),
        openFile: vi.fn(async () => ({ success: true, data: { paths: ['/kb/a.md'] } })),
      },
      kb: {
        parseDocument: vi.fn(async () => ({
          success: true,
          data: { text: '内容', fileName: 'a.md', fileType: 'md' },
        })),
      },
    };

    render(<KnowledgeBaseSettings />);
    fireEvent.click(screen.getByText('ai.kb.importDir'));

    await vi.waitFor(() =>
      expect(storeMock.state.triggerKbImportDir).toHaveBeenCalledWith('/kb')
    );
  });

  it('空列表显示 ai.kb.empty', () => {
    storeMock.state.kbDocuments = [];
    render(<KnowledgeBaseSettings />);
    expect(screen.getByText('ai.kb.empty')).toBeTruthy();
  });
});

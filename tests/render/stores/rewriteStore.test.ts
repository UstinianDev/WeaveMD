// ============================================
// WeaveMD — rewriteStore 状态机测试（TDD strict）
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAgentStore, useAgentStore } from '@render/stores/agentStore';
import { resetRewriteStore, useRewriteStore } from '@render/stores/rewriteStore';
import { useUIStore } from '@render/stores/uiStore';
import { useEditorStore } from '@render/stores/editorStore';
import type { SelectionRef } from '@shared/ai';

// ---- mock 渲染侧块编辑/导出纯函数（store 只管编排，不改块树）----
vi.mock('@render/editor/rewrite/selectionExport', () => ({
  exportSelectionMarkdown: vi.fn(() => 'selected-md'),
}));
vi.mock('@render/editor/rewrite/blockEdit', () => ({
  buildNumberedBlockList: vi.fn(() => []),
  proposeSelectionRewrite: vi.fn((_c: string, _s: SelectionRef, reply: string) => ({
    originalMd: _c,
    rewrittenMd: reply,
    ops: [],
    unchanged: false,
  })),
  proposeDocumentRewrite: vi.fn(() => ({ originalMd: 'orig', rewrittenMd: 'docRe', ops: [] })),
}));

// ---- fixtures ----
const remoteConfig = {
  backend: 'remote' as const,
  ollamaBaseUrl: 'http://localhost:11434',
  remoteBaseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  hasApiKey: true,
};
const noConsent = { allowNetwork: false, allowSend: false, consentUpdatedAt: null as string | null };
const grantedConsent = { allowNetwork: true, allowSend: true, consentUpdatedAt: '2026-08-14T00:00:00Z' };

const sel: SelectionRef = {
  startLeafIndex: 0,
  startOffset: 0,
  endLeafIndex: 0,
  endOffset: 3,
  startBlockId: 'b0',
  endBlockId: 'b0',
};

const rewritePreviewMock = () =>
  (window.weaveMD.ai as unknown as { rewritePreview: ReturnType<typeof vi.fn> }).rewritePreview;

describe('rewriteStore 改写状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRewriteStore();
    resetAgentStore();
    // 重置 ui/editor 关键状态
    useUIStore.setState({ isAIPanelOpen: false });
    useEditorStore.setState({ content: 'original-md', undoStack: [], redoStack: [] });

    // 默认授权+用户（用例自行覆盖：remote+granted 保证 consent 通过）
    useAgentStore.setState({ userId: 'u1', config: remoteConfig, consent: grantedConsent });
  });

  it('startSelectionRewrite 仅开面板，不调 IPC', () => {
    const setAIPanelOpenSpy = vi.spyOn(useUIStore.getState(), 'setAIPanelOpen');
    useRewriteStore
      .getState()
      .startSelectionRewrite('original-md', sel);

    // 面板开启
    expect(setAIPanelOpenSpy).toHaveBeenCalledWith(true);
    // 未发起改写请求
    expect(rewritePreviewMock()).not.toHaveBeenCalled();
    // selectionContext 已记录，供 runSelectionRewrite 消费
    expect(useRewriteStore.getState().selectionContext).toEqual({
      md: 'original-md',
      sel,
    });
  });

  it('runSelectionRewrite 无 selectionContext → rewriteError', async () => {
    await useRewriteStore.getState().runSelectionRewrite('改写');
    expect(rewritePreviewMock()).not.toHaveBeenCalled();
    expect(useRewriteStore.getState().rewriteError).toBeTruthy();
  });

  it('runSelectionRewrite consent 未授权 → pendingConsent 不调 IPC', async () => {
    useAgentStore.setState({ config: remoteConfig, consent: noConsent });
    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    await useRewriteStore.getState().runSelectionRewrite('改写');
    expect(useAgentStore.getState().pendingConsent).toBe(true);
    expect(rewritePreviewMock()).not.toHaveBeenCalled();
    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
  });

  it('runSelectionRewrite 授权 → 调 preview → pendingRewrite', async () => {
    rewritePreviewMock().mockResolvedValue({
      success: true,
      data: { text: 'rewritten-text' },
    });
    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    await useRewriteStore.getState().runSelectionRewrite('改写这段');

    // 请求载荷：selection scope + selectionMarkdown + instruction + userId
    expect(rewritePreviewMock()).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        scope: 'selection',
        instruction: '改写这段',
        selectionMarkdown: 'selected-md',
      })
    );
    const s = useRewriteStore.getState();
    expect(s.pendingRewrite?.rewrittenMd).toBe('rewritten-text');
    expect(s.rewriting).toBe(false);
    // 消费后清空 selectionContext
    expect(s.selectionContext).toBeNull();
  });

  it('runSelectionRewrite 授权但结果 unchanged → 不弹卡（pendingRewrite null）', async () => {
    // proposeSelectionRewrite 返回 unchanged:true
    const blockEdit = await import('@render/editor/rewrite/blockEdit');
    const proposeSelectionRewrite = blockEdit.proposeSelectionRewrite as ReturnType<typeof vi.fn>;
    proposeSelectionRewrite.mockReturnValueOnce({
      originalMd: 'original-md',
      rewrittenMd: 'original-md',
      ops: [],
      unchanged: true,
    });
    rewritePreviewMock().mockResolvedValue({ success: true, data: { text: 'original-md' } });

    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    await useRewriteStore.getState().runSelectionRewrite('改写');

    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
  });

  it('runSelectionRewrite 授权但 locateFailed → rewriteError（拒用提示，不弹卡）', async () => {
    const blockEdit = await import('@render/editor/rewrite/blockEdit');
    const proposeSelectionRewrite = blockEdit.proposeSelectionRewrite as ReturnType<typeof vi.fn>;
    proposeSelectionRewrite.mockReturnValueOnce({
      originalMd: 'original-md',
      rewrittenMd: 'original-md',
      ops: [],
      locateFailed: true,
    });
    rewritePreviewMock().mockResolvedValue({ success: true, data: { text: 'x' } });

    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    await useRewriteStore.getState().runSelectionRewrite('改写');

    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
    expect(useRewriteStore.getState().staleRejected).toBe(false);
    // locateFailed 走错误提示
    expect(useRewriteStore.getState().rewriteError).toBeTruthy();
  });

  it('runSelectionRewrite preview 失败（success:false）→ rewriteError 不弹卡', async () => {
    rewritePreviewMock().mockResolvedValue({
      success: false,
      message: 'network',
    });
    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    await useRewriteStore.getState().runSelectionRewrite('改写');
    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
    expect(useRewriteStore.getState().rewriteError).toBeTruthy();
  });

  it('startDocumentRewrite 走 document scope + buildNumberedBlockList', async () => {
    const blockEdit = await import('@render/editor/rewrite/blockEdit');
    const buildNumberedBlockList = blockEdit.buildNumberedBlockList as ReturnType<typeof vi.fn>;
    const proposeDocumentRewrite = blockEdit.proposeDocumentRewrite as ReturnType<typeof vi.fn>;
    buildNumberedBlockList.mockReturnValue([{ blockIndex: 0, blockId: 'b0', markdown: '# a' }]);
    proposeDocumentRewrite.mockReturnValue({
      originalMd: 'doc',
      rewrittenMd: 'docRe',
      ops: [],
      unchanged: false,
    });
    rewritePreviewMock().mockResolvedValue({
      success: true,
      data: { text: '[{"block_index":0,"new_content":"x"}]' },
    });

    await useRewriteStore.getState().startDocumentRewrite('doc', '把文档改写');

    expect(rewritePreviewMock()).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'document', instruction: '把文档改写' })
    );
    expect(useRewriteStore.getState().pendingRewrite?.rewrittenMd).toBe('docRe');
  });

  it('applyRewrite 文档已变更（stale）→ 拒绝写入，不 updateContent', () => {
    // 设置 pendingRewrite
    useRewriteStore.setState({
      pendingRewrite: {
        originalMd: 'original-md',
        rewrittenMd: 'new-md',
        ops: [],
      },
    });
    // 用户随后改了文档 → content !== originalMd
    useEditorStore.setState({ content: 'edited-elsewhere' });

    const updateSpy = vi.spyOn(useEditorStore.getState(), 'updateContent');
    useRewriteStore.getState().applyRewrite();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(useRewriteStore.getState().staleRejected).toBe(true);
    expect(useRewriteStore.getState().pendingRewrite).not.toBeNull(); // 不清空 pending，供重生成
  });

  it('applyRewrite 一致 → updateContent(rewrittenMd) 入 undo + clear', () => {
    useRewriteStore.setState({
      pendingRewrite: {
        originalMd: 'original-md',
        rewrittenMd: 'new-md',
        ops: [],
      },
    });
    useEditorStore.setState({ content: 'original-md' });

    const updateSpy = vi.spyOn(useEditorStore.getState(), 'updateContent');
    useRewriteStore.getState().applyRewrite();

    expect(updateSpy).toHaveBeenCalledWith('new-md');
    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
    expect(useRewriteStore.getState().selectionContext).toBeNull();
    expect(useRewriteStore.getState().rewriteError).toBeNull();
    expect(useRewriteStore.getState().staleRejected).toBe(false);
  });

  it('applyRewrite updateContent 内部即入 undo 栈（editorStore 行为）', () => {
    useEditorStore.setState({ content: 'original-md', undoStack: [] });
    useEditorStore.getState().updateContent('new-md');
    const s = useEditorStore.getState();
    expect(s.content).toBe('new-md');
    expect(s.isDirty).toBe(true);
    expect(s.undoStack).toEqual(['original-md']);
  });

  it('clearRewrite 重置全部改写状态', () => {
    useRewriteStore.setState({
      selectionContext: { md: 'x', sel },
      pendingRewrite: { originalMd: 'x', rewrittenMd: 'y', ops: [] },
      rewriting: true,
      rewriteError: 'boom',
      staleRejected: true,
    });
    useRewriteStore.getState().clearRewrite();
    const s = useRewriteStore.getState();
    expect(s.selectionContext).toBeNull();
    expect(s.pendingRewrite).toBeNull();
    expect(s.rewriting).toBe(false);
    expect(s.rewriteError).toBeNull();
    expect(s.staleRejected).toBe(false);
  });
});

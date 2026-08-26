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
  proposeFullDocumentRewrite: vi.fn((_c: string, _r: string) => ({
    originalMd: _c,
    rewrittenMd: _r.trim(),
    ops: [],
    unchanged: _r.trim() === _c,
  })),
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

  it('runSelectionRewrite consent 未授权仍正常发起改写（铁律二已移除）', async () => {
    rewritePreviewMock().mockResolvedValue({ success: true, data: { text: 'rewritten-text' } });
    useAgentStore.setState({ config: remoteConfig, consent: noConsent });
    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    await useRewriteStore.getState().runSelectionRewrite('改写');
    expect(rewritePreviewMock()).toHaveBeenCalled();
    expect(useAgentStore.getState().pendingConsent).toBe(false);
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
    // 消费后 selectionContext 保留（高亮保持到用户确认/取消）
    expect(s.selectionContext).not.toBeNull();
  });

  it('runSelectionRewrite 解析 --- 分隔符 → aiComment 分离', async () => {
    rewritePreviewMock().mockResolvedValue({
      success: true,
      data: { text: '将"old"替换为"new"\n---\nrewritten-text' },
    });
    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    await useRewriteStore.getState().runSelectionRewrite('改写');
    const s = useRewriteStore.getState();
    expect(s.pendingRewrite?.aiComment).toBe('将"old"替换为"new"');
    expect(s.pendingRewrite?.rewrittenMd).toBe('rewritten-text');
  });

  it('runSelectionRewrite 无 --- 分隔符 → aiComment undefined', async () => {
    rewritePreviewMock().mockResolvedValue({
      success: true,
      data: { text: 'rewritten-text' },
    });
    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    await useRewriteStore.getState().runSelectionRewrite('改写');
    const s = useRewriteStore.getState();
    expect(s.pendingRewrite?.aiComment).toBeUndefined();
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

  it('applyRewrite 一致 → updateContent(rewrittenMd) 入 undo + 保留 pending 供卡片展示', () => {
    useRewriteStore.setState({
      pendingRewrite: {
        originalMd: 'original-md',
        rewrittenMd: 'new-md',
        ops: [],
      },
      selectionContext: { md: 'original-md', sel },
    });
    useEditorStore.setState({ content: 'original-md' });

    const updateSpy = vi.spyOn(useEditorStore.getState(), 'updateContent');
    useRewriteStore.getState().applyRewrite();

    expect(updateSpy).toHaveBeenCalledWith('new-md');
    // pendingRewrite 保留供卡片展示 AI 改动说明 + diff，用户手动关闭
    expect(useRewriteStore.getState().pendingRewrite).not.toBeNull();
    expect(useRewriteStore.getState().selectionContext).not.toBeNull();
    expect(useRewriteStore.getState().rewriteResult).toBe('applied');
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

  // ============================================================
  // 第 7 期 A1c：整篇写（runFullDocumentRewrite / previewDocumentFromReply）
  // ============================================================

  it('runFullDocumentRewrite 未打开文档 → rewriteError=no-document 且不调 IPC、无 proposal', async () => {
    useEditorStore.setState({ currentFile: null, content: 'should-not-write' });
    await useRewriteStore.getState().runFullDocumentRewrite('帮我从 0 到 1 写一篇');

    expect(rewritePreviewMock()).not.toHaveBeenCalled();
    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
    expect(useRewriteStore.getState().rewriteError).toBe('no-document');
  });

  it('runFullDocumentRewrite consent 未授权仍正常发起改写（铁律二已移除）', async () => {
    useEditorStore.setState({
      currentFile: { id: 'f1', content: 'doc' } as unknown as import('@shared/types').IFile,
      content: '原文档',
    });
    useAgentStore.setState({ config: remoteConfig, consent: noConsent });
    rewritePreviewMock().mockResolvedValue({ success: true, data: { text: '整篇新文档' } });
    await useRewriteStore.getState().runFullDocumentRewrite('从 0 到 1 写文档');
    expect(rewritePreviewMock()).toHaveBeenCalled();
    expect(useAgentStore.getState().pendingConsent).toBe(false);
  });

  it('runFullDocumentRewrite 授权 → document scope 空 numberedBlocks → proposeFullDocumentRewrite → pendingRewrite', async () => {
    useEditorStore.setState({
      currentFile: { id: 'f1', content: 'doc' } as unknown as import('@shared/types').IFile,
      content: '原文档',
    });
    const blockEdit = await import('@render/editor/rewrite/blockEdit');
    const proposeFullDocumentRewrite =
      blockEdit.proposeFullDocumentRewrite as ReturnType<typeof vi.fn>;
    // 默认 mock 实现：originalMd=_c、rewrittenMd=_r.trim()、unchanged=trim相同时。此处直接复用。
    rewritePreviewMock().mockResolvedValue({ success: true, data: { text: '整篇新文档' } });

    await useRewriteStore.getState().runFullDocumentRewrite('帮我从 0 到 1 写一篇关于 AI 的文档');

    // 载荷：document scope + 空 numberedBlocks（空文档/整篇协议）+ instruction
    expect(rewritePreviewMock()).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        scope: 'document',
        instruction: '帮我从 0 到 1 写一篇关于 AI 的文档',
        numberedBlocks: [],
      })
    );
    expect(proposeFullDocumentRewrite).toHaveBeenCalledWith('原文档', '整篇新文档');
    expect(useRewriteStore.getState().pendingRewrite?.rewrittenMd).toBe('整篇新文档');
    expect(useRewriteStore.getState().rewriting).toBe(false);
  });

  it('runFullDocumentRewrite 结果 unchanged → 不弹卡（pendingRewrite null + no-change）', async () => {
    useEditorStore.setState({
      currentFile: { id: 'f1', content: 'doc' } as unknown as import('@shared/types').IFile,
      content: '原文档',
    });
    rewritePreviewMock().mockResolvedValue({ success: true, data: { text: '原文档' } });
    await useRewriteStore.getState().runFullDocumentRewrite('重写');

    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
    expect(useRewriteStore.getState().rewriteError).toBe('no-change');
  });

  it('previewDocumentFromReply（Agent 回复路径）无需 IPC：current content + 回复 → pendingRewrite', () => {
    useEditorStore.setState({
      currentFile: { id: 'f1', content: 'doc' } as unknown as import('@shared/types').IFile,
      content: '当前文档',
    });
    useRewriteStore.getState().previewDocumentFromReply('# 整篇 markdown\n\n正文');

    // 不调 IPC
    expect(rewritePreviewMock()).not.toHaveBeenCalled();
    expect(useRewriteStore.getState().pendingRewrite?.originalMd).toBe('当前文档');
    expect(useRewriteStore.getState().pendingRewrite?.rewrittenMd).toBe('# 整篇 markdown\n\n正文');
  });

  it('previewDocumentFromReply 未打开文档 → no-document 且不产生 proposal', () => {
    useEditorStore.setState({ currentFile: null, content: '' });
    useRewriteStore.getState().previewDocumentFromReply('# 回复内容');

    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
    expect(useRewriteStore.getState().rewriteError).toBe('no-document');
  });

  it('previewDocumentFromReply 回复为空白 → 不产生 proposal（视为无变化）', () => {
    useEditorStore.setState({
      currentFile: { id: 'f1', content: 'doc' } as unknown as import('@shared/types').IFile,
      content: '当前文档',
    });
    useRewriteStore.getState().previewDocumentFromReply('   ');

    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
    expect(useRewriteStore.getState().rewriteError).toBe('no-change');
  });

  // ============================================================
  // 第 7 期 A3：selectionContext 生命周期 = 高亮源（持久选区保持）
  // 高亮仅随 selectionContext 非空而显示；面板聚焦/输入不清 selectionContext，
  // 仅 applyRewrite/clearRewrite/pendingRewrite 落定后清空（高亮消失）。
  // ============================================================
  it('A3: startSelectionRewrite 后 selectionContext 保留（高亮持久，面板聚焦不清）', () => {
    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    // 面板聚焦/输入不清 selectionContext —— 高亮源仍在
    expect(useRewriteStore.getState().selectionContext).toEqual({ md: 'original-md', sel });
    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
  });

  it('A3: runSelectionRewrite 落定 proposal 后 selectionContext 保留（高亮保持到用户确认/取消）', async () => {
    rewritePreviewMock().mockResolvedValue({ success: true, data: { text: 'rewritten' } });
    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    await useRewriteStore.getState().runSelectionRewrite('改写');
    expect(useRewriteStore.getState().pendingRewrite).not.toBeNull();
    // selectionContext 不再立即清空，保留编辑器高亮到用户确认/取消
    expect(useRewriteStore.getState().selectionContext).not.toBeNull();
  });

  it('A3: applyRewrite 成功后 rewriteResult 设为 applied（pendingRewrite 保留供展示）', () => {
    useRewriteStore.setState({
      pendingRewrite: { originalMd: 'original-md', rewrittenMd: 'new-md', ops: [] },
      selectionContext: { md: 'original-md', sel },
    });
    useEditorStore.setState({ content: 'original-md' });
    useRewriteStore.getState().applyRewrite();
    expect(useRewriteStore.getState().rewriteResult).toBe('applied');
    // pendingRewrite 保留供卡片展示，用户通过 dismissRewriteResult 手动关闭
    expect(useRewriteStore.getState().pendingRewrite).not.toBeNull();
    expect(useRewriteStore.getState().selectionContext).not.toBeNull();
  });

  it('A3: clearRewrite 取消后 rewriteResult 设为 cancelled（selectionContext 同步清除）', () => {
    useRewriteStore.getState().startSelectionRewrite('original-md', sel);
    expect(useRewriteStore.getState().selectionContext).not.toBeNull();
    useRewriteStore.getState().clearRewrite();
    expect(useRewriteStore.getState().rewriteResult).toBe('cancelled');
    // pendingRewrite 保留供卡片展示取消反馈
    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
    // selectionContext 同步清除，编辑器高亮消失
    expect(useRewriteStore.getState().selectionContext).toBeNull();
  });

  it('clearRewrite 重置改写状态（pendingRewrite 保留，selectionContext 清除）', () => {
    useRewriteStore.setState({
      selectionContext: { md: 'x', sel },
      pendingRewrite: { originalMd: 'x', rewrittenMd: 'y', ops: [] },
      rewriting: true,
      rewriteError: 'boom',
      staleRejected: true,
    });
    useRewriteStore.getState().clearRewrite();
    const s = useRewriteStore.getState();
    // selectionContext 同步清除，编辑器高亮消失
    expect(s.selectionContext).toBeNull();
    // pendingRewrite 保留供卡片展示取消反馈，用户通过 dismissRewriteResult 手动关闭
    expect(s.pendingRewrite).not.toBeNull();
    expect(s.rewriting).toBe(false);
    expect(s.rewriteError).toBeNull();
    expect(s.staleRejected).toBe(false);
    expect(s.rewriteResult).toBe('cancelled');
  });

  // ============================================================
  // R16：dismissRewriteBanner 仅清提示条，保留 pendingRewrite/selectionContext
  // ============================================================
  it('dismissRewriteBanner 清 staleRejected + rewriteError，保留 pendingRewrite', () => {
    useRewriteStore.setState({
      pendingRewrite: { originalMd: 'x', rewrittenMd: 'y', ops: [] },
      staleRejected: true,
      rewriteError: 'rewrite-failed',
    });
    useRewriteStore.getState().dismissRewriteBanner();
    const s = useRewriteStore.getState();
    expect(s.staleRejected).toBe(false);
    expect(s.rewriteError).toBeNull();
    // 仅关闭提示条，不触碰 pending（仍有提案可重新生成/确认）
    expect(s.pendingRewrite).not.toBeNull();
  });

  it('dismissRewriteBanner 保留 selectionContext（无提案时仅消错误）', () => {
    useRewriteStore.setState({
      selectionContext: { md: 'x', sel },
      staleRejected: true,
    });
    useRewriteStore.getState().dismissRewriteBanner();
    const s = useRewriteStore.getState();
    expect(s.staleRejected).toBe(false);
    expect(s.selectionContext).not.toBeNull();
  });

  it('dismissRewriteBanner / clearRewrite / dismissRewriteResult 语义区分', () => {
    useRewriteStore.setState({
      pendingRewrite: { originalMd: 'x', rewrittenMd: 'y', ops: [] },
      rewriteError: 'locate-failed',
    });
    // dismissRewriteBanner：仅清提示条，保留 pending
    useRewriteStore.getState().dismissRewriteBanner();
    expect(useRewriteStore.getState().pendingRewrite).not.toBeNull();
    expect(useRewriteStore.getState().rewriteError).toBeNull();

    // clearRewrite：设 cancelled 反馈，保留 pending（供卡片展示取消反馈）
    useRewriteStore.getState().clearRewrite();
    expect(useRewriteStore.getState().pendingRewrite).not.toBeNull();
    expect(useRewriteStore.getState().rewriteResult).toBe('cancelled');

    // dismissRewriteResult：彻底清空 pending + selectionContext
    useRewriteStore.getState().dismissRewriteResult();
    expect(useRewriteStore.getState().pendingRewrite).toBeNull();
    expect(useRewriteStore.getState().rewriteResult).toBeNull();
    expect(useRewriteStore.getState().selectionContext).toBeNull();
  });
});

// ============================================
// WeaveMD — Rewrite Store（第 5 期批次 4 完整实现）
// ============================================
// 改写预览状态机（选区触发为主 + 面板 @ 兜底共享管线）。
// 铁律一：applyRewrite 是唯一写入点（editorStore.updateContent，入 undo 栈）；
//         AI 永不直接写 —— pendingRewrite 只存 proposal，任何情况不自动 updateContent。
// 铁律二：改写 = 联网，触发前校验 consent（needsConsent(consent)）。
// 跨 store 读统一 useXxxStore.getState()，不引循环依赖。
//
// 触发入口（批次 3 落点）：
//   startSelectionRewrite(md, sel)  -> 记录 selectionContext + 开 AI 面板（不调 IPC，
//                                      等用户在 composer 输入指令后 runSelectionRewrite）
//   runSelectionRewrite(instruction) -> 选区改写真实请求
//   startDocumentRewrite(md,instruction) -> @ 兜底 document scope
// applyRewrite / clearRewrite 用于预览卡片。

import { create } from 'zustand';
import type { RewriteProposal, SelectionRef } from '@shared/ai';
import { exportSelectionMarkdown } from '@render/editor/rewrite/selectionExport';
import {
  buildNumberedBlockList,
  proposeDocumentRewrite,
  proposeFullDocumentRewrite,
  proposeSelectionRewrite,
} from '@render/editor/rewrite/blockEdit';
import { needsConsent, useAgentStore } from './agentStore';
import { useUIStore } from './uiStore';
import { useEditorStore } from './editorStore';

interface SelectionContext {
  md: string;
  sel: SelectionRef;
}

interface RewriteStore {
  /** 已选文本上下文（startSelectionRewrite 记录），供 runSelectionRewrite 消费。 */
  selectionContext: SelectionContext | null;
  /** 待确认的改写提案（确认前绝不写盘）。 */
  pendingRewrite: RewriteProposal | null;
  /** 改写请求进行中。 */
  rewriting: boolean;
  /** 改写失败（网络/consent_required/locateFailed 等）。 */
  rewriteError: string | null;
  /** 确认时文档已变更（stale）→ 拒绝写入并提示重生成。 */
  staleRejected: boolean;

  /** 选区触发第一步：记录上下文 + 开 AI 面板（不调 IPC，等 composer 指令）。 */
  startSelectionRewrite: (md: string, sel: SelectionRef) => void;
  /** 选区改写真实请求（composer 指令触发）。 */
  runSelectionRewrite: (instruction: string) => Promise<void>;
  /** 面板 @ 兜底：document scope 改写。 */
  startDocumentRewrite: (md: string, instruction: string) => Promise<void>;
  /** 整篇写（A1c）：document scope 空 numberedBlocks → LLM 生成整篇 → preview。未打开文档拒写。 */
  runFullDocumentRewrite: (instruction: string) => Promise<void>;
  /** Agent 回复路径（A1c）：无需 IPC，当前 content + 回复 md → proposal 预览。未打开文档拒写。 */
  previewDocumentFromReply: (replyText: string) => void;
  /** 确认应用：唯一写入点。校验 content===originalMd，一致则写入并入 undo 栈。 */
  applyRewrite: () => void;
  /** 取消/复位：重置全部改写状态。 */
  clearRewrite: () => void;
  /** 关闭无提案提示条（R16）：仅清 staleRejected/rewriteError，保留 pendingRewrite/selectionContext。 */
  dismissRewriteBanner: () => void;
}

const INITIAL = {
  selectionContext: null as SelectionContext | null,
  pendingRewrite: null as RewriteProposal | null,
  rewriting: false,
  rewriteError: null as string | null,
  staleRejected: false,
};

export const useRewriteStore = create<RewriteStore>((set, get) => ({
  ...INITIAL,

  startSelectionRewrite(md, sel) {
    set({ selectionContext: { md, sel }, rewriteError: null, staleRejected: false });
    // 选区触发自动开 AI 面板，保证预览卡片可见
    useUIStore.getState().setAIPanelOpen(true);
  },

  async runSelectionRewrite(instruction) {
    const { selectionContext } = get();
    if (!selectionContext) {
      set({ rewriteError: 'no-selection', rewriting: false });
      return;
    }
    const { md, sel } = selectionContext;

    // 铁律二：联网闸（chat）
    const { consent, userId } = useAgentStore.getState();
    if (needsConsent(consent)) {
      useAgentStore.getState().setPendingConsent(true); // 弹同意页，不发请求
      return;
    }

    set({ rewriting: true, rewriteError: null, staleRejected: false });
    try {
      const selectionMarkdown = exportSelectionMarkdown(md, sel);
      const res = await window.weaveMD.ai.rewritePreview({
        userId,
        scope: 'selection',
        instruction,
        selectionMarkdown,
      });
      if (!res.success || !res.data) {
        set({ rewriteError: res.message ?? 'rewrite-failed', rewriting: false });
        return;
      }
      const proposal = proposeSelectionRewrite(md, sel, res.data.text);
      if (proposal.unchanged) {
        // 改写结果与原文相同 → 提示「无变化」，不弹卡片
        set({ rewriting: false, selectionContext: null, rewriteError: 'no-change' });
        return;
      }
      if (proposal.locateFailed) {
        set({ rewriting: false, selectionContext: null, rewriteError: 'locate-failed' });
        return;
      }
      set({ pendingRewrite: proposal, rewriting: false, selectionContext: null });
    } catch {
      set({ rewriting: false, rewriteError: 'rewrite-failed', selectionContext: null });
    }
  },

  async startDocumentRewrite(md, instruction) {
    // 铁律二：联网闸（chat）
    const { consent, userId } = useAgentStore.getState();
    if (needsConsent(consent)) {
      useAgentStore.getState().setPendingConsent(true); // 弹同意页，不发请求
      return;
    }

    set({ rewriting: true, rewriteError: null, staleRejected: false });
    try {
      const numberedBlocks = buildNumberedBlockList(md);
      const res = await window.weaveMD.ai.rewritePreview({
        userId,
        scope: 'document',
        instruction,
        numberedBlocks,
      });
      if (!res.success || !res.data) {
        set({ rewriteError: res.message ?? 'rewrite-failed', rewriting: false });
        return;
      }
      const proposal = proposeDocumentRewrite(md, numberedBlocks, res.data.text);
      if (proposal.unchanged) {
        set({ rewriting: false, pendingRewrite: null, rewriteError: 'no-change' });
        return;
      }
      if (proposal.locateFailed) {
        set({ rewriting: false, pendingRewrite: null, rewriteError: 'locate-failed' });
        return;
      }
      set({ pendingRewrite: proposal, rewriting: false });
    } catch {
      set({ rewriting: false, rewriteError: 'rewrite-failed', pendingRewrite: null });
    }
  },

  async runFullDocumentRewrite(instruction) {
    // 未打开文档 → 拒写（A1c 验收 2）：不调 IPC、不产生 proposal，引导用户先打开文档
    if (useEditorStore.getState().currentFile === null) {
      set({ rewriting: false, pendingRewrite: null, rewriteError: 'no-document' });
      return;
    }

    // 铁律二：改写 = 联网，consent 'chat' 闸
    const { consent, userId } = useAgentStore.getState();
    if (needsConsent(consent)) {
      useAgentStore.getState().setPendingConsent(true); // 弹同意页，不发请求
      return;
    }

    const content = useEditorStore.getState().content;
    set({ rewriting: true, rewriteError: null, staleRejected: false });
    try {
      // 整篇写：document scope + 空 numberedBlocks（空文档/整篇生成协议）
      const res = await window.weaveMD.ai.rewritePreview({
        userId,
        scope: 'document',
        instruction,
        numberedBlocks: [],
      });
      if (!res.success || !res.data) {
        set({ rewriteError: res.message ?? 'rewrite-failed', rewriting: false });
        return;
      }
      const proposal = proposeFullDocumentRewrite(content, res.data.text);
      if (proposal.unchanged) {
        set({ rewriting: false, pendingRewrite: null, rewriteError: 'no-change' });
        return;
      }
      set({ pendingRewrite: proposal, rewriting: false });
    } catch {
      set({ rewriting: false, rewriteError: 'rewrite-failed', pendingRewrite: null });
    }
  },

  previewDocumentFromReply(replyText) {
    // 未打开文档 → 拒写（引导提示，不产生 proposal）
    if (useEditorStore.getState().currentFile === null) {
      set({ rewriting: false, pendingRewrite: null, rewriteError: 'no-document' });
      return;
    }
    // 空回复 → 视为无变化，不产生 proposal
    if (!(replyText ?? '').trim()) {
      set({ rewriting: false, pendingRewrite: null, rewriteError: 'no-change' });
      return;
    }
    const content = useEditorStore.getState().content;
    // Agent 回复路径：无需 IPC，直接以当前 content + 回复产 proposal
    const proposal = proposeFullDocumentRewrite(content, replyText);
    if (proposal.unchanged) {
      set({ rewriting: false, pendingRewrite: null, rewriteError: 'no-change' });
      return;
    }
    set({ pendingRewrite: proposal, rewriting: false });
  },

  applyRewrite() {
    const { pendingRewrite } = get();
    if (!pendingRewrite) return;

    // 铁律：确认写入唯一入口，校验文档未在预览期被改动（stale）
    const currentContent = useEditorStore.getState().content;
    if (currentContent !== pendingRewrite.originalMd) {
      // 文档已变更 → 拒绝写入，提示重新生成
      set({ staleRejected: true });
      return;
    }

    useEditorStore.getState().updateContent(pendingRewrite.rewrittenMd);
    get().clearRewrite();
  },

  clearRewrite() {
    set(INITIAL);
  },

  dismissRewriteBanner() {
    // R16: 仅关闭无提案提示条（错误/拒绝），不触碰 pendingRewrite/selectionContext
    set({ staleRejected: false, rewriteError: null });
  },
}));

/** 测试/重置入口：彻底清空改写状态机。 */
export function resetRewriteStore() {
  useRewriteStore.setState({ ...INITIAL });
}

// ============================================
// WeaveMD — Rewrite Store（第 5 期批次 4 完整实现）
// ============================================
// 改写预览状态机（选区触发为主 + 面板 @ 兜底共享管线）。
// 铁律一：applyRewrite 是唯一写入点（editorStore.updateContent，入 undo 栈）；
//         AI 永不直接写 —— pendingRewrite 只存 proposal，任何情况不自动 updateContent。
// 铁律二：改写 = 联网，触发前校验 consent 'chat'（needsConsent(config,consent,'chat')）。
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
  /** 确认应用：唯一写入点。校验 content===originalMd，一致则写入并入 undo 栈。 */
  applyRewrite: () => void;
  /** 取消/复位：重置全部改写状态。 */
  clearRewrite: () => void;
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
    const { config, consent, userId } = useAgentStore.getState();
    if (needsConsent(config, consent, 'chat')) {
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
    const { config, consent, userId } = useAgentStore.getState();
    if (needsConsent(config, consent, 'chat')) {
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
}));

/** 测试/重置入口：彻底清空改写状态机。 */
export function resetRewriteStore() {
  useRewriteStore.setState({ ...INITIAL });
}

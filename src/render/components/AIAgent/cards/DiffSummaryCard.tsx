// ============================================
// WeaveMD — DiffSummaryCard 统一 diff 预览卡片
// ============================================
// 替换 RewritePreviewCard / EditBlocksPreviewCard / PatchPreviewCard 中
// 各自独立的 diff 渲染逻辑，统一为红删绿增 LCS diff + 单/多文件自动适配。
// 旧卡片保留为薄壳：负责 store 读写 + error/stale banner + 回调接线。
//
// R6 新增：
// - useDiffSummaryHandlers 内部 hook（按 source.kind 路由到正确 store）
// - Staleness 检测（apply 前校验 contentHash / originalContent）
// - 文件列表截断（>50 个文件时默认显示前 50 个 + 展开按钮）

import React, { useCallback, useMemo, useState } from 'react';
import { useI18n } from '@render/i18n';
import { diffLines, type DiffLine } from '@render/filters/rewriteDiff';
import type { RewriteProposal } from '@shared/ai';
import type { RewriteFileProposal } from '@render/stores/rewriteStore';
import { xxHash64Sync } from '@shared/utils/hashUtil';
import { useRewriteStore } from '@render/stores/rewriteStore';
import type { EditBlocksProposal } from '@render/stores/agentStore';
import { useAgentStore } from '@render/stores/agentStore';
import { useEditorStore } from '@render/stores/editorStore';
import type { IPatchProposal, IPatchFile } from '@shared/ai';
import Icon from '../../Common/Icon';

// ============================================
// Types
// ============================================

/** 统一 diff 数据源，区分三种现有卡片来源。 */
export type DiffSummarySource =
  | { kind: 'rewrite'; data: RewriteProposal | RewriteFileProposal[] }
  | { kind: 'editBlocks'; data: EditBlocksProposal[] }
  | { kind: 'patch'; data: IPatchProposal[] };

/** 标准化后的单文件记录（内部使用）。 */
interface NormalizedDiffFile {
  label: string;
  oldContent: string;
  newContent: string;
  sourceIndex: number;
}

export interface DiffSummaryCardProps {
  source: DiffSummarySource;
  /** 确认/取消后的结果态。非 null 时操作行替换为"关闭"按钮。
   * 如果不传，DiffSummaryCard 内部 hook 会根据 source.kind 自动推导。 */
  resultState?: 'applied' | 'cancelled' | null;
  /** 文档 stale 警告文案（非空时在标题行下方显示红色横幅）。
   * 如果不传，DiffSummaryCard 内部 hook 会自动检测 staleness。 */
  staleBanner?: string | null;
  /** AI 改动说明（仅 rewrite 场景使用，非空时在 diff 区域下方显示）。 */
  comment?: string;
  /** 全部应用回调（可选：不传则由内部 hook 直接调 store）。 */
  onApplyAll?: () => void;
  /** 全部废弃回调（可选：不传则由内部 hook 直接调 store）。 */
  onDiscardAll?: () => void;
  /** 结果态关闭回调（可选：不传则由内部 hook 直接调 store）。 */
  onDismiss?: () => void;
  /** 查看详情回调（按钮始终可见，不限文件数）。 */
  onViewDetails?: () => void;
}

// ============================================
// Helpers
// ============================================

/** 从文件路径中提取纯文件名。 */
function getFileNameFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? filePath;
}

/** 获取补丁文件的变更类型标记。 */
function getPatchChangeType(file: IPatchFile): 'new' | 'delete' | 'modify' {
  if (!file.oldContent && file.newContent) return 'new';
  if (file.oldContent && !file.newContent) return 'delete';
  return 'modify';
}

/** 从各来源标准化为统一文件列表。 */
function normalizeSource(source: DiffSummarySource): NormalizedDiffFile[] {
  switch (source.kind) {
    case 'rewrite': {
      if (Array.isArray(source.data)) {
        return source.data.map((f, i) => ({
          label: f.fileName,
          oldContent: f.originalMd,
          newContent: f.rewrittenMd,
          sourceIndex: i,
        }));
      }
      return [
        {
          label: '文档改写',
          oldContent: source.data.originalMd,
          newContent: source.data.rewrittenMd,
          sourceIndex: 0,
        },
      ];
    }
    case 'editBlocks': {
      return source.data.map((p, i) => {
        const isCreateFile = p.toolName === 'createFile';
        const label =
          p.fileName
          ?? p.fileId
          ?? (isCreateFile ? `新建文件 ${i + 1}` : `提案 ${i + 1}`);
        return {
          label,
          oldContent: p.originalContent,
          newContent: p.newContent,
          sourceIndex: i,
        };
      });
    }
    case 'patch': {
      const result: NormalizedDiffFile[] = [];
      let globalIdx = 0;
      for (const proposal of source.data) {
        for (const file of proposal.files) {
          const changeType = getPatchChangeType(file);
          const name = getFileNameFromPath(file.filePath);
          const prefix =
            changeType === 'new'
              ? '[新增] '
              : changeType === 'delete'
                ? '[删除] '
                : '';
          result.push({
            label: `${prefix}${name}`,
            oldContent: file.oldContent,
            newContent: file.newContent,
            sourceIndex: globalIdx,
          });
          globalIdx += 1;
        }
      }
      return result;
    }
  }
}

// ============================================
// useDiffSummaryHandlers hook（R6 新增）
// ============================================

interface DiffSummaryHandlers {
  handleApplyAll: () => void;
  handleDiscardAll: () => void;
  handleDismiss: () => void;
  /** 内部推导的结果态（非 null 时操作行改"关闭"）。 */
  resultState: 'applied' | 'cancelled' | null;
  /** staleness 错误文案（非 null 时在标题下方显示红色横幅）。 */
  staleError: string | null;
}

/**
 * 按 source.kind 路由到正确的 store 操作，并内置 staleness 检测。
 *
 * - rewrite：调 rewriteStore.applyRewrite / clearRewrite / dismissRewriteResult
 * - editBlocks：调 agentStore.applyEditBlocksProposal / discardEditBlocksProposal / clearEditBlocksProposals
 * - patch：调 agentStore.applyPatchProposal / discardPatchProposal
 *
 * Staleness 检测规则：
 * - rewrite：调 store 方法后检查 staleRejected 标记
 * - editBlocks：对比首个 pending proposal 的 originalContent 与当前编辑器内容
 * - patch：对比 proposal.contentHash 与当前编辑器内容 hash
 */
function useDiffSummaryHandlers(source: DiffSummarySource): DiffSummaryHandlers {
  const [localStaleError, setLocalStaleError] = useState<string | null>(null);

  // 始终订阅 rewriteStore 状态（仅 rewrite kind 使用）
  const rewriteResult = useRewriteStore((s) => s.rewriteResult);
  const storeStaleRejected = useRewriteStore((s) => s.staleRejected);

  // 推导 resultState
  const resultState: 'applied' | 'cancelled' | null = useMemo(() => {
    switch (source.kind) {
      case 'rewrite':
        return rewriteResult;
      case 'editBlocks': {
        const allDone =
          source.data.length > 0 &&
          source.data.every((p) => p.status !== 'pending');
        if (!allDone) return null;
        const anyApplied = source.data.some((p) => p.status === 'applied');
        return anyApplied ? 'applied' : 'cancelled';
      }
      case 'patch': {
        const allDone =
          source.data.length > 0 &&
          source.data.every((p) => p.status !== 'pending');
        if (!allDone) return null;
        const anyApplied = source.data.some((p) => p.status === 'applied');
        return anyApplied ? 'applied' : 'cancelled';
      }
    }
  }, [source.kind, source.data, rewriteResult]);

  // 推导 staleError
  const staleError: string | null = useMemo(() => {
    if (localStaleError) return localStaleError;
    if (source.kind === 'rewrite' && storeStaleRejected) {
      return '文档已被外部修改，请重新生成';
    }
    return null;
  }, [localStaleError, source.kind, storeStaleRejected]);

  const handleApplyAll = useCallback(() => {
    setLocalStaleError(null);

    switch (source.kind) {
      case 'rewrite': {
        const rstore = useRewriteStore.getState();
        if (Array.isArray(source.data)) {
          rstore.applyAllRewrites();
        } else {
          rstore.applyRewrite();
        }
        // 读回 staleRejected 标记（store 方法同步设置）
        if (useRewriteStore.getState().staleRejected) {
          setLocalStaleError('文档已被外部修改，请重新生成');
        }
        break;
      }
      case 'editBlocks': {
        const astore = useAgentStore.getState();
        const currentContent = useEditorStore.getState().content ?? '';
        const allProposals = astore.editBlocksProposals;

        // staleness：仅对预览类工具（editBlocks / preview_file_revision）检查，
        // editLocalFile / createFile 是直接写盘工具，文件已变更，无需比对 originalContent
        const firstPending = allProposals.find((p) => p.status === 'pending');
        const needsStalenessCheck =
          firstPending &&
          firstPending.toolName !== 'editLocalFile' &&
          firstPending.toolName !== 'createFile';
        if (needsStalenessCheck && firstPending.originalContent !== currentContent) {
          setLocalStaleError('文档已被外部修改，请重新生成');
          return;
        }

        for (let i = 0; i < allProposals.length; i++) {
          if (allProposals[i].status === 'pending') {
            astore.applyEditBlocksProposal(i);
          }
        }
        break;
      }
      case 'patch': {
        const astore = useAgentStore.getState();
        const currentContent = useEditorStore.getState().content ?? '';

        // staleness：检查 contentHash
        for (const p of source.data) {
          if (p.status !== 'pending') continue;
          if (p.contentHash) {
            const currentHash = xxHash64Sync(currentContent);
            const hashes = Array.isArray(p.contentHash)
              ? p.contentHash
              : [p.contentHash];
            if (!hashes.includes(currentHash)) {
              setLocalStaleError('文档已被外部修改，请重新生成');
              return;
            }
          }
        }

        for (const p of astore.patchProposals) {
          if (p.status === 'pending') {
            void astore.applyPatchProposal(p.id);
          }
        }
        break;
      }
    }
  }, [source]);

  const handleDiscardAll = useCallback(() => {
    setLocalStaleError(null);

    switch (source.kind) {
      case 'rewrite': {
        const rstore = useRewriteStore.getState();
        if (Array.isArray(source.data)) {
          rstore.discardAllRewrites();
        } else {
          rstore.clearRewrite();
        }
        break;
      }
      case 'editBlocks': {
        const astore = useAgentStore.getState();
        const allProposals = astore.editBlocksProposals;
        for (let i = 0; i < allProposals.length; i++) {
          if (allProposals[i].status === 'pending') {
            astore.discardEditBlocksProposal(i);
          }
        }
        break;
      }
      case 'patch': {
        const astore = useAgentStore.getState();
        for (const p of astore.patchProposals) {
          if (p.status === 'pending') {
            astore.discardPatchProposal(p.id);
          }
        }
        break;
      }
    }
  }, [source]);

  const handleDismiss = useCallback(() => {
    setLocalStaleError(null);

    switch (source.kind) {
      case 'rewrite': {
        useRewriteStore.getState().dismissRewriteResult();
        break;
      }
      case 'editBlocks': {
        useAgentStore.getState().clearEditBlocksProposals();
        break;
      }
      case 'patch': {
        const astore = useAgentStore.getState();
        for (const p of astore.patchProposals) {
          if (p.status !== 'pending') continue;
          astore.discardPatchProposal(p.id);
        }
        break;
      }
    }
  }, [source]);

  return { handleApplyAll, handleDiscardAll, handleDismiss, resultState, staleError };
}

// ============================================
// FILE_LIST_TRUNCATION_THRESHOLD（R6 新增）
// ============================================
const FILE_TRUNCATION_THRESHOLD = 50;

// ============================================
// Main Component
// ============================================

const DiffSummaryCard: React.FC<DiffSummaryCardProps> = ({
  source,
  resultState: propResultState,
  staleBanner: propStaleBanner,
  comment,
  onApplyAll: propOnApplyAll,
  onDiscardAll: propOnDiscardAll,
  onDismiss: propOnDismiss,
  onViewDetails,
}) => {
  const { t } = useI18n();

  // R6：内部 hook 提供 handler + resultState + staleError
  const {
    handleApplyAll: internalApplyAll,
    handleDiscardAll: internalDiscardAll,
    handleDismiss: internalDismiss,
    resultState: internalResultState,
    staleError: internalStaleError,
  } = useDiffSummaryHandlers(source);

  // 文件列表截断（R6 新增）：>50 个文件时默认只显示前 50 个
  const [fileShowAll, setFileShowAll] = useState(false);

  const allFiles = useMemo(() => normalizeSource(source), [source]);
  const fileCount = allFiles.length;

  // 当 source.data 变化时重置展开状态
  const files = useMemo(() => {
    setFileShowAll(false); // reset memo side-effect（在渲染期间设置 state 是安全的）
    return fileShowAll || fileCount <= FILE_TRUNCATION_THRESHOLD
      ? allFiles
      : allFiles.slice(0, FILE_TRUNCATION_THRESHOLD);
  }, [allFiles, fileCount, fileShowAll]);

  const isMulti = fileCount > 1;
  const fileTruncated = fileCount > FILE_TRUNCATION_THRESHOLD && !fileShowAll;

  // 用 prop 覆盖 hook 推导值（prop 优先）
  const resultState = propResultState !== undefined ? propResultState : internalResultState;
  const staleBanner = propStaleBanner !== undefined ? propStaleBanner : internalStaleError;
  const isResult = resultState !== null;

  // 操作回调：prop 优先，没有 prop 则用内部 hook
  const handleApplyAll = propOnApplyAll ?? internalApplyAll;
  const handleDiscardAll = propOnDiscardAll ?? internalDiscardAll;
  const handleDismiss = propOnDismiss ?? internalDismiss;

  // 汇总所有文件的增删统计（多文件场景用于标题行显示）
  const totalStats = useMemo(() => {
    let del = 0;
    let ins = 0;
    for (const f of allFiles) {
      const lines = diffLines(f.oldContent, f.newContent);
      for (const ln of lines) {
        if (ln.type === 'del') del += 1;
        if (ln.type === 'ins') ins += 1;
      }
    }
    return { del, ins };
  }, [allFiles]);

  // 单文件 diff（内联展示用）
  const singleDiff = useMemo(() => {
    if (isMulti || allFiles.length === 0)
      return { lines: [] as DiffLine[], del: 0, ins: 0 };
    const f = allFiles[0];
    const lines = diffLines(f.oldContent, f.newContent);
    let del = 0;
    let ins = 0;
    for (const ln of lines) {
      if (ln.type === 'del') del += 1;
      if (ln.type === 'ins') ins += 1;
    }
    return { lines, del, ins };
  }, [allFiles, isMulti]);

  if (allFiles.length === 0) return null;

  const singleFile = allFiles[0];

  return (
    <div className="mx-3 my-1 rounded-card border border-border bg-bg-tertiary/60 overflow-hidden shadow-sm">
      {/* 结果态反馈横幅 */}
      {resultState === 'applied' && (
        <div className="px-3 py-2 text-[13px] text-green-600 bg-green-500/10 border-b border-green-500/20 flex items-center gap-2">
          <Icon icon="check" size={14} />
          {t('ai.diff.applied', '已应用')}
        </div>
      )}
      {resultState === 'cancelled' && (
        <div className="px-3 py-2 text-[13px] text-text-muted bg-bg-primary/40 border-b border-border flex items-center gap-2">
          {t('ai.diff.cancelled', '已取消')}
        </div>
      )}

      {/* stale 警告横幅 */}
      {staleBanner && (
        <div className="px-3 pt-2 text-[12px] text-red-500">{staleBanner}</div>
      )}

      {/* 标题行：图标 + 文件信息 + 操作按钮 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[13px] font-medium text-text-primary flex items-center gap-1.5 min-w-0">
          <Icon icon="file-edit" size={14} className="text-text-sub shrink-0" />
          {isMulti ? (
            <span className="truncate">
              {t('ai.diff.multiFiles', '{count} 个文件修订').replace(
                '{count}',
                String(fileCount),
              )}
              <span className="ml-1.5 text-text-muted font-normal">
                (−{totalStats.del} / +{totalStats.ins})
              </span>
            </span>
          ) : (
            <span className="truncate">
              {singleFile.label}
              <span className="ml-1.5 text-text-muted font-normal">
                (−{singleDiff.del} / +{singleDiff.ins})
              </span>
            </span>
          )}
        </span>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isResult ? (
            <button
              type="button"
              onClick={handleDismiss}
              className="text-[13px] px-2.5 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
            >
              {t('ai.diff.dismiss', '关闭')}
            </button>
          ) : (
            <>
              {onViewDetails && (
                <button
                  type="button"
                  onClick={onViewDetails}
                  className="text-[13px] px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
                >
                  {t('ai.diff.viewDetails', '查看详情')}
                </button>
              )}
              <button
                type="button"
                onClick={handleDiscardAll}
                className="text-[13px] px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
              >
                {t('ai.diff.discardAll', '全部废弃')}
              </button>
              <button
                type="button"
                onClick={handleApplyAll}
                className="text-[13px] px-2.5 py-1 rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                {t('ai.diff.applyAll', '全部应用')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 多文件：文件名列表（R6：>50 截断 + 展开） */}
      {isMulti && (
        <div
          className="px-3 py-1.5 text-[12px] text-text-sub border-b border-border bg-bg-primary/40"
          title={allFiles.map((f) => f.label).join('\n')}
        >
          {files
            .slice(0, fileTruncated ? undefined : 2)
            .map((f) => f.label)
            .join('、')}
          {!fileTruncated && fileCount > 2 && (
            <span className="text-text-muted">
              {' '}
              {t('ai.diff.andMore', '等 {count} 个文件').replace(
                '{count}',
                String(fileCount),
              )}
            </span>
          )}
          {/* R6：文件截断展开按钮 */}
          {fileTruncated && (
            <button
              type="button"
              onClick={() => setFileShowAll(true)}
              className="ml-2 text-accent hover:underline"
            >
              {t(
                'ai.diff.showAllFiles',
                '显示全部 {count} 个文件',
              ).replace('{count}', String(fileCount))}
            </button>
          )}
        </div>
      )}

      {/* 单文件：不再展开内联 diff，摘要信息已在标题行显示 */}

      {/* AI 改动说明（仅 rewrite 场景） */}
      {comment && (
        <div className="px-3 py-2 border-t border-border">
          <span className="text-[13px] font-medium text-text-sub">
            {t('ai.diff.aiComment', 'AI 改动说明')}
          </span>
          <p className="text-[14px] text-text-primary mt-1">{comment}</p>
        </div>
      )}
    </div>
  );
};

export default DiffSummaryCard;
// ============================================
// WeaveMD — 知识库设置/导入 UI
// ============================================
// 导入 7 格式文档（单文件 + 目录批量，先 parseDocument 再入索引，B4）、索引状态列表（pending/done/error）、
// 删除/重建操作、embedding 可用性提示（未装标注「仅关键词召回」）。
// 数据与动作均读 agentStore（kbStatus/kbDocuments + triggerKb*）。

import React, { useEffect, useState } from 'react';
import type { IKbDocumentStatus } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAgentStore } from '@render/stores/agentStore';
import { useAuthStore } from '@render/stores/authStore';
import Icon from '../../Common/Icon';

const STATUS_LABEL: Record<IKbDocumentStatus['status'], string> = {
  pending: 'kb.status.pending',
  importing: 'kb.status.importing',
  done: 'kb.status.done',
  error: 'kb.status.error',
};

const STATUS_CLASS: Record<IKbDocumentStatus['status'], string> = {
  pending: 'text-text-muted',
  importing: 'text-amber-500',
  done: 'text-green-500',
  error: 'text-red-500',
};

const KnowledgeBaseSettings: React.FC = () => {
  const { t } = useI18n();
  const kbStatus = useAgentStore((s) => s.kbStatus);
  const kbDocuments = useAgentStore((s) => s.kbDocuments);
  const loadKbStatus = useAgentStore((s) => s.loadKbStatus);
  const triggerKbImportFile = useAgentStore((s) => s.triggerKbImportFile);
  const triggerKbImportDir = useAgentStore((s) => s.triggerKbImportDir);
  const triggerKbDelete = useAgentStore((s) => s.triggerKbDelete);

  const [busy, setBusy] = useState(false);
  // R3：导入「允许外发」授权勾选（默认不勾 = fail-closed，铁律二）
  const [allowEgress, setAllowEgress] = useState(false);

  useEffect(() => {
    void loadKbStatus();
  }, [loadKbStatus]);

  const handleImportFile = async () => {
    setBusy(true);
    try {
      // B2：openFile 只返回路径数组，内容由解析层接管（KB 单文件导入取首个，多选批量随 B4）
      const result = (await window.weaveMD.dialog.openFile()) as unknown as {
        success?: boolean;
        data?: { paths?: string[] };
      };
      const path = result.success && Array.isArray(result.data?.paths)
        ? result.data.paths[0]
        : undefined;
      if (!path) return;
      const name = path.split(/[/\\]/).pop() ?? path;
      const parsed = await window.weaveMD.kb.parseDocument(path, name, undefined, {
        userId: useAuthStore.getState().user?.id ?? '',
      });
      if (parsed.success && parsed.data) {
        await triggerKbImportFile({
          title: name,
          content: parsed.data.text,
          // 二-6②：页码偏移随单文件导入 → source_ref 真实页码
          ...(parsed.data.pageOffsets ? { pageOffsets: parsed.data.pageOffsets } : {}),
          // R3：勾选才携带授权标记（缺省不加键 = fail-closed「漏传不撤销」）
          ...(allowEgress ? { consentGranted: true } : {}),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleImportDir = async () => {
    setBusy(true);
    try {
      const result = (await window.weaveMD.dialog.openFolder()) as unknown as {
        success?: boolean;
        data?: { path: string };
      };
      if (result.success && result.data) {
        if (allowEgress) {
          await triggerKbImportDir(result.data.path, true);
        } else {
          await triggerKbImportDir(result.data.path);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const embeddingAvailable = kbStatus?.embedding.available ?? false;

  return (
    <div className="rounded-card border border-border bg-bg-tertiary/40 px-3 py-2 space-y-2 shadow-sm">
      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleImportFile()}
          disabled={busy}
          className="text-[13px] px-2.5 py-1 rounded-input bg-bg-secondary border border-border text-text-primary hover:border-[var(--accent)] disabled:opacity-40 transition-colors"
        >
          {t('ai.kb.importFile')}
        </button>
        <button
          type="button"
          onClick={() => void handleImportDir()}
          disabled={busy}
          className="text-[13px] px-2.5 py-1 rounded-input bg-bg-secondary border border-border text-text-primary hover:border-[var(--accent)] disabled:opacity-40 transition-colors"
        >
          {t('ai.kb.importDir')}
        </button>
        <span className="ml-auto text-[12px] text-text-muted">
          {t('ai.kb.docCount')
            .split('{count}')
            .join(String(kbStatus?.documents ?? 0))}
        </span>
      </div>

      {/* R3：导入「允许外发」授权勾选（默认不勾，铁律二 fail-closed） */}
      <label
        className="flex items-center gap-1.5 text-[12px] text-text-sub cursor-pointer select-none"
        data-testid="kb-allow-egress"
      >
        <input
          type="checkbox"
          checked={allowEgress}
          onChange={(e) => setAllowEgress(e.target.checked)}
          className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
        />
        {t('ai.kb.allowEgress')}
      </label>
      <div className="text-[11px] text-text-muted">{t('ai.kb.allowEgressHint')}</div>

      {/* embedding 可用性提示 */}
      <div className="text-[12px] text-text-sub">
        {embeddingAvailable
          ? t('ai.kb.embeddingEnabled')
          : t('ai.kb.embeddingDisabled')}
      </div>

      {/* 文档索引状态列表 */}
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {kbDocuments.length === 0 ? (
          <p className="text-[13px] text-text-muted">{t('ai.kb.empty')}</p>
        ) : (
          kbDocuments.map((doc) => (
            <div
              key={doc.docId}
              className="flex items-center gap-2 text-[13px] bg-bg-secondary rounded-md px-2 py-1.5"
            >
              <span className="flex-1 truncate text-text-primary">{doc.title}</span>
              {doc.pinned && <span className="text-[11px] text-amber-500">★</span>}
              <span className={`flex-shrink-0 ${STATUS_CLASS[doc.status]}`}>
                {t(STATUS_LABEL[doc.status])}
              </span>
              <span className="flex-shrink-0 text-text-muted">
                {t('ai.kb.chunks').split('{count}').join(String(doc.chunkCount))}
              </span>
              {/* B4：导入/附件/错误行（file_id 为 NULL）同样可删 —— 走 KB_DELETE docId 路径 */}
              <button
                type="button"
                onClick={() => void triggerKbDelete({ fileId: doc.fileId, docId: doc.docId })}
                className="flex-shrink-0 text-text-muted hover:text-red-400 transition-colors"
                title={t('ai.kb.delete')}
              >
                <Icon icon="close" size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default KnowledgeBaseSettings;

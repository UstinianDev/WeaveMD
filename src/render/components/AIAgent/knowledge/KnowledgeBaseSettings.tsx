// ============================================
// WeaveMD — 知识库设置/导入 UI
// ============================================
// 导入 md/txt（单文件 + 目录批量）、索引状态列表（pending/done/error）、
// 删除/重建操作、embedding 可用性提示（未装标注「仅关键词召回」）。
// 数据与动作均读 agentStore（kbStatus/kbDocuments + triggerKb*）。

import React, { useEffect, useState } from 'react';
import type { IKbDocumentStatus } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAgentStore } from '@render/stores/agentStore';
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

  useEffect(() => {
    void loadKbStatus();
  }, [loadKbStatus]);

  const handleImportFile = async () => {
    setBusy(true);
    try {
      const result = (await window.weaveMD.dialog.openFile()) as unknown as {
        success?: boolean;
        data?: { name: string; content: string };
      };
      if (result.success && result.data) {
        await triggerKbImportFile({ title: result.data.name, content: result.data.content });
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
        await triggerKbImportDir(result.data.path);
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
              {doc.fileId && (
                <button
                  type="button"
                  onClick={() => void triggerKbDelete(doc.fileId ?? '')}
                  className="flex-shrink-0 text-text-muted hover:text-red-400 transition-colors"
                  title={t('ai.kb.delete')}
                >
                  <Icon icon="close" size={14} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default KnowledgeBaseSettings;

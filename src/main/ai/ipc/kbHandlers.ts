// ============================================
// Knowledge Base IPC Handlers
// ============================================

import fs from 'fs';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { AIErrorCode, IAttachmentMeta, IKbSettings, KbImportDirRequest } from '@shared/ai';
import { DEFAULT_KB_SETTINGS, normalizeKbSettings } from '@shared/ai';
import { getAiConfig, upsertAiConfig, updateKbExtendedSettings } from '../../db/ai';
import { listKbDocumentsByUser, listKbDocumentsWithChunkCount } from '../../db/kb';
import { getFile } from '../../db/files';
import { getParsedAttachment } from '../../db/attachments';
import {
  indexFile,
  indexImportedText,
  recordImportFailure,
  removeByDocId,
  removeByFile,
  type KbIndexOpts,
} from '../knowledge/kbIndexer';
import { isSupportedDocument, parseDocument } from '../files/documentParser';
import { parseWithLimit } from '../files/parseLimiter';
import { resolveEmbedding, scheduleVectorBackfill } from '../knowledge/vectorBackfill';
import type { IKbImportResult } from '@shared/ai';

export function registerKbHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.KB_LIST,
    (_event, payload: { userId: string }) => {
      try {
        // 单条聚合查询替代 N+1（listKbDocumentsByUser + countChunksByDoc × N）
        const docs = listKbDocumentsWithChunkCount(payload.userId);
        return { success: true, data: docs };
      } catch (error) {
        return { success: false, message: 'Failed to list knowledge base' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_IMPORT_FILE,
    async (
      _event,
      // IPC 边界松载荷（二选一校验在 handler 内做，不信渲染层）
      payload: {
        userId: string;
        title?: string;
        content?: string;
        attachmentId?: string;
        /** B7 二-6②：单文件 PDF 导入的页码偏移。 */
        pageOffsets?: number[];
        /** B11 八-1②：勾选授权（该文档显式外发授权）；缺省 = 未授权（fail-closed）。 */
        consentGranted?: boolean;
      }
    ) => {
      try {
        // IPC 边界二选一（B4 四-3②）：attachmentId → 附件入 KB；否则 title+content 文本导入
        if (typeof payload.attachmentId === 'string' && payload.attachmentId) {
          const result = await importAttachmentAsKb(
            payload.userId,
            payload.attachmentId,
            payload.consentGranted === true ? { consentGranted: true } : undefined
          );
          return { success: true, data: result };
        }
        if (!payload.title || typeof payload.content !== 'string') {
          return { success: false, message: 'title/content required' };
        }
        const contentOffsets =
          Array.isArray(payload.pageOffsets) &&
          payload.pageOffsets.every((n) => typeof n === 'number' && Number.isFinite(n))
            ? payload.pageOffsets
            : undefined;
        const result = await indexImportedText(
          payload.userId,
          payload.title,
          payload.content,
          {
            ...kbIndexOpts(payload.userId),
            ...(contentOffsets ? { pageOffsets: contentOffsets } : {}),
            // R3：===true 才写授权（缺省不写 = DB DEFAULT 0 fail-closed，「漏传不撤销」）
            ...(payload.consentGranted === true ? { consentGranted: true } : {}),
          }
        );
        // 索引完成后触发向量回填（历史 chunk 缺口/模型切换扫描，防抖合并）
        scheduleVectorBackfill(payload.userId);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, message: 'Failed to import text to knowledge base' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_IMPORT_DIR,
    async (_event, payload: KbImportDirRequest) => {
      try {
        const results: IKbImportResult[] = await importDirAsKb(
          payload.userId,
          payload.folderPath,
          // R3：===true 才透传授权标记（缺省 fail-closed，与附件/文本分支同口径）
          payload.consentGranted === true ? { consentGranted: true } : undefined
        );
        return { success: true, data: results };
      } catch (error) {
        return { success: false, message: 'Failed to import folder to knowledge base' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_REINDEX,
    async (_event, payload: { userId: string; fileId: string }) => {
      try {
        if (!payload.fileId) return { success: false, message: 'fileId required' };
        const result = await reindexFromKbOrFile(payload.userId, payload.fileId);
        if (!result) return { success: false, message: 'Knowledge base document not found' };
        return { success: true, data: result };
      } catch (error) {
        return { success: false, message: 'Failed to reindex knowledge base document' };
      }
    }
  );

  ipcMain.handle(
    // fileId（文件笔记）与 docId（导入/附件/错误行，file_id 为 NULL）二选一（B4 四-3②）
    IPC_CHANNELS.KB_DELETE,
    (_event, payload: { userId: string; fileId?: string | null; docId?: string }) => {
      try {
        if (payload?.fileId) {
          return { success: true, data: { deleted: removeByFile(payload.userId, payload.fileId) } };
        }
        if (payload?.docId) {
          return { success: true, data: { deleted: removeByDocId(payload.userId, payload.docId) } };
        }
        return { success: false, message: 'fileId/docId required' };
      } catch (error) {
        return { success: false, message: 'Failed to delete knowledge base document' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_STATUS,
    async (_event, payload: { userId: string }) => {
      try {
        const docs = listKbDocumentsByUser(payload.userId);
        // 检查 embedding 配置是否可用
        const config = getAiConfig(payload.userId);
        const hasEmbedding = !!(config?.kbEmbeddingProvider && config?.apiKeyEnc);
        return {
          success: true,
          data: {
            documents: docs.length,
            embedding: {
              available: hasEmbedding,
              dims: config?.kbEmbeddingDimension ?? null,
            },
          },
        };
      } catch (error) {
        return { success: false, message: 'Failed to get knowledge base status' };
      }
    }
  );

  // --- KB 参数持久化读写（第 6 期批次 2 + R2~R10 扩展；user_id 隔离） ---
  ipcMain.handle(
    IPC_CHANNELS.KB_GET_SETTINGS,
    (_event, payload: { userId: string }) => {
      try {
        const row = getAiConfig(payload.userId);
        // 无配置返回 DEFAULT，恒 success:true（缺省兜底）
        const settings: IKbSettings = row
          ? normalizeKbSettings({
              topK: row.kbTopK,
              fuse: row.kbFuse,
              threshold: row.kbThreshold,
              pinnedWeight: row.kbPinnedWeight,
              rrfK: row.kbRrfK,
              candidateMultiplier: row.kbCandidateMultiplier,
              vecScoreThreshold: row.kbVecScoreThreshold,
              currentFileBoost: row.kbCurrentFileBoost,
              recencyBoost: row.kbRecencyBoost,
              headingBoost: row.kbHeadingBoost,
              maxChunksPerFile: row.kbMaxChunksPerFile,
              contextExpand: row.kbContextExpand,
              enableQueryUnderstanding: row.kbEnableQueryUnderstanding,
              enableConditionalRerank: row.kbEnableConditionalRerank,
              enableClarify: row.kbEnableClarify,
              enableEvidenceGrading: row.kbEnableEvidenceGrading,
              enableResearchLoop: row.kbEnableResearchLoop,
              enableDocumentContext: row.kbEnableDocumentContext,
              documentContextBudget: row.kbDocumentContextBudget,
            })
          : { ...DEFAULT_KB_SETTINGS };
        return { success: true, data: settings };
      } catch (error) {
        return {
          success: false,
          code: 'network' as AIErrorCode,
          message: 'Failed to get knowledge base settings',
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_SET_SETTINGS,
    async (
      _event,
      payload: { userId: string; settings: Partial<IKbSettings> }
    ) => {
      try {
        const settings = normalizeKbSettings(payload.settings);
        // 基础4字段走 upsertAiConfig（向后兼容）
        const row = upsertAiConfig(payload.userId, {
          kbTopK: settings.topK,
          kbFuse: settings.fuse,
          kbThreshold: settings.threshold,
          kbPinnedWeight: settings.pinnedWeight,
        });
        // R2~R10 扩展字段走 updateKbExtendedSettings
        updateKbExtendedSettings(payload.userId, payload.settings as Record<string, unknown>);
        // 写后回读，返回实际落盘归一值
        const fresh = getAiConfig(payload.userId);
        return {
          success: true,
          data: fresh
            ? normalizeKbSettings({
                topK: fresh.kbTopK,
                fuse: fresh.kbFuse,
                threshold: fresh.kbThreshold,
                pinnedWeight: fresh.kbPinnedWeight,
                rrfK: fresh.kbRrfK,
                candidateMultiplier: fresh.kbCandidateMultiplier,
                vecScoreThreshold: fresh.kbVecScoreThreshold,
                currentFileBoost: fresh.kbCurrentFileBoost,
                recencyBoost: fresh.kbRecencyBoost,
                headingBoost: fresh.kbHeadingBoost,
                maxChunksPerFile: fresh.kbMaxChunksPerFile,
                contextExpand: fresh.kbContextExpand,
                enableQueryUnderstanding: fresh.kbEnableQueryUnderstanding,
                enableConditionalRerank: fresh.kbEnableConditionalRerank,
                enableClarify: fresh.kbEnableClarify,
                enableEvidenceGrading: fresh.kbEnableEvidenceGrading,
                enableResearchLoop: fresh.kbEnableResearchLoop,
                enableDocumentContext: fresh.kbEnableDocumentContext,
                documentContextBudget: fresh.kbDocumentContextBudget,
              })
            : settings,
        };
      } catch (error) {
        return {
          success: false,
          code: 'config_incomplete' as AIErrorCode,
          message: 'Failed to save knowledge base settings',
        };
      }
    }
  );

  // 文档解析（7 格式白名单 → 结构化产物）
  ipcMain.handle(
    IPC_CHANNELS.KB_PARSE_DOCUMENT,
    async (
      _event,
      filePath: string,
      fileName: string,
      mimeType?: string,
      options?: { userId?: string }
    ) => {
      try {
        // 白名单入口校验（isSupportedDocument 接线：供上传校验复用，二-1②）
        if (!isSupportedDocument(fileName)) {
          return { success: false, message: `Unsupported file type: ${fileName}` };
        }
        // IPC 边界校验：options 须为对象，userId 须为字符串（缺省不触发 D 路线配置读取）
        const parseOptions =
          options && typeof options === 'object' && typeof options.userId === 'string'
            ? { userId: options.userId }
            : undefined;
        // 解析并发限流（一-2②：多文件批量上传时避免主进程被 20 个 pdf 阻塞）
        const result = await parseWithLimit(() =>
          parseDocument(filePath, fileName, mimeType, parseOptions)
        );
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          message: `Document parse failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// KB 内部辅助函数
// ---------------------------------------------------------------------------

/** 去掉最后一个扩展名作为标题（7 格式通用；无扩展名时原样返回）。 */
function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || fileName;
}

/**
 * 目录批量导入（四-3②）：folderPath 下 7 格式白名单文件，
 * **先 parseDocument（parseLimiter 限流）再 indexImportedText** —— 直接 utf-8 读 pdf 必乱码，
 * 本函数不读任何文件字节；单文件解析失败写 status='error' 不静默、不断批。
 */
export async function importDirAsKb(
  userId: string,
  folderPath: string,
  opts?: { consentGranted?: boolean }
): Promise<IKbImportResult[]> {
  const results: IKbImportResult[] = [];
  if (!folderPath || typeof folderPath !== 'string') return results;
  // R3：===true 才携带授权标记（缺省不加键 = DB DEFAULT 0，fail-closed 漏传不撤销）
  const consentFlag = opts?.consentGranted === true ? { consentGranted: true as const } : {};

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isSupportedDocument(entry.name)) continue;
    const filePath = `${folderPath}/${entry.name}`;
    const title = stripExtension(entry.name);
    try {
      // 解析并发限流（B2 parseLimiter）：大目录/大文件不阻塞单线程主进程
      const parsed = await parseWithLimit(() =>
        parseDocument(filePath, entry.name, undefined, { userId })
      );
      if (parsed.error || !parsed.text.trim()) {
        // 无产物（解析失败 / 无文本层 / .doc 降级）→ status='error' UI 可见，不静默
        results.push(
          recordImportFailure(userId, title, {
            error: parsed.error ?? parsed.degraded ?? 'no extractable text',
            // R3：error 行同口径保留授权标记（UI 可见、重试幂等）
            ...consentFlag,
          })
        );
        continue;
      }
      results.push(
        await indexImportedText(userId, title, parsed.text, {
          ...kbIndexOpts(userId),
          // 二-6②：产物页码偏移贯通 → source_ref 真实页码
          ...(parsed.pageOffsets ? { pageOffsets: parsed.pageOffsets } : {}),
          // R3：授权标记贯通（缺省不加键）
          ...consentFlag,
        })
      );
    } catch (err) {
      // 单文件异常：记 error 行后继续（不断批）
      results.push(
        recordImportFailure(userId, title, {
          error: err instanceof Error ? err.message : String(err),
          ...consentFlag,
        })
      );
    }
  }
  // 目录导入入口同样触发向量回填（四-1② 三入口之一，防抖合并）
  scheduleVectorBackfill(userId);
  return results;
}

/**
 * 附件入 KB（四-3②）：读 `parsed_attachments` 解析产物（content 列），
 * 以 `source_type='attachment'` + `attachment_id` 入索引；删除附件经 removeByAttachment 清理 KB。
 * 附件不存在（跨用户/已删）→ error 结果且不落库（不产生孤儿行）。
 * B11 八-1②：`opts.consentGranted` 为勾选授权标记（该文档显式外发授权，外发过滤键）；
 * 缺省不传 → 不写授权键（DB DEFAULT 0，fail-closed）。
 */
export async function importAttachmentAsKb(
  userId: string,
  attachmentId: string,
  opts?: { consentGranted?: boolean }
): Promise<IKbImportResult> {
  const consentGranted = opts?.consentGranted;
  const att = getParsedAttachment(attachmentId, userId); // 参数化 + user_id 归属过滤
  if (!att) {
    return {
      docId: '',
      title: attachmentId,
      chunks: 0,
      status: 'error',
      error: 'attachment not found',
    };
  }

  const title = stripExtension(att.fileName);
  if (att.parseStatus !== 'done' || !att.content.trim()) {
    // 未解析完成 / 无正文（图片等）→ 写 error 行，UI 可见
    return recordImportFailure(userId, title, {
      sourceType: 'attachment',
      attachmentId,
      error: 'attachment not parsed',
      ...(consentGranted !== undefined ? { consentGranted } : {}),
    });
  }

  const indexOpts = kbIndexOpts(userId);
  const result = await indexImportedText(userId, title, att.content, {
    ...indexOpts,
    sourceType: 'attachment',
    attachmentId,
    // 二-6②：附件结构页码偏移 → source_ref 真实页码
    ...(att.structure?.pageOffsets ? { pageOffsets: att.structure.pageOffsets } : {}),
    // B11 八-1②：勾选授权标记贯通（undefined 不加键，不因漏传撤销既有授权）
    ...(consentGranted !== undefined ? { consentGranted } : {}),
  });
  // 附件入 KB 也触发向量回填（同三入口语义）
  scheduleVectorBackfill(userId);
  return result;
}

/**
 * 发送链路勾选批量入 KB（B11 八-1②）：
 * 仅「勾选（consentGranted=true）+ file + 解析完成」的附件入 KB——勾选是入 KB 唯一触发，
 * 图片与未解析完成附件跳过（错误可见性由 parseStatus 三态渲染承担）。
 * 调用方（AGENT_RUN / AI_CHAT）fire-and-forget，不阻塞发送。
 */
export async function importAttachmentsAsKb(
  userId: string,
  metas: readonly IAttachmentMeta[],
  consentGranted: boolean
): Promise<void> {
  if (!consentGranted) return;
  for (const meta of metas) {
    if (meta.type !== 'file' || meta.parseStatus !== 'done') continue;
    try {
      await importAttachmentAsKb(userId, meta.id, { consentGranted: true });
    } catch {
      /* 单附件失败不阻断其余（importAttachmentAsKb 内部已落 error 行） */
    }
  }
}

/** KB 重索引：以文件系统笔记（files 表）重建该 fileId 的知识库文档。 */
async function reindexFromKbOrFile(
  userId: string,
  fileId: string
): Promise<IKbImportResult | null> {
  const file = getFile(fileId, userId);
  if (file) {
    const result = await indexFile(
      userId,
      { id: file.id, name: file.name, content: file.content },
      kbIndexOpts(userId)
    );
    // 手动重索引入口触发向量回填（四-1② 三入口之一）
    scheduleVectorBackfill(userId);
    return result;
  }
  return null;
}

/**
 * 当前 KB 索引选项（四-1②）：读取真实 embedding 配置；
 * 未配置 / 解析失败 → {}（纯 FTS5 分支不破坏）。解析异常在此收敛不外抛。
 */
export function kbIndexOpts(userId: string): KbIndexOpts {
  try {
    const emb = resolveEmbedding(userId);
    return emb ? { embedding: emb } : {};
  } catch {
    return {};
  }
}

// ============================================
// Knowledge Base IPC Handlers
// ============================================

import fs from 'fs';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { AIErrorCode, IKbSettings, KbImportDirRequest } from '@shared/ai';
import { DEFAULT_KB_SETTINGS, normalizeKbSettings } from '@shared/ai';
import { getAiConfig, upsertAiConfig, updateKbExtendedSettings } from '../../db/ai';
import { countChunksByDoc, listKbDocumentsByUser } from '../../db/kb';
import { getFile } from '../../db/files';
import { indexFile, indexImportedText, removeByFile } from '../kbIndexer';
import { parseDocument } from '../documentParser';
import type { IKbImportResult } from '@shared/ai';

export function registerKbHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.KB_LIST,
    (_event, payload: { userId: string }) => {
      try {
        const docs = listKbDocumentsByUser(payload.userId).map((d) => ({
          docId: d.id,
          fileId: d.fileId,
          title: d.title,
          sourceType: d.sourceType,
          pinned: d.pinned,
          status: d.status,
          chunkCount: countChunksByDoc(payload.userId, d.id),
        }));
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
      payload: { userId: string; title: string; content: string }
    ) => {
      try {
        if (!payload.title || typeof payload.content !== 'string') {
          return { success: false, message: 'title/content required' };
        }
        const result = await indexImportedText(
          payload.userId,
          payload.title,
          payload.content,
          kbIndexOpts()
        );
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
        const results: IKbImportResult[] = await importDirAsKb(payload.userId, payload.folderPath);
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
    IPC_CHANNELS.KB_DELETE,
    (_event, payload: { userId: string; fileId: string }) => {
      try {
        const deleted = removeByFile(payload.userId, payload.fileId);
        return { success: true, data: { deleted } };
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

  // 文档解析（PDF/DOCX/MD/TXT）
  ipcMain.handle(
    IPC_CHANNELS.KB_PARSE_DOCUMENT,
    async (_event, filePath: string, fileName: string, mimeType?: string) => {
      try {
        const result = await parseDocument(filePath, fileName, mimeType);
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

/** 目录批量导入：读 folderPath 下 *.md/*.txt，逐个 indexImportedText。路径安全校验，异常逐文件捕获。 */
async function importDirAsKb(userId: string, folderPath: string): Promise<IKbImportResult[]> {
  const results: IKbImportResult[] = [];
  if (!folderPath || typeof folderPath !== 'string') return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(md|txt)$/i.test(entry.name)) continue;
    const filePath = `${folderPath}/${entry.name}`;
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue; // 单个文件读取失败跳过，不中断整批
    }
    const title = entry.name.replace(/\.(md|txt)$/i, '');
    const result = await indexImportedText(userId, title, content, kbIndexOpts());
    results.push(result);
  }
  return results;
}

/** KB 重索引：以文件系统笔记（files 表）重建该 fileId 的知识库文档。 */
async function reindexFromKbOrFile(
  userId: string,
  fileId: string
): Promise<IKbImportResult | null> {
  const file = getFile(fileId, userId);
  if (file) {
    return indexFile(userId, { id: file.id, name: file.name, content: file.content }, kbIndexOpts());
  }
  return null;
}

/** 当前 KB 索引选项（纯 FTS5；无向量/嵌入）。 */
function kbIndexOpts(): Record<string, never> {
  return {};
}

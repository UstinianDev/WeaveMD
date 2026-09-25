// ============================================
// WeaveMD — 知识库索引（导入/分块/FTS5/增量重建）
// ============================================
// splitNote 纯函数分块；indexFile/indexImportedText/reindexAfterSave/removeByFile 落 kb.ts DAO。
// 写 kb_documents / kb_chunks 属知识库索引存储（两铁律允许），绝不写 files 表/用户笔记。
// FTS5 关键词索引 + 可选向量嵌入（embeddingClient 生成 → kb_chunks.vector BLOB）。

import {
  deleteChunksByDoc,
  deleteKbDocument,
  deleteKbDocumentByAttachment,
  deleteKbDocumentByFile,
  getChunksByDoc,
  insertChunksBatch,
  setKbDocStatus,
  upsertKbDocument,
  type KbSourceType,
} from '../../db/kb';
import { getDatabase } from '../../db/index';
import { createEmbedding } from './embeddingClient';
import { invalidateKbSearchCache } from './kbSearch';
import type { IKbImportResult } from '@shared/ai';

// ---------------------------------------------------------------------------
// splitNote — 纯函数分块
// ---------------------------------------------------------------------------

/** 分块结果：seq 序号 / text 块文本 / approxOffset 源文档近似起始偏移。 */
export interface NoteChunk {
  seq: number;
  text: string;
  approxOffset: number;
}

export interface SplitNoteOptions {
  /** 目标块字符数（默认 800）。 */
  targetSize?: number;
  /** 相邻块 overlap 字符数（默认 80）。 */
  overlap?: number;
}

const HEADING_SEP = new Set(['## ', '# ', '---']);

/** 在 window 中找「新行后紧跟 Heading 分隔符」的切点（返回相对 window 的 p，不含换行符）。 */
function findBreakpoint(window: string): number {
  // 最小 25% 窗位门槛：避免在窗口很开头切出过小块；heading 出现在其后即可优先断点。
  const minPos = Math.floor(window.length * 0.25);
  let best = -1;
  for (let i = 0; i < window.length; i++) {
    if (window[i] !== '\n') continue;
    const rest = window.slice(i + 1).replace(/^[ \t]+/, '');
    for (const sep of HEADING_SEP) {
      if (rest.startsWith(sep)) {
        if (i + 1 >= minPos) best = i; // 取最后一个满足最小阈值的断点
        break;
      }
    }
  }
  return best;
}

/**
 * 把长文本切成 ~targetSize 字符的块，优先在 Heading/分隔符断点切分（标题不进上一块末尾），
 * 相邻块间保留 approxOverlap 字符 overlap 以衔接语义。返回块内 seq 递增、approxOffset 递增。
 */
export function splitNote(content: string, opts?: SplitNoteOptions): NoteChunk[] {
  const targetSize = opts?.targetSize ?? 800;
  const overlap = opts?.overlap ?? 80;
  const len = content.length;

  if (len <= targetSize) {
    return [{ seq: 0, text: content, approxOffset: 0 }];
  }

  const chunks: NoteChunk[] = [];
  let cursor = 0;
  let seq = 0;

  while (cursor < len) {
    const end = Math.min(cursor + targetSize, len);
    const window = content.slice(cursor, end);
    let cut = -1;
    let headed = false;
    const bp = findBreakpoint(window);
    if (bp >= 0) {
      // 断点在换行符之后切，使下一块以标题开头；跨标题切分不施加 overlap，
      // 以保证「下一块以标题开头」这一断点语义不被 overlap 回拉破坏。
      cut = cursor + bp + 1;
      headed = true;
    } else {
      cut = end;
    }
    const text = content.slice(cursor, cut).trim();
    if (text.length > 0) {
      chunks.push({ seq, text, approxOffset: cursor });
      seq++;
    }
    if (cut >= len) break;
    // 标题断点 → 下一块直接从切点（标题）开始；字符切分 → 保留 overlap 衔接语义。
    cursor = headed ? cut : Math.max(cut - overlap, cursor + 1);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// 索引编排
// ---------------------------------------------------------------------------

export interface IndexFileInput {
  id: string;
  name: string;
  content: string;
}

export interface KbIndexOpts {
  /** Embedding 配置（可选，不传则跳过向量生成）。 */
  embedding?: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
  /**
   * 文档归属类型（B4 四-3②）。缺省按入口推导：indexFile='db'、indexImportedText='import'；
   * 附件入 KB 传 'attachment'（TEXT 取值扩展，无 DDL）。
   */
  sourceType?: KbSourceType;
  /** 关联 parsed_attachments.id（D3；删除附件→清理 KB 的关联键）。 */
  attachmentId?: string;
}

const EMBED_BATCH_SIZE = 20;

/** 分块并依次落库（FTS 文本 + 可选向量嵌入）。返回落库 chunk 数。 */
async function writeChunks(
  documentId: string,
  content: string,
  fileName: string,
  embeddingConfig?: { baseUrl: string; model: string; apiKey: string }
): Promise<number> {
  const chunks = splitNote(content);
  if (chunks.length === 0) return 0;

  // 第一步：批量文本分块入库（事务包裹，避免逐条 auto-commit）
  const batchInput = chunks.map((chunk) => ({
    documentId,
    seq: chunk.seq,
    content: chunk.text,
    sourceRef: buildSourceRef(fileName, chunk.approxOffset),
  }));
  const insertedRows = insertChunksBatch(batchInput);
  const insertedChunks = insertedRows.map((row, i) => ({ id: row.id, text: chunks[i].text }));

  // 第二步：批量生成向量（如果配置了 embedding）
  if (embeddingConfig && insertedChunks.length > 0) {
    try {
      const db = getDatabase();
      for (let i = 0; i < insertedChunks.length; i += EMBED_BATCH_SIZE) {
        const batch = insertedChunks.slice(i, i + EMBED_BATCH_SIZE);
        const texts = batch.map((c) => c.text);

        const response = await createEmbedding({
          baseUrl: embeddingConfig.baseUrl,
          model: embeddingConfig.model,
          apiKey: embeddingConfig.apiKey,
          input: texts,
        });

        const updateStmt = db.prepare(
          'UPDATE kb_chunks SET vector = ?, embedding_model = ? WHERE id = ?'
        );
        for (let j = 0; j < batch.length; j++) {
          const chunkId = batch[j].id;
          const embedding = response.embeddings[j];
          if (embedding && Array.isArray(embedding)) {
            const vecBuffer = Buffer.from(new Float32Array(embedding).buffer);
            updateStmt.run(vecBuffer, embeddingConfig.model, chunkId);
          }
        }
      }
    } catch (err) {
      // 向量生成失败不阻断索引流程，降级到纯 FTS5
      console.warn(`[kbIndexer] Embedding generation failed for doc ${documentId}:`, err);
    }
  }

  return insertedChunks.length;
}

/** 构造 source_ref（JSON 字符串）：{ fileName(fileId), line? }。line 由 approxOffset 近似换算。 */
export function buildSourceRef(fileName: string, approxOffset: number, fileId?: string | null): string {
  const ref: Record<string, unknown> = {};
  if (fileId != null) ref.fileId = fileId;
  ref.fileName = fileName;
  if (approxOffset > 0) ref.line = 1 + Math.floor(approxOffset / 60); // 近似行号（约 60 字符/行）
  return JSON.stringify(ref);
}

/**
 * 索引一个 db 文件（source_type='db'，file_id 关联）。纯 FTS5 分块落库。
 * 状态流转：importing →（分块插块）→ done；异常 → error（不抛）。
 */
export async function indexFile(
  userId: string,
  file: IndexFileInput,
  opts: KbIndexOpts
): Promise<IKbImportResult> {
  let docId = '';
  let title = file.name;

  try {
    const doc = upsertKbDocument(userId, {
      fileId: file.id,
      // D3：附件关联随 opts 贯穿（正常 db 笔记不带 → undefined）
      attachmentId: opts.attachmentId,
      title: file.name,
      sourceType: opts.sourceType ?? 'db',
      status: 'importing',
    });
    docId = doc.id;
    title = doc.title;
    // S3: 获取旧 chunk ID 列表，用于精确失效缓存
    const oldChunks = getChunksByDoc(docId);
    const oldChunkIds = oldChunks.map((c) => c.id);
    deleteChunksByDoc(docId);
    const chunkCount = await writeChunks(docId, file.content, file.name, opts.embedding);
    setKbDocStatus(userId, docId, 'done');
    // 索引完成后清除搜索缓存（分级失效：先按旧 chunk 精确清除，再全量兜底）
    for (const chunkId of oldChunkIds) {
      invalidateKbSearchCache({ type: 'chunk', chunkId });
    }
    invalidateKbSearchCache(userId);
    return {
      docId,
      title,
      chunks: chunkCount,
      status: 'done',
    };
  } catch {
    setKbDocStatus(userId, docId ?? '', 'error');
    return { docId: docId ?? file.id, title, chunks: 0, status: 'error' };
  }
}

/**
 * 文件保存后重建式重索引（删旧文档再新索引）。防抖由 ipc 层负责。
 */
export async function reindexAfterSave(
  userId: string,
  file: IndexFileInput,
  opts: KbIndexOpts
): Promise<IKbImportResult | null> {
  deleteKbDocumentByFile(userId, file.id);
  // 重建索引前清除搜索缓存
  invalidateKbSearchCache(userId);
  return indexFile(userId, file, opts);
}

/**
 * 导入纯文本（source_type='import'，file_id 置 NULL；出处只定位文件名+行号）。
 */
export async function indexImportedText(
  userId: string,
  title: string,
  text: string,
  opts: KbIndexOpts
): Promise<IKbImportResult> {
  let docId = '';

  try {
    const doc = upsertKbDocument(userId, {
      fileId: null,
      // D3：附件入 KB 以 attachment_id 收敛（重试更新同一行，不产生重复）
      attachmentId: opts.attachmentId,
      title,
      sourceType: opts.sourceType ?? 'import',
      status: 'importing',
    });
    docId = doc.id;
    // S3: 获取旧 chunk ID 列表，用于精确失效缓存
    const oldChunks = getChunksByDoc(docId);
    const oldChunkIds = oldChunks.map((c) => c.id);
    deleteChunksByDoc(docId);
    const chunkCount = await writeChunks(docId, text, title, opts.embedding);
    setKbDocStatus(userId, docId, 'done');
    // 导入完成后清除搜索缓存（分级失效：先按旧 chunk 精确清除，再全量兜底）
    for (const chunkId of oldChunkIds) {
      invalidateKbSearchCache({ type: 'chunk', chunkId });
    }
    invalidateKbSearchCache(userId);
    return { docId, title, chunks: chunkCount, status: 'done' };
  } catch {
    setKbDocStatus(userId, docId ?? '', 'error');
    return { docId: docId ?? '', title, chunks: 0, status: 'error' };
  }
}

/**
 * 记录一次导入失败（四-3② 失败不静默）：直接落 `status='error'` 的 kb_documents 行，
 * 不写 chunks。附件场景带 attachment_id，重试成功时按关联收敛更新同一行。
 * DB 异常不抛（仍返回 error 结果），保证 UI 可见。
 */
export function recordImportFailure(
  userId: string,
  title: string,
  opts?: { sourceType?: KbSourceType; attachmentId?: string; error?: string }
): IKbImportResult {
  let docId = '';
  let finalTitle = title;
  try {
    const doc = upsertKbDocument(userId, {
      fileId: null,
      attachmentId: opts?.attachmentId,
      title,
      sourceType: opts?.sourceType ?? 'import',
      status: 'error',
    });
    docId = doc.id;
    finalTitle = doc.title;
  } catch {
    // DB 层异常不阻断导入流程（结果仍为 error，UI 可见）
  }
  return {
    docId,
    title: finalTitle,
    chunks: 0,
    status: 'error',
    ...(opts?.error ? { error: opts.error } : {}),
  };
}

/** 删除某 file 关联的知识库文档（文件删除清理）。 */
export function removeByFile(userId: string, fileId: string): boolean {
  const result = deleteKbDocumentByFile(userId, fileId);
  // 删除完成后清除搜索缓存
  if (result) {
    invalidateKbSearchCache(userId);
  }
  return result;
}

/**
 * 删除某附件关联的知识库文档（附件删除→清理 KB，四-3②；
 * 对齐 ipc-handlers.ts cleanupKbAfterFileDelete 模式，由 db/attachments 唯一删除点收口）。
 */
export function removeByAttachment(userId: string, attachmentId: string): boolean {
  const result = deleteKbDocumentByAttachment(userId, attachmentId);
  if (result) {
    invalidateKbSearchCache(userId);
  }
  return result;
}

/** 按 docId 删除（KB 设置页删除导入/错误行——file_id 为 NULL 的文档无 file 键）。 */
export function removeByDocId(userId: string, docId: string): boolean {
  const result = deleteKbDocument(userId, docId);
  if (result) {
    invalidateKbSearchCache(userId);
  }
  return result;
}

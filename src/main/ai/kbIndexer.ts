// ============================================
// WeaveMD — 知识库索引（导入/分块/FTS5/增量重建）
// ============================================
// splitNote 纯函数分块；indexFile/indexImportedText/reindexAfterSave/removeByFile 落 kb.ts DAO。
// 写 kb_documents / kb_chunks 属知识库索引存储（两铁律允许），绝不写 files 表/用户笔记。
// 纯 FTS5 关键词索引（向量已去除）。

import {
  deleteChunksByDoc,
  deleteKbDocumentByFile,
  getKbDocumentByFile,
  insertChunk,
  setKbDocStatus,
  upsertKbDocument,
} from '../db/kb';
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
  // 纯 FTS5：无向量/嵌入选项
}

/** 分块并依次落库（纯 FTS 文本）。返回落库 chunk 数。 */
async function writeChunks(
  documentId: string,
  content: string,
  fileName: string
): Promise<number> {
  const chunks = splitNote(content);
  if (chunks.length === 0) return 0;

  for (const chunk of chunks) {
    const sourceRef = buildSourceRef(fileName, chunk.approxOffset);
    insertChunk({
      documentId,
      seq: chunk.seq,
      content: chunk.text,
      sourceRef,
    });
  }
  return chunks.length;
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
  _opts: KbIndexOpts
): Promise<IKbImportResult> {
  let docId = '';
  let title = file.name;

  try {
    const doc = upsertKbDocument(userId, {
      fileId: file.id,
      title: file.name,
      sourceType: 'db',
      status: 'importing',
    });
    docId = doc.id;
    title = doc.title;
    deleteChunksByDoc(docId);
    const chunkCount = await writeChunks(docId, file.content, file.name);
    setKbDocStatus(userId, docId, 'done');
    const fresh = getKbDocumentByFile(userId, file.id);
    return {
      docId,
      title,
      chunks: chunkCount,
      status: fresh ? fresh.status : 'done',
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
  return indexFile(userId, file, opts);
}

/**
 * 导入纯文本（source_type='import'，file_id 置 NULL；出处只定位文件名+行号）。
 */
export async function indexImportedText(
  userId: string,
  title: string,
  text: string,
  _opts: KbIndexOpts
): Promise<IKbImportResult> {
  let docId = '';

  try {
    const doc = upsertKbDocument(userId, {
      fileId: null,
      title,
      sourceType: 'import',
      status: 'importing',
    });
    docId = doc.id;
    deleteChunksByDoc(docId);
    const chunkCount = await writeChunks(docId, text, title);
    setKbDocStatus(userId, docId, 'done');
    return { docId, title, chunks: chunkCount, status: 'done' };
  } catch {
    setKbDocStatus(userId, docId ?? '', 'error');
    return { docId: docId ?? '', title, chunks: 0, status: 'error' };
  }
}

/** 删除某 file 关联的知识库文档（文件删除清理）。 */
export function removeByFile(userId: string, fileId: string): boolean {
  return deleteKbDocumentByFile(userId, fileId);
}

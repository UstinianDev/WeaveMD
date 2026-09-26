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
// splitNote — 纯函数分块（B5 三-2② 表格边界 + 标题统领 / 四-2② headingPath）
// ---------------------------------------------------------------------------

/** 分块结果：seq 序号 / text 块文本 / approxOffset 源文档近似起始偏移 / headingPath 标题路径。 */
export interface NoteChunk {
  seq: number;
  text: string;
  approxOffset: number;
  /** B5 四-2②：块所属标题路径（" > " 连接，≤80 字符；无标题为空串 → 落库 NULL）。 */
  headingPath: string;
}

export interface SplitNoteOptions {
  /** 目标块字符数（默认 800）。 */
  targetSize?: number;
  /** 相邻块 overlap 字符数（默认 80）。 */
  overlap?: number;
}

const HEADING_PATH_MAX = 80;

/** 源行（含绝对起始偏移）。 */
interface SourceLine {
  text: string;
  start: number;
}

/** header stack 条目（层级 + 纯标题文本）。 */
interface TitleEntry {
  level: number;
  text: string;
}

/** 结构单元：非表格内容（text/section）或整张表格（table）。 */
interface StructuralUnit {
  kind: 'text' | 'section' | 'table';
  start: number;
  end: number;
  headingPath: string;
  /** table 单元专用：最近标题行原文 + 表格各行（表头/分隔/数据）与各自偏移。 */
  table?: {
    headingLine: string | null;
    lines: SourceLine[];
  };
}

/** 标题行判定（#{1,6} + 空白 + 内容）。 */
const HEADING_LINE_RE = /^(#{1,6}) [^\s]/;

/** 计算 header stack 路径：' > ' 连接，硬上限 80 字符（research-chunking §3.1）。 */
function stackPath(stack: TitleEntry[]): string {
  if (stack.length === 0) return '';
  return stack.map((t) => t.text).join(' > ').slice(0, HEADING_PATH_MAX);
}

/** 未转义管道计数（GFM：表头单元数必须等于分隔行）。 */
function cellCount(line: string): number {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  if (!t) return 0;
  return t.split(/(?<!\\)\|/).length;
}

/** GFM 分隔行判定：至少一个 `---` 单元，允许对齐冒号与首尾管道。 */
function isDelimiterRow(text: string): boolean {
  const t = text.trim();
  if (!t.includes('-')) return false;
  return /^\s*\|?(?:\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?\s*$/.test(t);
}

/** 表格起点：当前行含 | + 下一行为分隔行 + 表头与分隔行单元数相等（GFM Example 203）。 */
function isTableStart(lines: SourceLine[], i: number): boolean {
  const line = lines[i];
  if (!line || !line.text.trim() || !line.text.includes('|')) return false;
  const next = lines[i + 1];
  if (!next || !isDelimiterRow(next.text)) return false;
  return cellCount(line.text) === cellCount(next.text);
}

/** 找出表格结束行（exclusive）：空行 / 标题行 / 无管道正文行中断（GFM 表格中断规则）。 */
function findTableEnd(lines: SourceLine[], start: number): number {
  let j = start + 2; // 表头 + 分隔行之后
  while (j < lines.length) {
    const t = lines[j].text;
    if (!t.trim()) break;
    if (HEADING_LINE_RE.test(t)) break;
    if (!t.includes('|')) break;
    j++;
  }
  return j;
}

/** 按行切分源文本（保留每行绝对起始偏移）。 */
function scanLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let pos = 0;
  for (const text of content.split('\n')) {
    lines.push({ text, start: pos });
    pos += text.length + 1;
  }
  return lines;
}

/**
 * 结构扫描：产出「表格单元 + 非表格单元」序列。
 * - 表格（GFM 判定）总是独立成单元，绝不与正文混切（BI 不变式）；
 * - 标题行开启新 section 单元（标题统领其下段落）；
 * - header stack 随标题行弹栈/入栈，为每个单元计算 headingPath。
 */
function scanUnits(content: string): StructuralUnit[] {
  const lines = scanLines(content);
  const units: StructuralUnit[] = [];
  const stack: TitleEntry[] = [];
  let current: StructuralUnit | null = null;
  let lastHeadingLine: string | null = null;
  let i = 0;

  const openUnit = (kind: 'text' | 'section', start: number): StructuralUnit => {
    const unit: StructuralUnit = { kind, start, end: start, headingPath: stackPath(stack) };
    return unit;
  };
  const flushUnit = (end: number): void => {
    if (current) {
      current.end = end;
      units.push(current);
      current = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (HEADING_LINE_RE.test(line.text)) {
      // 标题行：封存旧单元 → 弹栈/入栈 → 开新 section（标题统领）
      flushUnit(line.start);
      const level = line.text.match(HEADING_LINE_RE)![1].length;
      const titleText = line.text.slice(level + 1).trim();
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: titleText });
      lastHeadingLine = line.text;
      current = openUnit('section', line.start);
      current.end = line.start + line.text.length;
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      // 表格：独立单元（整表原子）
      flushUnit(line.start);
      const end = findTableEnd(lines, i);
      units.push({
        kind: 'table',
        start: line.start,
        end: lines[end - 1].start + lines[end - 1].text.length,
        headingPath: stackPath(stack),
        table: {
          // 超长表切片时重复的最近标题行（无标题路径时为 null）
          headingLine: stackPath(stack) ? lastHeadingLine : null,
          lines: lines.slice(i, end),
        },
      });
      i = end;
      continue;
    }

    if (!current) current = openUnit('text', line.start);
    current.end = line.start + line.text.length;
    i++;
  }
  flushUnit(
    lines.length > 0
      ? lines[lines.length - 1].start + lines[lines.length - 1].text.length
      : content.length
  );

  return units;
}

/** 超长段兜底切分的断点前缀（标题行主断点已由结构扫描承担，此处保留 '---' 等兜底）。 */
const HEADING_SEP = ['## ', '# ', '---'];

/** 在 window 中找「新行后紧跟 Heading/分隔符」的切点（结构单元切分内的兜底断点）。 */
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

/** 超长非表格单元的兜底切分（段内标题已由结构扫描切走；保留旧断点 + overlap 语义）。 */
function splitOversizedSegment(
  content: string,
  start: number,
  end: number,
  headingPath: string,
  targetSize: number,
  overlap: number,
  chunks: NoteChunk[]
): void {
  const len = end;
  let cursor = start;

  while (cursor < len) {
    const windowEnd = Math.min(cursor + targetSize, len);
    const window = content.slice(cursor, windowEnd);
    let cut = -1;
    let headed = false;
    const bp = findBreakpoint(window);
    if (bp >= 0) {
      cut = cursor + bp + 1;
      headed = true;
    } else {
      cut = windowEnd;
    }
    const text = content.slice(cursor, cut).trim();
    if (text.length > 0) {
      chunks.push({ seq: chunks.length, text, approxOffset: cursor, headingPath });
    }
    if (cut >= len) break;
    cursor = headed ? cut : Math.max(cut - overlap, cursor + 1);
  }
}

/** 原子单元 → chunk（≤targetSize 单块；超长段走兜底切分；表格整表独立/超长按行切片带表头）。 */
function emitUnit(
  unit: StructuralUnit,
  content: string,
  targetSize: number,
  overlap: number,
  chunks: NoteChunk[]
): void {
  const size = unit.end - unit.start;

  if (unit.kind === 'table' && unit.table) {
    const { headingLine, lines } = unit.table;
    const prefix = headingLine ? headingLine + '\n' : '';
    const full = lines.map((l) => l.text).join('\n');
    if (prefix.length + full.length <= targetSize) {
      // 整表独立成一个 chunk（含最近标题行上下文）
      const text = (prefix + full).trim();
      if (text.length > 0) {
        chunks.push({ seq: chunks.length, text, approxOffset: unit.start, headingPath: unit.headingPath });
      }
      return;
    }
    // 超长表：按行切片，每片重复表头行 + 分隔行（配对保持），不与相邻片 overlap
    const header = lines[0];
    const delimiter = lines[1];
    const dataRows = lines.slice(2);
    let piece: SourceLine[] = [header, delimiter];
    let pieceLen = header.text.length + 1 + delimiter.text.length;
    const flushPiece = (): void => {
      const body = [prefix, ...piece.map((l) => l.text)].join('\n').trim();
      if (body.length > 0) {
        chunks.push({
          seq: chunks.length,
          text: body,
          // 片偏移取该片首个数据行（表头/分隔为复制行，取原文数据位置保单调）
          approxOffset: piece[2].start,
          headingPath: unit.headingPath,
        });
      }
    };
    for (const row of dataRows) {
      const nextLen = pieceLen + 1 + row.text.length;
      if (nextLen > targetSize && piece.length > 2) {
        // 攒满：以表头+分隔为基准开出新片（下一片仍带表头）
        flushPiece();
        piece = [header, delimiter];
        pieceLen = header.text.length + 1 + delimiter.text.length;
      }
      piece.push(row);
      pieceLen += 1 + row.text.length;
    }
    if (piece.length > 2) flushPiece();
    return;
  }

  if (size <= targetSize) {
    const text = content.slice(unit.start, unit.end).trim();
    if (text.length > 0) {
      chunks.push({
        seq: chunks.length,
        text,
        approxOffset: unit.start,
        headingPath: unit.headingPath,
      });
    }
    return;
  }
  splitOversizedSegment(content, unit.start, unit.end, unit.headingPath, targetSize, overlap, chunks);
}

/**
 * 把文档切成 ~targetSize 的块：
 * - 表格边界识别，整表独立成 chunk；超长表按行切分且每片重复表头行+分隔行（三-2②）；
 * - 标题统领：标题 + 其下段落（合计 ≤ targetSize）合并为 1 chunk（三-2②）；
 * - 每块携带 headingPath（四-2②），无标题为空串；相邻非表格块保留 overlap 衔接。
 * 返回块内 seq 递增、approxOffset 递增。
 */
export function splitNote(content: string, opts?: SplitNoteOptions): NoteChunk[] {
  const targetSize = opts?.targetSize ?? 800;
  const overlap = opts?.overlap ?? 80;
  const units = scanUnits(content);

  if (units.length === 0) {
    const text = content.trim();
    return [{ seq: 0, text, approxOffset: 0, headingPath: '' }];
  }

  const chunks: NoteChunk[] = [];
  let buf: StructuralUnit | null = null;

  const flushBuffer = (): void => {
    if (buf) {
      emitUnit(buf, content, targetSize, overlap, chunks);
      buf = null;
    }
  };

  for (const unit of units) {
    if (unit.kind === 'table') {
      // 表格原子：先封存累积的正文，再独立出表
      flushBuffer();
      emitUnit(unit, content, targetSize, overlap, chunks);
      continue;
    }
    if (!buf) {
      buf = { ...unit };
      continue;
    }
    if (unit.end - buf.start <= targetSize) {
      // 标题统领合并：相邻非表格单元拼进同一块（路径取块起始处 stack）
      buf = { ...buf, end: unit.end };
    } else {
      flushBuffer();
      buf = { ...unit };
    }
  }
  flushBuffer();

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
  /**
   * B7 二-6②：每页 text 起始偏移（pageOffsets[i] = 第 i+1 页起点）。
   * 提供时 source_ref 写真实页码 page（替代 60 字符行号近似）。
   */
  pageOffsets?: number[];
}

const EMBED_BATCH_SIZE = 20;

/** 分块并依次落库（FTS 文本 + 可选向量嵌入）。返回落库 chunk 数。 */
async function writeChunks(
  documentId: string,
  content: string,
  fileName: string,
  embeddingConfig?: { baseUrl: string; model: string; apiKey: string },
  pageOffsets?: number[]
): Promise<number> {
  const chunks = splitNote(content);
  if (chunks.length === 0) return 0;

  // 第一步：批量文本分块入库（事务包裹，避免逐条 auto-commit）
  const batchInput = chunks.map((chunk) => ({
    documentId,
    seq: chunk.seq,
    content: chunk.text,
    sourceRef: buildSourceRef(fileName, chunk.approxOffset, undefined, pageOffsets),
    // D4：heading_path 写入（空串由 DAO 归一 NULL）
    headingPath: chunk.headingPath,
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

/**
 * 构造 source_ref（JSON 字符串）。
 * B7 二-6②：有 pageOffsets（PDF/结构化产物）→ 写真实页码 page（二分定位）+ offset，
 * 替代 60 字符行号近似；无 pageOffsets（md/txt 笔记）→ 保留 line 近似（既有消费方兼容）。
 */
export function buildSourceRef(
  fileName: string,
  approxOffset: number,
  fileId?: string | null,
  pageOffsets?: number[]
): string {
  const ref: Record<string, unknown> = {};
  if (fileId != null) ref.fileId = fileId;
  ref.fileName = fileName;
  if (pageOffsets && pageOffsets.length > 0) {
    // 二分：最大 i 满足 pageOffsets[i] <= approxOffset → 页码 i+1
    let lo = 0;
    let hi = pageOffsets.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pageOffsets[mid] <= approxOffset) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    ref.page = idx + 1;
    ref.offset = approxOffset;
  } else if (approxOffset > 0) {
    ref.line = 1 + Math.floor(approxOffset / 60); // 近似行号（约 60 字符/行，md/txt 兼容）
  }
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
    const chunkCount = await writeChunks(docId, file.content, file.name, opts.embedding, opts.pageOffsets);
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
    const chunkCount = await writeChunks(docId, text, title, opts.embedding, opts.pageOffsets);
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

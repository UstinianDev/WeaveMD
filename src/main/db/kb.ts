// ============================================
// WeaveMD — 知识库 Database Operations
// ============================================
// kb_documents / kb_chunks 表 DAO。
// 全部操作按 user_id / document_id 参数化过滤，绝无字符串拼接（SECURITY.md）。
// 检索默认走 FTS5+标题；`kb_chunks.vector` 列保留，由 kbIndexer 在配置了 embedding 时写入，
// 供 searchKB 传 hyde:true 时的向量路径使用（见 knowledge/kbSearch.ts 与 kbSearchFts.vectorSearch）。

import { randomUUID } from 'crypto';
import { getDatabase } from './index';
import type { IKbDocumentStatus } from '@shared/ai';

export type KbDocumentStatus = IKbDocumentStatus['status'];
export type KbSourceType = IKbDocumentStatus['sourceType'];

// ---------------------------------------------------------------------------
// kb_documents
// ---------------------------------------------------------------------------

export interface KbDocumentRow {
  id: string;
  userId: string;
  fileId: string | null;
  /** 关联 parsed_attachments.id（B4 D3；非附件文档为 null） */
  attachmentId: string | null;
  sourceType: KbSourceType;
  title: string;
  pinned: boolean;
  status: KbDocumentStatus;
  /** B11 八-1：勾选授权标记（该文档显式外发授权；历史行/未勾选 = false） */
  consentGranted: boolean;
  createdAt: string;
}

interface KbDocumentDbRow {
  id: string;
  user_id: string;
  file_id: string | null;
  attachment_id?: string | null;
  source_type: string;
  title: string;
  pinned: number;
  status: string;
  /** D5b 迁移前的行/隔离测试行无该列 → undefined 归一 false（fail-closed） */
  consent_granted?: number | null;
  created_at: string;
}

function mapDocumentRow(row: KbDocumentDbRow): KbDocumentRow {
  return {
    id: row.id,
    userId: row.user_id,
    fileId: row.file_id,
    // D3 迁移前的行/隔离测试行无该列 → 归一 null
    attachmentId: row.attachment_id ?? null,
    sourceType: (row.source_type as KbSourceType) || 'import',
    title: row.title,
    pinned: !!row.pinned,
    status: (row.status as KbDocumentStatus) || 'pending',
    consentGranted: !!row.consent_granted,
    createdAt: row.created_at,
  };
}

export interface UpsertKbDocumentInput {
  fileId?: string | null;
  /** 关联 parsed_attachments.id（source_type='attachment' 时写入，B4 D3） */
  attachmentId?: string | null;
  title: string;
  sourceType: KbSourceType;
  pinned?: boolean;
  status?: KbDocumentStatus;
  /**
   * B11 八-1：勾选授权标记（外发过滤键）。
   * undefined = 不改既有授权（重入不因漏传而撤销）；true/false = 显式写入。
   */
  consentGranted?: boolean;
}

/**
 * 插入或按 file / attachment 归属更新 kb_documents；返回（id 或既有 id）标识。
 * 查找优先级：attachmentId（附件文档按附件收敛，重试幂等）> fileId > 无关联（纯导入，新建行）。
 */
export function upsertKbDocument(userId: string, doc: UpsertKbDocumentInput): KbDocumentRow {
  const db = getDatabase();
  const existing =
    doc.attachmentId != null
      ? getKbDocumentByAttachment(userId, doc.attachmentId)
      : doc.fileId != null
        ? getKbDocumentByFile(userId, doc.fileId)
        : null;

  const pinned = doc.pinned ?? false;
  const status = doc.status ?? 'pending';
  const consentGranted = doc.consentGranted ?? false;

  if (existing) {
    // UPDATE 不触碰 attachment_id（既有行已关联；查找即按该关联命中）；
    // consent_granted 仅在显式传入时写（undefined 保留既有授权，不因漏传撤销）
    if (doc.consentGranted !== undefined) {
      db.prepare(
        `UPDATE kb_documents
           SET title = ?, source_type = ?, pinned = ?, status = ?, consent_granted = ?
         WHERE id = ? AND user_id = ?`
      ).run(doc.title, doc.sourceType, pinned ? 1 : 0, status, consentGranted ? 1 : 0, existing.id, userId);
      return {
        ...existing,
        title: doc.title,
        sourceType: doc.sourceType,
        pinned,
        status,
        consentGranted,
      };
    }
    db.prepare(
      `UPDATE kb_documents
         SET title = ?, source_type = ?, pinned = ?, status = ?
       WHERE id = ? AND user_id = ?`
    ).run(doc.title, doc.sourceType, pinned ? 1 : 0, status, existing.id, userId);
    // 直接构造返回值，省掉回读 SELECT
    return { ...existing, title: doc.title, sourceType: doc.sourceType, pinned, status };
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO kb_documents
       (id, user_id, file_id, source_type, title, pinned, status, attachment_id, consent_granted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    doc.fileId ?? null,
    doc.sourceType,
    doc.title,
    pinned ? 1 : 0,
    status,
    doc.attachmentId ?? null,
    consentGranted ? 1 : 0
  );
  // 直接构造返回值，省掉回读 SELECT
  return {
    id,
    userId,
    fileId: doc.fileId ?? null,
    attachmentId: doc.attachmentId ?? null,
    sourceType: doc.sourceType,
    title: doc.title,
    pinned,
    status,
    consentGranted,
    createdAt: new Date().toISOString(),
  };
}

export function getKbDocumentByFile(userId: string, fileId: string): KbDocumentRow | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM kb_documents WHERE file_id = ? AND user_id = ?')
    .get(fileId, userId) as KbDocumentDbRow | undefined;
  if (!row) return null;
  return mapDocumentRow(row);
}

/** 按 attachment_id + user_id 查找附件关联的 KB 文档（B4 D3；跨用户不可见）。 */
export function getKbDocumentByAttachment(
  userId: string,
  attachmentId: string
): KbDocumentRow | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM kb_documents WHERE attachment_id = ? AND user_id = ?')
    .get(attachmentId, userId) as KbDocumentDbRow | undefined;
  if (!row) return null;
  return mapDocumentRow(row);
}

export function getKbDocument(userId: string, docId: string): KbDocumentRow | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM kb_documents WHERE id = ? AND user_id = ?')
    .get(docId, userId) as KbDocumentDbRow | undefined;
  if (!row) return null;
  return mapDocumentRow(row);
}

export function listKbDocumentsByUser(userId: string): KbDocumentRow[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM kb_documents WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as KbDocumentDbRow[];
  return rows.map(mapDocumentRow);
}

/** 单条聚合查询：listKbDocumentsByUser + chunk count（替代 N+1 模式）。 */
export function listKbDocumentsWithChunkCount(userId: string): Array<{
  docId: string;
  fileId: string | null;
  title: string;
  sourceType: KbSourceType;
  pinned: boolean;
  status: KbDocumentStatus;
  chunkCount: number;
  /** R3 D2：勾选授权回读（渲染闸 hasKbEgressGrant 数据源；缺列旧库归一 false）。 */
  consentGranted: boolean;
}> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT d.id AS docId, d.file_id AS fileId, d.title, d.source_type AS sourceType,
           d.pinned, d.status, d.consent_granted AS consentGranted, COUNT(c.id) AS chunkCount
      FROM kb_documents d
      LEFT JOIN kb_chunks c ON c.document_id = d.id
     WHERE d.user_id = ?
     GROUP BY d.id
     ORDER BY d.created_at DESC
  `).all(userId) as Array<{
    docId: string;
    fileId: string | null;
    title: string;
    sourceType: string;
    pinned: number;
    status: string;
    consentGranted: number | null | undefined;
    chunkCount: number;
  }>;
  return rows.map((r) => ({
    docId: r.docId,
    fileId: r.fileId,
    title: r.title,
    sourceType: (r.sourceType as KbSourceType) || 'import',
    pinned: !!r.pinned,
    status: (r.status as KbDocumentStatus) || 'pending',
    consentGranted: r.consentGranted === 1,
    chunkCount: r.chunkCount,
  }));
}

export function deleteKbDocumentByFile(userId: string, fileId: string): boolean {
  const db = getDatabase();
  const info = db
    .prepare('DELETE FROM kb_documents WHERE file_id = ? AND user_id = ?')
    .run(fileId, userId);
  return info.changes > 0;
}

/**
 * B11 八-1② → R3 D4-A 扩展：勾选授权文档 docId 集合（外发过滤白名单）。
 * 仅含 `source_type IN ('attachment','import') AND consent_granted=1`——
 * 授权导入行（目录/单文件导入勾选「允许外发」）同入列；笔记（db/disk）永不入列。
 * 数据层是唯一强制点：`filterKbEgressResults` 消费本集合，allowSend 语义不放宽。
 */
export function getGrantedAttachmentDocIds(userId: string): Set<string> {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT id FROM kb_documents WHERE user_id = ? AND source_type IN (?, ?) AND consent_granted = 1'
    )
    .all(userId, 'attachment', 'import') as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

/**
 * B11 八-1② → R3 D4-A 扩展：是否存在勾选授权的附件或授权导入文档
 * （searchKB 注入判定，fail-closed 默认 false）。口径与 getGrantedAttachmentDocIds 一致。
 */
export function hasGrantedAttachmentDocs(userId: string): boolean {
  const db = getDatabase();
  const row = db
    .prepare(
      'SELECT 1 AS ok FROM kb_documents WHERE user_id = ? AND source_type IN (?, ?) AND consent_granted = 1 LIMIT 1'
    )
    .get(userId, 'attachment', 'import') as { ok: number } | undefined;
  return row != null;
}

/** 删除附件关联的 KB 文档（附件删除→清理 KB，B4 D3）。 */
export function deleteKbDocumentByAttachment(userId: string, attachmentId: string): boolean {
  const db = getDatabase();
  const info = db
    .prepare('DELETE FROM kb_documents WHERE attachment_id = ? AND user_id = ?')
    .run(attachmentId, userId);
  return info.changes > 0;
}

export function deleteKbDocument(userId: string, docId: string): boolean {
  const db = getDatabase();
  const info = db
    .prepare('DELETE FROM kb_documents WHERE id = ? AND user_id = ?')
    .run(docId, userId);
  return info.changes > 0;
}

export function setKbDocStatus(userId: string, docId: string, status: KbDocumentStatus): void {
  const db = getDatabase();
  db.prepare('UPDATE kb_documents SET status = ? WHERE id = ? AND user_id = ?').run(
    status,
    docId,
    userId
  );
}

export function deleteAllKbForUser(userId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM kb_documents WHERE user_id = ?').run(userId);
}

// ---------------------------------------------------------------------------
// kb_chunks
// ---------------------------------------------------------------------------

export interface KbChunkRow {
  id: string;
  documentId: string;
  seq: number;
  content: string;
  sourceRef: string | null;
  createdAt: string;
}

interface KbChunkDbRow {
  id: string;
  document_id: string;
  seq: number;
  content: string;
  source_ref: string | null;
  created_at: string;
}

function mapChunkRow(row: KbChunkDbRow): KbChunkRow {
  return {
    id: row.id,
    documentId: row.document_id,
    seq: row.seq,
    content: row.content,
    sourceRef: row.source_ref ?? null,
    createdAt: row.created_at,
  };
}

export interface InsertChunkInput {
  documentId: string;
  seq: number;
  content: string;
  sourceRef?: string | null;
  /** B5 D4：标题路径（空串归一 NULL，老数据/纯文本降级）。 */
  headingPath?: string | null;
}

export function insertChunk(chunk: InsertChunkInput): KbChunkRow {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO kb_chunks
       (id, document_id, seq, content, source_ref, heading_path)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    chunk.documentId,
    chunk.seq,
    chunk.content,
    chunk.sourceRef ?? null,
    chunk.headingPath || null
  );
  // 回读失败（如 FakeDatabase 隔离）时以写入值组装，保证返回形状稳定。
  const row = db.prepare('SELECT * FROM kb_chunks WHERE id = ?').get(id) as
    | KbChunkDbRow
    | undefined;
  if (row) return mapChunkRow(row);
  return {
    id,
    documentId: chunk.documentId,
    seq: chunk.seq,
    content: chunk.content,
    sourceRef: chunk.sourceRef ?? null,
    createdAt: new Date().toISOString(),
  };
}

/** 批量插入 chunks（事务包裹，避免逐条 auto-commit）。返回插入行。 */
export function insertChunksBatch(chunks: InsertChunkInput[]): KbChunkRow[] {
  const db = getDatabase();
  const insertStmt = db.prepare(
    `INSERT INTO kb_chunks (id, document_id, seq, content, source_ref, heading_path)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const wrapped = db.transaction((items: InsertChunkInput[]) => {
    const results: KbChunkRow[] = [];
    for (const chunk of items) {
      const id = randomUUID();
      insertStmt.run(
        id,
        chunk.documentId,
        chunk.seq,
        chunk.content,
        chunk.sourceRef ?? null,
        // D4 空路径降级：空串不写，统一 NULL（读侧 !!headingPath 判定不受影响）
        chunk.headingPath || null
      );
      results.push({
        id,
        documentId: chunk.documentId,
        seq: chunk.seq,
        content: chunk.content,
        sourceRef: chunk.sourceRef ?? null,
        createdAt: new Date().toISOString(),
      });
    }
    return results;
  });
  return wrapped(chunks);
}

export function deleteChunksByDoc(docId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM kb_chunks WHERE document_id = ?').run(docId);
}

export function getChunksByDoc(docId: string): KbChunkRow[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM kb_chunks WHERE document_id = ? ORDER BY seq ASC')
    .all(docId) as KbChunkDbRow[];
  return rows.map(mapChunkRow);
}

/** 供 listKbDocumentsByUser 补 chunk 计数（KB_LIST）。 */
export function countChunksByDoc(userId: string, docId: string): number {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM kb_chunks c
         JOIN kb_documents d ON d.id = c.document_id
        WHERE c.document_id = ? AND d.user_id = ?`
    )
    .get(docId, userId) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

// ---------------------------------------------------------------------------
// kb_images（R12：图片索引）
// ---------------------------------------------------------------------------

export interface KbImageRow {
  id: string;
  documentId: string;
  sourceRef: string | null;
  mimeType: string;
  embeddingModel: string | null;
  createdAt: string;
}

interface KbImageDbRow {
  id: string;
  document_id: string;
  source_ref: string | null;
  mime_type: string;
  embedding_model: string | null;
  created_at: string;
}

function mapImageRow(row: KbImageDbRow): KbImageRow {
  return {
    id: row.id,
    documentId: row.document_id,
    sourceRef: row.source_ref ?? null,
    mimeType: row.mime_type,
    embeddingModel: row.embedding_model ?? null,
    createdAt: row.created_at,
  };
}

/** 插入一条图片索引记录（kb_images 表）。 */
export function insertImage(row: KbImageRow): void {
  const db = getDatabase();
  db.prepare(
    `INSERT OR REPLACE INTO kb_images
       (id, document_id, source_ref, mime_type, embedding_model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.documentId,
    row.sourceRef ?? null,
    row.mimeType,
    row.embeddingModel ?? null,
    row.createdAt
  );
}

/** 删除指定文档下的所有图片记录。 */
export function deleteImagesByDoc(docId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM kb_images WHERE document_id = ?').run(docId);
}

/** 查询指定文档下的所有图片记录。 */
export function getImagesByDoc(docId: string): KbImageRow[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM kb_images WHERE document_id = ? ORDER BY created_at ASC')
    .all(docId) as KbImageDbRow[];
  return rows.map(mapImageRow);
}

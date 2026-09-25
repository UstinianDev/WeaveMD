// ============================================
// WeaveMD — parsed_attachments DAO + 发送链路落库（doc-pipeline B3 一-4）
// ============================================
// 一物两表：ai_messages.attachments_json 只存轻量元数据（db/ai.ts 白名单序列化），
// 解析产物正文存本表 content 列；parse_status 三态流转 pending → processing → done | error。
// 幂等：INSERT OR REPLACE 按 id 覆盖 —— Agent 任务重试复用同一附件 id 不产生重复行。
// 全部 SQL 参数化 + user_id 归属过滤（SECURITY.md）。

import { randomUUID } from 'crypto';

import { getDatabase } from './index';
import {
  DOCUMENT_PARSE_VERSION,
  isSupportedDocFile,
  type AttachmentParseStatus,
  type IAttachmentMeta,
  type IAttachmentPayload,
} from '@shared/ai';
import { parseDocument } from '../ai/files/documentParser';
import { parseWithLimit } from '../ai/files/parseLimiter';
import { removeByAttachment } from '../ai/knowledge/kbIndexer';

/** 单条消息附件数上限（边界防护，超限截断；chips 折叠 UI 另有 5 个可视上限）。 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 20;

/** parsed_attachments 行（camel 映射）。 */
export interface ParsedAttachmentRecord {
  id: string;
  userId: string;
  conversationId: string | null;
  fileName: string;
  fileType: string;
  content: string;
  parseStatus: AttachmentParseStatus;
  parseVersion: number;
  createdAt: string;
}

interface ParsedAttachmentDbRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  file_name: string;
  file_type: string;
  content: string;
  parse_status: string;
  parse_version: number | null;
  created_at: string;
}

function mapRow(row: ParsedAttachmentDbRow): ParsedAttachmentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    fileName: row.file_name,
    fileType: row.file_type,
    content: row.content,
    // 旧库升级行未回写 parse_status 时按列 DEFAULT 'done' 收敛
    parseStatus: (row.parse_status ?? 'done') as AttachmentParseStatus,
    parseVersion: row.parse_version ?? 1,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// DAO（insert / get / update / remove / listByConversation）
// ---------------------------------------------------------------------------

/** 幂等写入一行附件（INSERT OR REPLACE：状态机从 pending 重新起步）。 */
export function insertParsedAttachment(input: {
  id: string;
  userId: string;
  conversationId: string | null;
  fileName: string;
  fileType: string;
  content: string;
  parseStatus: AttachmentParseStatus;
  parseVersion?: number;
}): void {
  const db = getDatabase();
  db.prepare(
    `INSERT OR REPLACE INTO parsed_attachments
       (id, user_id, conversation_id, file_name, file_type, content, parse_status, parse_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    input.id,
    input.userId,
    input.conversationId,
    input.fileName,
    input.fileType,
    input.content,
    input.parseStatus,
    input.parseVersion ?? DOCUMENT_PARSE_VERSION
  );
}

/** 按 id + user_id 读取（归属校验，跨用户不可见）。 */
export function getParsedAttachment(id: string, userId: string): ParsedAttachmentRecord | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM parsed_attachments WHERE id = ? AND user_id = ?')
    .get(id, userId) as ParsedAttachmentDbRow | undefined;
  return row ? mapRow(row) : null;
}

/** 更新解析状态（pending → processing → done | error 流转）。 */
export function updateParsedAttachmentStatus(
  id: string,
  userId: string,
  status: AttachmentParseStatus
): void {
  const db = getDatabase();
  db.prepare(
    'UPDATE parsed_attachments SET parse_status = ? WHERE id = ? AND user_id = ?'
  ).run(status, id, userId);
}

/** 写入解析正文并置终态（content + status 一并提交）。 */
export function updateParsedAttachmentContent(
  id: string,
  userId: string,
  content: string,
  status: AttachmentParseStatus
): void {
  const db = getDatabase();
  db.prepare(
    'UPDATE parsed_attachments SET content = ?, parse_status = ? WHERE id = ? AND user_id = ?'
  ).run(content, status, id, userId);
}

/**
 * 删除附件行（按 id + user_id）。
 * B4 四-3②：本函数是附件的唯一删除点 —— 删除成功即同步清理关联的 KB 文档
 * （removeByAttachment，对齐 ipc-handlers.ts cleanupKbAfterFileDelete 模式）。
 */
export function removeParsedAttachment(id: string, userId: string): boolean {
  const db = getDatabase();
  const info = db
    .prepare('DELETE FROM parsed_attachments WHERE id = ? AND user_id = ?')
    .run(id, userId);
  const removed = info.changes > 0;
  if (removed) {
    // 删除附件 → 清理 kb_documents（source_type='attachment' 关联行）+ 搜索缓存失效
    removeByAttachment(userId, id);
  }
  return removed;
}

/** 按会话列出附件（conversation_id + user_id 双过滤，时间正序）。 */
export function listParsedAttachmentsByConversation(
  conversationId: string,
  userId: string
): ParsedAttachmentRecord[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM parsed_attachments
        WHERE conversation_id = ? AND user_id = ?
        ORDER BY created_at ASC`
    )
    .all(conversationId, userId) as ParsedAttachmentDbRow[];
  return rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// 发送链路（一-4②）：IPC 边界校验 + 三态流转落库
// ---------------------------------------------------------------------------

/**
 * IPC 边界校验：只接受数组项含合法 fileName/fileType 的载荷；
 * 多余字段（parseStatus/thumb 等）一律剔除 —— 状态由本层状态机重算，不信渲染层。
 * 非法项静默丢弃（单附件失败不断批语义）。
 */
export function sanitizeIncomingAttachments(raw: unknown): IAttachmentPayload[] {
  if (!Array.isArray(raw)) return [];
  const out: IAttachmentPayload[] = [];
  for (const item of raw) {
    if (out.length >= MAX_ATTACHMENTS_PER_MESSAGE) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.fileName !== 'string' || !rec.fileName.trim()) continue;
    if (rec.fileType !== 'file' && rec.fileType !== 'image') continue;
    out.push({
      fileName: rec.fileName,
      fileType: rec.fileType,
      content: typeof rec.content === 'string' ? rec.content : '',
      ...(typeof rec.pageCount === 'number' ? { pageCount: rec.pageCount } : {}),
      ...(typeof rec.id === 'string' && rec.id ? { id: rec.id } : {}),
      ...(typeof rec.path === 'string' && rec.path ? { path: rec.path } : {}),
      ...(typeof rec.size === 'number' && Number.isFinite(rec.size) && rec.size >= 0
        ? { size: rec.size }
        : {}),
    });
  }
  return out;
}

/**
 * 发送链路落两表（一-4②）：先 INSERT pending，再按载荷状态收敛
 * pending → processing → done | error：
 * - 有解析产物 → 直接写 content 置 done；
 * - 文件无产物但有路径 → processing → 主进程经 parseLimiter 补解析（成功 done / 失败 error）；
 * - 图片仅有路径 → done（content 留空，落盘与 vision 随 B6，不塞 base64 进消息表）；
 * - 既无产物也无路径 → error。
 * 返回轻量元数据（无 content），供 appendMessage 写 attachments_json（一物两表）。
 */
export async function persistIncomingAttachments(
  userId: string,
  conversationId: string,
  raw: unknown
): Promise<IAttachmentMeta[]> {
  const items = sanitizeIncomingAttachments(raw);
  if (items.length === 0) return [];

  const conv = conversationId || null;
  const metas: IAttachmentMeta[] = [];

  for (const att of items) {
    const id = att.id ?? randomUUID();
    let status: AttachmentParseStatus = 'pending';
    try {
      insertParsedAttachment({
        id,
        userId,
        conversationId: conv,
        fileName: att.fileName,
        fileType: att.fileType,
        content: '',
        parseStatus: 'pending',
      });

      if (att.content) {
        updateParsedAttachmentContent(id, userId, att.content, 'done');
        status = 'done';
      } else if (att.path && att.fileType === 'file' && isSupportedDocFile(att.fileName)) {
        updateParsedAttachmentStatus(id, userId, 'processing');
        try {
          const parsed = await parseWithLimit(() =>
            parseDocument(att.path as string, att.fileName)
          );
          if (parsed.text && parsed.text.trim()) {
            updateParsedAttachmentContent(id, userId, parsed.text, 'done');
            status = 'done';
          } else {
            // 无文本层/解析失败产物（errorResult）→ error 三态可见
            updateParsedAttachmentStatus(id, userId, 'error');
            status = 'error';
          }
        } catch {
          updateParsedAttachmentStatus(id, userId, 'error');
          status = 'error';
        }
      } else if (att.path) {
        // 图片仅有本地路径：不需要文本解析（vision/落盘随 B6）
        updateParsedAttachmentStatus(id, userId, 'done');
        status = 'done';
      } else {
        updateParsedAttachmentStatus(id, userId, 'error');
        status = 'error';
      }
    } catch (err) {
      // DB 层异常不阻断发送（单附件失败不断批），状态按已有信息兜底
      console.warn('[attachments] persist failed:', err instanceof Error ? err.message : String(err));
      status = att.content ? 'done' : 'error';
    }

    metas.push({
      id,
      type: att.fileType,
      name: att.fileName,
      ...(att.path ? { path: att.path } : {}),
      ...(typeof att.size === 'number' ? { size: att.size } : {}),
      parseStatus: status,
    });
  }

  return metas;
}

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
  type IDocumentStructure,
  type IAttachmentMeta,
  type IAttachmentPayload,
} from '@shared/ai';
import { parseDocument } from '../ai/files/documentParser';
import { parseWithLimit } from '../ai/files/parseLimiter';
import { removeByAttachment } from '../ai/knowledge/kbIndexer';
import {
  deleteAttachmentImage,
  MAX_IMAGE_BYTES,
  storeAttachmentImage,
  type StoreImageErrorCode,
} from '../ai/image/imageStorage';

/** 单条消息附件数上限（边界防护，超限截断；chips 折叠 UI 另有 5 个可视上限）。 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 20;

/** 图片落盘失败 → 用户可读提示（五-2②：格式拒绝 / 大小上限 / 文件缺失）。 */
export function imageStoreErrorMessage(code: StoreImageErrorCode): string {
  switch (code) {
    case 'unsupported_format':
      return '不支持该图片格式（SVG 请先另存为 PNG）';
    case 'too_large':
      return `图片超过 ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB 上限，请压缩后重试`;
    case 'invalid_source':
      return '图片文件不存在或已被移动';
    case 'write_failed':
      return '图片保存失败';
    default:
      return '图片处理失败';
  }
}

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
  /** 解析结构（页码/章节/表格序号，二-6②；坏 JSON 容错 undefined）。 */
  structure?: IDocumentStructure;
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
  structure_json: string | null;
  created_at: string;
}

function parseStructureJson(json: string | null): IDocumentStructure | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as IDocumentStructure;
  } catch {
    /* 坏 JSON 容错：结构缺失不阻断正文读取 */
  }
  return undefined;
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
    structure: parseStructureJson(row.structure_json),
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
  /** 解析结构（二-6②：页码/章节/表格序号 JSON）。 */
  structure?: IDocumentStructure;
}): void {
  const db = getDatabase();
  db.prepare(
    `INSERT OR REPLACE INTO parsed_attachments
       (id, user_id, conversation_id, file_name, file_type, content, parse_status, parse_version, structure_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    input.id,
    input.userId,
    input.conversationId,
    input.fileName,
    input.fileType,
    input.content,
    input.parseStatus,
    input.parseVersion ?? DOCUMENT_PARSE_VERSION,
    input.structure ? JSON.stringify(input.structure) : null
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
 * 写入解析结构（二-6②：页码/章节/表格序号 → structure_json）。
 * 补解析（主进程 re-parse）成功后回写；payload 结构随 insert 直接落库。
 */
export function updateParsedAttachmentStructure(
  id: string,
  userId: string,
  structure: IDocumentStructure
): void {
  const db = getDatabase();
  db.prepare(
    'UPDATE parsed_attachments SET structure_json = ? WHERE id = ? AND user_id = ?'
  ).run(JSON.stringify(structure), id, userId);
}

/**
 * 删除附件行（按 id + user_id）。
 * B4 四-3②：本函数是附件的唯一删除点 —— 删除成功即同步清理关联的 KB 文档
 * （removeByAttachment，对齐 ipc-handlers.ts cleanupKbAfterFileDelete 模式）。
 */
export function removeParsedAttachment(id: string, userId: string): boolean {
  const db = getDatabase();
  // 先取会话归属（参数化查询），删除成功后一并清理该附件的落盘图片
  const row = db
    .prepare('SELECT conversation_id FROM parsed_attachments WHERE id = ? AND user_id = ?')
    .get(id, userId) as { conversation_id: string | null } | undefined;
  const info = db
    .prepare('DELETE FROM parsed_attachments WHERE id = ? AND user_id = ?')
    .run(id, userId);
  const removed = info.changes > 0;
  if (removed) {
    // 删除附件 → 清理 kb_documents（source_type='attachment' 关联行）+ 搜索缓存失效
    removeByAttachment(userId, id);
    // 删除附件 → 清理落盘图片（五-2②，对齐 ipc-handlers.ts 清理模式）
    if (row?.conversation_id) {
      deleteAttachmentImage(userId, row.conversation_id, id);
    }
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
/**
 * IPC 边界结构白名单校验（二-6②）：按字段重建，非法整体丢弃（正文不受影响）。
 * pageOffsets 逐项有限数字且限长（防 IPC 载荷炸弹）。
 */
export function sanitizeStructure(raw: unknown): IDocumentStructure | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.parseVersion !== 'number' || !Number.isFinite(rec.parseVersion)) return undefined;
  const out: IDocumentStructure = { parseVersion: rec.parseVersion };
  if (typeof rec.pageCount === 'number' && Number.isFinite(rec.pageCount) && rec.pageCount >= 0) {
    out.pageCount = rec.pageCount;
  }
  if (Array.isArray(rec.pageOffsets)) {
    if (rec.pageOffsets.length > 1_000_000) return undefined;
    if (!rec.pageOffsets.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
      return undefined;
    }
    out.pageOffsets = rec.pageOffsets as number[];
  }
  if (Array.isArray(rec.sections)) {
    out.sections = rec.sections.filter(
      (sec): sec is { title: string; path: string[] } =>
        !!sec && typeof sec === 'object' &&
        typeof (sec as { title?: unknown }).title === 'string' &&
        Array.isArray((sec as { path?: unknown }).path)
    );
  }
  if (Array.isArray(rec.tables)) {
    out.tables = rec.tables
      .filter((t) => !!t && typeof t === 'object' && typeof (t as { index?: unknown }).index === 'number')
      .map((t) => {
        const tb = t as { index: number; sectionPath?: string[]; pageIndex?: number; csv?: string };
        return {
          index: tb.index,
          sectionPath: Array.isArray(tb.sectionPath) ? tb.sectionPath : [],
          ...(typeof tb.pageIndex === 'number' ? { pageIndex: tb.pageIndex } : {}),
          ...(typeof tb.csv === 'string' ? { csv: tb.csv } : {}),
        };
      });
  }
  if (Array.isArray(rec.images)) {
    // B8 六-1：图片序号白名单（index 正整数；sectionPath 字符串数组；pageIndex 可选）
    out.images = rec.images
      .filter(
        (img): img is { index: number; sectionPath: string[]; pageIndex?: number } =>
          !!img && typeof img === 'object' &&
          typeof (img as { index?: unknown }).index === 'number' &&
          Number.isInteger((img as { index: number }).index) &&
          (img as { index: number }).index >= 1
      )
      .map((img) => {
        const im = img as { sectionPath?: unknown; pageIndex?: unknown };
        return {
          index: (img as { index: number }).index,
          sectionPath: Array.isArray(im.sectionPath)
            ? im.sectionPath.filter((s): s is string => typeof s === 'string')
            : [],
          ...(typeof im.pageIndex === 'number' ? { pageIndex: im.pageIndex } : {}),
        };
      });
  }
  if (rec.metadata && typeof rec.metadata === 'object') {
    const md = rec.metadata as { headersFooters?: unknown };
    out.metadata = {
      ...(Array.isArray(md.headersFooters)
        ? { headersFooters: md.headersFooters.filter((h): h is string => typeof h === 'string') }
        : {}),
    };
  }
  return out;
}

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
      ...(sanitizeStructure(rec.structure) ? { structure: sanitizeStructure(rec.structure) } : {}),
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
    /** 图片落盘后的相对路径（写进 attachments_json，不存 base64，五-2②）。 */
    let storedRelPath: string | undefined;
    /** 图片落盘失败的人类可读提示（svg 拒绝 / 超限等）。 */
    let imageError: string | undefined;
    /** 文件解析失败/降级的显式提示（无文本层等，上屏二-3②）。 */
    let fileError: string | undefined;
    try {
      insertParsedAttachment({
        id,
        userId,
        conversationId: conv,
        fileName: att.fileName,
        fileType: att.fileType,
        content: '',
        parseStatus: 'pending',
        // 二-6②：renderer 解析结构随载荷落库（sanitize 已白名单校验）
        ...(att.structure ? { structure: att.structure } : {}),
      });

      if (att.fileType === 'image') {
        // 五-2：图片落盘 userData/attachments/{userId}/{convId}/{id}.{ext}；
        // content 不写 base64（粘贴 data URL 就地解码写盘），svg/超限 → error 三态可见
        const outcome = storeAttachmentImage({
          userId,
          conversationId: conversationId || '',
          id,
          fileName: att.fileName,
          ...(att.path ? { sourcePath: att.path } : {}),
          ...(att.content ? { dataUrl: att.content } : {}),
        });
        if (outcome.ok) {
          storedRelPath = outcome.value.relPath;
          updateParsedAttachmentStatus(id, userId, 'done');
          status = 'done';
        } else {
          imageError = imageStoreErrorMessage(outcome.error);
          updateParsedAttachmentStatus(id, userId, 'error');
          status = 'error';
        }
      } else if (att.content) {
        updateParsedAttachmentContent(id, userId, att.content, 'done');
        status = 'done';
      } else if (att.path && att.fileType === 'file' && isSupportedDocFile(att.fileName)) {
        updateParsedAttachmentStatus(id, userId, 'processing');
        try {
          // 二-4②：传 userId 供 D 路线解析模型配置（无文本层短路转 D）
          const parsed = await parseWithLimit(() =>
            parseDocument(att.path as string, att.fileName, undefined, { userId })
          );
          if (parsed.text && parsed.text.trim()) {
            updateParsedAttachmentContent(id, userId, parsed.text, 'done');
            // 二-6②：解析结构（页码/章节/表格序号）同步落库
            updateParsedAttachmentStructure(id, userId, {
              ...(parsed.pageCount != null ? { pageCount: parsed.pageCount } : {}),
              ...(parsed.pageOffsets ? { pageOffsets: parsed.pageOffsets } : {}),
              sections: parsed.sections,
              tables: parsed.tables.map((t) => ({
                index: t.index,
                sectionPath: t.sectionPath,
                ...(t.pageIndex != null ? { pageIndex: t.pageIndex } : {}),
                ...(t.csv != null ? { csv: t.csv } : {}),
              })),
              // B8 六-1：图片序号随解析结构落库（analyzeChart 定位锚点）
              ...(parsed.images.length > 0 ? { images: parsed.images } : {}),
              ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
              parseVersion: parsed.parseVersion,
            });
            status = 'done';
          } else {
            // 无文本层/解析失败产物（errorResult）→ error 三态可见；
            // 降级提示上屏（二-3②：给用户明确提示，不静默）
            fileError = parsed.degraded ?? parsed.error ?? '解析失败';
            updateParsedAttachmentStatus(id, userId, 'error');
            status = 'error';
          }
        } catch {
          updateParsedAttachmentStatus(id, userId, 'error');
          status = 'error';
        }
      } else if (att.path) {
        // 非白名单扩展名但带本地路径：无解析产物可写，沿用既有语义记 done（正文空）
        updateParsedAttachmentStatus(id, userId, 'done');
        status = 'done';
      } else {
        updateParsedAttachmentStatus(id, userId, 'error');
        status = 'error';
      }
    } catch (err) {
      // DB 层异常不阻断发送（单附件失败不断批），状态按已有信息兜底
      console.warn('[attachments] persist failed:', err instanceof Error ? err.message : String(err));
      // 图片落盘异常一律 error（三态可见），文件按是否已有产物兜底
      status = att.fileType === 'image' ? 'error' : att.content ? 'done' : 'error';
    }

    metas.push({
      id,
      type: att.fileType,
      name: att.fileName,
      // 图片只存落盘相对路径（落盘失败不回退原始路径，绝对路径读取时重建）；
      // 文件仍为原始绝对路径
      ...(imageError ? { error: imageError } : {}),
      ...(!imageError && fileError ? { error: fileError } : {}),
      ...(storedRelPath
        ? { path: storedRelPath }
        : att.fileType === 'image'
          ? {}
          : att.path
            ? { path: att.path }
            : {}),
      ...(typeof att.size === 'number' ? { size: att.size } : {}),
      parseStatus: status,
    });
  }

  return metas;
}

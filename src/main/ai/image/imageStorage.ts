// ============================================
// WeaveMD — 附件图片落盘与引用（doc-pipeline B6 五-2）
// ============================================
// 目录结构：userData/attachments/{userId}/{conversationId}/{id}.{ext}
// - 消息 attachments_json 只存**相对路径**（相对 userData，正斜杠分隔），
//   绝对路径在读取时由 resolveStoredPath 重建（userData 迁移不失效）。
// - 删除会话 / 删除附件同步清理落盘文件（对齐 ipc-handlers.ts cleanupKbAfterFileDelete 模式）。
// 格式边界（五-2②）：
// - svg 矢量图不可直喂 vision → 明确拒绝（unsupported_format），dialog 侧同步剔除；
// - bmp 经 nativeImage 栅格化为 png，转码失败同样拒绝（不静默发送不被支持的格式）；
// - gif 按原样存储，注入层附加「按首帧处理」提示；
// - 单图超限 → too_large。
// 全部 SQL 无关、纯 fs 操作；返回结构化结果供 IPC 层转三态提示。

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, readdirSync } from 'fs';
import { extname, isAbsolute, join, sep } from 'path';
import { app, nativeImage } from 'electron';

/** 单图字节上限（10MB，超限拒绝并提示）。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 可落盘的图片扩展名白名单（svg 显式排除，bmp 走栅格化）。 */
export const ALLOWED_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] as const;

/** 拒绝清单（明确提示用，含 svg）。 */
export const REJECTED_IMAGE_EXTS = ['svg'] as const;

/** 落盘失败原因（IPC 层据此转用户可读提示）。 */
export type StoreImageErrorCode =
  | 'unsupported_format'
  | 'too_large'
  | 'invalid_source'
  | 'write_failed';

export interface StoreImageInput {
  userId: string;
  conversationId: string;
  /** 附件 id（文件名主键，与 parsed_attachments.id 一致） */
  id: string;
  /** 原始文件名（用于取扩展名/大小校验） */
  fileName?: string;
  /** 系统对话框/文件粘贴带来的本地源路径 */
  sourcePath?: string;
  /** 剪贴板粘贴图片的 data URL */
  dataUrl?: string;
}

export interface StoredImageRef {
  /** 相对 userData 的路径（正斜杠），如 attachments/u1/c1/a1.png */
  relPath: string;
  size: number;
  mimeType: string;
  /** gif 未栅格化时为 true（注入层附加首帧提示） */
  animated?: boolean;
}

export type StoreImageOutcome =
  | { ok: true; value: StoredImageRef }
  | { ok: false; error: StoreImageErrorCode };

/** 扩展名 → MIME（项目唯一映射见 mediaMime，此处仅列白名单）。 */
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** 附件存储根目录（userData/attachments）；electron 不可用时返回 ''（调用方降级为透传）。 */
export function getAttachmentsRoot(): string {
  try {
    return join(app.getPath('userData'), 'attachments');
  } catch {
    return '';
  }
}

/** 归一化扩展名（去点、转小写）。 */
function normalizeExt(nameOrExt: string): string {
  return nameOrExt.replace(/^\./, '').toLowerCase();
}

/** 从文件名取扩展名。 */
function extOf(fileName: string | undefined, fallback: string): string {
  const ext = fileName ? extname(fileName).toLowerCase() : '';
  return ext ? normalizeExt(ext) : fallback;
}

/** data URL → { ext, buffer }；格式不合法返回 null。 */
function decodeDataUrl(dataUrl: string): { ext: string; buffer: Buffer } | null {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const buffer = Buffer.from(m[2], 'base64');
  const byMime: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  };
  const ext = byMime[mime];
  if (!ext) return null;
  return { ext, buffer };
}

/** bmp → png 栅格化（Electron nativeImage；失败返回空 Buffer）。 */
function rasterizeBmp(source: { buffer?: Buffer; path?: string }): Buffer {
  try {
    const img = source.path
      ? nativeImage.createFromPath(source.path)
      : nativeImage.createFromBuffer(source.buffer ?? Buffer.alloc(0));
    return img?.toPNG?.() ?? Buffer.alloc(0);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * 图片落盘（发送链路主进程内调用，不新增 IPC 通道）。
 * 成功返回相对路径引用；失败返回结构化错误码供三态提示。
 */
export function storeAttachmentImage(input: StoreImageInput): StoreImageOutcome {
  const { userId, conversationId, id } = input;
  if (!userId || !conversationId || !id) return { ok: false, error: 'invalid_source' };

  const root = getAttachmentsRoot();
  if (!root) return { ok: false, error: 'write_failed' };

  let sourcePath: string | undefined;
  let dataUrl: string | undefined;
  if (input.sourcePath && existsSync(input.sourcePath)) {
    sourcePath = input.sourcePath;
  } else if (input.dataUrl) {
    dataUrl = input.dataUrl;
  } else if (input.sourcePath) {
    // 有路径但文件不存在（用户移动/删除后才发送）
    return { ok: false, error: 'invalid_source' };
  } else {
    return { ok: false, error: 'invalid_source' };
  }

  // 扩展名与白名单校验（svg 显式拒绝）
  let ext = sourcePath ? extOf(input.fileName ?? sourcePath, '') : extOf(decodeDataUrl(dataUrl!)?.ext, '');
  if (!ext && dataUrl) ext = decodeDataUrl(dataUrl)?.ext ?? '';
  if (REJECTED_IMAGE_EXTS.includes(ext as (typeof REJECTED_IMAGE_EXTS)[number])) {
    return { ok: false, error: 'unsupported_format' };
  }
  if (!ALLOWED_IMAGE_EXTS.includes(ext as (typeof ALLOWED_IMAGE_EXTS)[number])) {
    return { ok: false, error: 'unsupported_format' };
  }

  // 内容读取 + 大小上限
  let buffer: Buffer;
  if (sourcePath) {
    try {
      buffer = readFileSync(sourcePath);
    } catch {
      return { ok: false, error: 'invalid_source' };
    }
  } else {
    const decoded = decodeDataUrl(dataUrl!);
    if (!decoded) return { ok: false, error: 'invalid_source' };
    buffer = decoded.buffer;
  }
  if (buffer.length > MAX_IMAGE_BYTES) return { ok: false, error: 'too_large' };
  if (buffer.length === 0) return { ok: false, error: 'invalid_source' };

  // bmp 栅格化为 png（转码失败 → 明确拒绝，不发送不被支持的格式）
  let storedExt = ext;
  if (ext === 'bmp') {
    const png = rasterizeBmp(sourcePath ? { path: sourcePath } : { buffer });
    if (png.length === 0) return { ok: false, error: 'unsupported_format' };
    buffer = png;
    storedExt = 'png';
  }

  const targetDir = join(root, userId, conversationId);
  try {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, `${id}.${storedExt}`), buffer);
  } catch {
    return { ok: false, error: 'write_failed' };
  }

  return {
    ok: true,
    value: {
      relPath: `attachments/${userId}/${conversationId}/${id}.${storedExt}`,
      size: buffer.length,
      mimeType: EXT_TO_MIME[storedExt] ?? 'image/png',
      ...(ext === 'gif' ? { animated: true } : {}),
    },
  };
}

/**
 * 绝对/相对路径解析：相对路径按附件根重建绝对路径（启动后任意时刻调用均可），
 * 绝对路径原样返回（B3 历史数据兼容）；根不可用时原样透传。
 */
export function resolveStoredPath(pathOrRel: string): string {
  if (!pathOrRel) return pathOrRel;
  if (isAbsolute(pathOrRel)) return pathOrRel;
  const root = getAttachmentsRoot();
  if (!root) return pathOrRel;
  return join(root, pathOrRel.replace(/^attachments\//, ''));
}

/**
 * 绝对路径 → 相对路径（持久化前调用）。不在附件根下返回 null（不改写）。
 */
export function toRelativePath(absPath: string): string | null {
  const root = getAttachmentsRoot();
  if (!root || !absPath) return null;
  const normalized = absPath.replace(/\\/g, '/');
  const rootNormalized = root.replace(/\\/g, '/');
  const prefix = rootNormalized.endsWith('/') ? rootNormalized : `${rootNormalized}/`;
  if (!normalized.startsWith(prefix)) return null;
  // 与 storeAttachmentImage 的返回口径一致：相对 userData、带 attachments/ 前缀
  return `attachments/${normalized.slice(prefix.length)}`;
}

/** 相对路径判定（持久化边界用）。 */
export function isRelativeAttachmentPath(p: string): boolean {
  return !!p && !isAbsolute(p) && p.replace(/\\/g, '/').startsWith('attachments/');
}

/**
 * 删除单个附件的落盘文件（按 id 匹配 `{id}.*`）。
 * 与 removeParsedAttachment 配对调用（附件唯一删除点，B4 四-3②）。
 */
export function deleteAttachmentImage(userId: string, conversationId: string, id: string): boolean {
  const root = getAttachmentsRoot();
  if (!root || !userId || !conversationId || !id) return false;
  const dir = join(root, userId, conversationId);
  if (!existsSync(dir)) return false;
  let removed = false;
  try {
    for (const file of readdirSync(dir)) {
      if (file === id || file.startsWith(`${id}.`)) {
        unlinkSync(join(dir, file));
        removed = true;
      }
    }
  } catch {
    return removed;
  }
  return removed;
}

/**
 * 删除整个会话的落盘图片（删除会话时调用，对齐 ipc-handlers.ts:74-84 清理模式）。
 * 返回删除的文件数。
 */
export function deleteConversationImages(userId: string, conversationId: string): number {
  const root = getAttachmentsRoot();
  if (!root || !userId || !conversationId) return 0;
  const dir = join(root, userId, conversationId);
  if (!existsSync(dir)) return 0;
  let count = 0;
  try {
    for (const file of readdirSync(dir)) {
      const fp = join(dir, file);
      try {
        if (statSync(fp).isFile()) {
          unlinkSync(fp);
          count += 1;
        }
      } catch {
        // 单文件删除失败继续（尽力清理）
      }
    }
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 目录删除失败不影响主流程
  }
  return count;
}

/** 路径分隔符归一（导出供需要比较平台路径的调用方使用）。 */
export function normalizePathSeparators(p: string): string {
  return sep === '\\' ? p.replace(/\\/g, '/') : p;
}

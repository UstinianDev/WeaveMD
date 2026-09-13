// ============================================
// WeaveMD — Media MIME resolver (shared)
// ============================================
// 项目内唯一的扩展名 → MIME 映射表，合并 imageInline.ts 的 MIME_BY_EXT 与
// exportService.ts 的 EXTENSION_CONTENT_TYPES，消除重复定义。
// 供 export、mail、AI 文件解析等模块统一引用。

/** 扩展名 → MIME content type（键不含前导点，小写） */
export const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  'svg+xml': 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
};

/** 可能需要透明通道的扩展名（降采样输出 PNG 保留透明） */
const ALPHA_EXTENSIONS = new Set([
  'png', 'gif', 'webp', 'svg', 'avif', 'ico', 'tiff', 'tif',
]);

/** 归一化扩展名：去前导点 + 转小写 */
export function normalizeExt(ext: string): string {
  return ext.replace(/^\./, '').toLowerCase();
}

/** 根据扩展名解析 MIME 类型；未知回退 application/octet-stream */
export function resolveMediaMime(ext: string): string {
  return EXT_TO_MIME[normalizeExt(ext)] ?? 'application/octet-stream';
}

/** 源扩展名是否可能需要透明通道（决定降采样输出格式） */
export function imageNeedsAlpha(ext: string): boolean {
  return ALPHA_EXTENSIONS.has(normalizeExt(ext));
}
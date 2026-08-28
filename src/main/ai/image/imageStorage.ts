// ============================================
// WeaveMD — 本地图片存储管理
// ============================================
// 图片存储配置（O3）。
// 管理本地图片的存储、检索和清理。

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';

export interface StoredImage {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

/** 图片存储目录。 */
function getStorageDir(): string {
  const dir = join(app.getPath('userData'), 'images');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** MIME 类型映射。 */
const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** 存储图片。 */
export function storeImage(
  sourcePath: string,
  fileName?: string
): StoredImage | null {
  try {
    if (!existsSync(sourcePath)) return null;

    const ext = extname(sourcePath).toLowerCase();
    const mime = MIME_MAP[ext] ?? 'application/octet-stream';
    const id = randomUUID();
    const name = fileName ?? `${id}${ext}`;
    const storageDir = getStorageDir();
    const destPath = join(storageDir, name);

    const data = readFileSync(sourcePath);
    writeFileSync(destPath, data);

    return {
      id,
      fileName: name,
      filePath: destPath,
      mimeType: mime,
      size: data.length,
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** 从 base64 存储图片。 */
export function storeImageFromBase64(
  base64: string,
  mimeType: string
): StoredImage | null {
  try {
    const ext = Object.entries(MIME_MAP).find(([, v]) => v === mimeType)?.[0] ?? '.png';
    const id = randomUUID();
    const fileName = `${id}${ext}`;
    const storageDir = getStorageDir();
    const filePath = join(storageDir, fileName);

    const buffer = Buffer.from(base64, 'base64');
    writeFileSync(filePath, buffer);

    return {
      id,
      fileName,
      filePath,
      mimeType,
      size: buffer.length,
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** 获取图片。 */
export function getImage(id: string): StoredImage | null {
  const storageDir = getStorageDir();
  const files = readdirSync(storageDir);

  for (const file of files) {
    if (file.startsWith(id)) {
      const filePath = join(storageDir, file);
      const stat = statSync(filePath);
      const ext = extname(file).toLowerCase();

      return {
        id,
        fileName: file,
        filePath,
        mimeType: MIME_MAP[ext] ?? 'application/octet-stream',
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
      };
    }
  }

  return null;
}

/** 删除图片。 */
export function deleteImage(id: string): boolean {
  const image = getImage(id);
  if (!image) return false;

  try {
    unlinkSync(image.filePath);
    return true;
  } catch {
    return false;
  }
}

/** 列出所有图片。 */
export function listImages(): StoredImage[] {
  const storageDir = getStorageDir();
  const files = readdirSync(storageDir);
  const images: StoredImage[] = [];

  for (const file of files) {
    const filePath = join(storageDir, file);
    const stat = statSync(filePath);
    const ext = extname(file).toLowerCase();
    const id = file.replace(ext, '');

    images.push({
      id,
      fileName: file,
      filePath,
      mimeType: MIME_MAP[ext] ?? 'application/octet-stream',
      size: stat.size,
      createdAt: stat.birthtime.toISOString(),
    });
  }

  return images;
}

/** 清理过期图片（超过 30 天）。 */
export function cleanupOldImages(maxAgeDays: number = 30): number {
  const images = listImages();
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const image of images) {
    const age = now - new Date(image.createdAt).getTime();
    if (age > maxAgeMs) {
      if (deleteImage(image.id)) cleaned++;
    }
  }

  return cleaned;
}

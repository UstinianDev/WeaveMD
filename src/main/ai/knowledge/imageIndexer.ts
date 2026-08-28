// ============================================
// WeaveMD — 图片索引器（R12）
// ============================================
// 图片 embedding → 写入 kb_images 表 + images_vec 虚拟表。
// 纯主进程模块，依赖 embeddingClient + db/kb + db/index。

import { getDatabase } from '../../db/index';
import { insertImage, deleteImagesByDoc, type KbImageRow } from '../../db/kb';
import {
  createImageEmbedding,
  type EmbeddingProviderConfig,
} from './embeddingClient';

export interface ImageIndexInput {
  id: string;
  documentId: string;
  base64: string;
  mimeType: string;
  sourceRef?: string;
}

/**
 * 批量索引图片：生成 embedding → 写入 kb_images + images_vec。
 *
 * @returns 成功索引的图片数量
 */
export async function indexImages(
  userId: string,
  images: ImageIndexInput[],
  config: EmbeddingProviderConfig
): Promise<number> {
  if (images.length === 0) return 0;

  // 调用图片 embedding API
  const { embeddings, model } = await createImageEmbedding({
    providerConfig: config,
    images: images.map((img) => ({
      id: img.id,
      base64: img.base64,
      mimeType: img.mimeType,
    })),
  });

  // 构建 id→vector 映射
  const vectorMap = new Map<string, number[]>();
  for (const e of embeddings) {
    vectorMap.set(e.id, e.vector);
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  let indexed = 0;

  // 使用事务批量写入
  const writeAll = db.transaction(() => {
    for (const img of images) {
      const vector = vectorMap.get(img.id);
      if (!vector) continue;

      // 写入 kb_images 表
      const row: KbImageRow = {
        id: img.id,
        documentId: img.documentId,
        sourceRef: img.sourceRef ?? null,
        mimeType: img.mimeType,
        embeddingModel: model,
        createdAt: now,
      };
      insertImage(row);

      // 写入 images_vec 虚拟表（vec0）
      try {
        // vec0 要求向量以 Float32Array 或 JSON 数组形式传入
        const vecJson = JSON.stringify(vector);
        db.prepare(
          'INSERT OR REPLACE INTO images_vec (id, vector) VALUES (?, ?)'
        ).run(img.id, vecJson);
      } catch {
        // sqlite-vec 不可用时静默跳过（降级到纯 FTS5）
      }

      indexed++;
    }
  });

  writeAll();
  return indexed;
}

/**
 * 删除指定文档下的所有图片索引（kb_images + images_vec）。
 */
export function removeImagesByDoc(documentId: string): void {
  const db = getDatabase();

  // 先查出该文档下所有图片 id，用于清理 images_vec
  const imageIds = db
    .prepare('SELECT id FROM kb_images WHERE document_id = ?')
    .all(documentId) as Array<{ id: string }>;

  // 删除 kb_images 记录
  deleteImagesByDoc(documentId);

  // 删除 images_vec 向量
  if (imageIds.length > 0) {
    try {
      const placeholders = imageIds.map(() => '?').join(', ');
      db.prepare(
        `DELETE FROM images_vec WHERE id IN (${placeholders})`
      ).run(...imageIds.map((r) => r.id));
    } catch {
      // sqlite-vec 不可用时静默跳过
    }
  }
}

// ============================================
// WeaveMD — 邮件图片校验（纯函数）
// ============================================
// 双向校验中主进程权威部分：数量上限 / 单图大小上限 / 合计大小上限 / 文件缺失。
// 接收已解析的文件信息（size 可能为 null 表示 stat 失败/文件不存在），
// 不触碰文件系统、不整读文件内容——超限即拒，避免内存峰值。
// 渲染层做即时提示（轻量），服务发送前再次以本函数为准（权威）。

import { MAX_FEEDBACK_IMAGES, MAX_IMAGE_SIZE_BYTES, MAX_TOTAL_SIZE_BYTES } from './config';

export interface ImageFileInfo {
  path: string;
  /** stat.size；文件不存在/null 表示缺失 */
  size: number | null;
}

export type ImageValidationErrorCode =
  | 'too_many'
  | 'too_large'
  | 'total_too_large'
  | 'missing';

export type ImageValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: ImageValidationErrorCode;
      message: string;
      path?: string;
      limit?: number;
      maxBytes?: number;
      totalBytes?: number;
    };

/** 校验图片集合是否满足数量/单图/合计/存在性约束。合法返回 {ok:true}。 */
export function validateImages(infos: ImageFileInfo[]): ImageValidationResult {
  if (infos.length > MAX_FEEDBACK_IMAGES) {
    return {
      ok: false,
      code: 'too_many',
      message: `Too many images: max ${MAX_FEEDBACK_IMAGES}`,
      limit: MAX_FEEDBACK_IMAGES,
    };
  }

  let total = 0;
  for (const info of infos) {
    if (info.size == null) {
      return {
        ok: false,
        code: 'missing',
        message: `Image file not found: ${info.path}`,
        path: info.path,
      };
    }
    if (info.size > MAX_IMAGE_SIZE_BYTES) {
      return {
        ok: false,
        code: 'too_large',
        message: `Image exceeds ${MAX_IMAGE_SIZE_BYTES} bytes: ${info.path}`,
        path: info.path,
        maxBytes: MAX_IMAGE_SIZE_BYTES,
      };
    }
    total += info.size;
  }

  if (total > MAX_TOTAL_SIZE_BYTES) {
    return {
      ok: false,
      code: 'total_too_large',
      message: `Total image size exceeds ${MAX_TOTAL_SIZE_BYTES} bytes`,
      maxBytes: MAX_TOTAL_SIZE_BYTES,
      totalBytes: total,
    };
  }

  return { ok: true };
}

// ============================================
// WeaveMD — mail validateImages 纯函数测试（RED → GREEN）
// 覆盖：数量上限 / 单图大小上限 / 合计大小上限 / 文件缺失四类校验。
// validateImages 为纯函数，接收已解析的文件信息（path+size），不触碰真实 fs。
// ============================================
import { describe, expect, it } from 'vitest';
import { validateImages, type ImageFileInfo } from '@main/mail/validateImages';
import {
  MAX_FEEDBACK_IMAGES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_TOTAL_SIZE_BYTES,
} from '@main/mail/config';

describe('validateImages — 图片上限双向校验（主进程权威部分）', () => {
  it('空数组视为合法（无图也可发送）', () => {
    const result = validateImages([]);
    expect(result.ok).toBe(true);
  });

  it('数量恰好等于上限时合法', () => {
    const infos: ImageFileInfo[] = Array.from({ length: MAX_FEEDBACK_IMAGES }, (_, i) => ({
      path: `img${i}.png`,
      size: 100,
    }));
    const result = validateImages(infos);
    expect(result.ok).toBe(true);
  });

  it('数量超过上限 → too_many', () => {
    const infos: ImageFileInfo[] = Array.from({ length: MAX_FEEDBACK_IMAGES + 1 }, (_, i) => ({
      path: `img${i}.png`,
      size: 100,
    }));
    const result = validateImages(infos);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('too_many');
      expect(result.limit).toBe(MAX_FEEDBACK_IMAGES);
    }
  });

  it('单图大小超过 MAX_IMAGE_SIZE_BYTES → too_large', () => {
    const infos: ImageFileInfo[] = [
      { path: 'a.png', size: 10 },
      { path: 'b.png', size: MAX_IMAGE_SIZE_BYTES + 1 },
    ];
    const result = validateImages(infos);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('too_large');
      expect(result.maxBytes).toBe(MAX_IMAGE_SIZE_BYTES);
    }
  });

  it('合计大小超过 MAX_TOTAL_SIZE_BYTES → total_too_large', () => {
    // 每张都在单图上限内，但合计超总上限（需 3 张：2×10MB 恰好等于 20MB 总上限，无法超）
    const each = MAX_IMAGE_SIZE_BYTES - 1; // 略低于单图 10MB
    const infos: ImageFileInfo[] = [
      { path: 'a.png', size: each },
      { path: 'b.png', size: each },
      { path: 'c.png', size: 3 }, // 3×~10MB 合计超 20MB
    ];
    const result = validateImages(infos);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('total_too_large');
      expect(result.maxBytes).toBe(MAX_TOTAL_SIZE_BYTES);
      expect(result.totalBytes).toBe(each * 2 + 3);
    }
  });

  it('单个文件缺失（size 为 null）→ missing，不读整文件', () => {
    const infos: ImageFileInfo[] = [{ path: 'a.png', size: 10 }, { path: 'ghost.png', size: null }];
    const result = validateImages(infos);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('missing');
      expect(result.path).toBe('ghost.png');
    }
  });

  it('大小上限回归：单图恰好等于单图上限合法（边界不误杀）', () => {
    const infos: ImageFileInfo[] = [
      { path: 'a.png', size: MAX_IMAGE_SIZE_BYTES },
    ];
    const result = validateImages(infos);
    expect(result.ok).toBe(true);
  });
});

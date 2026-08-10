// ============================================
// PLAN-EDIT-LINK-IMAGE 切片 A：decodeMediaUrl 纯函数矩阵
// ============================================
// decodeMediaUrl 不依赖 Electron 运行时（纯字符串解析），jsdom 环境可直接测试。
// 契约（见 docs/plan/editor-link-image-fix.plan.md）：
//   渲染层生成 media:// + encodeURIComponent(正斜杠归一化路径)
//   handler 解析：去前缀 → decodeURIComponent 一次 → 校验 Windows 绝对/UNC → 返回解码后的原始路径（保持 \）
import { describe, expect, it } from 'vitest';

import { decodeMediaUrl } from '../../src/main/media-protocol';

describe('decodeMediaUrl — Windows 盘符绝对路径', () => {
  it('解码 C 盘路径（/ 编码、: 编码）并保持原路径', () => {
    expect(decodeMediaUrl('media://C%3A/a.png')).toBe('C:\\a.png');
    expect(decodeMediaUrl('media://C%3A/Users/me/img/a.png')).toBe('C:\\Users\\me\\img\\a.png');
  });

  it('解码含空格 + 中文 + 特殊字符的路径', () => {
    expect(decodeMediaUrl('media://D%3A/my%20folder/图%E7%89%87.png')).toBe(
      'D:\\my folder\\图片.png',
    );
  });

  it('保留解码前端点（# / ?）——它们已被 encodeURIComponent 转义，解码后还原为原始字符', () => {
    // 文件名本身含 #/?：encodeURIComponent 编码后无歧义，这里验证还原
    expect(decodeMediaUrl('media://C%3A/a%23b%20c.png')).toBe('C:\\a#b c.png');
    expect(decodeMediaUrl('media://C%3A/a%3Fb.png')).toBe('C:\\a?b.png');
  });
});

describe('decodeMediaUrl — UNC 路径', () => {
  it('解码 UNC（方案 B：去前缀后 / 被 %2F 编码）', () => {
    expect(decodeMediaUrl('media://%2F%2Fserver%2Fshare%2Fa.png')).toBe(
      '\\\\server\\share\\a.png',
    );
  });

  it('解码含空格 UNC 目录', () => {
    expect(decodeMediaUrl('media://%2F%2Fnas%2Fmy%20share%2Fpic.png')).toBe(
      '\\\\nas\\my share\\pic.png',
    );
  });
});

describe('decodeMediaUrl — 非法/边界输入返回 null', () => {
  it('非 media 协议头返回 null', () => {
    expect(decodeMediaUrl('https://C:/a.png')).toBeNull();
    expect(decodeMediaUrl('file:///C:/a.png')).toBeNull();
    expect(decodeMediaUrl('data:image/png;base64,xxx')).toBeNull();
  });

  it('javascript: / 危险 scheme 返回 null', () => {
    expect(decodeMediaUrl('javascript:alert(1)')).toBeNull();
    expect(decodeMediaUrl('media://javascript:alert(1)')).toBeNull();
  });

  it('相对路径 / 空串 / 非绝对路径返回 null', () => {
    expect(decodeMediaUrl('media://a.png')).toBeNull();
    expect(decodeMediaUrl('media://a/b/c.png')).toBeNull();
    expect(decodeMediaUrl('media://')).toBeNull();
    expect(decodeMediaUrl('')).toBeNull();
  });

  it('缺盘符分隔符（C:/ 非 C:\\）按规范化后不误判', () => {
    // 契约规范是 \，但 C:/ 形式的正斜杠同样视为合法盘符（归一化后 /^[a-zA-Z]:\// 命中）
    expect(decodeMediaUrl('media://C%3A/a.png')).toBe('C:\\a.png');
  });
});

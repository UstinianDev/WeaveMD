// ============================================
// PLAN-EDIT-LINK-IMAGE 切片 C1：index.html CSP img-src 静态断言
// ============================================
// vitest.config.ts 为 css:false，无法在 jsdom 计算 CSP；用 node:fs 读取 index.html
// 对 CSP meta 做字符串存在性断言（与 tests/styles/ft2Css.test.ts 同类做法）。
// 目标：本地图片走 media://、网络图片走 https:/http: 均不被 CSP 阻止（G1/G2）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf-8');

describe('PLAN-EDIT-LINK-IMAGE C1: CSP img-src 放行 media / https / http', () => {
  it('img-src 包含 media: 放行本地图片（media:// 协议）', () => {
    expect(html).toMatch(/img-src\s+'self' data:\s+https:\s+http:\s+media:/);
  });

  it('允许网络图片 https: 与 http:', () => {
    expect(html).toMatch(/img-src[^;]*https:/);
    expect(html).toMatch(/img-src[^;]*http:/);
  });

  it('default-src 仍为 \'self\'（未被连带放宽，安全边界保持）', () => {
    expect(html).toMatch(/default-src\s+'self';/);
  });
});

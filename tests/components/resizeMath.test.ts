// ============================================
// R1-UI：图片缩放纯算术层单测（TDD）
// ============================================
import { describe, expect, it } from 'vitest';

import { computeResizeWidth, RESIZE_MIN_WIDTH } from '@render/components/Editor/v2/resizeMath';

describe('computeResizeWidth — 图片四角缩放算术', () => {
  const min = RESIZE_MIN_WIDTH;
  const max = 1000;

  it('G2: east 角右拖（dx>0）宽度增大；西向无变化', () => {
    expect(computeResizeWidth(200, 50, 'se', min, max)).toBe(250);
    expect(computeResizeWidth(200, 50, 'ne', min, max)).toBe(250);
    expect(computeResizeWidth(200, 50, 'sw', min, max)).toBe(150);
    expect(computeResizeWidth(200, 50, 'nw', min, max)).toBe(150);
  });

  it('east 角左拖（dx<0）宽度减小；west 角反向增大', () => {
    expect(computeResizeWidth(200, -40, 'se', min, max)).toBe(160);
    expect(computeResizeWidth(200, -40, 'nw', min, max)).toBe(240);
  });

  it('G3 下界：宽度不跌破 min（32px）', () => {
    expect(computeResizeWidth(32, -200, 'se', min, max)).toBe(min);
    expect(computeResizeWidth(50, -1000, 'ne', min, max)).toBe(min);
    expect(computeResizeWidth(10, 0, 'sw', min, max)).toBe(min);
  });

  it('G3 上界：宽度不超出 max（容器宽）', () => {
    expect(computeResizeWidth(900, 400, 'se', min, max)).toBe(max);
    // nw 角左拖（dx<0）才增大——340 已是 950+(-(-340)*... ) 直达 max
    expect(computeResizeWidth(950, -340, 'nw', min, max)).toBe(max);
    expect(computeResizeWidth(800, -500, 'sw', min, max)).toBe(max);
  });

  it('结果为整数 px（Math.round 契约）', () => {
    expect(computeResizeWidth(201, 0.5, 'se', min, max)).toBe(202);
    expect(computeResizeWidth(201, 0.4, 'se', min, max)).toBe(201);
  });

  it('非有限输入回落到 min（防御）', () => {
    expect(computeResizeWidth(200, NaN, 'se', min, max)).toBe(min);
    expect(computeResizeWidth(200, Number.POSITIVE_INFINITY, 'ne', min, max)).toBe(min);
  });
});

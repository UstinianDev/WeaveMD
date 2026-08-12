// ============================================
// R1-UI：图片缩放纯算术层单测（TDD）
// ============================================
// computeResizeWidth(startWidth, dx, dy, corner, min, max)
// - 横向分量：east +dx / west −dx；纵向分量：south +dy / north −dy。
// - 按主轴向（|横| ≥ |纵| 用横，否则用纵）取增量 → 对角拖拽实时等比例（宽高比由 img height:auto 保持）。
import { describe, expect, it } from 'vitest';

import { computeResizeWidth, RESIZE_MIN_WIDTH } from '@render/components/Editor/v2/resizeMath';

describe('computeResizeWidth — 图片四角缩放算术', () => {
  const min = RESIZE_MIN_WIDTH;
  const max = 1000;

  it('G2: east 角右拖（dx>0,dy=0）宽度增大；西向反向', () => {
    expect(computeResizeWidth(200, 50, 0, 'se', min, max)).toBe(250);
    expect(computeResizeWidth(200, 50, 0, 'ne', min, max)).toBe(250);
    expect(computeResizeWidth(200, 50, 0, 'sw', min, max)).toBe(150);
    expect(computeResizeWidth(200, 50, 0, 'nw', min, max)).toBe(150);
  });

  it('east 角左拖（dx<0）宽度减小；west 角反向增大', () => {
    expect(computeResizeWidth(200, -40, 0, 'se', min, max)).toBe(160);
    expect(computeResizeWidth(200, -40, 0, 'nw', min, max)).toBe(240);
  });

  it('对角（dy 主导）：se 斜下右拖放大；斜上拖收缩', () => {
    expect(computeResizeWidth(200, 20, 40, 'se', min, max)).toBe(240);
    expect(computeResizeWidth(200, 20, -30, 'se', min, max)).toBe(170);
  });

  it('对角（dx 主导）：斜拖按横向主分量', () => {
    expect(computeResizeWidth(200, 40, 10, 'se', min, max)).toBe(240);
    expect(computeResizeWidth(200, -40, 10, 'se', min, max)).toBe(160);
  });

  it('北角纵向：ne/nw 向下拖（dy>0）收缩（朝对向角）；向上拖（dy<0）放大', () => {
    expect(computeResizeWidth(200, 0, 30, 'ne', min, max)).toBe(170);
    expect(computeResizeWidth(200, 0, -30, 'ne', min, max)).toBe(230);
    expect(computeResizeWidth(200, 0, -30, 'nw', min, max)).toBe(230);
  });

  it('南角纵向：sw 向下拖（dy>0）放大', () => {
    expect(computeResizeWidth(200, 0, 30, 'sw', min, max)).toBe(230);
  });

  it('G3 下界：宽度不跌破 min（32px）', () => {
    expect(computeResizeWidth(32, -200, 0, 'se', min, max)).toBe(min);
    expect(computeResizeWidth(50, -1000, 0, 'ne', min, max)).toBe(min);
    expect(computeResizeWidth(10, 0, 0, 'sw', min, max)).toBe(min);
  });

  it('G3 上界：宽度不超出 max（容器宽）', () => {
    expect(computeResizeWidth(900, 400, 0, 'se', min, max)).toBe(max);
    expect(computeResizeWidth(950, -340, 0, 'nw', min, max)).toBe(max);
    expect(computeResizeWidth(800, -500, 0, 'sw', min, max)).toBe(max);
  });

  it('结果为整数 px（Math.round 契约）', () => {
    expect(computeResizeWidth(201, 0.5, 0, 'se', min, max)).toBe(202);
    expect(computeResizeWidth(201, 0.4, 0, 'se', min, max)).toBe(201);
  });

  it('非有限输入回落到 min（防御）', () => {
    expect(computeResizeWidth(200, NaN, 0, 'se', min, max)).toBe(min);
    expect(computeResizeWidth(200, Number.POSITIVE_INFINITY, 0, 'ne', min, max)).toBe(min);
  });
});

// ============================================
// R1-UI：图片缩放纯算术层单测（TDD）
// ============================================
// computeResizeWidth(startWidth, dx, dy, corner, min, max)
// - 横向分量：east +dx / west −dx；纵向分量：south +dy / north −dy。
// - 增量 = 指针位移长度 √(dx²+dy²)（方向取主轴向符号）→ 对角/横/纵拖拽都实时等比例
//   （宽高比由 img height:auto 保持），斜向按对角距离顺滑增长，无主轴向切换跳变。
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

  it('对角拖拽：增量 = 指针对角位移长度（√(dx²+dy²)），方向取主轴向符号', () => {
    // se 斜下 (20,40)：√(400+1600)≈44.7 → +45
    expect(computeResizeWidth(200, 20, 40, 'se', min, max)).toBe(245);
    // se 斜上 (20,-30)：dominant=-30，√(400+900)≈36.1 → -36
    expect(computeResizeWidth(200, 20, -30, 'se', min, max)).toBe(164);
    // se 斜下 (40,10)：√(1600+100)≈41.2 → +41
    expect(computeResizeWidth(200, 40, 10, 'se', min, max)).toBe(241);
    // se 斜上 (-40,10)：dominant=-40，√41.2 → -41
    expect(computeResizeWidth(200, -40, 10, 'se', min, max)).toBe(159);
  });

  it('G1 用户期望：斜 45° 与缓斜分别按对角距离增长（拖越远长得越大）', () => {
    expect(computeResizeWidth(200, 100, 100, 'se', min, max)).toBe(341); // √(100²+100²)≈141
    expect(computeResizeWidth(200, 100, 50, 'se', min, max)).toBe(312); // √(100²+50²)≈112
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

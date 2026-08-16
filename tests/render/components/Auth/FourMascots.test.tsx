// ============================================
// WeaveMD — FourMascots 测试（渲染 4 角色 + 状态→样式映射 + 瞳孔偏移）
// ============================================

import { act, fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FourMascots, { computeEyeOffset, modeFromState } from '@render/components/Auth/FourMascots';
import type { MascotState } from '@render/components/Auth/InteractiveMascot';

// --- 辅助：mock getBoundingClientRect 供眼随鼠标使用 ---
function mockRect(el: Element, left: number, top: number, width: number, height: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

function renderFour() {
  const { container } = render(<FourMascots state="idle" />);
  return container;
}

describe('FourMascots — 渲染', () => {
  it('渲染 4 个角色（数据魔杖）', () => {
    const container = renderFour();
    const characters = container.querySelectorAll('[data-mascot]');
    expect(characters.length).toBe(4);
  });

  it('每个角色带容器模式类', () => {
    const container = renderFour();
    const characters = container.querySelectorAll('[data-mascot]');
    characters.forEach((c) => {
      expect(c.className).toContain('mascot-character');
    });
  });
});

describe('FourMascots — state→className 映射', () => {
  it.each<[MascotState, string]>([
    ['idle', 'idle'],
    ['focus-username', 'focus-username'],
    ['typing', 'focus-username'],
    ['focus-password', 'focus-password'],
    ['success', 'success'],
    ['error', 'error'],
    ['hover-submit', 'hover-submit'],
  ])('%s → 容器 mode-%s', (state, expectedClass) => {
    const { container } = render(<FourMascots state={state} />);
    const root = container.querySelector('[data-four-mascots]');
    expect(root).not.toBeNull();
    expect(root!.className).toContain(`mode-${expectedClass}`);
  });

  it('passwordVisible=true 时为容器加 mode-peek', () => {
    const { container } = render(<FourMascots state="focus-password" passwordVisible />);
    const root = container.querySelector('[data-four-mascots]');
    expect(root!.className).toContain('mode-peek');
  });
});

describe('FourMascots — 眼随鼠标瞳孔偏移', () => {
  it('computeEyeOffset：on-center 时 dx/dy=0', () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 } as DOMRect;
    expect(computeEyeOffset(200, 150, rect)).toEqual({ dx: 0, dy: 0 });
  });

  it('computeEyeOffset：鼠标右上 → 瞳孔右上位移（dx>0, dy<0），受 maxDist 限制', () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 } as DOMRect;
    // 鼠标远离中心 500px → 位移被 maxDist=9 封顶
    const far = computeEyeOffset(200 + 500, 150 - 500, rect);
    expect(Math.abs(far.dx)).toBeLessThanOrEqual(9.01);
    expect(Math.abs(far.dy)).toBeLessThanOrEqual(9.01);
    expect(far.dx).toBeGreaterThan(0);
    expect(far.dy).toBeLessThan(0);
  });

  it('mousemove 更新末屏角色瞳孔 style 位移（rAF 刷新）', () => {
    let rafCb: FrameRequestCallback | null = null;
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        rafCb = cb;
        return 1;
      });

    const { container, unmount } = render(<FourMascots state="idle" />);
    const root = container.querySelector('[data-four-mascots]')!;
    mockRect(root, 0, 0, 400, 300);
    // 中心 (200,150)；鼠标到 (260,120)：右侧 + 上方
    fireEvent.mouseMove(window, { clientX: 260, clientY: 120 });
    // 触发 rAF 回调（act 包裹保证 setState 落 DOM）
    if (rafCb) {
      act(() => {
        (rafCb as FrameRequestCallback)(16);
      });
    }

    const lastChar = container.querySelector('[data-mascot="3"]')!;
    // 眼随鼠标：瞳孔 style 应透传位移变量（初始 0 → 鼠标右移后 dx>0）
    const pupils = within(lastChar as HTMLElement).getAllByTestId('pupil');
    expect(pupils.length).toBe(2);
    const pxVar = pupils[0].getAttribute('style') ?? '';
    expect(pxVar).toMatch(/--px:\s*-?\d/);
    const pxValue = Number(pxVar.match(/--px:\s*(-?\d+)/)?.[1] ?? 0);
    expect(pxValue).toBeGreaterThan(0);

    unmount();
    rafSpy.mockRestore();
  });
});

// modeFromState 应为跨 state 收敛的纯函数
describe('FourMascots — modeFromState 纯函数', () => {
  it('focus-username 与 typing 均收敛为 focus-username 视唱', () => {
    expect(modeFromState('focus-username')).toBe('focus-username');
    expect(modeFromState('typing')).toBe('focus-username');
  });
});

// ============================================
// WeaveMD — FourMascots
// careercompass 风格四小人物容器：rAF 眼随鼠标 + 随机眨眼 + 模式分发。
// 纯 CSS transitions/keyframes，无动画库。
// 导出纯函数 computeEyeOffset / modeFromState 供测试直接覆盖。
// ============================================

import React, { useEffect, useRef, useState } from 'react';
import MascotCharacter from './MascotCharacter';
import type { MascotState } from './InteractiveMascot';

// --- 角色参数（careercompass 配色/高矮） ---
interface CharacterSpec {
  color: string;
  height: number;
  role: 'tall' | 'calm' | 'short' | 'yellow';
  favoriteToBlink?: boolean;
}

const CHARACTERS: CharacterSpec[] = [
  { color: '#6C3FF5', height: 1.32, role: 'tall', favoriteToBlink: true }, // 紫，最高，爱眨眼
  { color: '#2D2D2D', height: 1.18, role: 'calm' }, // 黑，冷静
  { color: '#FF9B6B', height: 0.9, role: 'short' }, // 橙，矮圆
  { color: '#E8D754', height: 1.02, role: 'yellow' }, // 黄，有情绪
];

const MAX_DIST = 9; // 瞳孔最大位移（px）

/** 纯函数：由鼠标相对角色中心的角度 & 距离计算瞳孔位移（受 MAX_DIST 限制）。 */
export function computeEyeOffset(clientX: number, clientY: number, rect: DOMRect): { dx: number; dy: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dxRaw = clientX - cx;
  const dyRaw = clientY - cy;
  const dist = Math.hypot(dxRaw, dyRaw);
  if (dist === 0) return { dx: 0, dy: 0 };
  const angle = Math.atan2(dyRaw, dxRaw);
  const mag = Math.min(dist, MAX_DIST);
  return { dx: Math.cos(angle) * mag, dy: Math.sin(angle) * mag };
}

/** 纯函数：由表单状态收敛为角色"模式"，供容器分发（focus-username/typing → 变高对视）。 */
export function modeFromState(state: MascotState | 'peek'): string {
  if (state === 'idle') return 'idle';
  if (state === 'focus-username' || state === 'typing') return 'focus-username';
  if (state === 'focus-password') return 'focus-password';
  if (state === 'peek') return 'peek';
  if (state === 'success') return 'success';
  if (state === 'error') return 'error';
  if (state === 'hover-submit') return 'hover-submit';
  return 'idle';
}

interface FourMascotsProps {
  state: MascotState;
  passwordVisible?: boolean;
}

const FourMascots: React.FC<FourMascotsProps> = ({ state, passwordVisible = false }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [blinkIndex, setBlinkIndex] = useState(-1);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const update = (e: MouseEvent): void => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const next = computeEyeOffset(e.clientX, e.clientY, rect);
      if (next.dx !== offset.dx || next.dy !== offset.dy) {
        setOffset(next);
      }
    };

    const onMove = (e: MouseEvent): void => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => update(e));
    };

    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [offset]);

  // 随机眨眼：每个角色独立 3-7s 触发 150ms
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (): void => {
      timer = setTimeout(() => {
        if (!alive) return;
        const target =
          Math.random() < 0.28 ? 0 : // 紫（爱眨眼）略高频
            Math.floor(Math.random() * CHARACTERS.length);
        setBlinkIndex((prev) => (prev === target ? -1 : target));
        setTimeout(() => alive && setBlinkIndex(-1), 150);
        schedule();
      }, 3000 + Math.random() * 4000);
    };
    schedule();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const mode = passwordVisible ? 'peek' : modeFromState(state);

  return (
    <div data-four-mascots={`mode-${mode}`} className={`four-mascots mode-${mode}`} ref={rootRef}>
      {CHARACTERS.map((spec, i) => (
        <MascotCharacter
          key={i}
          index={i}
          color={spec.color}
          height={spec.height}
          pupilX={offset.dx}
          pupilY={offset.dy}
          blink={blinkIndex === i}
          mood={mode === 'error' ? 'sad' : mode === 'success' ? 'happy' : 'neutral'}
          cover={mode === 'focus-password' || (mode === 'peek' && i !== 0)}
          wave={mode === 'hover-submit'}
        />
      ))}
      <style>{FOUR_MASCOTS_CSS}</style>
    </div>
  );
};

const FOUR_MASCOTS_CSS = `
  .four-mascots {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 14px;
    --mc-color: #6C3FF5;
  }

  /* ===== 单个角色（纯 CSS 绘制） ===== */
  .mascot-character {
    position: relative;
    width: 72px;
    display: flex;
    flex-direction: column;
    align-items: center;
    transform-origin: bottom;
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  /* 邮箱 focus：变高 + 对视（紫黑转头互视） */
  .four-mascots.mode-focus-username .mascot-character { transform: scaleY(1.1); }
  .four-mascots.mode-focus-username [data-mascot="0"],
  .four-mascots.mode-focus-username [data-mascot="1"] { transform: scaleY(1.14) translateY(-2px); }
  .four-mascots.mode-focus-username [data-mascot="0"] .mc-head { transform: rotate(10deg); }
  .four-mascots.mode-focus-username [data-mascot="1"] .mc-head { transform: rotate(-10deg); }

  /* 头部 */
  .mc-head {
    position: relative;
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: var(--mc-color);
    z-index: 2;
    transition: transform 0.3s;
  }

  /* 眼窝 */
  .mc-eye {
    position: absolute;
    top: 15px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .mc-eye:first-child { left: 6px; }
  .mc-eye:last-child { right: 6px; }

  /* 瞳孔：style 变量 --px/--py 驱动位移 + 眨眼 scaleY */
  .mc-pupil {
    display: block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #202020;
    transform: translate(var(--px, 0px), var(--py, 0px));
    transition: transform 0.08s ease-out;
  }
  .mascot-character.is-blink .mc-pupil { animation: mc-blink 0.15s ease; }

  /* 嘴 */
  .mc-mouth {
    position: absolute;
    left: 14px;
    top: 30px;
    width: 14px;
    height: 6px;
    border-radius: 0 0 10px 10px;
    background: #fff;
    opacity: 0.9;
  }
  .four-mascots.mode-error .mc-mouth,
  .mascot-character.mood-sad .mc-mouth { border-radius: 10px 10px 0 0; background: #202020; }

  /* 手 */
  .mc-arms { position: absolute; top: 12px; right: 0; left: 0; display: flex; justify-content: center; gap: 30px; z-index: 3; }
  .mc-hand {
    display: block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--mc-color);
    transition: transform 0.3s ease;
  }

  /* 密码 focus：双手上移遮眼 */
  .mascot-character.is-cover .mc-hand {
    transform: translateY(-14px);
    box-shadow: 0 0 0 2px var(--mc-color);
  }
  .mascot-character.is-cover .mc-head { transform: rotateY(18deg); }
  .four-mascots.mode-focus-password [data-mascot="0"] { transform: scale(0.95) translateX(6px); }
  .four-mascots.mode-focus-password [data-mascot="1"] { transform: scale(0.95) translateX(-6px); }

  /* 偷看：紫角色朝密码框（右侧） */
  .four-mascots.mode-peek [data-mascot="0"] .mc-head { transform: rotate(22deg); }
  .four-mascots.mode-peek [data-mascot="0"] .mc-eye { animation: mc-peek 2s ease-in-out infinite; }

  /* 挥手 */
  .mascot-character.is-wave .mc-hand:first-child { animation: mc-wave 0.6s ease-in-out infinite; }

  /* 摇头（error） */
  .four-mascots.mode-error .mascot-character { animation: mc-head-shake 0.5s ease-in-out 2; }
  .four-mascots.mode-error .mc-head { border-radius: 50%; }

  /* 身体 */
  .mc-body {
    width: 46px;
    height: 38px;
    border-radius: 8px 8px 14px 14px;
    background: var(--mc-color);
    opacity: 0.92;
    margin-top: -4px;
  }

  @keyframes mc-blink {
    0%, 100% { transform: scaleY(0.1); }
    50% { transform: scaleY(1); }
  }
  @keyframes mc-head-shake {
    0%, 100% { transform: translateX(0) rotateY(0); }
    25% { transform: translateX(-4px) rotateY(-14deg); }
    75% { transform: translateX(4px) rotateY(14deg); }
  }
  @keyframes mc-peek {
    0%, 100% { transform: translate(var(--px, 0px), var(--py, 0px)); }
    50% { transform: translate(4px, -1px); }
  }
  @keyframes mc-wave {
    0%, 100% { transform: rotate(0); }
    50% { transform: rotate(-18deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .four-mascots,
    .four-mascots .mascot-character,
    .four-mascots .mc-head,
    .four-mascots .mc-pupil { transition: none !important; animation: none !important; }
  }
`;

export default FourMascots;

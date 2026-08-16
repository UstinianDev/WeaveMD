// ============================================
// WeaveMD — MascotCharacter
// 单个纯 CSS 小人物（careercompass 风格）：
// 圆角矩形身体 + 圆形头 + 眼窝/瞳孔，参数化颜色/高矮/表情。
// JS 仅算瞳孔位移（style var）+ 类名开关，纯 CSS transitions/keyframes 无动画库。
// ============================================

import React from 'react';

export interface MascotCharacterProps {
  /** 角色编号（1-4），用于 data 属性定位与顺序感知。 */
  index: number;
  /** 主题色（身体/头填充）。 */
  color: string;
  /** 相对高度（比例），用于区分高矮角色。 */
  height?: number;
  /** 瞳孔位移（px，眼随鼠标）。 */
  pupilX?: number;
  pupilY?: number;
  /** 当前是否眨眼（随机）。 */
  blink?: boolean;
  /** 表情：'neutral' | 'happy' | 'sad' | 'worried'。 */
  mood?: 'neutral' | 'happy' | 'sad' | 'worried';
  /** 遮眼（密码 focus → 手遮眼回避）。 */
  cover?: boolean;
  /** 举手（挥手/兴奋）。 */
  wave?: boolean;
}

const MascotCharacter: React.FC<MascotCharacterProps> = ({
  index,
  color,
  height = 1,
  pupilX = 0,
  pupilY = 0,
  blink = false,
  mood = 'neutral',
  cover = false,
  wave = false,
}) => {
  const moodClass = `mood-${mood}`;

  return (
    <div
      data-mascot={`${index}`}
      data-testid="mascot-character"
      className={`mascot-character ${moodClass} ${cover ? 'is-cover' : ''} ${wave ? 'is-wave' : ''} ${blink ? 'is-blink' : ''}`}
      style={{ height: `${clamp(height, 0.6, 1.4) * 100}px`, '--mc-color': color } as React.CSSProperties}
    >
      {/* 头部 */}
      <div className="mc-head" data-testid="head">
        {/* 眼睛：眼窝 + 瞳孔（style 变量驱动位移） */}
        <div className="mc-eye">
          <span
            className="mc-pupil"
            data-testid="pupil"
            style={{ '--px': `${pupilX}px`, '--py': `${pupilY}px` } as React.CSSProperties}
          />
        </div>
        <div className="mc-eye">
          <span
            className="mc-pupil"
            data-testid="pupil"
            style={{ '--px': `${pupilX}px`, '--py': `${pupilY}px` } as React.CSSProperties}
          />
        </div>
        {/* 嘴 */}
        <div className="mc-mouth" data-testid="mouth" />
      </div>
      {/* 手（遮眼/挥手） */}
      <div className="mc-arms" data-testid="arms">
        <span className="mc-hand" />
        <span className="mc-hand" />
      </div>
      {/* 身体 */}
      <div className="mc-body" data-testid="body" />
    </div>
  );
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export default MascotCharacter;

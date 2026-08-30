// ============================================
// WeaveMD — InteractiveMascot（门面）
// 委托 AnimatedCharacters 渲染 careercompass 风格四小人物。
// 保留 MascotState 导出（防破坏 Login/Signup import）。
// ============================================

import React from 'react';
import AnimatedCharacters from './AnimatedCharacters';

export type MascotState =
  'idle' | 'focus-username' | 'focus-password' | 'typing' | 'success' | 'error' | 'hover-submit';

interface InteractiveMascotProps {
  state: MascotState;
  /** 密码是否已显示（showPassword），驱动紫角色"偷看"。 */
  passwordVisible?: boolean;
  /** 是否正在打字（输入框获焦且有内容）。 */
  isTyping?: boolean;
  /** 当前密码长度，驱动回避/偷看动画。 */
  passwordLength?: number;
}

const STATE_TEXT: Partial<Record<MascotState, { text: string; className: string }>> = {
  'focus-username': { text: "Who's there? 👀", className: 'text-purple-400 animate-pulse' },
  'focus-password': { text: "I won't peek! 🙈", className: 'text-purple-400' },
  typing: { text: 'Keep going... ✍️', className: 'text-purple-400' },
  success: { text: 'Welcome aboard! 🎉', className: 'text-green-400 font-semibold' },
  error: { text: "Oops, something's wrong 😥", className: 'text-red-400' },
  'hover-submit': { text: "Let's go! 🚀", className: 'text-purple-400' },
};

const InteractiveMascot: React.FC<InteractiveMascotProps> = ({
  state,
  passwordVisible = false,
  isTyping = false,
  passwordLength = 0,
}) => {
  const hint = STATE_TEXT[state];

  return (
    <div className="flex flex-col items-center justify-center h-full select-none">
      <AnimatedCharacters
        isTyping={isTyping || state === 'focus-username' || state === 'typing'}
        showPassword={passwordVisible}
        passwordLength={passwordLength}
      />
      {hint && (
        <div className="text-center mt-3">
          <p className={`text-sm ${hint.className}`} style={{ fontFamily: 'Consolas, monospace' }}>
            {hint.text}
          </p>
        </div>
      )}
    </div>
  );
};

export default InteractiveMascot;

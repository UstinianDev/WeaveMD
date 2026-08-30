// ============================================
// WeaveMD — AnimatedCharacters
// CareerCompass 风格四小人 1:1 复刻。
// 四个纯 CSS 角色（紫/黑/橙/黄），支持：
// - 鼠标追踪（身体倾斜 + 眼球跟随）
// - 随机眨眼
// - 打字时互看动画
// - 密码可见时紫角色偷看
// - 密码隐藏时所有角色回避
// 纯 CSS transitions/keyframes，无动画库。
// ============================================

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ---- 子组件：眼球 ----

interface EyeBallProps {
  size?: number;
  pupilSize?: number;
  maxDistance?: number;
  eyeColor?: string;
  pupilColor?: string;
  isBlinking?: boolean;
  forceLookX?: number;
  forceLookY?: number;
}

const EyeBall: React.FC<EyeBallProps> = ({
  size = 48,
  pupilSize = 16,
  maxDistance = 10,
  eyeColor = 'white',
  pupilColor = 'black',
  isBlinking = false,
  forceLookX,
  forceLookY,
}) => {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const eyeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const calculatePupilPosition = useCallback(() => {
    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }
    if (!eyeRef.current) return { x: 0, y: 0 };

    const eye = eyeRef.current.getBoundingClientRect();
    const eyeCenterX = eye.left + eye.width / 2;
    const eyeCenterY = eye.top + eye.height / 2;

    const deltaX = mouseX - eyeCenterX;
    const deltaY = mouseY - eyeCenterY;
    const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance);

    const angle = Math.atan2(deltaY, deltaX);
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  }, [forceLookX, forceLookY, mouseX, mouseY, maxDistance]);

  const pupilPosition = calculatePupilPosition();

  return (
    <div
      ref={eyeRef}
      className="rounded-full flex items-center justify-center"
      style={{
        width: `${size}px`,
        height: isBlinking ? '2px' : `${size}px`,
        backgroundColor: eyeColor,
        overflow: 'hidden',
        transition: 'all 0.15s ease',
      }}
    >
      {!isBlinking && (
        <div
          className="rounded-full"
          style={{
            width: `${pupilSize}px`,
            height: `${pupilSize}px`,
            backgroundColor: pupilColor,
            transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
            transition: 'transform 0.1s ease-out',
          }}
        />
      )}
    </div>
  );
};

// ---- 子组件：纯瞳孔（无白色眼窝）----

interface PupilProps {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
}

const Pupil: React.FC<PupilProps> = ({
  size = 12,
  maxDistance = 5,
  pupilColor = 'black',
  forceLookX,
  forceLookY,
}) => {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const pupilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const calculatePupilPosition = useCallback(() => {
    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }
    if (!pupilRef.current) return { x: 0, y: 0 };

    const pupil = pupilRef.current.getBoundingClientRect();
    const pupilCenterX = pupil.left + pupil.width / 2;
    const pupilCenterY = pupil.top + pupil.height / 2;

    const deltaX = mouseX - pupilCenterX;
    const deltaY = mouseY - pupilCenterY;
    const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance);

    const angle = Math.atan2(deltaY, deltaX);
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  }, [forceLookX, forceLookY, mouseX, mouseY, maxDistance]);

  const pupilPosition = calculatePupilPosition();

  return (
    <div
      ref={pupilRef}
      className="rounded-full"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: pupilColor,
        transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
        transition: 'transform 0.1s ease-out',
      }}
    />
  );
};

// ---- 主组件 ----

interface AnimatedCharactersProps {
  isTyping?: boolean;
  showPassword?: boolean;
  passwordLength?: number;
}

const AnimatedCharacters: React.FC<AnimatedCharactersProps> = ({
  isTyping = false,
  showPassword = false,
  passwordLength = 0,
}) => {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);

  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);

  // 鼠标追踪
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // 紫色角色眨眼
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        setIsPurpleBlinking(true);
        setTimeout(() => {
          if (alive) setIsPurpleBlinking(false);
          schedule();
        }, 150);
      }, Math.random() * 4000 + 3000);
    };
    schedule();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  // 黑色角色眨眼
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        setIsBlackBlinking(true);
        setTimeout(() => {
          if (alive) setIsBlackBlinking(false);
          schedule();
        }, 150);
      }, Math.random() * 4000 + 3000);
    };
    schedule();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  // 打字时互看动画
  useEffect(() => {
    if (isTyping) {
      setIsLookingAtEachOther(true);
      const timer = setTimeout(() => setIsLookingAtEachOther(false), 800);
      return () => clearTimeout(timer);
    } else {
      setIsLookingAtEachOther(false);
    }
  }, [isTyping]);

  // 密码可见时紫角色偷看
  useEffect(() => {
    if (passwordLength > 0 && showPassword) {
      let alive = true;
      let timer: ReturnType<typeof setTimeout>;
      const schedule = () => {
        timer = setTimeout(() => {
          if (!alive) return;
          setIsPurplePeeking(true);
          setTimeout(() => {
            if (alive) setIsPurplePeeking(false);
          }, 800);
        }, Math.random() * 3000 + 2000);
      };
      schedule();
      return () => { alive = false; clearTimeout(timer); };
    } else {
      setIsPurplePeeking(false);
    }
  }, [passwordLength, showPassword, isPurplePeeking]);

  // 计算角色位置（身体倾斜）
  const calculatePosition = useCallback(
    (ref: React.RefObject<HTMLDivElement | null>) => {
      if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };

      const rect = ref.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 3;

      const deltaX = mouseX - centerX;
      const deltaY = mouseY - centerY;

      const faceX = Math.max(-15, Math.min(15, deltaX / 20));
      const faceY = Math.max(-10, Math.min(10, deltaY / 30));
      const bodySkew = Math.max(-6, Math.min(6, -deltaX / 120));

      return { faceX, faceY, bodySkew };
    },
    [mouseX, mouseY],
  );

  const purplePos = calculatePosition(purpleRef);
  const blackPos = calculatePosition(blackRef);
  const yellowPos = calculatePosition(yellowRef);
  const orangePos = calculatePosition(orangeRef);

  const isHidingPassword = passwordLength > 0 && !showPassword;

  return (
    <div className="relative" style={{ width: '550px', height: '400px' }}>
      {/* 紫色高矩形 — 后层 */}
      <div
        ref={purpleRef}
        className="absolute bottom-0"
        style={{
          left: '70px',
          width: '180px',
          height: (isTyping || isHidingPassword) ? '440px' : '400px',
          backgroundColor: '#6C3FF5',
          borderRadius: '10px 10px 0 0',
          zIndex: 1,
          transform:
            passwordLength > 0 && showPassword
              ? 'skewX(0deg)'
              : isTyping || isHidingPassword
                ? `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px)`
                : `skewX(${purplePos.bodySkew || 0}deg)`,
          transformOrigin: 'bottom center',
          transition: 'all 0.7s ease-in-out',
        }}
      >
        <div
          className="absolute flex gap-8"
          style={{
            left:
              passwordLength > 0 && showPassword
                ? '20px'
                : isLookingAtEachOther
                  ? '55px'
                  : `${45 + purplePos.faceX}px`,
            top:
              passwordLength > 0 && showPassword
                ? '35px'
                : isLookingAtEachOther
                  ? '65px'
                  : `${40 + purplePos.faceY}px`,
            transition: 'all 0.7s ease-in-out',
          }}
        >
          <EyeBall
            size={18}
            pupilSize={7}
            maxDistance={5}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isPurpleBlinking}
            forceLookX={
              passwordLength > 0 && showPassword
                ? isPurplePeeking ? 4 : -4
                : isLookingAtEachOther
                  ? 3
                  : undefined
            }
            forceLookY={
              passwordLength > 0 && showPassword
                ? isPurplePeeking ? 5 : -4
                : isLookingAtEachOther
                  ? 4
                  : undefined
            }
          />
          <EyeBall
            size={18}
            pupilSize={7}
            maxDistance={5}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isPurpleBlinking}
            forceLookX={
              passwordLength > 0 && showPassword
                ? isPurplePeeking ? 4 : -4
                : isLookingAtEachOther
                  ? 3
                  : undefined
            }
            forceLookY={
              passwordLength > 0 && showPassword
                ? isPurplePeeking ? 5 : -4
                : isLookingAtEachOther
                  ? 4
                  : undefined
            }
          />
        </div>
      </div>

      {/* 黑色高矩形 — 中层 */}
      <div
        ref={blackRef}
        className="absolute bottom-0"
        style={{
          left: '240px',
          width: '120px',
          height: '310px',
          backgroundColor: '#2D2D2D',
          borderRadius: '8px 8px 0 0',
          zIndex: 2,
          transform:
            passwordLength > 0 && showPassword
              ? 'skewX(0deg)'
              : isLookingAtEachOther
                ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`
                : isTyping || isHidingPassword
                  ? `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)`
                  : `skewX(${blackPos.bodySkew || 0}deg)`,
          transformOrigin: 'bottom center',
          transition: 'all 0.7s ease-in-out',
        }}
      >
        <div
          className="absolute flex gap-6"
          style={{
            left:
              passwordLength > 0 && showPassword
                ? '10px'
                : isLookingAtEachOther
                  ? '32px'
                  : `${26 + blackPos.faceX}px`,
            top:
              passwordLength > 0 && showPassword
                ? '28px'
                : isLookingAtEachOther
                  ? '12px'
                  : `${32 + blackPos.faceY}px`,
            transition: 'all 0.7s ease-in-out',
          }}
        >
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isBlackBlinking}
            forceLookX={
              passwordLength > 0 && showPassword
                ? -4
                : isLookingAtEachOther
                  ? 0
                  : undefined
            }
            forceLookY={
              passwordLength > 0 && showPassword
                ? -4
                : isLookingAtEachOther
                  ? -4
                  : undefined
            }
          />
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isBlackBlinking}
            forceLookX={
              passwordLength > 0 && showPassword
                ? -4
                : isLookingAtEachOther
                  ? 0
                  : undefined
            }
            forceLookY={
              passwordLength > 0 && showPassword
                ? -4
                : isLookingAtEachOther
                  ? -4
                  : undefined
            }
          />
        </div>
      </div>

      {/* 橙色半圆 — 前左 */}
      <div
        ref={orangeRef}
        className="absolute bottom-0"
        style={{
          left: '0px',
          width: '240px',
          height: '200px',
          zIndex: 3,
          backgroundColor: '#FF9B6B',
          borderRadius: '120px 120px 0 0',
          transform:
            passwordLength > 0 && showPassword
              ? 'skewX(0deg)'
              : `skewX(${orangePos.bodySkew || 0}deg)`,
          transformOrigin: 'bottom center',
          transition: 'all 0.7s ease-in-out',
        }}
      >
        <div
          className="absolute flex gap-8"
          style={{
            left:
              passwordLength > 0 && showPassword
                ? '50px'
                : `${82 + (orangePos.faceX || 0)}px`,
            top:
              passwordLength > 0 && showPassword
                ? '85px'
                : `${90 + (orangePos.faceY || 0)}px`,
            transition: 'all 0.2s ease-out',
          }}
        >
          <Pupil
            size={12}
            maxDistance={5}
            pupilColor="#2D2D2D"
            forceLookX={passwordLength > 0 && showPassword ? -5 : undefined}
            forceLookY={passwordLength > 0 && showPassword ? -4 : undefined}
          />
          <Pupil
            size={12}
            maxDistance={5}
            pupilColor="#2D2D2D"
            forceLookX={passwordLength > 0 && showPassword ? -5 : undefined}
            forceLookY={passwordLength > 0 && showPassword ? -4 : undefined}
          />
        </div>
      </div>

      {/* 黄色高矩形 — 前右 */}
      <div
        ref={yellowRef}
        className="absolute bottom-0"
        style={{
          left: '310px',
          width: '140px',
          height: '230px',
          backgroundColor: '#E8D754',
          borderRadius: '70px 70px 0 0',
          zIndex: 4,
          transform:
            passwordLength > 0 && showPassword
              ? 'skewX(0deg)'
              : `skewX(${yellowPos.bodySkew || 0}deg)`,
          transformOrigin: 'bottom center',
          transition: 'all 0.7s ease-in-out',
        }}
      >
        <div
          className="absolute flex gap-6"
          style={{
            left:
              passwordLength > 0 && showPassword
                ? '20px'
                : `${52 + (yellowPos.faceX || 0)}px`,
            top:
              passwordLength > 0 && showPassword
                ? '35px'
                : `${40 + (yellowPos.faceY || 0)}px`,
            transition: 'all 0.2s ease-out',
          }}
        >
          <Pupil
            size={12}
            maxDistance={5}
            pupilColor="#2D2D2D"
            forceLookX={passwordLength > 0 && showPassword ? -5 : undefined}
            forceLookY={passwordLength > 0 && showPassword ? -4 : undefined}
          />
          <Pupil
            size={12}
            maxDistance={5}
            pupilColor="#2D2D2D"
            forceLookX={passwordLength > 0 && showPassword ? -5 : undefined}
            forceLookY={passwordLength > 0 && showPassword ? -4 : undefined}
          />
        </div>
        {/* 嘴巴 */}
        <div
          className="absolute w-20 h-[4px] bg-[#2D2D2D] rounded-full"
          style={{
            left:
              passwordLength > 0 && showPassword
                ? '10px'
                : `${40 + (yellowPos.faceX || 0)}px`,
            top:
              passwordLength > 0 && showPassword
                ? '88px'
                : `${88 + (yellowPos.faceY || 0)}px`,
            transition: 'all 0.2s ease-out',
          }}
        />
      </div>
    </div>
  );
};

export default AnimatedCharacters;

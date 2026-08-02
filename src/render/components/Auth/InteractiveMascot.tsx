// ============================================
// WeaveMD — Interactive Mascot Component
// Eyes follow mouse, reacts to form interactions
// ============================================

import React, { useState, useEffect, useCallback, useRef } from 'react';

export type MascotState =
  'idle' | 'focus-username' | 'focus-password' | 'typing' | 'success' | 'error' | 'hover-submit';

interface InteractiveMascotProps {
  state: MascotState;
}

const InteractiveMascot: React.FC<InteractiveMascotProps> = ({ state }) => {
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const [blink, setBlink] = useState(false);
  const mascotRef = useRef<HTMLDivElement>(null);

  // Track mouse position relative to the mascot container
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!mascotRef.current) return;
      const rect = mascotRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      // Normalize to -1..1 range, clamped
      const dx = Math.max(-1, Math.min(1, (e.clientX - centerX) / (rect.width * 0.8)));
      const dy = Math.max(-1, Math.min(1, (e.clientY - centerY) / (rect.height * 0.8)));
      setMousePos({ x: dx, y: dy });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Blink animation
  useEffect(() => {
    const blinkInterval = setInterval(
      () => {
        setBlink(true);
        setTimeout(() => setBlink(false), 150);
      },
      3000 + Math.random() * 2000
    );
    return () => clearInterval(blinkInterval);
  }, []);

  // Compute eye offsets based on mouse position and state
  const getEyeOffsets = useCallback(() => {
    const maxOffset = 6;
    let dx = mousePos.x * maxOffset;
    let dy = mousePos.y * maxOffset;

    switch (state) {
      case 'focus-username':
        // Look down at the keyboard area
        dy = Math.max(dy, 2);
        dx = dx * 0.5;
        break;
      case 'focus-password':
        // Look away / cover eyes for privacy
        dx = -maxOffset * 0.8;
        dy = -2;
        break;
      case 'typing':
        // Bouncy look
        dy = -3;
        dx = dx * 0.7;
        break;
      case 'success':
        // Happy - eyes curve up
        dy = -maxOffset;
        dx = 0;
        break;
      case 'error':
        // Worried - eyes down
        dy = maxOffset * 0.5;
        dx = 0;
        break;
      case 'hover-submit':
        // Excited
        dy = -maxOffset;
        dx = dx * 1.2;
        break;
      default:
        break;
    }

    return { dx, dy };
  }, [mousePos, state]);

  const { dx, dy } = getEyeOffsets();

  // Pupil positions
  const leftPupilCX = 150 + dx;
  const leftPupilCY = 130 + dy;
  const rightPupilCX = 250 + dx;
  const rightPupilCY = 130 + dy;

  // Determine eye shape based on state
  const eyeOpenness = blink ? 0.1 : state === 'success' ? 0.35 : 1;

  // Body bounce animation
  const bodyBounce = state === 'typing' ? 'animate-bounce-small' : '';

  return (
    <div ref={mascotRef} className="flex flex-col items-center justify-center h-full select-none">
      <div className={`relative transition-transform duration-300 ${bodyBounce}`}>
        <svg
          width="320"
          height="380"
          viewBox="0 0 400 450"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-2xl"
        >
          {/* ===== Body / Torso ===== */}
          {/* Main body - rounded rectangle like a notebook */}
          <rect
            x="100"
            y="220"
            width="200"
            height="180"
            rx="20"
            fill="url(#bodyGradient)"
            stroke="#7C3AED"
            strokeWidth="2"
          />

          {/* Notebook lines */}
          <line
            x1="125"
            y1="260"
            x2="275"
            y2="260"
            stroke="#7C3AED"
            strokeWidth="1"
            opacity="0.3"
          />
          <line
            x1="125"
            y1="285"
            x2="275"
            y2="285"
            stroke="#7C3AED"
            strokeWidth="1"
            opacity="0.3"
          />
          <line
            x1="125"
            y1="310"
            x2="260"
            y2="310"
            stroke="#7C3AED"
            strokeWidth="1"
            opacity="0.3"
          />
          <line
            x1="125"
            y1="335"
            x2="240"
            y2="335"
            stroke="#7C3AED"
            strokeWidth="1"
            opacity="0.3"
          />

          {/* WeaveMD text on body */}
          <text
            x="200"
            y="375"
            textAnchor="middle"
            fill="#7C3AED"
            fontSize="18"
            fontWeight="bold"
            fontFamily="sans-serif"
            opacity="0.6"
          >
            WeaveMD
          </text>

          {/* ===== Head ===== */}
          <ellipse
            cx="200"
            cy="165"
            rx="75"
            ry="70"
            fill="url(#headGradient)"
            stroke="#7C3AED"
            strokeWidth="2"
          />

          {/* ===== Eyes ===== */}
          {/* Left eye background */}
          <ellipse
            cx="150"
            cy="130"
            rx="22"
            ry={22 * eyeOpenness}
            fill="white"
            stroke="#7C3AED"
            strokeWidth="1.5"
          />
          {/* Left pupil */}
          <ellipse
            cx={leftPupilCX}
            cy={leftPupilCY}
            rx="10"
            ry={10 * Math.max(0.3, eyeOpenness)}
            fill="#7C3AED"
            className="transition-all duration-100 ease-out"
          />
          {/* Left pupil highlight */}
          <ellipse
            cx={leftPupilCX - 3}
            cy={leftPupilCY - 3}
            rx="3"
            ry={3 * Math.max(0.3, eyeOpenness)}
            fill="white"
            className="transition-all duration-100 ease-out"
          />

          {/* Right eye background */}
          <ellipse
            cx="250"
            cy="130"
            rx="22"
            ry={22 * eyeOpenness}
            fill="white"
            stroke="#7C3AED"
            strokeWidth="1.5"
          />
          {/* Right pupil */}
          <ellipse
            cx={rightPupilCX}
            cy={rightPupilCY}
            rx="10"
            ry={10 * Math.max(0.3, eyeOpenness)}
            fill="#7C3AED"
            className="transition-all duration-100 ease-out"
          />
          {/* Right pupil highlight */}
          <ellipse
            cx={rightPupilCX - 3}
            cy={rightPupilCY - 3}
            rx="3"
            ry={3 * Math.max(0.3, eyeOpenness)}
            fill="white"
            className="transition-all duration-100 ease-out"
          />

          {/* ===== Eyebrows ===== */}
          {/* Left eyebrow */}
          {state === 'error' ? (
            <line
              x1="128"
              y1="102"
              x2="172"
              y2="108"
              stroke="#7C3AED"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ) : state === 'success' ? (
            <line
              x1="128"
              y1="108"
              x2="172"
              y2="102"
              stroke="#7C3AED"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ) : (
            <line
              x1="130"
              y1="105"
              x2="170"
              y2="105"
              stroke="#7C3AED"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          )}

          {/* Right eyebrow */}
          {state === 'error' ? (
            <line
              x1="228"
              y1="108"
              x2="272"
              y2="102"
              stroke="#7C3AED"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ) : state === 'success' ? (
            <line
              x1="228"
              y1="102"
              x2="272"
              y2="108"
              stroke="#7C3AED"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ) : (
            <line
              x1="230"
              y1="105"
              x2="270"
              y2="105"
              stroke="#7C3AED"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          )}

          {/* ===== Mouth ===== */}
          {state === 'success' ? (
            // Happy smile
            <path
              d="M 170 175 Q 200 200 230 175"
              stroke="#7C3AED"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
          ) : state === 'error' ? (
            // Worried
            <path
              d="M 170 180 Q 200 165 230 180"
              stroke="#7C3AED"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
          ) : state === 'focus-password' ? (
            // Closed/zipped mouth
            <line
              x1="175"
              y1="175"
              x2="225"
              y2="175"
              stroke="#7C3AED"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          ) : (
            // Neutral slight smile
            <path
              d="M 175 172 Q 200 182 225 172"
              stroke="#7C3AED"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          )}

          {/* ===== Arms ===== */}
          {/* Left arm */}
          <g className="origin-bottom-right">
            <path
              d="M 105 260 Q 70 290 60 330"
              stroke="#7C3AED"
              strokeWidth="8"
              strokeLinecap="round"
              fill="none"
              className={state === 'typing' ? 'animate-wave-left' : ''}
            />
            {/* Left hand / pen */}
            <rect
              x="48"
              y="330"
              width="6"
              height="20"
              rx="3"
              fill="#7C3AED"
              transform="rotate(-15 51 340)"
            />
          </g>

          {/* Right arm */}
          <g>
            <path
              d="M 295 260 Q 330 290 340 330"
              stroke="#7C3AED"
              strokeWidth="8"
              strokeLinecap="round"
              fill="none"
              className={state === 'typing' ? 'animate-wave-right' : ''}
            />
            {/* Right hand */}
            <circle cx="342" cy="335" r="10" fill="#7C3AED" opacity="0.3" />
          </g>

          {/* ===== Legs ===== */}
          <rect x="130" y="395" width="30" height="35" rx="12" fill="#7C3AED" opacity="0.5" />
          <rect x="240" y="395" width="30" height="35" rx="12" fill="#7C3AED" opacity="0.5" />

          {/* ===== Gradients ===== */}
          <defs>
            <linearGradient id="bodyGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1A1A1A" />
              <stop offset="100%" stopColor="#0F0F0F" />
            </linearGradient>
            <linearGradient id="headGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1A1A1A" />
              <stop offset="100%" stopColor="#0F0F0F" />
            </linearGradient>
          </defs>
        </svg>

        {/* State indicator text */}
        <div className="text-center mt-2">
          {state === 'focus-username' && (
            <p className="text-sm text-purple-400 animate-pulse">Who&apos;s there? 👀</p>
          )}
          {state === 'focus-password' && (
            <p className="text-sm text-purple-400">I won&apos;t peek! 🙈</p>
          )}
          {state === 'typing' && <p className="text-sm text-purple-400">Keep going... ✍️</p>}
          {state === 'success' && (
            <p className="text-sm text-green-400 font-semibold">Welcome aboard! 🎉</p>
          )}
          {state === 'error' && (
            <p className="text-sm text-red-400">Oops, something&apos;s wrong 😥</p>
          )}
          {state === 'hover-submit' && <p className="text-sm text-purple-400">Let&apos;s go! 🚀</p>}
        </div>
      </div>

      {/* CSS animations for the mascot */}
      <style>{`
        @keyframes bounce-small {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes wave-left {
          0%, 100% { transform: rotate(0deg); transform-origin: 105px 260px; }
          50% { transform: rotate(-10deg); transform-origin: 105px 260px; }
        }
        @keyframes wave-right {
          0%, 100% { transform: rotate(0deg); transform-origin: 295px 260px; }
          50% { transform: rotate(10deg); transform-origin: 295px 260px; }
        }
        .animate-bounce-small {
          animation: bounce-small 0.6s ease-in-out infinite;
        }
        .animate-wave-left {
          animation: wave-left 0.8s ease-in-out infinite;
        }
        .animate-wave-right {
          animation: wave-right 0.8s ease-in-out infinite 0.1s;
        }
      `}</style>
    </div>
  );
};

export default InteractiveMascot;

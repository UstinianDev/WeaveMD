// ============================================
// WeaveMD — Splash Loader Component
// ============================================

import React, { useEffect, useState } from 'react';

interface SplashLoaderProps {
  onComplete: () => void;
}

const SplashLoader: React.FC<SplashLoaderProps> = ({ onComplete }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Auto-complete after animation finishes (1200ms gradient + 800ms text + buffer)
    const timer = setTimeout(() => {
      handleComplete();
    }, 2200);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleComplete = () => {
    if (isExiting) return;
    setIsExiting(true);
    setTimeout(() => {
      onComplete();
    }, 300); // Match exit animation duration
  };

  return (
    <div
      className={`flex items-center justify-center h-screen bg-white overflow-hidden relative ${
        isExiting ? 'splash-exit' : ''
      }`}
      onClick={handleComplete}
    >
      {/* 45-degree purple gradient sweep */}
      <div
        className="absolute inset-0 pointer-events-none splash-gradient"
        style={{
          background:
            'linear-gradient(45deg, transparent 0%, rgba(124,58,237,0.12) 35%, rgba(124,58,237,0.22) 50%, rgba(124,58,237,0.12) 65%, transparent 100%)',
        }}
      />

      {/* WeaveMD text */}
      <div className="text-center">
        <h1
          className="text-[48px] font-bold text-[#7C3AED] select-none tracking-tight"
          style={{
            opacity: 0,
            animation: 'splash-fade-in 800ms ease-out 200ms forwards',
          }}
        >
          WeaveMD
        </h1>
        <p
          className="text-sm text-gray-400 mt-2 select-none"
          style={{
            opacity: 0,
            animation: 'splash-fade-in 800ms ease-out 600ms forwards',
          }}
        >
          Your notes, woven together
        </p>
      </div>

      {/* Click hint */}
      <p className="absolute bottom-12 text-xs text-gray-400 select-none">
        Click anywhere to skip
      </p>
    </div>
  );
};

export default SplashLoader;

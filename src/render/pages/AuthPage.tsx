// ============================================
// WeaveMD — Auth Page Container
// Two-column layout: Left = animated characters, Right = form
// 字体：中文阿里巴巴普惠体 + 英文 Consolas
// ============================================

import React, { useState, useCallback } from 'react';
import LoginPage from '@render/components/Auth/LoginPage';
import SignupPage from '@render/components/Auth/SignupPage';
import InteractiveMascot from '@render/components/Auth/InteractiveMascot';
import AuthWindowControls from '@render/components/Auth/AuthWindowControls';
import type { MascotState } from '@render/components/Auth/InteractiveMascot';

type AuthMode = 'login' | 'register';

const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [prefillUsername, setPrefillUsername] = useState<string | undefined>();
  const [mascotState, setMascotState] = useState<MascotState>('idle');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [passwordLength, setPasswordLength] = useState(0);

  const handleSwitchToRegister = useCallback(() => setMode('register'), []);
  const handleSwitchToLogin = useCallback((username?: string) => {
    setMode('login');
    if (username) setPrefillUsername(username);
  }, []);
  const handleCreateNewAccount = useCallback(() => setMode('register'), []);

  return (
    <div className="flex h-screen overflow-hidden" style={{ fontFamily: 'KaiTi, serif' }}>
      {/* Left Panel — Animated Characters (CareerCompass 风格) */}
      <div
        className="hidden md:flex w-[45%] lg:w-[50%] items-center justify-center relative"
        style={{
          background: 'linear-gradient(135deg, #9CA3AF 0%, #6B7280 50%, #4B5563 100%)',
        }}
      >
        {/* 装饰性背景 */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute"
            style={{
              inset: 0,
              background:
                'repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(255,255,255,0.03) 19px, rgba(255,255,255,0.03) 20px), repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(255,255,255,0.03) 19px, rgba(255,255,255,0.03) 20px)',
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              top: '25%',
              right: '25%',
              width: '16rem',
              height: '16rem',
              background: 'rgba(156,163,175,0.2)',
              filter: 'blur(60px)',
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              bottom: '25%',
              left: '25%',
              width: '24rem',
              height: '24rem',
              background: 'rgba(107,114,128,0.2)',
              filter: 'blur(60px)',
            }}
          />
        </div>

        <div className="relative z-20 flex items-end justify-center" style={{ height: '500px' }}>
          <InteractiveMascot
            state={mascotState}
            passwordVisible={passwordVisible}
            isTyping={isTyping}
            passwordLength={passwordLength}
          />
        </div>

        {/* 底部链接 */}
        <div
          className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-8 text-sm"
          style={{ color: 'rgba(75,85,99,0.7)', fontFamily: 'Consolas, monospace' }}
        >
          <span className="hover:text-gray-900 transition-colors cursor-default">
            WeaveMD © 2026
          </span>
        </div>
      </div>

      {/* Right Panel — Auth Form */}
      <div className="flex-1 flex flex-col bg-white relative">
        {/* Window Controls - top right */}
        <div className="absolute top-0 right-0 z-50">
          <AuthWindowControls />
        </div>

        {/* Form area */}
        <div className="flex-1 flex items-center justify-center p-8">
          {mode === 'register' ? (
            <SignupPage
              onSwitchToLogin={handleSwitchToLogin}
              onMascotStateChange={setMascotState}
              onPasswordVisibleChange={setPasswordVisible}
              onTypingChange={setIsTyping}
              onPasswordLengthChange={setPasswordLength}
            />
          ) : (
            <LoginPage
              onSwitchToRegister={handleSwitchToRegister}
              onCreateNewAccount={handleCreateNewAccount}
              prefillUsername={prefillUsername}
              onMascotStateChange={setMascotState}
              onPasswordVisibleChange={setPasswordVisible}
              onTypingChange={setIsTyping}
              onPasswordLengthChange={setPasswordLength}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthPage;

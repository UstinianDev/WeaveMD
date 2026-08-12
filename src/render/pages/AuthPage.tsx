// ============================================
// WeaveMD — Auth Page Container
// Two-column layout: Left = mascot, Right = form
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

  const handleSwitchToRegister = useCallback(() => setMode('register'), []);
  const handleSwitchToLogin = useCallback((username?: string) => {
    setMode('login');
    if (username) setPrefillUsername(username);
  }, []);
  const handleCreateNewAccount = useCallback(() => setMode('register'), []);

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      {/* Left Panel — Interactive Mascot */}
      <div className="hidden md:flex w-[45%] lg:w-[50%] bg-gradient-to-br from-purple-50 via-white to-indigo-50 items-center justify-center relative border-r border-purple-100">
        {/* Decorative background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-10 left-10 w-32 h-32 bg-purple-200/20 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-10 w-40 h-40 bg-indigo-200/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-purple-100/10 rounded-full blur-3xl" />
        </div>
        <InteractiveMascot state={mascotState} />
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
            />
          ) : (
            <LoginPage
              onSwitchToRegister={handleSwitchToRegister}
              onCreateNewAccount={handleCreateNewAccount}
              prefillUsername={prefillUsername}
              onMascotStateChange={setMascotState}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthPage;

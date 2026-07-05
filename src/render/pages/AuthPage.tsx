// ============================================
// WeaveMD — Auth Page Container
// ============================================

import React, { useState } from 'react';
import LoginPage from '../components/Auth/LoginPage';
import SignupPage from '../components/Auth/SignupPage';

type AuthMode = 'login' | 'register';

const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [prefillUsername, setPrefillUsername] = useState<string | undefined>();

  const handleSwitchToRegister = () => setMode('register');
  const handleSwitchToLogin = (username?: string) => {
    setMode('login');
    if (username) setPrefillUsername(username);
  };
  const handleCreateNewAccount = () => setMode('register');

  if (mode === 'register') {
    return <SignupPage onSwitchToLogin={handleSwitchToLogin} />;
  }

  return (
    <LoginPage
      onSwitchToRegister={handleSwitchToRegister}
      onCreateNewAccount={handleCreateNewAccount}
      prefillUsername={prefillUsername}
    />
  );
};

export default AuthPage;

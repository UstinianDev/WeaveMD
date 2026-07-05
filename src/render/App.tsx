// ============================================
// WeaveMD — Root Application Component
// ============================================

import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from './stores/authStore';
import { useUIStore } from './stores/uiStore';
import SplashLoader from './components/Auth/SplashLoader';
import AuthPage from './pages/AuthPage';
import MainPage from './pages/MainPage';

type AppPhase = 'splash' | 'auth' | 'main';

const App: React.FC = () => {
  const [phase, setPhase] = useState<AppPhase>('splash');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loadSettings = useUIStore((s) => s.loadSettings);
  const loadRecentAccounts = useAuthStore((s) => s.loadRecentAccounts);

  useEffect(() => {
    // Load persisted UI settings and recent accounts
    loadSettings();
    loadRecentAccounts();

    // Try to restore session from stored token
    const token = localStorage.getItem('weavemd_token');
    const userStr = localStorage.getItem('weavemd_user');

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        // Validate token with backend before accepting
        window.weaveMD.auth.validateToken(token).then((result: unknown) => {
          const r = result as { success: boolean; data?: { id: string; username: string; createdAt: string; lastLogin: string | null } };
          if (r.success && r.data) {
            useAuthStore.getState().login(r.data, token);
          } else {
            // Token expired or invalid
            localStorage.removeItem('weavemd_token');
            localStorage.removeItem('weavemd_user');
          }
        }).catch(() => {
          // Can't reach backend, use stored data anyway for offline
          useAuthStore.getState().login(user, token);
        });
      } catch {
        localStorage.removeItem('weavemd_token');
        localStorage.removeItem('weavemd_user');
      }
    }
  }, [loadSettings, loadRecentAccounts]);

  // Sync phase with auth state
  useEffect(() => {
    if (phase === 'splash') return;
    setPhase(isAuthenticated ? 'main' : 'auth');
  }, [isAuthenticated, phase]);

  // Apply theme class to html element
  const theme = useUIStore((s) => s.theme);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('dark', 'light');
    if (theme === 'dark' || theme === 'high-contrast') {
      html.classList.add('dark');
    } else {
      html.classList.add('light');
    }
  }, [theme]);

  const handleSplashComplete = useCallback(() => {
    setPhase(isAuthenticated ? 'main' : 'auth');
  }, [isAuthenticated]);

  if (phase === 'splash') {
    return <SplashLoader onComplete={handleSplashComplete} />;
  }

  if (phase === 'auth') {
    return <AuthPage />;
  }

  return <MainPage />;
};

export default App;

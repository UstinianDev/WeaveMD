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

  // Load settings from backend and apply
  const loadBackendSettings = useCallback(async (userId: string) => {
    try {
      const result = (await window.weaveMD.settings.get(userId)) as {
        success: boolean;
        data?: { theme?: string; language?: string };
      };
      if (result.success && result.data) {
        const uiStore = useUIStore.getState();
        if (result.data.theme)
          uiStore.setTheme(
            result.data.theme as 'light' | 'dark' | 'light-header' | 'high-contrast' | 'custom'
          );
        if (result.data.language)
          uiStore.setLanguage(result.data.language as 'zh-CN' | 'zh-TW' | 'en');
      }
    } catch {
      // Use localStorage settings as fallback
    }
  }, []);

  useEffect(() => {
    // Load persisted UI settings from localStorage
    loadSettings();
    loadRecentAccounts();

    // Try to restore session from stored token
    const token = localStorage.getItem('weavemd_token');
    const userStr = localStorage.getItem('weavemd_user');

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        window.weaveMD.auth
          .validateToken(token)
          .then((result: unknown) => {
            const r = result as {
              success: boolean;
              data?: {
                id: string;
                username: string;
                createdAt: string;
                lastLogin: string | null;
              };
            };
            if (r.success && r.data) {
              useAuthStore.getState().login(r.data, token);
              loadBackendSettings(r.data.id);
            } else {
              localStorage.removeItem('weavemd_token');
              localStorage.removeItem('weavemd_user');
            }
          })
          .catch(() => {
            useAuthStore.getState().login(user, token);
            loadBackendSettings(user.id);
          });
      } catch {
        localStorage.removeItem('weavemd_token');
        localStorage.removeItem('weavemd_user');
      }
    }
  }, [loadSettings, loadRecentAccounts, loadBackendSettings]);

  // Sync phase with auth state
  useEffect(() => {
    if (phase === 'splash') return;
    setPhase(isAuthenticated ? 'main' : 'auth');
  }, [isAuthenticated, phase]);

  // Apply theme classes to html element
  const theme = useUIStore((s) => s.theme);
  useEffect(() => {
    const html = document.documentElement;
    // Remove all theme classes
    html.classList.remove('dark', 'light', 'light-header', 'high-contrast', 'custom', 'notus');
    // Apply current theme class
    html.classList.add(theme);
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

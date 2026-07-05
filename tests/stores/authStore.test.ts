// ============================================
// WeaveMD — Auth Store Tests
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../../src/render/stores/authStore';

describe('authStore', () => {
  beforeEach(() => {
    // Reset store state
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      recentAccounts: [],
    });
    localStorage.clear();
  });

  it('should start with unauthenticated state', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
  });

  it('should login successfully and set state', () => {
    const user = { id: '1', username: 'testuser', createdAt: '2024-01-01', lastLogin: null };
    const token = 'jwt-token-123';

    useAuthStore.getState().login(user, token);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual(user);
    expect(state.token).toBe(token);
    expect(localStorage.getItem('weavemd_token')).toBe(token);
  });

  it('should logout and clear state', () => {
    const user = { id: '1', username: 'testuser', createdAt: '2024-01-01', lastLogin: null };
    useAuthStore.getState().login(user, 'token');

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(localStorage.getItem('weavemd_token')).toBeNull();
  });

  it('should add recent accounts and respect max limit', () => {
    const store = useAuthStore.getState();

    // Add 12 accounts
    for (let i = 1; i <= 12; i++) {
      store.addRecentAccount(`user${i}`);
    }

    const { recentAccounts } = useAuthStore.getState();
    expect(recentAccounts.length).toBe(10); // Max 10
    expect(recentAccounts[0]).toBe('user12'); // Most recent first
  });

  it('should deduplicate recent accounts', () => {
    const store = useAuthStore.getState();
    store.addRecentAccount('alice');
    store.addRecentAccount('bob');
    store.addRecentAccount('alice'); // Duplicate

    const { recentAccounts } = useAuthStore.getState();
    expect(recentAccounts).toEqual(['alice', 'bob']);
  });

  it('should load recent accounts from localStorage', () => {
    localStorage.setItem('weavemd_recent_accounts', JSON.stringify(['charlie', 'dave']));

    useAuthStore.getState().loadRecentAccounts();

    const { recentAccounts } = useAuthStore.getState();
    expect(recentAccounts).toEqual(['charlie', 'dave']);
  });
});

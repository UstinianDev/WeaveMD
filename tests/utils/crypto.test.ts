// ============================================
// WeaveMD — Crypto Utilities Tests
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveRememberedCredentials,
  getRememberedCredentials,
  clearRememberedCredentials,
} from '@render/utils/crypto';

describe('crypto', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should save and retrieve remembered credentials', () => {
    saveRememberedCredentials('testuser', 'mypassword123');

    const creds = getRememberedCredentials();
    expect(creds).not.toBeNull();
    expect(creds!.username).toBe('testuser');
    expect(creds!.password).toBe('mypassword123');
  });

  it('should return null when no credentials saved', () => {
    const creds = getRememberedCredentials();
    expect(creds).toBeNull();
  });

  it('should clear remembered credentials', () => {
    saveRememberedCredentials('testuser', 'password');
    clearRememberedCredentials();

    const creds = getRememberedCredentials();
    expect(creds).toBeNull();
  });

  it('should handle special characters in password', () => {
    const specialPassword = 'p@ss!💡#123';
    saveRememberedCredentials('user', specialPassword);

    const creds = getRememberedCredentials();
    expect(creds!.password).toBe(specialPassword);
  });
});

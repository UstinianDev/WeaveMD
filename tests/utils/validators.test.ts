// ============================================
// WeaveMD — Validators Tests
// ============================================

import { describe, it, expect } from 'vitest';
import {
  validateUsername,
  validatePassword,
  getPasswordStrength,
  generateCaptcha,
  validateCaptcha,
} from '@render/utils/validators';

describe('validateUsername', () => {
  it('should reject empty username', () => {
    expect(validateUsername('').valid).toBe(false);
    expect(validateUsername('   ').valid).toBe(false);
  });

  it('should reject username shorter than 5 chars', () => {
    expect(validateUsername('ab').valid).toBe(false);
    expect(validateUsername('abc').valid).toBe(false);
  });

  it('should reject username starting with number', () => {
    expect(validateUsername('1testuser').valid).toBe(false);
  });

  it('should reject username with special chars', () => {
    expect(validateUsername('test@user').valid).toBe(false);
    expect(validateUsername('test user').valid).toBe(false);
  });

  it('should reject reserved usernames', () => {
    expect(validateUsername('admin').valid).toBe(false);
    expect(validateUsername('root').valid).toBe(false);
    expect(validateUsername('system').valid).toBe(false);
  });

  it('should accept valid usernames', () => {
    expect(validateUsername('testuser').valid).toBe(true);
    expect(validateUsername('my_user_1').valid).toBe(true);
    expect(validateUsername('Abc123').valid).toBe(true);
  });
});

describe('validatePassword', () => {
  it('should reject empty password', () => {
    expect(validatePassword('').valid).toBe(false);
  });

  it('should reject password shorter than 8 chars', () => {
    expect(validatePassword('Ab1!').valid).toBe(false);
  });

  it('should accept valid passwords', () => {
    expect(validatePassword('MyPass123!').valid).toBe(true);
    expect(validatePassword('abcdefgh').valid).toBe(true);
  });
});

describe('getPasswordStrength', () => {
  it('should return weak for short passwords', () => {
    expect(getPasswordStrength('abc')).toBe('weak');
    expect(getPasswordStrength('')).toBe('weak');
  });

  it('should return weak for simple 8-char passwords', () => {
    expect(getPasswordStrength('abcdefgh')).toBe('weak');
    expect(getPasswordStrength('12345678')).toBe('weak');
  });

  it('should return medium for mixed passwords', () => {
    expect(getPasswordStrength('MyPassword')).toBe('medium');
    expect(getPasswordStrength('abc12345')).toBe('medium');
  });

  it('should return strong for complex passwords', () => {
    expect(getPasswordStrength('MyStr0ng!Pass')).toBe('strong');
    expect(getPasswordStrength('P@ssw0rd12345')).toBe('strong');
  });
});

describe('generateCaptcha', () => {
  it('should generate a question and answer', () => {
    const captcha = generateCaptcha();
    expect(captcha.question).toBeTruthy();
    expect(typeof captcha.answer).toBe('number');
  });

  it('should generate valid arithmetic questions', () => {
    for (let i = 0; i < 20; i++) {
      const captcha = generateCaptcha();
      // Extract the operator and numbers
      const match = captcha.question.match(/(\d+)\s*([+\-×])\s*(\d+)/);
      expect(match).toBeTruthy();
      if (match) {
        const a = parseInt(match[1]);
        const op = match[2];
        const b = parseInt(match[3]);
        expect(a).toBeGreaterThanOrEqual(1);
        expect(a).toBeLessThanOrEqual(20);
        expect(b).toBeGreaterThanOrEqual(1);
        expect(b).toBeLessThanOrEqual(20);

        let expected: number;
        switch (op) {
          case '+': expected = a + b; break;
          case '-': expected = a - b; break;
          case '×': expected = a * b; break;
          default: expected = 0;
        }
        expect(captcha.answer).toBe(expected);
      }
    }
  });
});

describe('validateCaptcha', () => {
  it('should validate correct answer', () => {
    expect(validateCaptcha('10', 10)).toBe(true);
    expect(validateCaptcha('0', 0)).toBe(true);
    expect(validateCaptcha('-5', -5)).toBe(true);
  });

  it('should reject incorrect answer', () => {
    expect(validateCaptcha('10', 5)).toBe(false);
  });

  it('should reject non-numeric input', () => {
    expect(validateCaptcha('abc', 10)).toBe(false);
    expect(validateCaptcha('', 10)).toBe(false);
  });
});

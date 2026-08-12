// ============================================
// WeaveMD — Input Validators
// ============================================

import { USERNAME_REGEX, PASSWORD_MIN_LENGTH, RESERVED_USERNAMES } from '@shared/constants';

export type PasswordStrength = 'weak' | 'medium' | 'strong';

export interface ValidationResult {
  valid: boolean;
  message: string;
}

export function validateUsername(username: string): ValidationResult {
  if (!username || username.trim().length === 0) {
    return { valid: false, message: 'Username is required' };
  }

  const normalized = username.toLowerCase().trim();

  if (normalized.length < 5) {
    return { valid: false, message: 'Username must be at least 5 characters' };
  }

  if (normalized.length > 15) {
    return { valid: false, message: 'Username must be at most 15 characters' };
  }

  if (!USERNAME_REGEX.test(normalized)) {
    return {
      valid: false,
      message: 'Must start with a letter, use only a-z, 0-9, _',
    };
  }

  if (RESERVED_USERNAMES.includes(normalized)) {
    return { valid: false, message: 'This username is reserved' };
  }

  return { valid: true, message: '' };
}

export function validatePassword(password: string): ValidationResult {
  if (!password || password.length === 0) {
    return { valid: false, message: 'Password is required' };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, message: 'Password must be at least 8 characters' };
  }

  return { valid: true, message: '' };
}

export function getPasswordStrength(password: string): PasswordStrength {
  if (!password || password.length < 8) {
    return 'weak';
  }

  let score = 0;

  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 2) return 'weak';
  if (score <= 4) return 'medium';
  return 'strong';
}

export function generateCaptcha(): { question: string; answer: number } {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const operators = ['+', '-', '×'] as const;
  const op = operators[Math.floor(Math.random() * operators.length)];

  let answer: number;
  let question: string;

  switch (op) {
    case '+':
      answer = a + b;
      question = `${a} + ${b} = ?`;
      break;
    case '-':
      answer = a - b;
      question = `${a} - ${b} = ?`;
      break;
    case '×':
      answer = a * b;
      question = `${a} × ${b} = ?`;
      break;
    default:
      answer = a + b;
      question = `${a} + ${b} = ?`;
  }

  return { question, answer };
}

export function validateCaptcha(userAnswer: string, correctAnswer: number): boolean {
  const parsed = parseInt(userAnswer, 10);
  return !isNaN(parsed) && parsed === correctAnswer;
}

export function validateFileContent(content: string): ValidationResult {
  if (content === undefined || content === null) {
    return { valid: false, message: 'Content is required' };
  }
  return { valid: true, message: '' };
}

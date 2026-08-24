import { describe, expect, it } from 'vitest';
import {
  executeAskQuestionCard,
  validateAnswers,
} from '@main/ai/tools/askQuestionCard';
import type { IClarifyQuestion, IClarifySession } from '@shared/ai';

describe('executeAskQuestionCard', () => {
  it('returns success + session for valid text question', () => {
    const result = executeAskQuestionCard({
      questions: [{ id: 'q1', text: 'What?', type: 'text' }],
    });
    expect(result.success).toBe(true);
    expect(result.session.phase).toBe('asking');
    expect(result.session.questions).toHaveLength(1);
    expect(result.session.answers).toEqual({});
  });

  it('returns success for choice question with options', () => {
    const result = executeAskQuestionCard({
      questions: [
        {
          id: 'q1',
          text: 'Pick',
          type: 'choice',
          options: ['A', 'B', 'C'],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('returns success for confirm question', () => {
    const result = executeAskQuestionCard({
      questions: [{ id: 'q1', text: 'Sure?', type: 'confirm' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty questions array', () => {
    const result = executeAskQuestionCard({ questions: [] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('1-5');
  });

  it('rejects more than 5 questions', () => {
    const questions: IClarifyQuestion[] = Array.from({ length: 6 }, (_, i) => ({
      id: `q${i}`,
      text: `Q${i}`,
      type: 'text' as const,
    }));
    const result = executeAskQuestionCard({ questions });
    expect(result.success).toBe(false);
    expect(result.error).toContain('1-5');
  });

  it('accepts exactly 5 questions', () => {
    const questions: IClarifyQuestion[] = Array.from({ length: 5 }, (_, i) => ({
      id: `q${i}`,
      text: `Q${i}`,
      type: 'text' as const,
    }));
    const result = executeAskQuestionCard({ questions });
    expect(result.success).toBe(true);
  });

  it('rejects question missing id', () => {
    const result = executeAskQuestionCard({
      questions: [{ id: '', text: 'What?', type: 'text' }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('id, text, and type');
  });

  it('rejects question missing text', () => {
    const result = executeAskQuestionCard({
      questions: [{ id: 'q1', text: '', type: 'text' }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('id, text, and type');
  });

  it('rejects choice question without options', () => {
    const result = executeAskQuestionCard({
      questions: [{ id: 'q1', text: 'Pick', type: 'choice' }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('must have options');
  });

  it('rejects choice question with empty options array', () => {
    const result = executeAskQuestionCard({
      questions: [{ id: 'q1', text: 'Pick', type: 'choice', options: [] }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('must have options');
  });
});

describe('validateAnswers', () => {
  const baseSession: IClarifySession = {
    questions: [
      { id: 'name', text: 'Your name?', type: 'text' },
      { id: 'lang', text: 'Language?', type: 'choice', options: ['en', 'zh'] },
      { id: 'confirm', text: 'Proceed?', type: 'confirm' },
    ],
    answers: {},
    phase: 'asking',
  };

  it('passes when all questions answered correctly', () => {
    const result = validateAnswers(baseSession, {
      name: 'Alice',
      lang: 'en',
      confirm: 'yes',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when required question is missing', () => {
    const result = validateAnswers(baseSession, {
      lang: 'en',
      confirm: 'yes',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('name');
  });

  it('fails when required question answer is empty string', () => {
    const result = validateAnswers(baseSession, {
      name: '   ',
      lang: 'en',
      confirm: 'yes',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('name');
  });

  it('fails when choice answer is not in options', () => {
    const result = validateAnswers(baseSession, {
      name: 'Bob',
      lang: 'fr',
      confirm: 'yes',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('en, zh');
  });

  it('skips conditional question when dependency not met', () => {
    const session: IClarifySession = {
      questions: [
        { id: 'has_key', text: 'Have key?', type: 'confirm' },
        {
          id: 'key_val',
          text: 'Paste key',
          type: 'text',
          dependsOn: 'has_key',
          condition: 'yes',
        },
      ],
      answers: {},
      phase: 'asking',
    };
    // has_key = 'no' -> key_val should be skipped
    const result = validateAnswers(session, { has_key: 'no' });
    expect(result.valid).toBe(true);
  });

  it('requires conditional question when dependency IS met', () => {
    const session: IClarifySession = {
      questions: [
        { id: 'has_key', text: 'Have key?', type: 'confirm' },
        {
          id: 'key_val',
          text: 'Paste key',
          type: 'text',
          dependsOn: 'has_key',
          condition: 'yes',
        },
      ],
      answers: {},
      phase: 'asking',
    };
    // has_key = 'yes' -> key_val is required
    const result = validateAnswers(session, { has_key: 'yes' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('key_val');
  });

  it('reports multiple errors', () => {
    const result = validateAnswers(baseSession, {});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });
});

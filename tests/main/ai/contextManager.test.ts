import { describe, expect, it } from 'vitest';
import { buildCompressed, estimateTokens, shouldCompress } from '@main/ai/contextManager';

describe('contextManager.estimateTokens', () => {
  it('estimates ceil(len/4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello world')).toBe(Math.ceil(11 / 4));
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('abc')).toBe(1);
  });
});

describe('contextManager.shouldCompress', () => {
  it('compresses at/above 80% threshold', () => {
    expect(shouldCompress(8000, 10000, 0.8)).toBe(true);
    expect(shouldCompress(7999, 10000, 0.8)).toBe(false);
    expect(shouldCompress(8000, 10000)).toBe(true); // 默认 0.8
    expect(shouldCompress(5000, 10000, 0.8)).toBe(false);
  });
});

describe('contextManager.buildCompressed', () => {
  const makePair = (n: number): Array<{ role: string; content: string }> => [
    { role: 'user', content: `u${n}` },
    { role: 'assistant', content: `a${n}` },
  ];

  it('returns only summary system when no keep rounds', () => {
    const out = buildCompressed([], 'S', 0);
    expect(out).toEqual([{ role: 'system', content: '以下为历史摘要：S' }]);
  });

  it('keeps recent N rounds of user/assistant original text below summary', () => {
    const msgs = [...makePair(1), ...makePair(2), ...makePair(3), ...makePair(4)];
    const out = buildCompressed(msgs, 'S', 2);
    // summary 置顶 + 保留最近 2 轮
    expect(out[0].role).toBe('system');
    expect(out[0].content).toContain('S');
    const rest = out.slice(1).map((m) => m.content);
    expect(rest).toEqual(['u3', 'a3', 'u4', 'a4']);
  });

  it('keeps tool messages belonging to the most recent assistant round', () => {
    const msgs = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: '' },
      { role: 'tool', content: 'toolResult1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ];
    const out = buildCompressed(msgs, 'S', 1);
    const rest = out.slice(1).map((m) => m.content);
    expect(rest).toEqual(['u2', 'a2']);
  });

  it('preserves everything when keepRecentRounds exceeds message count', () => {
    const msgs = [...makePair(1), ...makePair(2)];
    const out = buildCompressed(msgs, 'S', 10);
    expect(out.slice(1)).toEqual(msgs);
  });
});

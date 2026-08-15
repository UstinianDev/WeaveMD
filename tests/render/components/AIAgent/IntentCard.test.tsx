// ============================================
// WeaveMD — IntentCard 组件测试（TDD strict）
// ============================================
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import IntentCard, { isAmbiguousIntent } from '@render/components/AIAgent/IntentCard';
import type { IIntent } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => ({ t: (key: string) => `[${key}]`, language: 'zh-CN' }),
}));

const ambiguousIntent: IIntent = {
  intent: 'chat',
  confidence: 0.3,
  candidates: ['create', 'rewrite', 'tech'],
  reason: '模糊',
};

const clearIntent: IIntent = {
  intent: 'kbQa',
  confidence: 0.9,
};

describe('isAmbiguousIntent', () => {
  it('低置信度判定为模糊', () => {
    expect(isAmbiguousIntent(ambiguousIntent)).toBe(true);
  });
  it('高置信度且无候选判定为非模糊', () => {
    expect(isAmbiguousIntent(clearIntent)).toBe(false);
  });
});

describe('IntentCard', () => {
  it('渲染候选卡片并按点击回调意图名', () => {
    const onPick = vi.fn();
    render(<IntentCard intent={ambiguousIntent} onPick={onPick} />);
    // 提示标题
    expect(screen.getByText('[ai.intent.hint]')).toBeInTheDocument();
    // 三个候选卡片
    expect(screen.getByText('[ai.intent.create]')).toBeInTheDocument();
    expect(screen.getByText('[ai.intent.rewrite]')).toBeInTheDocument();
    expect(screen.getByText('[ai.intent.tech]')).toBeInTheDocument();

    fireEvent.click(screen.getByText('[ai.intent.create]'));
    expect(onPick).toHaveBeenCalledWith('create');
  });

  it('无候选时渲染单一意图卡片', () => {
    const onPick = vi.fn();
    render(<IntentCard intent={clearIntent} onPick={onPick} />);
    expect(screen.getByText('[ai.intent.kbQa]')).toBeInTheDocument();
    fireEvent.click(screen.getByText('[ai.intent.kbQa]'));
    expect(onPick).toHaveBeenCalledWith('kbQa');
  });
});

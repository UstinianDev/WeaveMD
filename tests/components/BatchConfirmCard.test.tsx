// ============================================
// agent-multi-intent 任务 11/12 — 多写汇总确认卡 BatchConfirmCard
// 覆盖：逐项 q.text 全文展示（staleness 警示前缀自然呈现）/
//       逐项 保留·拒绝 勾选回传 answers[id]='yes'|'no'（默认全保留）。
// i18n 走 mock（与 SplitConfirmCard.test.tsx 同款模式）。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BatchConfirmCard from '@render/components/AIAgent/cards/BatchConfirmCard';
import type { IClarifyQuestion } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.batchConfirm.hint': '链内写入汇总确认',
      'ai.batchConfirm.apply': '保留',
      'ai.batchConfirm.reject': '拒绝',
      'ai.batchConfirm.confirm': '确认（{count}）',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

/** 主进程 write_batch 交互下发的逐项问题（含任务 12 staleness 前缀项）。 */
const QUESTIONS: IClarifyQuestion[] = [
  {
    id: 'call_0_0',
    text: '⚠️ 目标在执行后被外部修改。链内写入 editLocalFile（a.md）已执行，共 2 项汇总确认——是否保留该写入？',
    type: 'confirm',
    options: ['保留', '拒绝'],
  },
  {
    id: 'call_2_0',
    text: '链内写入 editLocalFile（b.md）已执行，共 2 项汇总确认——是否保留该写入？',
    type: 'confirm',
    options: ['保留', '拒绝'],
  },
];

function renderCard(onSubmit = vi.fn()) {
  const view = render(<BatchConfirmCard questions={QUESTIONS} onSubmit={onSubmit} />);
  return { ...view, onSubmit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('BatchConfirmCard — 逐项文案展示', () => {
  it('每项 q.text 全文渲染：stale 警示前缀可见、非 stale 项无前缀', () => {
    renderCard();
    const rows = screen.getAllByTestId('batch-confirm-row');
    expect(rows).toHaveLength(2);
    // 任务 12：主进程按项加的警示前缀在卡面自然呈现（不改 IClarifyQuestion 类型）
    expect(
      screen.getByText(/⚠️ 目标在执行后被外部修改/)
    ).toBeInTheDocument();
    expect(screen.getByText(/链内写入 editLocalFile（b\.md）/)).toBeInTheDocument();
    // 第二行文本不含警示前缀
    expect(rows[1].textContent ?? '').not.toContain('⚠️ 目标在执行后被外部修改');
  });
});

describe('BatchConfirmCard — 勾选回传', () => {
  it('默认全保留；取消一项后提交 → answers 该项为 no、其余 yes', () => {
    const { onSubmit } = renderCard();
    // 默认 2 项全勾（确认按钮计数 = 2）
    expect(screen.getByText('确认（2）')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('batch-toggle-call_2_0'));
    expect(screen.getByText('确认（1）')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('batch-confirm-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const answers = onSubmit.mock.calls[0][0] as Record<string, string>;
    expect(answers).toEqual({ call_0_0: 'yes', call_2_0: 'no' });
  });

  it('重新勾选恢复保留 → 提交全 yes（取消拒绝即保留）', () => {
    const { onSubmit } = renderCard();
    fireEvent.click(screen.getByTestId('batch-toggle-call_0_0'));
    fireEvent.click(screen.getByTestId('batch-toggle-call_0_0'));
    fireEvent.click(screen.getByTestId('batch-confirm-submit'));
    const answers = onSubmit.mock.calls[0][0] as Record<string, string>;
    expect(answers).toEqual({ call_0_0: 'yes', call_2_0: 'yes' });
  });
});

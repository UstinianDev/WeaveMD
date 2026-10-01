// ============================================
// agent-multi-intent 任务 2 — 拆分确认卡 SplitConfirmCard
// 覆盖 plan §4.2：渲染子任务行 / 删除行 / 添加子任务 / 确认回传合法 split_plan JSON
// + 直接执行（空计划 → 主进程降级单意图直通）。
// i18n 走 mock（与仓内 aiMessageBubble 组件测试同款模式）。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SplitConfirmCard from '@render/components/AIAgent/cards/SplitConfirmCard';
import type { AgentTaskPlan } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.split.add': '添加子任务',
      'ai.split.confidence': '置信度 {value}%',
      'ai.split.confirm': '确认执行',
      'ai.split.delete': '删除该子任务',
      'ai.split.direct': '直接执行',
      'ai.split.hint': '检测到多个意图',
      'ai.split.object': '操作对象',
      'ai.split.omitted': '另有 {count} 个子任务被省略',
      'ai.split.read': '只读',
      'ai.split.write': '写入',
      'ai.intent.kbQa': '知识库问答',
      'ai.intent.create': '创作',
      'ai.intent.rewrite': '改写',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

const PLAN: AgentTaskPlan = {
  subtasks: [
    {
      id: 's1',
      intent: 'kbQa',
      action: 'search',
      object: '笔记里的TODO',
      confidence: 0.92,
      rw: 'read',
    },
    {
      id: 's2',
      intent: 'create',
      action: 'write',
      object: 'weekly.md',
      confidence: 0.85,
      rw: 'write',
      preconditions: ['serial_after:s1'],
    },
  ],
  primaryIntent: 'create',
  omittedCount: 2,
};

function renderCard(onSubmit = vi.fn()) {
  const view = render(<SplitConfirmCard plan={PLAN} onSubmit={onSubmit} />);
  return { ...view, onSubmit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('SplitConfirmCard — 渲染与编辑', () => {
  it('渲染每个子任务行：intent 徽标 / action·object / confidence / R·W 标注', () => {
    renderCard();
    const rows = screen.getAllByTestId('split-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('知识库问答')).toBeInTheDocument();
    expect(screen.getByText('创作')).toBeInTheDocument();
    expect(screen.getByText('search → 笔记里的TODO')).toBeInTheDocument();
    expect(screen.getByText('write → weekly.md')).toBeInTheDocument();
    // 置信度百分比（0.92 → 92%）
    expect(screen.getByText('置信度 92%')).toBeInTheDocument();
    expect(screen.getByText('只读')).toBeInTheDocument();
    expect(screen.getByText('写入')).toBeInTheDocument();
    // 超上限省略提示
    expect(screen.getByText('另有 2 个子任务被省略')).toBeInTheDocument();
  });

  it('删除行 → 该行移除，其余行保留', () => {
    renderCard();
    expect(screen.getAllByTestId('split-row')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('split-delete-s1'));
    const rows = screen.getAllByTestId('split-row');
    expect(rows).toHaveLength(1);
    expect(screen.queryByText('search → 笔记里的TODO')).not.toBeInTheDocument();
    expect(screen.getByText('write → weekly.md')).toBeInTheDocument();
  });

  it('添加子任务 → 新增一行（默认子任务，随后可编辑对象）', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('split-add'));
    expect(screen.getAllByTestId('split-row')).toHaveLength(3);
  });

  it('编辑对象输入 → 回传计划反映修改', () => {
    const { onSubmit } = renderCard();
    const inputs = screen.getAllByTestId('split-object-input');
    fireEvent.change(inputs[1], { target: { value: 'report.md' } });
    fireEvent.click(screen.getByTestId('split-confirm'));
    const answers = onSubmit.mock.calls[0][0] as Record<string, string>;
    const plan = JSON.parse(answers.split_plan) as AgentTaskPlan;
    expect(plan.subtasks[1].object).toBe('report.md');
  });
});

describe('SplitConfirmCard — 提交回传', () => {
  it('确认执行 → onSubmit 收到 { split_plan } 且为合法 JSON（≥1 子任务）', () => {
    const { onSubmit } = renderCard();
    fireEvent.click(screen.getByTestId('split-confirm'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const answers = onSubmit.mock.calls[0][0] as Record<string, string>;
    expect(typeof answers.split_plan).toBe('string');
    const plan = JSON.parse(answers.split_plan) as AgentTaskPlan;
    expect(Array.isArray(plan.subtasks)).toBe(true);
    expect(plan.subtasks).toHaveLength(2);
    expect(plan.subtasks[0]).toMatchObject({
      id: 's1',
      intent: 'kbQa',
      action: 'search',
      object: '笔记里的TODO',
      rw: 'read',
    });
    expect(plan.primaryIntent).toBe('create');
    expect(plan.omittedCount).toBe(2);
  });

  it('删除到 0 行后确认 → subtasks 为空数组的合法 JSON（主进程侧降级直通）', () => {
    const { onSubmit } = renderCard();
    fireEvent.click(screen.getByTestId('split-delete-s1'));
    fireEvent.click(screen.getByTestId('split-delete-s2'));
    fireEvent.click(screen.getByTestId('split-confirm'));
    const answers = onSubmit.mock.calls[0][0] as Record<string, string>;
    const plan = JSON.parse(answers.split_plan) as AgentTaskPlan;
    expect(plan.subtasks).toHaveLength(0);
  });

  it('直接执行 → onSubmit 收到空 answers（主进程 parseSplitAnswers 返回 null 降级）', () => {
    const { onSubmit } = renderCard();
    fireEvent.click(screen.getByTestId('split-direct'));
    expect(onSubmit).toHaveBeenCalledWith({});
  });
});

// ============================================
// WeaveMD — AIPanelHome 组件测试（M3：RECENT 最近3 / 空态 / 点击进会话）
// ============================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AIPanelHome, { formatRecentDate, recentConversations } from '@render/components/AIAgent/panel/AIPanelHome';
import { useAgentStore } from '@render/stores/agentStore';
import type { IAIConversation } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.home.cta': 'What can I do for you?',
      'ai.home.recent': '最近',
      'ai.home.viewAll': '查看全部',
      'ai.home.noRecent': '暂无最近会话',
      'ai.home.date': '{m}月{d}日',
      'ai.tab.agent': '智能体',
      'ai.tab.chat': '对话',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

/** 捕获 AIPanelHome 传给 composer 的受控 value（M4 草稿透传断言用）。 */
let composerValue = '';
let composerOnChange: ((v: string) => void) | undefined;

vi.mock('@render/components/AIAgent/panel/AIPanelComposer', () => ({
  default: ({ value, onChange }: {
    value: string;
    onChange?: (v: string) => void;
  }) => {
    composerValue = value;
    composerOnChange = onChange;
    return <div data-testid="mock-composer">Composer</div>;
  },
}));

const conv = (id: string, summary: string, updatedAt: string): IAIConversation => ({
  id,
  userId: 'u1',
  summary,
  mode: 'agent',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt,
});

const a = conv('a', '首个会话', '2026-08-10T00:00:00Z');
const b = conv('b', '第二个', '2026-08-12T00:00:00Z');
const c = conv('c', '第三个', '2026-08-14T00:00:00Z');
const d = conv('d', '第四个', '2026-08-15T00:00:00Z');

describe('recentConversations', () => {
  it('按 updatedAt 倒序取最近 3 项', () => {
    const res = recentConversations([a, b, c, d]);
    expect(res.map((x) => x.id)).toEqual(['d', 'c', 'b']);
  });

  it('不足 3 项原样返回（倒序）', () => {
    expect(recentConversations([a, b]).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('空列表返回空', () => {
    expect(recentConversations([])).toEqual([]);
  });
});

describe('formatRecentDate', () => {
  const t = (k: string, fb?: string) => fb ?? k;
  it('格式化月/日', () => {
    expect(formatRecentDate('2026-07-28T00:00:00Z', t)).toBe('7月28日');
  });
  it('无 updatedAt 返回空', () => {
    expect(formatRecentDate(undefined, t)).toBe('');
  });
  it('非法日期原样返回', () => {
    expect(formatRecentDate('not-a-date', t)).toBe('not-a-date');
  });
});

describe('AIPanelHome', () => {
  afterEach(() => {
    cleanup();
  });

  const openFn = vi.fn();
  const viewAllFn = vi.fn();
  const createFn = vi.fn();

  const renderHome = () => {
    composerValue = '';
    composerOnChange = undefined;
    return render(
      <AIPanelHome
        draft=""
        setDraft={() => undefined}
        onOpenConversation={openFn}
        onViewAll={viewAllFn}
        onCreateSession={createFn}
      />
    );
  };

  it('空态：无会话显示「暂无最近会话」+ 大图标 + CTA', () => {
    useAgentStore.setState({ conversations: [], activeMode: 'agent' });
    renderHome();
    expect(screen.getByText('What can I do for you?')).toBeInTheDocument();
    expect(screen.getByText('暂无最近会话')).toBeInTheDocument();
  });

  it('展示 RECENT 最近 3 会话（标题 + 日期）并点击进会话', () => {
    useAgentStore.setState({ conversations: [a, b, c, d], activeMode: 'agent' });
    renderHome();
    // 最近 3 个：d/c/b（第4个 a 不显示）
    expect(screen.getByText('第四个')).toBeInTheDocument();
    expect(screen.getByText('第三个')).toBeInTheDocument();
    expect(screen.getByText('第二个')).toBeInTheDocument();
    expect(screen.queryByText('首个会话')).toBeNull();
    // 日期月/日
    expect(screen.getByText('8月15日')).toBeInTheDocument();
    // 点击最近会话 → onOpenConversation
    fireEvent.click(screen.getByText('第四个'));
    expect(openFn).toHaveBeenCalledWith('d');
  });

  it('无 summary 会话标题用模式名兜底', () => {
    useAgentStore.setState({
      conversations: [{ ...d, summary: '' }],
      activeMode: 'agent',
    });
    renderHome();
    expect(screen.getByText('智能体')).toBeInTheDocument();
  });

  it('RECENT「查看全部」触发 onViewAll；底部 composer 存在', () => {
    useAgentStore.setState({ conversations: [], activeMode: 'agent' });
    renderHome();
    fireEvent.click(screen.getByText('查看全部'));
    expect(viewAllFn).toHaveBeenCalled();
    expect(screen.getByTestId('mock-composer')).toBeInTheDocument();
  });

  it('M4: 接收 draft 并受控透传给 composer（value=草案；onChange=setDraft）', () => {
    useAgentStore.setState({ conversations: [], activeMode: 'agent' });
    const setDraft = vi.fn();
    render(
      <AIPanelHome
        draft="透传草稿"
        setDraft={setDraft}
        onOpenConversation={openFn}
        onViewAll={viewAllFn}
        onCreateSession={createFn}
      />
    );
    expect(composerValue).toBe('透传草稿');
    // onChange 是 setDraft（父级驱动受控）
    composerOnChange?.('新值');
    expect(setDraft).toHaveBeenCalledWith('新值');
  });
});

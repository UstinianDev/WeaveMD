// ============================================
// WeaveMD — RewritePreviewCard 组件测试（TDD strict）
// R1 更新：匹配 DiffSummaryCard 统一卡片 UI
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RewritePreviewCard from '@render/components/AIAgent/cards/RewritePreviewCard';
import { resetRewriteStore, useRewriteStore } from '@render/stores/rewriteStore';
import type { RewriteProposal } from '@shared/ai';

vi.mock('@render/services/aiMarkdown', () => ({
  renderAIMarkdownSafe: (md: string) => `[MD:${md}]`,
}));

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      // 旧 key（thin shell 仍使用）
      'ai.rewrite.previewTitle': '改写预览',
      'ai.rewrite.previewConfirm': '应用',
      'ai.rewrite.previewCancel': '取消',
      'ai.rewrite.applied': '已应用',
      'ai.rewrite.cancelled': '已取消改写',
      'ai.rewrite.noChange': '改写结果与原文相同，无变化',
      'ai.rewrite.staleRejected': '文档已变更，请重新生成',
      'ai.rewrite.failure': '改写失败',
      'ai.rewrite.locateFailed': '无法定位目标块，已拒绝应用',
      'ai.rewrite.dismiss': '关闭',
      'ai.rewrite.noDocument': '请先打开一个文档，再让 AI 整篇生成/写入',
      'ai.rewrite.diff': '改动内容',
      'ai.rewrite.aiComment': 'AI 的改动说明',
      'ai.rewrite.collapse': '收起',
      'ai.rewrite.expand': '展开',
      'ai.rewrite.rewriting': '正在改写...',
      // 新 key（DiffSummaryCard 使用）
      'ai.diff.preview': '变更预览',
      'ai.diff.collapse': '折叠',
      'ai.diff.expand': '展开',
      'ai.diff.showAll': '显示全部',
      'ai.diff.truncated': '... 共 {count} 行，已截断',
      'ai.diff.noChanges': '无变更',
      'ai.diff.applied': '已应用',
      'ai.diff.cancelled': '已取消',
      'ai.diff.dismiss': '关闭',
      'ai.diff.discardAll': '全部废弃',
      'ai.diff.applyAll': '全部应用',
      'ai.diff.viewDetails': '查看详情',
      'ai.diff.multiFiles': '{count} 个文件修订',
      'ai.diff.andMore': '等 {count} 个文件',
      'ai.diff.aiComment': 'AI 改动说明',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

const proposal: RewriteProposal = {
  originalMd: 'line1\nold\nline3',
  rewrittenMd: 'line1\nnew\nline3',
  ops: [],
};

describe('RewritePreviewCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRewriteStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('渲染红删绿增 diff + AI 改动说明', () => {
    useRewriteStore.setState({ pendingRewrite: proposal });
    const { container } = render(<RewritePreviewCard />);

    // 单文件标题：文档改写 + (−1 / +1)
    expect(screen.getByText(/文档改写/)).toBeInTheDocument();
    // 标题和 diff 区域各有一次 −1/+1 统计
    expect(screen.getAllByText(/−1\s+\/\s+\+1/).length).toBeGreaterThanOrEqual(1);

    // 按 data-type 定位 diff 行：del（红）/ ins（绿）/ same（灰）
    // diff 默认折叠，需要先展开
    fireEvent.click(screen.getByText('展开'));
    const delEl = container.querySelector('[data-type="del"]');
    const insEl = container.querySelector('[data-type="ins"]');
    const sameEls = container.querySelectorAll('[data-type="same"]');
    expect(delEl).not.toBeNull();
    expect(insEl).not.toBeNull();
    expect(sameEls.length).toBe(2); // line1 + line3

    // 内容
    expect(delEl?.textContent).toContain('old');
    expect(insEl?.textContent).toContain('new');
    // 样式：del 红 / ins 绿
    expect((delEl as HTMLElement).className).toMatch(/text-red-500/);
    expect((insEl as HTMLElement).className).toMatch(/text-green-600/);

    // AI 改动说明（回退到行级统计）
    expect(screen.getByText(/删除了 1 行，新增了 1 行内容/)).toBeInTheDocument();
    // 无危险注入
    expect(container.innerHTML).not.toContain('dangerouslySetInnerHTML');
  });

  it('确认按钮 → applyRewrite', () => {
    useRewriteStore.setState({ pendingRewrite: proposal });
    const applySpy = vi.spyOn(useRewriteStore.getState(), 'applyRewrite');
    render(<RewritePreviewCard />);
    // R1: 统一卡片用"全部应用"替代原"应用"
    fireEvent.click(screen.getByText('全部应用'));
    expect(applySpy).toHaveBeenCalled();
  });

  it('取消按钮 → clearRewrite', () => {
    useRewriteStore.setState({ pendingRewrite: proposal });
    const clearSpy = vi.spyOn(useRewriteStore.getState(), 'clearRewrite');
    render(<RewritePreviewCard />);
    // R1: 统一卡片用"全部废弃"替代原"取消"
    fireEvent.click(screen.getByText('全部废弃'));
    expect(clearSpy).toHaveBeenCalled();
  });

  it('rewriting → 显示改写中提示', () => {
    useRewriteStore.setState({ rewriting: true });
    render(<RewritePreviewCard />);
    expect(screen.getByText(/正在/)).toBeInTheDocument();
  });

  it('staleRejected → 显示文档已变更提示', () => {
    useRewriteStore.setState({ staleRejected: true, pendingRewrite: proposal });
    render(<RewritePreviewCard />);
    expect(screen.getByText('文档已变更，请重新生成')).toBeInTheDocument();
  });

  it('rewriteError=no-change → 显示无变化提示', () => {
    useRewriteStore.setState({ rewriteError: 'no-change' });
    render(<RewritePreviewCard />);
    expect(screen.getByText('改写结果与原文相同，无变化')).toBeInTheDocument();
  });

  it('rewriteError=locate-failed → 显示无法定位提示', () => {
    useRewriteStore.setState({ rewriteError: 'locate-failed' });
    render(<RewritePreviewCard />);
    expect(screen.getByText('无法定位目标块，已拒绝应用')).toBeInTheDocument();
  });

  it('rewriteError 其他值 → 显示改写失败提示', () => {
    useRewriteStore.setState({ rewriteError: 'network' });
    render(<RewritePreviewCard />);
    expect(screen.getByText('改写失败')).toBeInTheDocument();
  });

  it('无任何改写状态 → 渲染空（null）', () => {
    const { container } = render(<RewritePreviewCard />);
    expect(container.firstChild).toBeNull();
  });

  it('rewriteResult=applied → 显示已应用反馈（在预览卡片内）', () => {
    useRewriteStore.setState({ rewriteResult: 'applied', pendingRewrite: proposal });
    render(<RewritePreviewCard />);
    expect(screen.getByText(/已应用/)).toBeInTheDocument();
    // R1: 卡片内仍显示文件名 + 关闭按钮
    expect(screen.getByText(/文档改写/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });

  it('rewriteResult=cancelled → 显示已取消反馈（在预览卡片内）', () => {
    useRewriteStore.setState({ rewriteResult: 'cancelled', pendingRewrite: proposal });
    render(<RewritePreviewCard />);
    expect(screen.getByText(/已取消/)).toBeInTheDocument();
    // R1: 卡片内仍显示文件名 + 关闭按钮
    expect(screen.getByText(/文档改写/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });

  it('proposal 含 aiComment → 显示 LLM 改写说明', () => {
    const proposalWithComment: RewriteProposal = {
      ...proposal,
      aiComment: '将"old"替换为"new"，保持格式不变',
    };
    useRewriteStore.setState({ pendingRewrite: proposalWithComment });
    render(<RewritePreviewCard />);
    expect(screen.getByText('将"old"替换为"new"，保持格式不变')).toBeInTheDocument();
  });

  it('proposal 无 aiComment → 回退到行级统计', () => {
    useRewriteStore.setState({ pendingRewrite: proposal });
    render(<RewritePreviewCard />);
    expect(screen.getByText(/删除了 1 行，新增了 1 行内容/)).toBeInTheDocument();
  });

  it('R16: 无提案错误提示条末尾有 ✕，点击调 dismissRewriteBanner', () => {
    useRewriteStore.setState({ rewriteError: 'network' });
    const dismissSpy = vi.spyOn(useRewriteStore.getState(), 'dismissRewriteBanner');
    render(<RewritePreviewCard />);
    // 提示条渲染 + ✕ 按钮（aria-label=关闭）
    expect(screen.getByText('改写失败')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: '关闭' });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(dismissSpy).toHaveBeenCalled();
  });

  it('R16: stale 无提案提示条也有 ✕ 且点击清 staleRejected', () => {
    useRewriteStore.setState({ staleRejected: true, pendingRewrite: null });
    const dismissSpy = vi.spyOn(useRewriteStore.getState(), 'dismissRewriteBanner');
    render(<RewritePreviewCard />);
    const btn = screen.getByRole('button', { name: '关闭' });
    fireEvent.click(btn);
    expect(dismissSpy).toHaveBeenCalled();
  });

  it('R16: 有提案卡内 stale 提示不加重叠 ✕（头部已有全部废弃/全部应用）', () => {
    useRewriteStore.setState({ staleRejected: true, pendingRewrite: proposal });
    render(<RewritePreviewCard />);
    // 有提案时卡片处于 pending 状态，显示"全部废弃"/"全部应用"而非"关闭"
    // 无提案提示条的 ✕ 关闭按钮不应出现
    // 注：卡片内 stale 横幅文本可见，但"关闭"按钮仅在 result 态出现
    const closeButtons = screen.queryAllByRole('button', { name: '关闭' });
    // R16 无提案 banner 不渲染（有 pendingRewrite），所以无 ✕ 关闭按钮
    expect(closeButtons.length).toBe(0);
    expect(screen.getByRole('button', { name: '全部废弃' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部应用' })).toBeInTheDocument();
  });
});
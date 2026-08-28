// ============================================
// WeaveMD — AIPanelSettings 组件测试（Phase 5：适配新 ModelForm 双视图）
// 覆盖：三 tab 切换 + 返回按钮。
// ============================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AIPanelSettings from '@render/components/AIAgent/panel/AIPanelSettings';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

vi.mock('@render/i18n', () => ({
  useI18n: () => {
    const dict: Record<string, string> = {
      'ai.settings.title': 'AI',
      'ai.settings.back': '返回',
      'ai.settings.tab.model': '模型',
      'ai.settings.tab.skills': '技能',
      'ai.settings.tab.mcp': 'MCP',
      'ai.settings.mcpDeferred': 'MCP 已延期',
      'ai.settings.modelConfigs.title': 'AI 模型配置',
      'ai.settings.modelConfigs.new': '+ 新建配置',
      'ai.settings.modelConfigs.empty': '暂无配置，点击上方按钮新建',
      'ai.settings.skillsEmpty': '暂无技能',
      'ai.settings.skillsLoading': '加载中...',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

describe('AIPanelSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: 'u1', username: 'tester', createdAt: '', lastLogin: null },
      token: 'tok',
      isAuthenticated: true,
      recentAccounts: [],
    });
    useAgentStore.setState({
      modelConfigs: [],
      activeModelConfigId: null,
    });
    // Stub refreshModelConfigs to prevent async issues
    vi.spyOn(useAgentStore.getState(), 'refreshModelConfigs').mockResolvedValue();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const backFn = vi.fn();

  it('左栏三 tab 切换：模型/skills/MCP + 返回按钮回原视图', async () => {
    render(<AIPanelSettings onBack={backFn} />);
    // 默认模型 tab：显示新 ModelForm 的标题
    expect(screen.getByText('AI 模型配置')).toBeInTheDocument();
    // 切 skills → 等待异步 listSkills 落地后再断言空态
    fireEvent.click(screen.getByTestId('settings-tab-skills'));
    expect(await screen.findByText('暂无技能')).toBeInTheDocument();
    // 切 MCP → 占位
    fireEvent.click(screen.getByTestId('settings-tab-mcp'));
    expect(screen.getByTestId('mcp-deferred')).toBeInTheDocument();
    expect(screen.getByText('MCP 已延期')).toBeInTheDocument();
    // 返回
    fireEvent.click(screen.getByTestId('settings-back'));
    expect(backFn).toHaveBeenCalled();
  });
});

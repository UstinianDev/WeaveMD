// ============================================
// WeaveMD — AIPanelSettings 组件测试（M3：三 tab 切换 + ModelForm 保存调 setKbSettings）
// ============================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AIPanelSettings from '@render/components/AIAgent/AIPanelSettings';
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
      'ai.settings.backend': '后端',
      'ai.settings.backend.ollama': 'Ollama（本地）',
      'ai.settings.backend.remote': '远程 API',
      'ai.settings.ollamaBaseUrl': 'Ollama 地址',
      'ai.settings.remoteBaseUrl': '远程 API 地址',
      'ai.settings.model': '模型 ID',
      'ai.settings.apiKey': 'API 密钥',
      'ai.settings.apiKeySet': '已设置（隐藏）',
      'ai.settings.allowNetwork': '允许联网',
      'ai.settings.allowSend': '允许将笔记发送给 AI',
      'ai.settings.kb.title': '知识库检索（Agent）',
      'ai.settings.kb.hint': '以下设置仅 Agent 知识库问答生效',
      'ai.settings.kb.topK': '召回条数 (topK)',
      'ai.settings.kb.fuse': '融合权重 (fuse)',
      'ai.settings.kb.threshold': '拒答阈值 (threshold)',
      'ai.settings.kb.pinnedWeight': '置顶权重 (pinnedWeight)',
      'ai.settings.kb.embeddingHost': 'Embedding 服务地址',
      'ai.settings.kb.embeddingModel': 'Embedding 模型 ID',
      'ai.security.weakKeyring': '密钥加密降级',
      'settings.save': '保存',
    };
    return {
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? `[${key}]`,
      language: 'zh-CN',
    };
  },
}));

describe('AIPanelSettings', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const backFn = vi.fn();

  it('左栏三 tab 切换：模型/skills/MCP + 返回按钮回原视图', async () => {
    render(<AIPanelSettings onBack={backFn} />);
    // 默认模型 tab
    expect(screen.getByText('模型 ID')).toBeInTheDocument();
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

  it('ModelForm 保存：写回 agentStore.kbSettings（setKbSettings 被调）', async () => {
    const setKbSettings = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useAgentStore.getState(), 'setKbSettings').mockImplementation(setKbSettings);
    // mock ai IPC：setConfig/setConsent 空成功，getConfig/getConsent 空
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.getConfig = vi
      .fn()
      .mockResolvedValue({ success: false });
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.getConsent = vi
      .fn()
      .mockResolvedValue({ success: false });
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.setConfig = vi
      .fn()
      .mockResolvedValue({ success: true, data: {} });
    (window.weaveMD as unknown as { ai: Record<string, unknown> }).ai.setConsent = vi
      .fn()
      .mockResolvedValue({ success: true, data: {} });

    useAgentStore.setState({
      kbSettings: {
        topK: 5,
        fuse: 0.5,
        threshold: 0.6,
        pinnedWeight: 1.5,
        embeddingHost: 'http://localhost:11434',
        embeddingModel: 'nomic-embed-text',
      },
      kbSettingsSaveState: 'idle',
    });

    render(<AIPanelSettings onBack={backFn} />);
    fireEvent.click(screen.getByTestId('model-form-save'));
    await waitFor(() => expect(setKbSettings).toHaveBeenCalled());
    expect(setKbSettings.mock.calls[0][0]).toMatchObject({
      topK: 5,
      fuse: 0.5,
    });
  });
});

// ============================================
// WeaveMD — ToolCallTrace 组件测试（TDD strict）
// ============================================
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ToolCallTrace from '@render/components/AIAgent/ToolCallTrace';
import type { IAgentToolCall } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => ({ t: (key: string) => `[${key}]`, language: 'zh-CN' }),
}));

const okCall: IAgentToolCall = {
  toolCallId: 'c1',
  name: 'searchKB',
  args: '{"query":"weavemd","topK":3}',
  status: 'ok',
  result: '{"fileName":"a.md","content":"..."}',
};

const errCall: IAgentToolCall = {
  toolCallId: 'c2',
  name: 'readFile',
  args: '{"fileId":"x"}',
  status: 'error',
  errorDesc: 'File not found',
};

describe('ToolCallTrace', () => {
  it('渲染工具名与 ok 状态色标', () => {
    render(<ToolCallTrace call={okCall} />);
    expect(screen.getByText('searchKB')).toBeInTheDocument();
    expect(screen.getByText('[ai.tool.statusOk]')).toBeInTheDocument();
  });

  it('渲染 error 状态色标', () => {
    render(<ToolCallTrace call={errCall} />);
    expect(screen.getByText('[ai.tool.statusError]')).toBeInTheDocument();
  });

  it('参数以 JSON 摘要展示', () => {
    render(<ToolCallTrace call={okCall} />);
    expect(screen.getByText(/searchKB/)).toBeInTheDocument();
    // 参数摘要应包含 query 关键信息
    expect(screen.getByText(/query/)).toBeInTheDocument();
  });

  it('默认折叠结果，点击展开显示结果', () => {
    render(<ToolCallTrace call={okCall} />);
    // 默认不显示结果内容
    expect(screen.queryByText(/FileName/)).toBeNull();
    fireEvent.click(screen.getByText('[ai.tool.expand]'));
    expect(screen.getByText(/a\.md/)).toBeInTheDocument();
  });

  it('error 调用结果区显示错误描述', () => {
    render(<ToolCallTrace call={errCall} />);
    fireEvent.click(screen.getByText('[ai.tool.expand]'));
    expect(screen.getByText('File not found')).toBeInTheDocument();
  });
});

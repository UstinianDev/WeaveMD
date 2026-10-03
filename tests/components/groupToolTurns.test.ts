// WeaveMD — 历史工具占位行分组（agent-history-toolcards）单测
// 复现依据：本地库实测 memory-B2 后一轮工具按「每轮一条 content='' 占位行」
// 落库（2026-10-01 起），原每消息一卡渲染会拆成单工具卡。

import { describe, expect, it } from 'vitest';
import { groupToolTurns, type ToolTurnEntry } from '@render/components/AIAgent/groupToolTurns';
import type { IAgentToolCall } from '@shared/ai';

interface Msg {
  id: string;
  role: string;
  content: string;
  toolCalls?: IAgentToolCall[];
}

function tc(id: string, name = 'readLocalFile', loopIndex = 0): IAgentToolCall {
  return { toolCallId: id, name, args: '{}', status: 'ok', loopIndex };
}

function entry(id: string, over: Partial<Msg> = {}): ToolTurnEntry<Msg> {
  return {
    originalIndex: 0,
    message: { id, role: 'assistant', content: '', ...over },
  };
}

describe('groupToolTurns — 连续工具占位行合并（修复一卡一工具）', () => {
  it('异常期形态：4 条连续空正文单工具行 → 合并为 1 组，toolCalls 按序拼接', () => {
    const entries = [
      entry('m1', { toolCalls: [tc('a', 'readLocalFile', 0)] }),
      entry('m2', { toolCalls: [tc('b', 'readLocalFile', 1)] }),
      entry('m3', { toolCalls: [tc('c', 'web_search', 2)] }),
      entry('m4', { toolCalls: [tc('d', 'web_search', 3)] }),
    ];
    const items = groupToolTurns(entries, true);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('toolGroup');
    if (items[0].kind !== 'toolGroup') return;
    expect(items[0].toolCalls.map((t) => t.toolCallId)).toEqual(['a', 'b', 'c', 'd']);
    expect(items[0].entries).toHaveLength(4);
  });

  it('user 消息断组：跨轮不合并', () => {
    const entries = [
      entry('m1', { toolCalls: [tc('a', 'readLocalFile', 0)] }),
      entry('u1', { role: 'user', content: '下一个问题' }),
      entry('m2', { toolCalls: [tc('b', 'web_search', 1)] }),
    ];
    const items = groupToolTurns(entries, true);
    expect(items.map((i) => i.kind)).toEqual(['toolGroup', 'message', 'toolGroup']);
    expect(items[0].kind === 'toolGroup' && items[0].toolCalls).toHaveLength(1);
    expect(items[2].kind === 'toolGroup' && items[2].toolCalls).toHaveLength(1);
  });

  it('正常期形态：单条多工具消息独立成组（渲染与原单卡等价）', () => {
    const entries = [
      entry('m1', { toolCalls: [tc('a', 'web_search', 0), tc('b', 'readLocalFile', 1)] }),
    ];
    const items = groupToolTurns(entries, true);
    expect(items).toHaveLength(1);
    expect(items[0].kind === 'toolGroup' && items[0].toolCalls).toHaveLength(2);
  });

  it('带正文的工具行不合并（保留单消息渲染：卡+气泡）', () => {
    const entries = [
      entry('m1', { content: '这是带正文的工具轮', toolCalls: [tc('a', 'readLocalFile', 0)] }),
      entry('m2', { toolCalls: [tc('b', 'web_search', 1)] }),
    ];
    const items = groupToolTurns(entries, true);
    expect(items.map((i) => i.kind)).toEqual(['message', 'toolGroup']);
  });

  it('非 agent 模式不合并（无卡片语义）', () => {
    const entries = [
      entry('m1', { toolCalls: [tc('a', 'readLocalFile', 0)] }),
      entry('m2', { toolCalls: [tc('b', 'readLocalFile', 1)] }),
    ];
    const items = groupToolTurns(entries, false);
    expect(items.map((i) => i.kind)).toEqual(['message', 'message']);
  });

  it('顺序与 originalIndex 透传不变', () => {
    const entries: ToolTurnEntry<Msg>[] = [
      { originalIndex: 3, message: { id: 'u', role: 'user', content: 'hi' } },
      { originalIndex: 4, message: { id: 'm1', role: 'assistant', content: '', toolCalls: [tc('a')] } },
      { originalIndex: 5, message: { id: 'm2', role: 'assistant', content: '', toolCalls: [tc('b')] } },
      { originalIndex: 6, message: { id: 'a', role: 'assistant', content: '最终回答' } },
    ];
    const items = groupToolTurns(entries, true);
    expect(items.map((i) => i.kind)).toEqual(['message', 'toolGroup', 'message']);
    if (items[1].kind === 'toolGroup') {
      expect(items[1].entries.map((e) => e.originalIndex)).toEqual([4, 5]);
      expect(items[1].id).toBe('m1');
    }
  });
});

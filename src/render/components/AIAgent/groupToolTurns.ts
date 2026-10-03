// WeaveMD — 历史工具消息分组（agent-history-toolcards）
// memory-B2 单事务落库后，一轮的工具调用按「每轮一条 content='' 占位行」写入
// （2026-10-01 起的数据形态）；而 AgentTab 原按「每消息一张卡」渲染，导致
// 一个执行过程被拆成 N 张单工具卡。本模块把连续的占位行合并为一组，
// 恢复「一个执行过程装多个工具」的卡片形态（与早期整轮单条数据渲染一致）。

import type { IAgentToolCall } from '@shared/ai';

export interface ToolTurnEntry<T> {
  message: T;
  originalIndex: number;
}

export type ToolTurnItem<T> =
  | { kind: 'toolGroup'; id: string; entries: ToolTurnEntry<T>[]; toolCalls: IAgentToolCall[] }
  | { kind: 'message'; entry: ToolTurnEntry<T> };

interface ToolTurnMessageLike {
  id: string;
  role: string;
  content: string | null | undefined;
  toolCalls?: IAgentToolCall[];
}

/** 占位行判定：agent 模式下 assistant + 有工具 + 正文为空。 */
function isBlankToolTurn<T extends ToolTurnMessageLike>(
  entry: ToolTurnEntry<T>,
  isAgentMode: boolean
): boolean {
  const m = entry.message;
  return (
    isAgentMode &&
    m.role === 'assistant' &&
    (m.toolCalls?.length ?? 0) > 0 &&
    (m.content ?? '').trim() === ''
  );
}

/**
 * 将连续的工具占位行合并为 toolGroup；其余消息原样透传（顺序不变）。
 * 分组在遇到非占位行（用户消息/带正文的 assistant）时断开——
 * 跨轮/跨会话轮换天然由 user 消息分隔。
 */
export function groupToolTurns<T extends ToolTurnMessageLike>(
  entries: ToolTurnEntry<T>[],
  isAgentMode: boolean
): ToolTurnItem<T>[] {
  const items: ToolTurnItem<T>[] = [];
  let run: ToolTurnEntry<T>[] = [];

  const flush = () => {
    if (run.length === 0) return;
    items.push({
      kind: 'toolGroup',
      id: run[0].message.id,
      entries: run,
      toolCalls: run.flatMap((e) => e.message.toolCalls ?? []),
    });
    run = [];
  };

  for (const entry of entries) {
    if (isBlankToolTurn(entry, isAgentMode)) {
      run.push(entry);
    } else {
      flush();
      items.push({ kind: 'message', entry });
    }
  }
  flush();
  return items;
}

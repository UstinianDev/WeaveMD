// ============================================
// WeaveMD — Agent helpers / constants
// ============================================

import { DEFAULT_MAX_ROUNDS, IPC_CHANNELS } from '@shared/constants';
import type { AgentRunResult, IAIConsent, IIntent } from '@shared/ai';
import type { AgentContext } from './agentContext';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const CONTEXT_WINDOW = 64_000;
export const KEEP_RECENT_ROUNDS = 3; // 从 6 减少到 3，减少前轮内容对当前轮的影响

/** 单工具执行超时（毫秒）。网络/文件 I/O 工具可能较慢，给予充足时间。 */
export const TOOL_EXEC_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// 函数
// ---------------------------------------------------------------------------

/**
 * 检测 LLM 文本回复是否包含提问（用于触发 ask_question_card 工具调用兜底）。
 * 匹配问号、提问关键词、编号问题等模式。
 */
export function detectTextQuestions(content: string): boolean {
  if (!content || content.length < 3) return false;
  // 问号检测
  if (/[?？]/.test(content)) return true;
  // 中文提问关键词
  if (/(请问|请告诉|你想要|你需要|你希望|确认一下|你能|你是否|你知道|你想|你需要我|请选择|请提供|请说明|告诉我|说说看)/.test(content)) return true;
  // 编号问题 Q1: / 1. / 1)
  if (/\b[Qq]\d+[：:]/.test(content) || /^\d+[.)]\s/.test(content)) return true;
  // 选项列表（A. / 1. / - 后面跟选项描述）
  if (/[（(][AaBbCcDd][）)]/.test(content)) return true;
  return false;
}

/**
 * 动态压缩阈值：简单任务晚压缩（0.85），复杂任务早压缩（0.65）。
 * round 0~1 视为简单任务，round 2+ 视为复杂任务。
 */
export function getCompressThreshold(round: number): number {
  return round <= 1 ? 0.85 : 0.65;
}

/**
 * 基于意图动态分配 Agent 轮次上限。
 * 简单对话用少轮次，复杂多工具任务用多轮次。
 */
export function getRoundsForIntent(intent: string): number {
  switch (intent) {
    case 'chat':   return 6;   // 纯对话，不需要工具
    case 'kbQa':   return 8;   // 知识库问答，单次检索+回答
    case 'web':    return 10;  // 联网搜索，可能多轮搜索
    case 'rewrite': return 10; // 改写，可能需要搜索+编辑
    case 'create': return 12;  // 创建，可能需要多文件操作
    case 'tech':   return 12;  // 技术任务，复杂多工具组合
    default:       return DEFAULT_MAX_ROUNDS;
  }
}

/**
 * KB 检索外发闸（笔记内容外发给远端模型）：
 * 已授权联网但未授权外发（allowSend）-> 需同意。
 */
export function needsKbSendConsent(_config: unknown, _consent: IAIConsent): boolean {
  return false; // 铁律二已移除：KB 外发不再需要用户同意
}

/** 发送进度事件（通过 AI_STREAM_TOOL 通道，status 为 progress）。 */
export function sendProgress(ctx: AgentContext, phase: string, message: string): void {
  ctx.send(IPC_CHANNELS.AI_STREAM_TOOL, {
    conversationId: ctx.convId,
    toolCallId: `progress_${phase}`,
    name: phase,
    args: '',
    status: 'progress',
    result: message,
    loopIndex: -1,
  });
}

export function makeAgentResult(partial: {
  conversationId: string;
  assistantId: string;
  roundsUsed: number;
  intent: IIntent | null;
  refused?: boolean;
  usage?: { reasoningTokenCount: number | null };
}): AgentRunResult {
  return {
    conversationId: partial.conversationId,
    assistantId: partial.assistantId,
    roundsUsed: partial.roundsUsed,
    intent: partial.intent,
    ...(partial.refused !== undefined ? { refused: partial.refused } : {}),
    ...(partial.usage ? { usage: partial.usage } : {}),
  };
}
// ============================================
// WeaveMD — Tool result storage (S6)
// ============================================
// 大结果持久化：超过阈值的工具结果写入文件，返回预览。
// 聚合预算控制：单轮所有结果总和超出上限时，从最大结果开始压缩。
// ContentReplacementState：确保同一 toolCallId 在所有后续调用中返回相同替换内容。
//
// 阈值：保守于 Claude Code（单工具 50k → 30k，聚合 200k → 120k）
// 因为 WeaveMD 的 CONTEXT_WINDOW = 64k tokens，需严格限制。

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 单工具结果字符阈值（约 7,500 tokens）。超出后写入文件返回预览。 */
export const MAX_SINGLE_RESULT_CHARS = 30_000;

/** 单轮所有工具结果总和字符阈值（约 30,000 tokens）。超出后从最大结果开始压缩。 */
export const MAX_AGGREGATE_RESULTS_CHARS = 120_000;

/** 工具结果持久化子目录（基于 userData，与 images/files 同级）。 */
export const TOOL_RESULTS_SUBDIR = 'tool-results';

/** 预览截取长度（字符）。 */
const PREVIEW_LENGTH = 500;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface PersistResult {
  persisted: boolean;
  displayContent: string;
  filePath?: string;
}

/** 轻量结果接口——applyAggregateBudget 不依赖 ToolExecResult，避免循环依赖。 */
export interface ResultLike {
  toolCallId: string;
  tc: { name: string; index: number; arguments: string };
  result: { content: string; status: 'ok' | 'error'; errorDesc?: string };
}

// ---------------------------------------------------------------------------
// ContentReplacementState
// ---------------------------------------------------------------------------

/**
 * 内容替换状态——确保同一 toolCallId 始终返回相同替换。
 *
 * 为什么需要：
 * - 不同轮次的上下文压缩可能重新序列化历史消息
 * - 如果每轮生成不同的预览文本，LLM 可能困惑
 * - 此状态在 runAgentFlow 生命周期内保持一致性
 */
export class ContentReplacementState {
  private map = new Map<string, { filePath: string; preview: string }>();

  hasReplacement(toolCallId: string): boolean {
    return this.map.has(toolCallId);
  }

  getReplacement(toolCallId: string): { filePath: string; preview: string } | undefined {
    return this.map.get(toolCallId);
  }

  registerReplacement(toolCallId: string, filePath: string, preview: string): void {
    this.map.set(toolCallId, { filePath, preview });
  }
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

function getToolResultsDir(): string {
  return path.join(app.getPath('userData'), TOOL_RESULTS_SUBDIR);
}

function buildPreview(toolName: string, content: string, filePath: string): string {
  const truncated = content.substring(0, PREVIEW_LENGTH);
  return (
    truncated +
    `\n\n[工具 ${toolName} 返回了大量结果（${content.length} 字符），完整内容已保存到: ${filePath}]`
  );
}

// ---------------------------------------------------------------------------
// 核心函数
// ---------------------------------------------------------------------------

/**
 * 持久化大结果：超出 MAX_SINGLE_RESULT_CHARS 时写入文件并返回预览。
 *
 * @param toolName 工具名称（用于预览文本）
 * @param content 工具返回的完整结果内容
 * @param toolCallId 工具调用 ID（用于确定性替换）
 * @param replacementState 可选替换状态（确保确定性）
 * @param force 强制持久化（即使用于聚合预算控制，忽略单工具阈值）
 */
export async function persistLargeResult(
  toolName: string,
  content: string,
  toolCallId: string,
  replacementState?: ContentReplacementState,
  force = false,
): Promise<PersistResult> {
  // 未超出单工具阈值且非强制时原样返回
  if (!force && content.length <= MAX_SINGLE_RESULT_CHARS) {
    return { persisted: false, displayContent: content };
  }

  // 确定性替换：同一 toolCallId 已注册过，返回相同预览
  if (replacementState?.hasReplacement(toolCallId)) {
    const existing = replacementState.getReplacement(toolCallId)!;
    return { persisted: true, displayContent: existing.preview, filePath: existing.filePath };
  }

  // 写入文件
  const dir = getToolResultsDir();
  fs.mkdirSync(dir, { recursive: true });

  // 文件名：<toolCallId>_<timestamp>.txt
  const sanitizedId = toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${sanitizedId}_${Date.now()}.txt`;
  const filePath = path.join(dir, fileName);

  await fs.promises.writeFile(filePath, content, 'utf-8');

  const preview = buildPreview(toolName, content, filePath);
  replacementState?.registerReplacement(toolCallId, filePath, preview);

  return { persisted: true, displayContent: preview, filePath };
}

/**
 * 聚合预算控制：所有结果总字符数超出 MAX_AGGREGATE_RESULTS_CHARS 时，
 * 从最大结果开始持久化（force=true），直至总字符数低于预算。
 *
 * 泛型化以支持 ToolExecResult 等子类型直接流入，无需类型断言。
 * 返回新数组，不修改原数组。
 */
export async function applyAggregateBudget<T extends ResultLike>(
  results: readonly T[],
  replacementState?: ContentReplacementState,
): Promise<T[]> {
  const totalChars = results.reduce((sum, r) => sum + r.result.content.length, 0);
  if (totalChars <= MAX_AGGREGATE_RESULTS_CHARS) {
    return [...results];
  }

  // 按内容长度降序排列，优先压缩最大结果
  const indicesBySize = results
    .map((r, i) => ({ index: i, length: r.result.content.length }))
    .sort((a, b) => b.length - a.length);

  // 深拷贝结果数组（展开原对象 + 浅拷贝 tc / result 子对象）
  const modified: T[] = results.map((r) => ({
    ...r,
    tc: { ...r.tc },
    result: { ...r.result },
  }));

  let currentTotal = totalChars;

  for (const { index } of indicesBySize) {
    if (currentTotal <= MAX_AGGREGATE_RESULTS_CHARS) break;

    const r = modified[index];

    // 使用 force=true 跳过单工具阈值，直接持久化
    const { persisted, displayContent } = await persistLargeResult(
      r.tc.name,
      r.result.content,
      r.toolCallId,
      replacementState,
      true, // force
    );

    if (persisted) {
      const saved = r.result.content.length - displayContent.length;
      r.result.content = displayContent;
      currentTotal -= saved;
    }
  }

  return modified;
}
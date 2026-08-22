// ============================================
// WeaveMD — 第 5 期块级改写（主进程薄 LLM 代理）
// ============================================
// C2 铁律：主进程零 markdown 解析、零 proposal 计算。不 import 渲染内核。
// 铁律一：runRewrite 只产 LLM 原始文本 {text}，绝不写文件/编辑器/DB。
// consent 闸（'chat'，allowNetwork）不在本模块判定——由 ipc.ts 层把关（铁律二）。
// 编写遵循 ipc.ts / agentLoop.ts 既有模式：streamChatCompletion 纯对话（不传 tools），
// 累加非空 delta（qwen thinking 空 content 由 llmClient 处理，此处再跳过一层保险），
// 错误透传 llmClient 结构化错误 {code,message}。

import type { IAIConfig, RewriteReply, RewriteRequestPayload } from '@shared/ai';
import { decryptApiKey } from './secureConfig';
import { streamChatCompletion } from './llmClient';

/** selection 改写指令模板（LLM 先输出一行改写说明，再输出改写后完整 Markdown）。 */
export const REWRITE_SELECTION_SYSTEM_INSTRUCTION =
  '你是一名专业的 Markdown 改写助手。根据用户的改写要求改写给定内容，保持原意与 Markdown 结构。请先用一句话简要说明你做了哪些改动（不超过50字），然后另起一行输出 "---" 分隔符，最后输出改写后的完整 Markdown 正文。不要使用代码块围栏。';

/** document 改写指令模板（输出 JSON 数组，仅替换目标块）。 */
export const REWRITE_DOCUMENT_SYSTEM_INSTRUCTION =
  '你是一名专业的 Markdown 改写助手。根据用户的改写要求，仅改写需要改动的若干块。输出一个 JSON 数组，形如 [{"block_index":<编号>,"new_content":"<新块Markdown>"}]，只列出被替换的块，其余块不动。不要输出 Markdown 代码块围栏或任何额外解释。';

/** 整篇写（A1c）指令模板：目标文档为空/整篇生成 → 直接输出完整 Markdown 正文。 */
export const REWRITE_FULL_DOCUMENT_SYSTEM_INSTRUCTION =
  '你是一名专业的 Markdown 写作助手。目标文档为空，请根据用户的写作要求直接生成一篇结构完整、条理清晰的 Markdown 文档。只输出完整 Markdown 正文，不要任何包裹、代码块围栏或额外解释。';

/** 结构化 parse 错误（scope 数据缺失时抛出，含 AIErrorCode 'parse'）。 */
function parseError(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'parse';
  return err;
}

/**
 * 依 scope 组装 LLM 消息。
 * - selection：system 改写指令 + user selectionMarkdown
 * - document：system 改写指令(含 JSON 数组协议) + user JSON(numberedBlocks)
 * scope 数据缺失（selection 无 selectionMarkdown / document 无 numberedBlocks）→ 抛 parse 错误。
 */
export function buildRewriteMessages(
  payload: RewriteRequestPayload
): Array<{ role: 'system' | 'user'; content: string }> {
  if (payload.scope === 'selection') {
    if (!payload.selectionMarkdown || typeof payload.selectionMarkdown !== 'string') {
      throw parseError('Selection scope requires selectionMarkdown');
    }
    return [
      { role: 'system', content: REWRITE_SELECTION_SYSTEM_INSTRUCTION },
      { role: 'user', content: `改写要求：${payload.instruction}\n\n原文：\n${payload.selectionMarkdown}` },
    ];
  }
  if (payload.scope === 'document') {
    if (!payload.numberedBlocks || !Array.isArray(payload.numberedBlocks)) {
      throw parseError('Document scope requires numberedBlocks');
    }
    // A1c：空编号块 = 空文档 / 整篇生成 → 提示「目标文档为空，直接生成完整 Markdown」
    if (payload.numberedBlocks.length === 0) {
      return [
        { role: 'system', content: REWRITE_FULL_DOCUMENT_SYSTEM_INSTRUCTION },
        { role: 'user', content: `用户写作要求：${payload.instruction}` },
      ];
    }
    return [
      { role: 'system', content: REWRITE_DOCUMENT_SYSTEM_INSTRUCTION },
      { role: 'user', content: `改写要求：${payload.instruction}\n\n文档块列表：\n${JSON.stringify(payload.numberedBlocks)}` },
    ];
  }
  throw parseError(`Unsupported rewrite scope: ${String(payload.scope)}`);
}

/**
 * 主进程薄 LLM 代理：解密 apiKey（remote）→ 建 messages → streamChatCompletion 纯对话
 * （不传 tools）累加非空 delta → 返回 { text }。错误透传 llmClient 结构化错误。
 */
export async function runRewrite(
  _event: Electron.IpcMainInvokeEvent,
  payload: RewriteRequestPayload,
  config: IAIConfig,
  apiKeyEnc: string | null,
  controller: AbortController
): Promise<RewriteReply> {
  const messages = buildRewriteMessages(payload);

  const baseUrl = config.remoteBaseUrl;
  const model = config.model?.trim() || 'deepseek-chat';

  let apiKey: string | undefined;
  if (apiKeyEnc) {
    apiKey = decryptApiKey(apiKeyEnc);
  }

  const gen = streamChatCompletion({
    baseUrl,
    model,
    apiKey,
    messages,
    timeoutMs: 60_000,
    signal: controller.signal,
  });

  let text = '';
  // 纯对话无 tools：for-await 累加 delta.content，跳过空 content（qwen thinking 坑）。
  for await (const chunk of gen) {
    if (chunk.delta) {
      text += chunk.delta;
    }
  }

  // 原样返回 LLM 原始文本，不做任何 markdown/JSON 解析（C2：解析在渲染侧）。
  return { text };
}

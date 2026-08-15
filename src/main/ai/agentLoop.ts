// ============================================
// WeaveMD — Agent function-calling loop (main)
// ============================================
// 远程后端（DeepSeek）函数调用可靠；ollama 降级纯生成（不传 tools）。
// 产物：AgentRunResult。consent 闸（agent）在入口先判 —— 未授权绝不发外发请求。
// 铁律一：所有工具只读（toolRegistry 无写工具）。铁律二：KB 外发必经 needsConsent('agent')。

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type {
  AgentRunResult,
  AIErrorCode,
  IAIConfig,
  IAIConsent,
  IAgentToolCall,
  IIntent,
  ToolDef,
} from '@shared/ai';
import { appendMessage, getConversation, getMessagesByConversation, updateConversationSummary } from '../db/ai';
import { decryptApiKey } from './secureConfig';
import { needsConsent, needsKbSendConsent } from './consent';
import { classifyIntent } from './intentRouter';
import { buildCompressed, estimateTokens, shouldCompress, summarizeViaLlm, type LlmMessage } from './contextManager';
import { streamChatCompletion } from './llmClient';
import { defineCoreTools, executeTool, type SearchKbFn } from './toolRegistry';
import { loadSkills, type CoreSkill, type SkillRunnerCtx } from './skillLoader';

/** agentLoop 依赖注入（KB 检索 / consent 由调用方注入，勿 import 并行 kbSearch.ts）。 */
export interface AgentLoopDeps {
  searchKb?: SearchKbFn;
  /** 用户 consent 快照（缺省视为未授权，安全默认）。 */
  consent?: IAIConsent;
}

interface AgentReqPayload {
  userId: string;
  conversationId?: string;
  message: string;
  /** 是否启用知识库检索（kbQa 意图时可作为 searchKB 工具候选）。 */
  useKnowledgeBase?: boolean;
  /** 当前文档 markdown 快照（只读上下文，供 editBlocks 产改写建议；不落盘）。 */
  currentDocument?: string;
}

/** 工具回填消息（OpenAI 续轮约定，额外字段随序列化传给远端）。
 *  注意字段为 snake_case（`tool_calls`/`tool_call_id`）——远端 OpenAI 兼容 API
 *  对 camelCase（`toolCalls`/`toolCallId`）会 400「missing field tool_call_id」。 */
type AgentLlmMessage = LlmMessage & {
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
};

const MAX_ROUNDS = 6;
const CONTEXT_WINDOW = 64_000;
const COMPRESS_THRESHOLD = 0.8;
const KEEP_RECENT_ROUNDS = 6;

function makeAgentResult(partial: {
  conversationId: string;
  assistantId: string;
  roundsUsed: number;
  intent: IIntent | null;
  refused?: boolean;
  usage?: { reasoningTokenCount: number | null };
  agentBackendHint?: string;
}): AgentRunResult {
  return {
    conversationId: partial.conversationId,
    assistantId: partial.assistantId,
    roundsUsed: partial.roundsUsed,
    intent: partial.intent,
    ...(partial.refused !== undefined ? { refused: partial.refused } : {}),
    ...(partial.usage ? { usage: partial.usage } : {}),
    ...(partial.agentBackendHint ? { agentBackendHint: partial.agentBackendHint } : {}),
  };
}

function sendStream(
  event: Electron.IpcMainInvokeEvent,
  channel: string,
  payload: unknown
): void {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.webContents.send(channel, payload);
}

/**
 * 按意图决定可用工具子集（全部只读；editBlocks 仅产改写建议，不落盘）。
 * - searchKB 仅在「kbQa 意图 + 启用知识库 + 已授权 KB 外发（allowSend）」时提供。
 * - editBlocks 仅在「rewrite 意图 + 已提供 currentDocument」时提供——无文档上下文则不给，
 *   避免 LLM 调用无上下文工具。
 * allowSend / consent 未授权则不提供对应外发工具（降级作答，不抛错）。
 */
function toolsForIntent(
  intent: IIntent,
  useKnowledgeBase: boolean,
  kbEgressAuthorized: boolean,
  currentDocument?: string
): ToolDef[] {
  const all = defineCoreTools();
  if (useKnowledgeBase && intent.intent === 'kbQa' && kbEgressAuthorized) {
    return all.filter((t) => t.function.name === 'searchKB');
  }
  if (intent.intent === 'rewrite' && !!currentDocument) {
    return all.filter((t) => t.function.name === 'editBlocks');
  }
  if (intent.intent === 'tech' || intent.intent === 'create') {
    return all.filter((t) =>
      ['listFiles', 'readFile', 'runSkill'].includes(t.function.name)
    );
  }
  return [];
}

/**
 * Agent 主流程。consent 未授权即抛 consent_required（不发外发请求）。
 * 工具调用异常单独兜底作答，不让循环抛断。
 */
export async function runAgentFlow(
  event: Electron.IpcMainInvokeEvent,
  payload: AgentReqPayload,
  config: IAIConfig,
  apiKeyEnc: string | null,
  controller: AbortController,
  deps: AgentLoopDeps = {}
): Promise<AgentRunResult> {
  const { userId } = payload;
  const send = (ch: string, pl: unknown): void => sendStream(event, ch, pl);

  // 1. consent 闸：agent 未授权（默认视为未授权）绝不外发
  const consent: IAIConsent = deps.consent ?? {
    allowNetwork: false,
    allowSend: false,
    consentUpdatedAt: null,
  };
  if (needsConsent(config, consent, 'agent')) {
    throw Object.assign(new Error('Agent network consent required'), {
      code: 'consent_required',
    });
  }

  const message = (payload.message ?? '').trim();
  if (!message) {
    throw Object.assign(new Error('Message is required'), { code: 'config_incomplete' });
  }

  // 会话归属校验 + 持久化用户消息
  const convId = payload.conversationId ?? '';
  if (!convId) {
    throw Object.assign(new Error('Agent conversation id is required'), {
      code: 'config_incomplete',
    });
  }
  const ownedConv = getConversation(convId, userId);
  if (!ownedConv) {
    throw Object.assign(new Error('Conversation not found'), { code: 'config_incomplete' });
  }
  appendMessage({ conversationId: convId, userId, role: 'user', content: message });

  const intent = classifyIntent(message);
  const baseUrl = config.backend === 'remote' ? config.remoteBaseUrl : config.ollamaBaseUrl;
  const model =
    config.model?.trim() || (config.backend === 'remote' ? 'deepseek-chat' : 'qwen3.5:0.8b');
  let apiKey: string | undefined;
  if (config.backend === 'remote' && apiKeyEnc) {
    apiKey = decryptApiKey(apiKeyEnc);
  }

  const skillContext: SkillRunnerCtx = {
    backend: config.backend,
    baseUrl,
    model,
    apiKey,
    timeoutMs: 60_000,
    signal: controller.signal,
  };
  const skills: CoreSkill[] = loadSkills();
  const toolCtx = {
    userId,
    searchKb: deps.searchKb,
    skill: skillContext,
    skills,
    // 只读文档上下文（editBlocks 改写建议用；不落盘，铁律一）
    currentDocument: payload.currentDocument,
  };

  const isRemote = config.backend === 'remote';
  // KB 检索外发授权：allowSend 已授权才提供 searchKB 工具（未授权则笔记不外发，降级普通作答）。
  const kbEgressAuthorized = !needsKbSendConsent(config, consent);
  const tools = isRemote
    ? toolsForIntent(
        intent,
        !!payload.useKnowledgeBase,
        kbEgressAuthorized,
        payload.currentDocument
      )
    : [];
  const isOllamaHint =
    config.backend === 'ollama'
      ? { agentBackendHint: '当前为本地纯生成模式（Ollama 不支持工具调用），Agent 能力需远程后端。' }
      : {};
  const agentBackendHint = config.backend === 'ollama' ? isOllamaHint.agentBackendHint : undefined;

  const summary = ownedConv?.summary || '';

  const history: LlmMessage[] = getMessagesByConversation(convId, userId)
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
    .map((m): LlmMessage => ({ role: m.role, content: m.content }));

  // 历史（含本轮 user 已落库）+ 当前；有 summary 则压缩/置顶
  let llmMessages: AgentLlmMessage[] = summary
    ? buildCompressed(history, summary, KEEP_RECENT_ROUNDS)
    : [...history];

  let roundsUsed = 0;
  let reasoningTokenCount: number | null = null;
  let assistantId = '';

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      roundsUsed = round + 1;

      // 上下文 >80% 且已有摘要 -> 在线压缩（幂等）
      if (
        summary &&
        shouldCompress(
          estimateTokens(llmMessages.map((m) => m.content).join('\n')),
          CONTEXT_WINDOW,
          COMPRESS_THRESHOLD
        )
      ) {
        const newSummary = await summarizeViaLlm(llmMessages, skillContext);
        if (newSummary) {
          updateConversationSummary(convId, userId, newSummary);
          llmMessages = buildCompressed(llmMessages, newSummary, KEEP_RECENT_ROUNDS);
        }
      }

      const gen = streamChatCompletion({
        backend: config.backend,
        baseUrl,
        model,
        apiKey,
        messages: llmMessages as Array<{ role: string; content: string }>,
        ...(tools.length ? { tools, toolChoice: 'auto' as const } : {}),
        timeoutMs: 60_000,
        signal: controller.signal,
      });

      const accumulatedToolCalls: Array<{ index: number; name: string; arguments: string }> = [];
      let assistantContent = '';

      for await (const chunk of gen) {
        if (chunk.delta) {
          assistantContent += chunk.delta;
          send(IPC_CHANNELS.AI_STREAM_CHUNK, { conversationId: convId, delta: chunk.delta });
        }
        if (chunk.usage?.reasoningTokenCount != null) {
          reasoningTokenCount = chunk.usage.reasoningTokenCount;
        }
        if (chunk.toolCalls?.length) accumulatedToolCalls.push(...chunk.toolCalls);
      }

      if (accumulatedToolCalls.length === 0) {
        // 无工具调用：assistant 完成落库
        const assistantMsg = appendMessage({
          conversationId: convId,
          userId,
          role: 'assistant',
          content: assistantContent,
        });
        assistantId = assistantMsg.id;
        send(IPC_CHANNELS.AI_STREAM_DONE, {
          conversationId: convId,
          usage: { reasoningTokenCount },
          roundsUsed,
          intent,
        });
        return makeAgentResult({
          conversationId: convId,
          assistantId,
          roundsUsed,
          intent,
          usage: { reasoningTokenCount },
          ...(agentBackendHint ? { agentBackendHint } : {}),
        });
      }

      // 有工具调用：逐次执行 + 推送 tool 事件 + 落库 role:'tool' + 回填续轮
      const toolTurn: AgentLlmMessage[] = [];
      toolTurn.push({
        role: 'assistant',
        content: '',
        tool_calls: accumulatedToolCalls.map((tc) => ({
          id: `call_${round}_${tc.index}`,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
      for (const tc of accumulatedToolCalls) {
        const toolCallId = `call_${round}_${tc.index}`;
        let result;
        try {
          result = await executeTool(tc.name, tc.arguments, toolCtx);
        } catch (err) {
          result = {
            content: '',
            status: 'error' as const,
            errorDesc: err instanceof Error ? err.message : String(err),
          };
        }
        const toolEvent: IAgentToolCall = {
          toolCallId,
          name: tc.name,
          args: tc.arguments,
          status: result.status,
          ...(result.status === 'ok'
            ? { result: result.content }
            : { errorDesc: result.errorDesc }),
        };
        send(IPC_CHANNELS.AI_STREAM_TOOL, { conversationId: convId, ...toolEvent });

        appendMessage({
          conversationId: convId,
          userId,
          role: 'tool',
          content: result.errorDesc
            ? `[工具 ${tc.name} 失败] ${result.errorDesc}`
            : result.content,
        });
        toolTurn.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: result.errorDesc ? `[工具失败] ${result.errorDesc}` : result.content,
        });
      }
      llmMessages = [...llmMessages, ...toolTurn];
    }

    // 到达轮数上限：收敛提示（不无限循环）
    const convergence = appendMessage({
      conversationId: convId,
      userId,
      role: 'assistant',
      content: `已在 ${MAX_ROUNDS} 轮内达到 Agent 工具能力上限，请将需求拆分后重试。`,
    });
    assistantId = convergence.id;
    send(IPC_CHANNELS.AI_STREAM_DONE, {
      conversationId: convId,
      usage: { reasoningTokenCount },
      roundsUsed,
      intent,
    });
    return makeAgentResult({
      conversationId: convId,
      assistantId,
      roundsUsed,
      intent,
      usage: { reasoningTokenCount },
      ...(agentBackendHint ? { agentBackendHint } : {}),
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'consent_required') {
      throw err;
    }
    if ((err as { name?: string })?.name === 'AbortError') {
      const aborted = Object.assign(new Error('aborted'), { code: 'aborted' });
      send(IPC_CHANNELS.AI_STREAM_ERROR, {
        conversationId: convId,
        code: 'aborted',
        message: 'Request aborted',
      });
      throw aborted;
    }
    const code = ((err as { code?: string })?.code ?? 'network') as AIErrorCode;
    send(IPC_CHANNELS.AI_STREAM_ERROR, {
      conversationId: convId,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

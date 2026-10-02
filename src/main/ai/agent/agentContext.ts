// ============================================
// WeaveMD — Agent 上下文准备
// ============================================

import { randomUUID } from 'crypto';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type {
  IAIConfig,
  IAIConsent,
  IAgentToolCall,
  IGlobalAgentFiles,
  IIntent,
  ToolDef,
} from '@shared/ai';
import { appendMessage, getConversation, getRecentMessagesByRounds } from '../../db/ai';
import { listFiles } from '../../db/files';
import { hasGrantedAttachmentDocs } from '../../db/kb';
import { getEmbeddingConfig } from '../../db/embeddingConfig';
import { getActiveProfile, type AgentMemoryRow } from '../../db/agentMemory';
import { decryptApiKey } from '../secureConfig';
// 意图路由经命名空间访问：classifyIntent 直用；多意图预检门 detectMultiIntentGate
// 在 mock 环境（旧测试仅 mock classifyIntent）可能缺导出，调用处 try/catch fail-closed
import * as intentRouter from '../intentRouter';
import * as intentTiering from '../intentTiering';
import { buildCompressed, contentToText, estimateContentTokens, type LlmMessage } from '../contextManager';
import { streamChatCompletionWithRetry } from '../llm/llmClient';
import { streamAnthropicCompletion } from '../llm/anthropicClient';
import { createEmbedding } from '../knowledge/embeddingClient';
import { resolveVisionSupport } from '../llm/modelDiscovery';
import {
  buildImageParts,
  injectImagesIntoMessages,
  VISION_DEGRADED_NOTICE,
} from './agentMedia';
import { buildMdImageContext } from '../files/mdImageResolver';
import { getGlobalAgentFiles } from '../files/globalAgentFiles';
import { type ToolCtx } from '../toolRegistry';
import { resolveSearchConfig } from '../tools/webSearch';
import { loadSkills, type CoreSkill, type SkillRunnerCtx } from '../skills/skillLoader';
import { getDefaultSkillDirs } from '../skills/skillPaths';
import { persistAndSend } from './agentEventStore';
import { DeadLoopDetector } from './agentLoopGuard';
import {
  buildDocumentContext,
  buildFileListSnapshot,
  buildLocalTreeSnapshot,
  buildAttachmentManifest,
  buildAgentSystemPrompt,
  buildChatSystemPrompt,
  isExperienceIntent,
  shouldInjectDocumentContext,
} from './agentPromptBuilder';
import { toolsForIntent } from './agentToolSelector';
import { getRoundsForIntent, KEEP_RECENT_ROUNDS } from './agentHelpers';
import { needsConsent, needsKbSendConsent } from '../consent';
import type { AgentLoopDeps } from './agentLoop';
import type { AgentReqPayload } from './agentLoop';
import type { AgentLlmMessage } from './agentLoop';
import type { ContentReplacementState } from './toolResultStorage';
import type { CitationEntry, WriteBatchItem } from './agentToolExecutor';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface AgentContext {
  convId: string;
  userId: string;
  /** 本次 agent 运行的唯一盐，用于工具轮确定性 id 的运行维度，整轮运行内稳定 */
  runId: string;
  send: (channel: string, payload: unknown) => void;
  intent: IIntent;
  baseUrl: string;
  model: string;
  apiKey?: string;
  skillContext: SkillRunnerCtx;
  skills: CoreSkill[];
  toolCtx: ToolCtx;
  tools: ToolDef[];
  llmMessages: AgentLlmMessage[];
  detector: DeadLoopDetector;
  toolCallsHistory: IAgentToolCall[];
  hasSessionPersist: boolean;
  roundsUsed: number;
  reasoningTokenCount: number | null;
  assistantId: string;
  /** 增量 token 统计（避免每轮全量重算）。 */
  totalTokens: number;
  /** S6: 大结果替换状态（确保跨轮确定性）。 */
  replacementState?: ContentReplacementState;
  /** B8 六-2②：本轮检索 citation（assistant refsJson 来源，executeOneTool 收集）。 */
  citationRefs?: CitationEntry[];
  /**
   * 多写子任务链的写批次收集器（任务 11）：链启动置 []，链内 batch 档写入成功后
   * 收集，链末 confirmWriteBatch 一次汇总确认（Q13）。缺省 = 非链/不收集。
   */
  writeBatch?: WriteBatchItem[];
  /** 多意图规则预检门（Q6）：true = 需走结构化拆分（agent-multi-intent 任务 2）。 */
  intentGateOpen: boolean;
  /** 链 v1 快照：历史消息（去当前 user 消息，经 cleanup/配对修复），任务 5 上下文重建铺垫。 */
  baseHistoryMessages: AgentLlmMessage[];
  /** 链 v1 快照：toolsForIntent 七个入参上提，任务 5 子任务级工具重建铺垫。 */
  toolSelectionArgs: ToolSelectionArgs;
}

/** toolsForIntent 入参元组（agentContext 与子任务链共用的单一口径）。 */
export type ToolSelectionArgs = Parameters<typeof toolsForIntent>;

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** IPC_CHANNELS → persistAndSend eventType 映射（ai:stream:* 后缀）。 */
export const CHANNEL_TO_EVENT_TYPE: Record<string, string> = {
  [IPC_CHANNELS.AI_STREAM_CHUNK]: 'chunk',
  [IPC_CHANNELS.AI_STREAM_TOOL]: 'tool',
  [IPC_CHANNELS.AI_STREAM_DONE]: 'done',
  [IPC_CHANNELS.AI_STREAM_ERROR]: 'error',
};

/**
 * P0-5 历史读取软字节闸（UTF-8 字节）。
 * 出处：plan §7 风险 3 —— 取消行数上限后用「字节预算 + buildCompressed 阈值 +
 * CONTEXT_WINDOW=64_000」三闸控上界，预算初值 45_000 **[待按 64000 实测调优]**。
 */
const HISTORY_BYTE_BUDGET = 45_000;

// ---------------------------------------------------------------------------
// IPC 发送
// ---------------------------------------------------------------------------

export function sendStream(
  event: Electron.IpcMainInvokeEvent,
  channel: string,
  payload: unknown
): void {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.webContents.send(channel, payload);
}

/**
 * 创建持久化发送函数：当 sessionId + db + mainWindow 都存在时走 persistAndSend，
 * 否则回退到原 sendStream 行为。DB 写入失败时 try-catch 降级为纯 IPC。
 */
export function createSend(
  event: Electron.IpcMainInvokeEvent,
  deps: AgentLoopDeps,
  convId: string
): (channel: string, payload: unknown) => void {
  const hasPersistDeps = !!(deps.sessionId && deps.db && deps.mainWindow);

  if (!hasPersistDeps) {
    return (channel, payload) => sendStream(event, channel, payload);
  }

  const db = deps.db!;
  const mainWindow = deps.mainWindow!;
  const sessionId = deps.sessionId!;

  return (channel, payload) => {
    const eventType = CHANNEL_TO_EVENT_TYPE[channel];
    if (eventType) {
      try {
        persistAndSend(db, mainWindow, sessionId, convId, eventType, payload);
      } catch {
        sendStream(event, channel, payload);
      }
    } else {
      sendStream(event, channel, payload);
    }
  };
}

// ---------------------------------------------------------------------------
// 消息清理
// ---------------------------------------------------------------------------

/**
 * 清理不完整对话历史：移除末尾无 assistant 回复的孤立 user 消息。
 * 上一轮 Agent 超时/崩溃时，user 消息已持久化但 assistant 回复缺失，
 * 不清理会导致 LLM 困惑（看到 user 消息却无对应 assistant 回复）。
 */
export function cleanupIncompleteMessages(messages: LlmMessage[]): LlmMessage[] {
  if (messages.length === 0) return messages;
  // 从末尾向前扫描：如果最后一条是 user / tool（无 assistant 跟随），移除
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') { lastAssistantIdx = i; break; }
  }
  if (lastAssistantIdx === -1) {
    // 整个历史无 assistant 回复，只保留第一条 user 消息（当前轮的 query）
    const firstUserIdx = messages.findIndex((m) => m.role === 'user');
    return firstUserIdx >= 0 ? [messages[firstUserIdx]] : [];
  }
  // 保留到最后一个 assistant 消息（含其 tool 消息），截断后续孤立 user 消息
  return messages.slice(0, lastAssistantIdx + 1);
}

/** P0-4 配对修复合成占位 tool 行的文案（plan §5，测试锁文案，勿改）。 */
export const MISSING_TOOL_RESULT_PLACEHOLDER =
  '[工具结果缺失：会话在该工具完成前中断，结果不可恢复]';

/**
 * DB `tool_calls` 列（`IAgentToolCall[]`）→ LLM 线上 tool_calls。
 * 与 `assembleToolTurn` 产出同形（`{id,type:'function',function:{name,arguments}}`），
 * 保证重载会话后发给 provider 的 assistant 轮与在线时一致。
 */
function toLlmToolCalls(
  toolCalls: IAgentToolCall[] | undefined
): AgentLlmMessage['tool_calls'] {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.toolCallId,
    type: 'function' as const,
    function: { name: tc.name, arguments: tc.args },
  }));
}

/**
 * 工具轮配对修复（P0-4 / Q14）：**纯内存、永不写库**，且不复用
 * `cleanupIncompleteMessages`（后者只按「最后一条 assistant」截断，不校验 id 配对）。
 * plan §5 三条规则：
 * 1. assistant 有 `tool_calls` 缺配对 tool 行 → 合成占位 tool 行（不剥 `tool_calls`，避免丢该轮）；
 * 2. 孤儿 tool 行（前置无含该 `tool_call_id` 的 `assistant.tool_calls`）→ 丢弃
 *    （无法重建 `function.name`，provider 必拒）；
 * 3. 老数据纯文本 assistant 行（本就无 `tool_calls`）→ 原样保留。
 */
export function repairToolTurnPairing(messages: AgentLlmMessage[]): AgentLlmMessage[] {
  // 第一遍：按出现顺序声明 id，孤儿 tool 行就地丢弃
  const declared = new Set<string>();
  const kept: AgentLlmMessage[] = [];
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) declared.add(tc.id);
    }
    if (m.role === 'tool') {
      if (!m.tool_call_id || !declared.has(m.tool_call_id)) continue;
    }
    kept.push(m);
  }

  // 第二遍：为缺配对的 assistant(tool_calls) 合成占位 tool 行
  const out: AgentLlmMessage[] = [];
  for (let i = 0; i < kept.length; i++) {
    const m = kept[i];
    out.push(m);
    if (m.role !== 'assistant' || !m.tool_calls || m.tool_calls.length === 0) continue;
    // 收集其后紧邻的本轮 tool 行
    let end = i + 1;
    while (end < kept.length && kept[end].role === 'tool') end++;
    const paired = kept.slice(i + 1, end);
    for (let x = i + 1; x < end; x++) out.push(kept[x]);
    for (const tc of m.tool_calls) {
      if (paired.some((t) => t.tool_call_id === tc.id)) continue;
      out.push({ role: 'tool', tool_call_id: tc.id, content: MISSING_TOOL_RESULT_PLACEHOLDER });
    }
    i = end - 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 阶段 1：准备 Agent 上下文
// ---------------------------------------------------------------------------

/**
 * A1（Q2 三文件同批 / Q4 上限）：把 soul / memory / style 三段内容拼成
 * system prompt 注入块。三段全空白 → 返回空串（调用方 filter(Boolean) 零注入）。
 * token 截断在 agentPromptBuilder 内做（硬上限 2000，Q4）。
 */
export function buildGlobalAgentFilesBlock(files: IGlobalAgentFiles): string {
  const sections: string[] = [];
  const push = (title: string, content: string): void => {
    const text = (content ?? '').trim();
    if (text) sections.push(`${title}\n${text}`);
  };
  push('=== soul.md（性格） ===', files.soul);
  push('=== memory.md（记忆） ===', files.memory);
  push('=== style.md（风格） ===', files.style);
  if (sections.length === 0) return '';
  return [
    '【全局 Agent 文件】以下为用户在设置页配置的全局 Agent 文件：遵循其中的人格、长期记忆与写作风格设定。',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

/** A1：读取三文件并拼注入块；读取失败返回空串（不影响主流程）。 */
function readGlobalAgentFilesBlock(): string {
  try {
    return buildGlobalAgentFilesBlock(getGlobalAgentFiles());
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// B4：用户画像注入块（agent-memory-optimize-2 req §二 B4 / 总指挥裁定 2~4）
// ---------------------------------------------------------------------------

/** 画像块稳定小节标题（注入位置与占位噪音判定的锚点）。 */
const PROFILE_HEADER = '【用户画像】';

/**
 * 画像条数上限（裁定 3③）：超出按 writtenAt 新者优先保留，并在块尾标注省略条数。
 * 取 40 的理由：画像为 subject/content 短条目，40 条已远超单用户典型画像量级，
 * 既防极端库把个性化层撑爆，也避免与 2000 token 截断重复兜底 —— 本批无画像条数
 * 实测分布，故按裁定取值，不做进一步压缩。
 */
const PROFILE_MAX_ENTRIES = 40;

/** 归一为单行可读文本（多行/连续空白折叠，避免破坏条目列表结构）。 */
function normalizeEntryText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 当前有效画像 → 注入块（纯函数，便于单测）。
 * - 以稳定小节标题开头，每条含 subject 与 content（裁定 3①/②）；
 * - 按 writtenAt 新者优先排序，条数超上限截断并标注省略条数（裁定 ③）；
 * - 无可用条目返回空串（连标题都不留，与 A1 未配置文件时同口径，裁定 2）。
 */
export function buildProfileBlock(rows: AgentMemoryRow[]): string {
  const valid = (rows ?? []).filter(
    (row) => normalizeEntryText(row.subject) || normalizeEntryText(row.content)
  );
  if (valid.length === 0) return '';

  const sorted = [...valid].sort((a, b) => {
    if (a.writtenAt !== b.writtenAt) return a.writtenAt < b.writtenAt ? 1 : -1;
    return b.id - a.id; // 同一写入时刻按 id 新者优先（稳定 tie-break）
  });
  const kept = sorted.slice(0, PROFILE_MAX_ENTRIES);
  const omitted = sorted.length - kept.length;

  const lines = kept.map((row) => {
    const subject = normalizeEntryText(row.subject);
    const content = normalizeEntryText(row.content);
    return subject && content ? `- ${subject}：${content}` : `- ${subject || content}`;
  });
  const parts = [
    `${PROFILE_HEADER}以下为从长期记忆读出的当前有效画像，用于个性化作答；与用户当面陈述冲突时以用户当面陈述为准。`,
    ...lines,
  ];
  if (omitted > 0) {
    parts.push(`(画像超过 ${PROFILE_MAX_ENTRIES} 条，已省略 ${omitted} 条较旧条目)`);
  }
  return parts.join('\n');
}

/**
 * B4：读取当前有效画像并拼注入块。
 * db 由调用方传入（生产链路由后台 worker 注入 `AgentLoopDeps.db`）——
 * 未注入即视为 DB 未初始化，直接降级空串且不发起查询；
 * 表缺失 / 查询抛错由 try/catch 兜住；userId 缺失同样降级
 * （画像必须按 user_id 归属读取，SECURITY.md）。
 */
function readActiveProfileBlock(userId: string, db?: import('better-sqlite3').Database): string {
  if (!userId || !db) return '';
  try {
    return buildProfileBlock(getActiveProfile(db, userId));
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 经验注入（agent-memory-optimize-3 D4 六.2：结构化经验 + 任务类型识别注入）
// ---------------------------------------------------------------------------

/** 经验块稳定小节标题（注入位置断言的锚点）。 */
const EXPERIENCE_HEADER = '【可复用经验】';

/**
 * 经验块的技能输入子集（结构兼容 `CoreSkill`）。
 * 用结构类型而非直接引 `CoreSkill`：本函数只消费 4 个字段，且便于单测传夹具。
 */
interface ExperienceSkillInput {
  name: string;
  description: string;
  instructions: string;
  /**
   * front matter 的原始标注：`undefined` = 未标注、`[]` = 标注了但全非法。
   * 合法性在此再按白名单过滤一次（不信任文件层）。
   */
  intents?: readonly string[];
}

/**
 * 按当前意图挑选技能并拼经验块（六.2，总指挥裁定 3/4）。
 *
 * 匹配规则：
 * 1. 意图不在 {@link isExperienceIntent} 白名单（**含 `chat`**）→ 空串，一律不注入；
 * 2. 技能显式标了 `intents` → **只看显式命中**，不回落推断（`[]` = 已标注却不适用）；
 * 3. 未标 `intents` → 用 `name + description` 跑一次 `classifyIntent` 推断
 *    （**复用 intentRouter 既有关键词规则表**，不改其判定逻辑），推断不中就不注入；
 * 4. 无匹配 / 无技能 → 空串，零占位噪音（与 A1/B4 同口径）。
 *
 * 排序：显式命中在前、推断命中在后，两组内部保持 `skills` 原顺序 ——
 * 注入顺序可预测，且块内 instructions 原文按序拼接（顺序语义不被洗乱）。
 */
export function buildExperienceBlock(
  skills: readonly ExperienceSkillInput[] | undefined,
  intent?: string
): string {
  if (!skills || skills.length === 0) return '';
  if (!isExperienceIntent(intent)) return '';

  const explicit: ExperienceSkillInput[] = [];
  const inferred: ExperienceSkillInput[] = [];
  for (const skill of skills) {
    if (!skill || !skill.instructions || !skill.instructions.trim()) continue;
    if (skill.intents !== undefined) {
      if ((skill.intents as readonly string[]).includes(intent as string)) explicit.push(skill);
      continue;
    }
    const label = `${skill.name} ${skill.description}`.trim();
    if (!label) continue;
    // 技能推断走 shared（hasHistory=true 键，与主分类同缓存）；缺导出回落规则
    let labelIntent: string;
    try {
      labelIntent = intentTiering.classifyIntentShared(label, true).intent;
    } catch {
      labelIntent = intentRouter.classifyIntent(label, { hasHistory: true }).intent;
    }
    if (labelIntent === intent) inferred.push(skill);
  }

  const matched = [...explicit, ...inferred];
  if (matched.length === 0) return '';

  const parts = [
    `${EXPERIENCE_HEADER}以下为与当前任务类型匹配的既有经验（来自技能库），按原步骤顺序执行，不要调整步骤次序。`,
  ];
  for (const skill of matched) {
    const head = `【技能 ${skill.name}】${skill.description}`.trim();
    parts.push('', head, skill.instructions.trim());
  }
  return parts.join('\n');
}

/**
 * 准备 Agent 运行上下文：consent 闸 + 校验 + 消息组装 + 工具选择。
 * consent 未授权即抛 consent_required。
 */
export function prepareAgentContext(
  event: Electron.IpcMainInvokeEvent,
  payload: AgentReqPayload,
  config: IAIConfig,
  apiKeyEnc: string | null,
  controller: AbortController,
  deps: AgentLoopDeps
): AgentContext {
  const { userId } = payload;
  const convId = payload.conversationId ?? '';
  // B-b-fix：整轮运行唯一的 id 盐（round 每次运行都从 0 重计，必须叠加运行维度）
  const runId = randomUUID();
  const send = createSend(event, deps, convId);

  // 联网同意闸已停用（needsConsent 恒 false）：三配置齐全即视为联网许可，保留调用点兼容。
  // 笔记外发闸由 kbEgressAuthorized（needsKbSendConsent / allowSend）单独把关。
  const consent: IAIConsent = deps.consent ?? {
    allowNetwork: false,
    allowSend: false,
    consentUpdatedAt: null,
  };
  if (needsConsent(consent)) {
    throw Object.assign(new Error('Agent network consent required'), {
      code: 'consent_required',
    });
  }

  const message = (payload.message ?? '').trim();
  if (!message) {
    throw Object.assign(new Error('Message is required'), { code: 'config_incomplete' });
  }

  // 会话归属校验 + 持久化用户消息
  if (!convId) {
    throw Object.assign(new Error('Agent conversation id is required'), {
      code: 'config_incomplete',
    });
  }
  const ownedConv = getConversation(convId, userId);
  if (!ownedConv) {
    throw Object.assign(new Error('Conversation not found'), { code: 'config_incomplete' });
  }

  const baseUrl = config.remoteBaseUrl;
  const model = config.model?.trim() || 'deepseek-chat';
  let apiKey: string | undefined;
  if (apiKeyEnc) {
    apiKey = decryptApiKey(apiKeyEnc);
  }

  // Bug B 发送前最终判定链：visionOverride 覆盖 → 已知能力表 → 未知乐观注入
  // （注入与识别两链路统一经 resolveVisionSupport，来源一致）
  const supportsImages = resolveVisionSupport(model, config.visionOverride);

  // ---- A-b-1：历史读取上提（先于 classifyIntent，以便后续拿到「是否存在历史」）----
  // 当前 user 消息此时尚未 appendMessage，故 dbRows 全部是历史行；
  // injectImagesIntoMessages 显式传 treatLastAsCurrent:false（末行不再代表当前轮，
  // 当前轮图片由下方 currentUserImages 全量注入）。
  // B6 五-1/五-3：图片 part 注入（历史限最近 3 张）
  const summary = ownedConv?.summary || '';
  // P0-5：按轮读取（KEEP_RECENT_ROUNDS 轮 + 软字节闸），DAO 返回时间正序；
  // 行数水位线 20 由上限降为下限，在 DAO 内部处理，调用方不传。
  const dbRows = getRecentMessagesByRounds(convId, userId, KEEP_RECENT_ROUNDS, {
    byteBudget: HISTORY_BYTE_BUDGET,
  })
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
    .map((m) => {
      const toolCalls = toLlmToolCalls(m.toolCalls);
      return {
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        // P0-4：DB tool_calls 列 → LLM 线上形状（此前在此二次丢弃）
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
        ...(m.attachments ? { attachments: m.attachments } : {}),
      };
    });
  const historyInjection = injectImagesIntoMessages(dbRows, {
    supportsVision: supportsImages,
    treatLastAsCurrent: false,
  });
  // P0-4：content:'' 的 assistant(tool_calls) 行必须放行（assembleToolTurn 产出即空串，
  // 过滤掉会让整轮工具调用在重载后消失）；只丢「无 tool_calls 且无 tool_call_id 且正文全空白」的噪音行。
  const rawDbMessages = historyInjection.messages.filter((m) => {
    if (m.tool_calls && m.tool_calls.length > 0) return true;
    if (m.tool_call_id) return true;
    return contentToText(m.content).trim().length > 0;
  });

  // A-b-3 P0-3：hasHistory 读原始读取行（dbRows，含本轮之前的全部行），
  // 不读 cleanupIncompleteMessages 之后的数组 —— 清理会删孤立 user 行，
  // 且当前 user 消息尚未落库，故新会话首轮恒为 false（与现状一致）。
  const hasHistory = dbRows.some((m) => m.role === 'assistant');

  // 三层意图路由（Q20 任务 4）：主分类走 shared（读 tier2 预取缓存，miss 即规则）。
  // namespace 访问 + try/catch 回落 classifyIntent（mock 缺导出 fail-closed，P0 gate 同款）
  let intent: IIntent;
  try {
    intent = intentTiering.classifyIntentShared(message, hasHistory);
  } catch {
    intent = intentRouter.classifyIntent(message, { hasHistory });
  }

  // 多意图规则预检门（Q6 / plan §1.4）：纯规则零 LLM；调用异常或 mock 缺导出一律
  // fail-closed 关闸（gate 关 = 现有单意图路径逐字节等价，安全默认）
  let intentGateOpen = false;
  try {
    intentGateOpen = intentRouter.detectMultiIntentGate(message);
  } catch {
    intentGateOpen = false;
  }

  // Bug B 降级上屏：模型不支持 vision 时，当前轮图片附件补写失败态与原因
  // （识别链已标过的保留原错误；识别链异常被吞时由本处兜底）→ attachments_json
  // 随消息落库，渲染层按 parseStatus=error + IAttachmentMeta.error 展示。
  const stampedAttachments =
    !supportsImages && payload.attachments && payload.attachments.length > 0
      ? payload.attachments.map((a) =>
          a.type === 'image' && a.parseStatus !== 'error'
            ? {
                ...a,
                parseStatus: 'error' as const,
                error: a.error ?? `当前模型（${model}）不支持图片理解`,
              }
            : a
        )
      : payload.attachments;

  // 用户消息落库：附件轻量元数据随消息写 attachments_json（正文已在发送链路落 parsed_attachments，一-4②）
  appendMessage({
    conversationId: convId,
    userId,
    role: 'user',
    content: message,
    ...(stampedAttachments && stampedAttachments.length > 0
      ? { attachments: stampedAttachments }
      : {}),
  });

  const skillContext: SkillRunnerCtx = {
    baseUrl,
    model,
    apiKey,
    // 透传协议：runSkill 与 summarizeViaLlm 回退模式按此分流
    protocol: config.protocol,
    timeoutMs: 180_000,
    signal: controller.signal,
  };
  // D3：显式传默认扫描目录（含 userData/skills 与 _auto/ 生效技能）——
  // 原无参调用只拿到内置 3 个，导致 runSkill / list_skills 看不到用户与提炼技能
  const skills: CoreSkill[] = loadSkills(getDefaultSkillDirs());

  // HyDE 向量生成器：LLM 生成假设性文档 → embedding → 返回向量
  const generateHydeVector = async (query: string): Promise<number[] | null> => {
    try {
      const encConfig = getEmbeddingConfig(userId);
      if (!encConfig || !encConfig.apiKeyEnc) return null;
      const embApiKey = decryptApiKey(encConfig.apiKeyEnc);
      if (!embApiKey) return null;

      // 1. LLM 生成假设性文档
      let hypotheticalAnswer = '';
      const hydeOpts = {
        messages: [
          { role: 'system' as const, content: '你是一个知识库检索助手。根据用户的问题，写一段可能包含答案的文档片段（100-200字）。直接输出文档内容，不要加任何前缀或解释。' },
          { role: 'user' as const, content: query },
        ],
        model,
        baseUrl,
        apiKey: apiKey ?? '',
        signal: controller.signal,
      };
      // HyDE 纯文本生成（不带 tools），按协议分流
      const hydeGen =
        config.protocol === 'anthropic'
          ? streamAnthropicCompletion(hydeOpts)
          : streamChatCompletionWithRetry(hydeOpts);
      for await (const chunk of hydeGen) {
        if (chunk.delta) hypotheticalAnswer += chunk.delta;
      }
      hypotheticalAnswer = hypotheticalAnswer.trim();
      if (!hypotheticalAnswer || hypotheticalAnswer.length < 10) return null;

      // 2. Embedding 假设性文档
      const embRes = await createEmbedding({
        baseUrl: encConfig.baseUrl,
        model: encConfig.model,
        apiKey: embApiKey,
        input: hypotheticalAnswer,
      });
      return embRes.embeddings[0] ?? null;
    } catch {
      return null;
    }
  };

  // KB 检索外发授权（B11 八-1②：该计算不放宽——仍恒等于 !allowSend）
  const kbEgressAuthorized = !needsKbSendConsent(config, consent);
  // B11 八-1②：勾选授权附件存在性（勾选=该文档显式授权；查询失败视为无授权，fail-closed）
  let kbAttachmentEgressGranted = false;
  if (!kbEgressAuthorized) {
    try {
      kbAttachmentEgressGranted = hasGrantedAttachmentDocs(userId);
    } catch { /* DB 未初始化时视为无勾选授权附件（不注入） */ }
  }

  const toolCtx: ToolCtx = {
    userId,
    searchKb: deps.searchKb,
    skill: skillContext,
    skills,
    currentDocument: payload.currentDocument,
    db: deps.db,
    currentConversationId: payload.conversationId,
    fileTreePaths: payload.fileTreePaths,
    generateHydeVector,
    // R3（L4）：附件外发授权 = allowSend ∨ 勾选授权（fail-closed，
    // searchDocument 四工具在 resolveAttachmentTarget 双检中消费）
    attachmentEgressAllowed: kbEgressAuthorized || kbAttachmentEgressGranted,
  };
  // 搜索配置检查：未配置时不注入 web_search，避免 LLM 调用注定失败的工具
  let hasSearchConfig = false;
  try {
    hasSearchConfig = !!resolveSearchConfig(userId);
  } catch { /* DB 未初始化时视为无搜索配置 */ }
  // 入参上提为快照（原 :632-640 局部变量）：任务 5 子任务链按 intent 重建工具时复用
  const toolSelectionArgs: ToolSelectionArgs = [
    intent,
    !!payload.useKnowledgeBase,
    kbEgressAuthorized,
    payload.currentDocument,
    !!deps.waitForInteraction,
    hasSearchConfig,
    kbAttachmentEgressGranted,
  ];
  const tools = toolsForIntent(...toolSelectionArgs);

  // 当前轮消息：图片全量注入（不受历史限额影响）
  const currentUserImages = buildImageParts(
    (payload.attachments ?? []).filter((a) => a.type === 'image'),
    { supportsVision: supportsImages }
  );
  // B9 三-3②：当前文档 md 内相对路径图片 → 复用五链路注入
  // （解析基准 md 所在目录、越界拦截、缺失降级提示；图片向量不动，范围外）
  const mdImageContext = buildMdImageContext({
    document: payload.currentDocument,
    filePath: payload.currentFileRef?.path,
    folders: payload.fileTreePaths?.folders,
    supportsVision: supportsImages,
  });
  const currentParts = [...currentUserImages.parts, ...mdImageContext.parts];
  if (
    currentUserImages.unreadable.length ||
    historyInjection.unreadable.length ||
    mdImageContext.unreadable.length
  ) {
    console.warn(
      '[AgentContext] 图片不可读，已跳过:',
      [...currentUserImages.unreadable, ...historyInjection.unreadable, ...mdImageContext.unreadable].join(', ')
    );
  }
  /** vision 降级标记：图片存在但模型不支持 → 显式提示（五-1②） */
  const visionDegraded =
    historyInjection.degraded || currentUserImages.degraded || mdImageContext.degraded;

  // B9 三-1②/三-3②：md 图片降级提示（缺失/越界/超限）随当前轮消息进 prompt，
  // 只加在 LLM 消息上，不写消息表（appendMessage 已用原始 message 落库）。
  const userText = mdImageContext.notes.length > 0
    ? `${message}\n\n${mdImageContext.notes.join('\n')}`
    : message;

  // A-b-1：历史读取已上提到 appendMessage 之前，dbRows 不含当前 user 消息，
  // 故不再需要 slice(0,-1) 剔除末行 —— 恒走 cleanupIncompleteMessages
  // （清理上一轮崩溃残留、末尾无 assistant 跟随的孤立 user），再追加当前消息。
  const currentUserMsg: LlmMessage = currentParts.length
    ? { role: 'user', content: [{ type: 'text', text: userText }, ...currentParts] }
    : { role: 'user', content: userText };
  // P0-4：cleanup（截断崩溃残留）之后做配对修复（补占位/丢孤儿），纯内存不写库
  const historyMsgs = repairToolTurnPairing(cleanupIncompleteMessages(rawDbMessages));
  const allDbMessages = [...historyMsgs, currentUserMsg];

  // P0-1（Q5=A）：chat 与其他意图统一取数与压缩路径 —— 历史与摘要一律进上下文，
  // 防串题改由注入块的「只回答最后一条」条款承担。
  const history: LlmMessage[] = allDbMessages;
  let llmMessages: AgentLlmMessage[] = buildCompressed(history, summary, KEEP_RECENT_ROUNDS);

  // Attention Anchoring 技术（来自 OpenAI/LangChain 最佳实践）：
  // 1. 在最后一条 user 消息前注入分隔标记（recency bias：最近的 token 权重更高）
  // 2. 在最后一条 user 消息后注入强调指令（Place key instructions at the END）
  // 这样可以最大程度确保 LLM 关注当前问题，避免 "lost in the middle" 问题

  // 查找最后一条 user 消息的位置
  let lastUserIdx = -1;
  for (let i = llmMessages.length - 1; i >= 0; i--) {
    if (llmMessages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx > 0) {
    // 在最后一条 user 消息前插入分隔标记
    llmMessages.splice(lastUserIdx, 0, {
      role: 'system',
      content: '=== 当前用户问题（必须回答此问题）===',
    });
    // 在最后一条 user 消息后插入强调指令（recency bias：最后的指令权重最高）
    llmMessages.splice(lastUserIdx + 2, 0, {
      role: 'system',
      content: '【重要】请只回答最后一条用户消息。历史与摘要仅用于理解当前问题中的指代与上下文，不要延续上一轮未完成的作答。',
    });
  }

  // B6 五-1②：vision 不支持 → 图片已降级为文本占位，给模型与用户一个显式提示
  if (visionDegraded) {
    llmMessages.push({ role: 'system', content: VISION_DEGRADED_NOTICE });
  }

  // 注入当前文档上下文（只读）
  // 注入 Agent 系统指令（指导 LLM 正确使用工具）
  // 注入当前用户的文件列表快照，让 AI 知道工作区中有哪些文件
  // 截断限制：避免文件过多导致初始上下文膨胀
  let fileListSnapshot = '';
  try {
    const files = listFiles(userId);
    fileListSnapshot = buildFileListSnapshot(files);
  } catch { /* 文件列表获取失败不影响主流程 */ }

  // 注入用户打开/导入的本地文件和文件夹路径，让 AI 可发现并读取这些文件
  const localFileTreeSnapshot = buildLocalTreeSnapshot(payload.fileTreePaths);

  const isChatIntent = intent.intent === 'chat';
  // 模糊输入需要澄清时：即使意图判为 chat，也用 Agent 提示 + 提供 ask_question_card
  const needsClarification = intent.needsClarification === true;
  // Bug A-2：带附件即用 Agent 提示 —— 附件消息常被 classifyIntent 判 chat，
  // 而 CHAT_SYSTEM_PROMPT 的「不要提及工具/文件」会锁死 searchDocument 与
  // ask_question_card（chat 闲聊不带附件，误伤面≈0）
  const hasAttachments = (payload.attachments?.length ?? 0) > 0;
  // 多意图（gate 开）恒用 Agent 提示（plan §2 任务 2 :736-743 修改点）
  const useAgentPrompt = !isChatIntent || needsClarification || hasAttachments || intentGateOpen;

  // Bug A-1：本会话附件清单（文件名+绝对路径+attachment_id+状态）随 system 段注入，
  // LLM 拿到真实路径/附件 id 后才能正确给 readLocalFile/searchDocument 传参
  const attachmentManifest = buildAttachmentManifest(payload.attachments);
  // A1（Q2/Q3）：soul/memory/style 三文件同批注入，落点在【核心规则】之后
  // （Attention Anchoring，不放文档上下文之后）；chat 分支同样注入，读取只做一次。
  // B4（裁定 1/4）：画像块与三文件块同通道、紧跟其后（同属「用户个性化层」），
  // 两分支各传一次；画像未就绪（无 db / 查询抛错 / 空画像）一律空串，零占位噪音。
  const globalFilesBlock = readGlobalAgentFilesBlock();
  const profileBlock = readActiveProfileBlock(userId, deps.db);
  // D4（六.2）：按当前意图从技能库挑经验块 —— 读取只做一次，两分支各传一次（与 A1/B4 同口径）；
  // 无匹配 / chat 意图 / 无技能 → 空串，输出与不传参时逐字一致、零占位噪音。
  const experienceBlock = buildExperienceBlock(skills, intent.intent);
  const agentSystemPrompt = useAgentPrompt
    ? buildAgentSystemPrompt(
        fileListSnapshot,
        localFileTreeSnapshot,
        needsClarification,
        attachmentManifest,
        globalFilesBlock,
        profileBlock,
        experienceBlock
      )
    : buildChatSystemPrompt(globalFilesBlock, profileBlock, experienceBlock);
  llmMessages = [{ role: 'system', content: agentSystemPrompt }, ...llmMessages];

  // 文档上下文注入：仅 rewrite/create/tech 三个写作意图（B1 意图门控）。
  // chat / kbQa / web 的回答来源与当前文档无关，不注入以省输入 token。
  if (shouldInjectDocumentContext(intent.intent, payload.currentDocument)) {
    // B9 三-1②：带磁盘路径时走引用模式（文件名+路径+摘要，正文交 readLocalFile 按需读取）
    const documentContext = buildDocumentContext(payload.currentDocument, payload.currentFileRef);
    if (documentContext) {
      llmMessages = [{ role: 'system', content: documentContext }, ...llmMessages];
    }
  }

  // P0-6（Q10 零额外 DB 读）：把主流程已读出的历史注入 toolCtx。
  // 取数位置：清理/配对修复之后、且取自 LLM 实际看到的 llmMessages ——
  // 工具看到的上下文与模型看到的同源同序（含当前问题），仅保留 user/assistant
  // 并经 contentToText 归一为纯文本（图片 part → [图片] 占位）。
  toolCtx.history = llmMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: contentToText(m.content) }));

  // 初始 token 统计
  const initTokens = llmMessages.reduce((sum, m) => sum + estimateContentTokens(m.content), 0);

  return {
    convId,
    userId,
    runId,
    send,
    intent,
    baseUrl,
    model,
    apiKey,
    skillContext,
    skills,
    toolCtx,
    tools,
    llmMessages,
    detector: new DeadLoopDetector({ maxRounds: deps.maxRounds ?? getRoundsForIntent(intent.intent) }),
    toolCallsHistory: [],
    hasSessionPersist: !!(deps.sessionId && deps.db),
    roundsUsed: 0,
    reasoningTokenCount: null,
    assistantId: '',
    totalTokens: initTokens,
    citationRefs: [],
    intentGateOpen,
    baseHistoryMessages: historyMsgs,
    toolSelectionArgs,
  };
}
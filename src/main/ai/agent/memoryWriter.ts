// ============================================
// WeaveMD — 后台记忆提取与写入（agent-memory-optimize 第二批 C2）
// ============================================
// 触发链（req 五.2 / Q9）：
//   AgentTaskWorker 在 AI_STREAM_DONE 之后调 maybeEnqueueMemoryExtraction —— 该函数**同步快速返回**，
//   只做「节流 + 同会话 pending 去重 + 入队」，绝不在此处调 LLM，因此不阻塞主流程；
//   入队后由既有 AgentTaskWorker 轮询取出并执行 runMemoryExtractionJob —— 读最近 3 轮对话 →
//   LLM 结构化提取 → 严格校验 → 逐条 upsertMemory(source='auto') → runMemoryPolicy 冲突清洗。
// 失败语义（Q9）：任务落 `failed` 不重试、console.error 带上下文日志、**绝不 reject 给调用方**，
//   所有异常在本文件的 try/catch 内收敛，因此不会阻塞用户下一轮提问。
// 冲突清洗（Q10）：时间新者赢 + memory.md 手写恒赢 + 旧事实置 valid_to 关闭 —— 全部由 B2 的
//   runMemoryPolicy 执行，本文件只负责在提取完成后调用一次，不重写任何清洗规则。
// 与 C1 的分工：tools/memoryRead.ts、tools/memoryWrite.ts 是 LLM 主动调用的**同步工具**路径；
//   本文件是**自动后台提取**路径。两条路径共用 agent_memory 与 upsert 语义，
//   重复写同一事实由 upsertMemory 的 fingerprint 短路（C2 裁定 6）保证零写入。
// 依赖注入（db / llm / queue）：便于单测，测试不必把原生 better-sqlite3 拉进 import 图。

import { createHash } from 'crypto';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

import { upsertMemory, type AgentMemoryKind } from '../../db/agentMemory';
import { writeMemoryVectorAsync } from '../knowledge/vectorBackfill';
import { parseStructuredJson } from '../llm/structuredJson';
import { runMemoryPolicy } from './memoryPolicy';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 队列任务类型标记（写进 payloadJson.type，worker 据此路由到后台提取而非 runAgentFlow）。 */
export const MEMORY_EXTRACT_TASK_TYPE = 'memory_extract';

/** 入队时写进 task.message 的说明（仅用于排查队列，不参与任何逻辑）。 */
export const MEMORY_EXTRACT_TASK_MESSAGE = '[memory_extract] 后台记忆提取';

/**
 * 节流间隔：同一 conversationId 距上次后台提取不足 **2 轮**则不入队。
 * 取值理由：**无实测数据、待校准**——目的是避免每轮对话都多打一次 LLM；建议上线后按
 * 「提取命中率 / 每次提取的写入条数」实测分布重设（间隔越大越省，但画像越滞后）。
 */
export const MEMORY_EXTRACT_MIN_ROUND_GAP = 2;

/**
 * 提取读取的对话轮数，与 `KEEP_RECENT_ROUNDS`（=3）同量级（不改该常量，见 req 四.3 红线）。
 * 取值理由：**无实测数据、待校准**。
 */
export const MEMORY_EXTRACT_ROUNDS = 3;

/**
 * 单次提取的条数上限，超出截断（req：条数上限、超上限截断）。
 * 取值理由：**无实测数据、待校准**，取 10 与 C1 的 MAX_MEMORY_WRITE_PER_TURN 同量级。
 */
export const MAX_MEMORY_EXTRACT_ITEMS = 10;

/** 单次后台 LLM 调用超时（毫秒），与既有单工具 30s 超时同量级。 */
export const MEMORY_EXTRACT_TIMEOUT_MS = 30000;

/** 主题长度上限（与 C1 memory_write 同口径）。 */
export const MEMORY_EXTRACT_SUBJECT_MAX_CHARS = 200;
/** 内容长度上限（与设置页 memory.md recommendedChars = 4000 同口径）。 */
export const MEMORY_EXTRACT_CONTENT_MAX_CHARS = 4000;

const KIND_VALUES: readonly string[] = ['profile', 'fact', 'entity'];

// ---------------------------------------------------------------------------
// 注入接口
// ---------------------------------------------------------------------------

/** 队列能力子集：真实 AgentTaskQueue 结构上天然满足，测试可用假队列。 */
export interface MemoryTaskQueueLike {
  enqueue(payload: {
    conversationId: string;
    userId: string;
    message: string;
    payloadJson?: string;
  }): { id: string };
  getTasksByConversation(conversationId: string): Array<{ id: string; status: string }>;
}

/** 一轮对话中的一条消息（只取正文，工具结果不进后台提取）。 */
export interface MemoryRoundMessage {
  role: string;
  content: string;
}

/** 读取最近 N 轮对话（worker 侧默认实现走 DAO 的 getRecentMessagesByRounds）。 */
export type MemoryRoundsReader = (
  conversationId: string,
  userId: string,
  rounds: number
) => MemoryRoundMessage[];

/** 提取用的 LLM 调用（worker 侧按协议分流到 llmClient / anthropicClient）。 */
export type MemoryLlmCall = (messages: MemoryLlmMessage[]) => Promise<string>;

export interface MemoryLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 任务终态回执（worker 用它更新队列状态）。 */
export type MemoryJobDone = (
  status: 'completed' | 'failed',
  errorCode?: string,
  errorMessage?: string
) => void;

export interface EnqueueDeps {
  queue: MemoryTaskQueueLike;
}

export interface EnqueueCtx {
  conversationId: string;
  userId: string;
}

export type EnqueueReason = 'enqueued' | 'throttled' | 'pending' | 'enqueue_error';

export interface EnqueueResult {
  enqueued: boolean;
  reason: EnqueueReason;
  taskId?: string;
  /** 本会话累计的已完成轮次（节流判定基准）。 */
  turn: number;
}

export interface JobDeps {
  db: BetterSqlite3Database;
  llm: MemoryLlmCall;
  readRounds: MemoryRoundsReader;
  /** 覆盖读取轮数，缺省 MEMORY_EXTRACT_ROUNDS */
  rounds?: number;
}

export interface JobCtx {
  conversationId: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// 节流状态（进程内，按 conversationId 隔离）
// ---------------------------------------------------------------------------

interface ExtractState {
  /** 本会话累计触发的已完成轮次数 */
  turn: number;
  /** 上次成功入队时的 turn；null = 尚未入队过 */
  lastEnqueuedTurn: number | null;
}

const extractStates = new Map<string, ExtractState>();

function stateOf(conversationId: string): ExtractState {
  let state = extractStates.get(conversationId);
  if (!state) {
    state = { turn: 0, lastEnqueuedTurn: null };
    extractStates.set(conversationId, state);
  }
  return state;
}

/** 测试用：清空节流状态（进程内状态，无持久化需求）。 */
export function resetMemoryExtractionState(): void {
  extractStates.clear();
}

// ---------------------------------------------------------------------------
// 任务类型识别（worker 路由）
// ---------------------------------------------------------------------------

/** 判断队列任务是否为后台记忆提取任务（payloadJson.type === memory_extract）。 */
export function isMemoryExtractTask(task: { payloadJson?: string | null }): boolean {
  if (!task.payloadJson) return false;
  try {
    const parsed: unknown = JSON.parse(task.payloadJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return (parsed as Record<string, unknown>).type === MEMORY_EXTRACT_TASK_TYPE;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 入队：同步快速返回，绝不调 LLM
// ---------------------------------------------------------------------------

/**
 * AI_STREAM_DONE 后尝试入队一次后台记忆提取。
 * 判定顺序：节流 → 同会话 pending 去重 → 入队；任一不满足都**不入队**（不堆积）。
 * 同步返回，任何异常都在内部收敛并记日志 —— 主流程调用方不需 try/catch。
 */
export function maybeEnqueueMemoryExtraction(
  deps: EnqueueDeps,
  ctx: EnqueueCtx
): EnqueueResult {
  const state = stateOf(ctx.conversationId);
  state.turn += 1;

  if (
    state.lastEnqueuedTurn !== null &&
    state.turn - state.lastEnqueuedTurn < MEMORY_EXTRACT_MIN_ROUND_GAP
  ) {
    return { enqueued: false, reason: 'throttled', turn: state.turn };
  }

  try {
    // 同会话同时只允许一个 pending：已有 pending 直接跳过，避免堆积
    //（AgentTaskQueue.enqueue 会 supersede 同会话旧 pending，先查后入才能不误伤既有任务）
    const hasPending = deps.queue
      .getTasksByConversation(ctx.conversationId)
      .some((t) => t.status === 'pending');
    if (hasPending) {
      return { enqueued: false, reason: 'pending', turn: state.turn };
    }

    const task = deps.queue.enqueue({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      message: MEMORY_EXTRACT_TASK_MESSAGE,
      payloadJson: JSON.stringify({
        type: MEMORY_EXTRACT_TASK_TYPE,
        rounds: MEMORY_EXTRACT_ROUNDS,
      }),
    });
    state.lastEnqueuedTurn = state.turn;
    return { enqueued: true, reason: 'enqueued', taskId: task.id, turn: state.turn };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[memoryWriter] 后台记忆提取入队失败（不影响本轮对话）', {
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      message,
    });
    return { enqueued: false, reason: 'enqueue_error', turn: state.turn };
  }
}

// ---------------------------------------------------------------------------
// 提取结果严格校验
// ---------------------------------------------------------------------------

/**
 * 严格解析 LLM 输出为结构化记忆条目。
 * 规则：必须是 JSON 数组（允许 ```json 代码块包裹）；每项必须含合法 kind / subject / content
 * 且长度在限内；任一项不合法 → **抛错（整批拒绝，零写入）**；条数超上限 → 截断。
 * 抛错由 runMemoryExtractionJob 捕获并落 failed，绝不写入脏数据。
 * 解析骨架已抽到 parseStructuredJson（agent-multi-intent 任务 1），错误文案逐字不变。
 */
export function parseExtractionItems(raw: string): Array<{
  kind: AgentMemoryKind;
  subject: string;
  content: string;
}> {
  const items = parseStructuredJson<Array<{ kind: AgentMemoryKind; subject: string; content: string }>>(
    raw,
    { label: 'memory_extract', validate: validateExtractionItems }
  );

  if (items.length > MAX_MEMORY_EXTRACT_ITEMS) {
    console.warn('[memoryWriter] 提取条数超上限，已截断', {
      before: items.length,
      after: MAX_MEMORY_EXTRACT_ITEMS,
      limit: MAX_MEMORY_EXTRACT_ITEMS,
    });
    return items.slice(0, MAX_MEMORY_EXTRACT_ITEMS);
  }
  return items;
}

/** 逐项严格校验（文案与抽骨架前逐字一致；非法整批拒绝）。 */
function validateExtractionItems(value: unknown): Array<{
  kind: AgentMemoryKind;
  subject: string;
  content: string;
}> {
  if (!Array.isArray(value)) {
    throw new Error('memory_extract: LLM 输出必须是 JSON 数组');
  }

  const list = value as unknown[];
  const items: Array<{ kind: AgentMemoryKind; subject: string; content: string }> = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry: unknown = list[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`memory_extract: 第 ${i + 1} 项不是对象`);
    }
    const rec = entry as Record<string, unknown>;

    const kind: unknown = rec.kind;
    if (typeof kind !== 'string' || !KIND_VALUES.includes(kind)) {
      throw new Error(`memory_extract: 第 ${i + 1} 项 kind 非法（必须是 profile | fact | entity）`);
    }
    const subject = typeof rec.subject === 'string' ? rec.subject.trim() : '';
    if (subject.length < 1 || subject.length > MEMORY_EXTRACT_SUBJECT_MAX_CHARS) {
      throw new Error(
        `memory_extract: 第 ${i + 1} 项 subject 必须为 1~${MEMORY_EXTRACT_SUBJECT_MAX_CHARS} 字符`
      );
    }
    const content = typeof rec.content === 'string' ? rec.content.trim() : '';
    if (content.length < 1 || content.length > MEMORY_EXTRACT_CONTENT_MAX_CHARS) {
      throw new Error(
        `memory_extract: 第 ${i + 1} 项 content 必须为 1~${MEMORY_EXTRACT_CONTENT_MAX_CHARS} 字符`
      );
    }
    items.push({ kind: kind as AgentMemoryKind, subject, content });
  }
  return items;
}

/** content 归一化（去首尾空白 + 折叠连续空白）后 sha256，与 B1「fingerprint = content 归一化 hash」同口径。
 *  C1 memoryWrite.ts 内有一份同口径实现（C1 工具本批不动），后续可上提到 DAO 统一。 */
function fingerprintOf(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// 提取提示词与对话拼装
// ---------------------------------------------------------------------------

const MEMORY_EXTRACT_SYSTEM_PROMPT = [
  '你是长期记忆提取器。输入是最近几轮对话，从中提取值得长期保留、后续会话仍需知道的记忆条目。',
  '只输出一个 JSON 数组，不要输出任何解释、Markdown 代码块或前后缀。',
  '数组每一项必须是 {"kind": "...", "subject": "...", "content": "..."}：',
  '- kind：profile（用户画像与偏好）| fact（事实与决策）| entity（实体，如人、组织、项目）',
  `- subject：1~${MEMORY_EXTRACT_SUBJECT_MAX_CHARS} 字符的主题标签`,
  `- content：1~${MEMORY_EXTRACT_CONTENT_MAX_CHARS} 字符的陈述句，避免代词与口语`,
  '规则：只提取用户明确表达的内容；不编造、不把一次性问答写成记忆；没有值得保存的内容时输出 []；不确定就不输出该项。',
].join('\n');

/**
 * 对话 → 提取输入文本。
 * 只保留 user / assistant 正文：后台提取不进主上下文（不受「不截断工具结果」红线约束），
 * 且工具结果不是记忆来源。
 */
function formatTranscript(rounds: readonly MemoryRoundMessage[]): string {
  return rounds
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ label: m.role === 'user' ? '用户' : '助手', content: m.content.trim() }))
    .filter((m) => m.content.length > 0)
    .map((m) => `${m.label}：${m.content}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// 任务体：读轮次 → LLM → 校验 → 写入 → 冲突清洗
// ---------------------------------------------------------------------------

/**
 * 执行一次后台记忆提取。**永不 reject**：
 * 成功 → done('completed')；任何失败 → console.error 带上下文 + done('failed', ...)，
 * 不重试（Q9：不新建重试机制）。
 */
export async function runMemoryExtractionJob(
  deps: JobDeps,
  ctx: JobCtx,
  done: MemoryJobDone
): Promise<void> {
  try {
    const rounds = deps.rounds ?? MEMORY_EXTRACT_ROUNDS;
    const transcript = formatTranscript(
      deps.readRounds(ctx.conversationId, ctx.userId, rounds)
    );
    if (!transcript) {
      console.log('[memoryWriter] 无可提取对话，跳过', {
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      });
      done('completed');
      return;
    }

    const raw = await deps.llm([
      { role: 'system', content: MEMORY_EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: `以下是最近 ${rounds} 轮对话：\n\n${transcript}` },
    ]);

    // 解析/校验失败在此抛错 → 落 failed，不写入
    const items = parseExtractionItems(raw);

    let written = 0;
    for (const item of items) {
      const id = upsertMemory(deps.db, {
        userId: ctx.userId,
        kind: item.kind,
        subject: item.subject,
        content: item.content,
        fingerprint: fingerprintOf(item.content),
        source: 'auto',
        conversationId: ctx.conversationId,
      });
      written += 1;
      // D6 写入接线②：后台提取写入成功后**异步**补向量（不 await → 不拖慢任务收尾）。
      // 失败只 console.warn，绝不让本任务落 failed、绝不动 upsert / runMemoryPolicy 结果。
      try {
        void writeMemoryVectorAsync(
          deps.db,
          ctx.userId,
          id,
          item.subject,
          item.content
        ).catch((error: unknown) => {
          console.warn('[memoryWriter] 记忆向量生成失败（不影响任务终态）', {
            conversationId: ctx.conversationId,
            subject: item.subject,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      } catch (error) {
        console.warn('[memoryWriter] 记忆向量写入调度异常（不影响任务终态）', {
          conversationId: ctx.conversationId,
          subject: item.subject,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Q10 冲突清洗：直接调 B2 的 runMemoryPolicy（时间新者赢 + manual 恒赢 + 置 valid_to）
    const policy = runMemoryPolicy(deps.db, ctx.userId);
    console.log('[memoryWriter] 后台记忆提取完成', {
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      written,
      merged: policy.merged,
      evicted: policy.evicted,
    });
    done('completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[memoryWriter] 后台记忆提取失败（落 failed，不重试，不阻塞下一轮提问）', {
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      message,
    });
    done('failed', 'memory_extract', message);
  }
}

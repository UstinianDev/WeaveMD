// ============================================
// WeaveMD — 执行轨迹 → 可复用 Skill 提炼（agent-memory-optimize-3 D3 六.1）
// ============================================
// 触发链（req Q4 半自动 + Q5 轨迹源）：
//   AgentTaskWorker 在 AI_STREAM_DONE 之后调 maybeEnqueueSkillDistillation —— 该函数**同步快速返回**，
//   只做「节流 + 同会话 pending 去重 + 入队」，绝不在此处调 LLM，因此不阻塞主流程；
//   入队后由既有 AgentTaskWorker 轮询取出并执行 runSkillDistillJob —— 读轨迹分页 →
//   LLM 结构化提炼 → 严格校验（任一项不合法整批抛错零写入）→ 语义去重后写**草稿目录**。
// 半自动铁律：本模块**只写草稿（status: draft）**，生效必须经设置页人工确认
//   （skillAutoStore.approveDraftSkill 是唯一 draft → active 的路径）；
//   未确认的草稿不进 ctx.skills / list_skills / runSkill / 任何 prompt。
// 失败语义（与 C2 同口径）：任务落 `failed` 不重试、console.error 带上下文日志、
//   **绝不 reject 给调用方**，因此不会阻塞用户下一轮提问。
// 依赖注入（reader / llm / writer / queue）：便于单测，测试不必把 better-sqlite3 与真 LLM 拉进 import 图。

import {
  assertValidSkillDraft,
  writeDraftSkill,
  type DraftWriteResult,
  type SkillDraftInput,
} from './skillAutoStore';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 队列任务类型标记（写进 payloadJson.type，worker 据此路由到提炼而非 runAgentFlow）。 */
export const SKILL_DISTILL_TASK_TYPE = 'skill_distill';

/** 入队时写进 task.message 的说明（仅用于排查队列，不参与任何逻辑）。 */
export const SKILL_DISTILL_TASK_MESSAGE = '[skill_distill] 执行轨迹 → 技能提炼';

/**
 * 节流间隔：同一 conversationId 距上次提炼入队不足 **4 轮**则不入队。
 * 取值理由：**无实测数据、待校准** —— 提炼需要至少 3 次同类任务轨迹，
 * 且不能每轮都多打一次 LLM；建议上线后按「草稿产出率 / 人工确认率」实测分布重设。
 */
export const SKILL_DISTILL_MIN_ROUND_GAP = 4;

/** 单次提炼的技能条数上限（超出**整批拒绝**，不截断写入）。 */
export const MAX_SKILL_DRAFTS_PER_RUN = 3;

/** 单次后台 LLM 调用超时（毫秒）。取值：**无实测数据、待校准**（30s 的 2 倍）。 */
export const SKILL_DISTILL_TIMEOUT_MS = 60000;

/** 轨迹读取条数（一个 agent 运行的 user/assistant/tool 行量级）。 */
export const SKILL_DISTILL_TRAJECTORY_LIMIT = 60;

/** 轨迹格式化的字符预算（**无实测数据、待校准**：超预算保留最近轨迹）。 */
export const SKILL_DISTILL_TRAJECTORY_MAX_CHARS = 6000;

/** 单条工具结果摘要长度（工具结果本就被 S6 截到 500 字，这里只再取前缀）。 */
const TOOL_EXCERPT_MAX_CHARS = 200;

// ---------------------------------------------------------------------------
// 注入接口
// ---------------------------------------------------------------------------

/** 队列能力子集（真实 AgentTaskQueue 结构上天然满足）。 */
export interface SkillDistillTaskQueueLike {
  enqueue(payload: {
    conversationId: string;
    userId: string;
    message: string;
    payloadJson?: string;
  }): { id: string };
  getTasksByConversation(conversationId: string): Array<{ id: string; status: string }>;
}

/** 轨迹中的一条消息（ai_messages 的 role/content/tool_calls 子集）。 */
export interface TrajectoryMessage {
  role: string;
  content: string;
  toolCalls?: unknown;
}

/** 读一页轨迹（worker 侧默认实现走 getConversationMessagesPage）。 */
export type TrajectoryPageReader = (
  conversationId: string,
  userId: string
) => TrajectoryMessage[];

/** 轨迹筛选口径（req 条 4）：只取 agent_task_queue.status='completed' 的会话。 */
export type CompletedTaskChecker = (conversationId: string, userId: string) => boolean;

/** 提炼用的 LLM 调用（worker 侧按协议分流到 llmClient / anthropicClient）。 */
export type SkillDistillLlmCall = (
  messages: SkillDistillLlmMessage[]
) => Promise<string>;

export interface SkillDistillLlmMessage {
  role: 'system' | 'user';
  content: string;
}

/** 草稿写入器（默认实现 = skillAutoStore.writeDraftSkill）。 */
export type DraftWriter = (draft: SkillDraftInput) => DraftWriteResult;

/** 任务终态回执（worker 用它更新队列状态）。 */
export type SkillDistillJobDone = (
  status: 'completed' | 'failed',
  errorCode?: string,
  errorMessage?: string
) => void;

export interface EnqueueDeps {
  queue: SkillDistillTaskQueueLike;
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

export interface SkillDistillJobDeps {
  readPage: TrajectoryPageReader;
  hasCompletedTask: CompletedTaskChecker;
  llm: SkillDistillLlmCall;
  writeDraft: DraftWriter;
}

export interface SkillDistillJobCtx {
  conversationId: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// 节流状态（进程内，按 conversationId 隔离）
// ---------------------------------------------------------------------------

interface DistillState {
  /** 本会话累计触发的已完成轮次数 */
  turn: number;
  /** 上次成功入队时的 turn；null = 尚未入队过 */
  lastEnqueuedTurn: number | null;
}

const distillStates = new Map<string, DistillState>();

function stateOf(conversationId: string): DistillState {
  let state = distillStates.get(conversationId);
  if (!state) {
    state = { turn: 0, lastEnqueuedTurn: null };
    distillStates.set(conversationId, state);
  }
  return state;
}

/** 测试用：清空节流状态（进程内状态，无持久化需求）。 */
export function resetSkillDistillState(): void {
  distillStates.clear();
}

// ---------------------------------------------------------------------------
// 任务类型识别（worker 路由）
// ---------------------------------------------------------------------------

/** 判断队列任务是否为技能提炼任务（payloadJson.type === skill_distill）。 */
export function isSkillDistillTask(task: { payloadJson?: string | null }): boolean {
  if (!task.payloadJson) return false;
  try {
    const parsed: unknown = JSON.parse(task.payloadJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return (parsed as Record<string, unknown>).type === SKILL_DISTILL_TASK_TYPE;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 入队：同步快速返回，绝不调 LLM
// ---------------------------------------------------------------------------

/**
 * AI_STREAM_DONE 后尝试入队一次技能提炼。
 * 判定顺序：节流 → 同会话 pending 去重 → 入队；任一不满足都**不入队**。
 *
 * pending 去重按「同会话任意 pending」判定（与 C2 同口径）：`AgentTaskQueue.enqueue`
 * 会 supersede 同会话旧 pending，先查后入才能不误伤 memory_extract 等其它后台任务。
 * 由于队列轮询 1s 即完成单个后台任务，而人类轮次间隔远大于 1s，
 * 被挡下的提炼会在下一轮自然补上 —— 不需要额外的跨类型协调。
 */
export function maybeEnqueueSkillDistillation(
  deps: EnqueueDeps,
  ctx: EnqueueCtx
): EnqueueResult {
  const state = stateOf(ctx.conversationId);
  state.turn += 1;

  if (
    state.lastEnqueuedTurn !== null &&
    state.turn - state.lastEnqueuedTurn < SKILL_DISTILL_MIN_ROUND_GAP
  ) {
    return { enqueued: false, reason: 'throttled', turn: state.turn };
  }

  try {
    const hasPending = deps.queue
      .getTasksByConversation(ctx.conversationId)
      .some((t) => t.status === 'pending');
    if (hasPending) {
      return { enqueued: false, reason: 'pending', turn: state.turn };
    }

    const task = deps.queue.enqueue({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      message: SKILL_DISTILL_TASK_MESSAGE,
      payloadJson: JSON.stringify({
        type: SKILL_DISTILL_TASK_TYPE,
        rounds: SKILL_DISTILL_TRAJECTORY_LIMIT,
      }),
    });
    state.lastEnqueuedTurn = state.turn;
    return { enqueued: true, reason: 'enqueued', taskId: task.id, turn: state.turn };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[skillDistiller] 技能提炼入队失败（不影响本轮对话）', {
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      message,
    });
    return { enqueued: false, reason: 'enqueue_error', turn: state.turn };
  }
}

// ---------------------------------------------------------------------------
// 提炼结果严格校验（整批拒写）
// ---------------------------------------------------------------------------

/**
 * 严格解析 LLM 输出为结构化技能草稿。
 * 规则：必须是 JSON 数组（允许 ```json 代码块包裹）；条数 ≤ {@link MAX_SKILL_DRAFTS_PER_RUN}；
 * 每项经 `assertValidSkillDraft` 校验（name 正则 / description / instructions 长度）；
 * **任一项不合法 → 抛错（整批拒绝，零写入）**；条数超上限同样整批拒绝（不截断）。
 */
export function parseSkillDrafts(raw: string): SkillDraftInput[] {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`skill_distill: LLM 输出不是合法 JSON → ${reason}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('skill_distill: LLM 输出必须是 JSON 数组');
  }

  if (parsed.length > MAX_SKILL_DRAFTS_PER_RUN) {
    throw new Error(
      `skill_distill: 条数超上限（最多 ${MAX_SKILL_DRAFTS_PER_RUN} 条，收到 ${parsed.length} 条）`
    );
  }

  return parsed.map((entry, index) =>
    assertValidSkillDraft(entry, `skill_distill: 第 ${index + 1} 项`)
  );
}

// ---------------------------------------------------------------------------
// 轨迹格式化
// ---------------------------------------------------------------------------

/** 提炼提示词：只要「调了什么工具 + 顺序 + 成败」，不复述完整工具结果。 */
const SKILL_DISTILL_SYSTEM_PROMPT = [
  '你是工作流提炼器。输入是同一会话最近若干轮的执行轨迹（含工具调用顺序与失败痕迹）。',
  '请从中提炼 1 条可复用的技能（skill），供下次同类任务直接套用。',
  '只输出一个 JSON 数组，不要输出任何解释、Markdown 代码块或前后缀。',
  '数组每一项必须是 {"name": "...", "description": "...", "instructions": "...", "intents": ["..."]}：',
  '- name：必须以 auto_ 开头，只允许小写字母/数字/下划线（auto_[a-z0-9_]+）',
  '- description：一句话说明「什么场景该用这个技能」，单行 1~200 字符',
  '- instructions：可直接照做的步骤，1~4000 字符；**必须包含「避坑」小节**，把轨迹里出现过的失败做法写进去',
  '- intents：该技能适用的任务类型，从 ["create","rewrite","kbQa","tech","web"] 中选 1~2 个（**不得使用 "chat"**）；按轨迹里用户请求的类型判断，拿不准就按最主要的那次任务标',
  '规则：',
  '1. 只提炼至少出现 2 次的同类任务；不同任务不要合并进同一条。',
  '2. 忠于轨迹，不编造轨迹中没有的步骤。',
  '3. 没有可复用的流程时输出 []。',
  '4. 一次最多输出 3 条。',
].join('\n');

/** 截断到 n 个字符（保留前缀，避免把半句话当结论）。 */
function truncate(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n)}…`;
}

/** 从 tool_calls 快照里取工具名（结构不合法时返回空数组，不抛）。 */
function toolNamesOf(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  const names: string[] = [];
  for (const item of toolCalls) {
    if (!item || typeof item !== 'object') continue;
    const fn = (item as { function?: { name?: unknown } }).function;
    if (fn && typeof fn.name === 'string' && fn.name) names.push(fn.name);
  }
  return names;
}

/** 单行轨迹片段。 */
function renderTrajectoryRow(message: TrajectoryMessage, index: number): string {
  const head = `[${index + 1}]`;
  if (message.role === 'user') {
    return `${head} 用户: ${message.content}`;
  }
  if (message.role === 'tool') {
    return `${head} 工具结果: ${truncate(message.content, TOOL_EXCERPT_MAX_CHARS)}`;
  }
  const body = `${head} 助手: ${message.content}`;
  const names = toolNamesOf(message.toolCalls);
  return names.length > 0 ? `${body}\n    调用工具: ${names.join(', ')}` : body;
}

/**
 * 轨迹 → 提炼输入文本。
 * - 按时间正序输出；
 * - 超出 `maxChars` 预算时**从最新往回保留**（旧轮先丢，保住当前任务的完整上下文）。
 */
export function formatTrajectory(
  messages: readonly TrajectoryMessage[],
  maxChars: number = SKILL_DISTILL_TRAJECTORY_MAX_CHARS
): string {
  if (messages.length === 0) return '';
  const segments = messages.map((message, index) => renderTrajectoryRow(message, index));
  const kept: string[] = [];
  let total = 0;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    const cost = segment.length + 1;
    if (total + cost > maxChars) {
      if (kept.length === 0) {
        // 最新一条本身就超预算：取其尾部（保最近内容）
        kept.push(segment.slice(Math.max(0, segment.length - maxChars)));
      }
      break;
    }
    kept.push(segment);
    total += cost;
  }
  return kept.reverse().join('\n');
}

// ---------------------------------------------------------------------------
// 任务体：过滤 → 读轨迹 → LLM → 校验 → 写草稿
// ---------------------------------------------------------------------------

/**
 * 执行一次技能提炼。**永不 reject**：
 * 成功 → done('completed')；任何失败 → console.error 带上下文 + done('failed', 'skill_distill', ...)，
 * 不重试（不新建重试机制）。
 */
export async function runSkillDistillJob(
  deps: SkillDistillJobDeps,
  ctx: SkillDistillJobCtx,
  done: SkillDistillJobDone
): Promise<void> {
  try {
    // 轨迹筛选口径：只提炼成功终态会话的轨迹（成败不在轨迹内，必须联查 agent_task_queue）
    if (!deps.hasCompletedTask(ctx.conversationId, ctx.userId)) {
      console.warn('[skillDistiller] 会话无 completed 终态，跳过', {
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      });
      done('completed');
      return;
    }

    const trajectory = deps.readPage(ctx.conversationId, ctx.userId);
    const transcript = formatTrajectory(trajectory);
    if (!transcript) {
      console.warn('[skillDistiller] 无可提炼轨迹，跳过', {
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      });
      done('completed');
      return;
    }

    const raw = await deps.llm([
      { role: 'system', content: SKILL_DISTILL_SYSTEM_PROMPT },
      { role: 'user', content: `以下是同一会话的执行轨迹：\n\n${transcript}` },
    ]);

    // 解析/校验失败在此抛错 → 落 failed，零写入
    const drafts = parseSkillDrafts(raw);
    if (drafts.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[skillDistiller] LLM 判定无可复用流程，本轮零草稿', {
        conversationId: ctx.conversationId,
      });
      done('completed');
      return;
    }

    let written = 0;
    let skipped = 0;
    for (const draft of drafts) {
      // 语义去重与路径安全都在 writeDraftSkill 内完成
      const result = deps.writeDraft(draft);
      if (result.written) written += 1;
      else skipped += 1;
    }

    // eslint-disable-next-line no-console
    console.log('[skillDistiller] 技能提炼完成（草稿待人工确认）', {
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      drafts: drafts.length,
      written,
      skipped,
    });
    done('completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[skillDistiller] 技能提炼失败（落 failed，不重试，不阻塞下一轮提问）', {
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      message,
    });
    done('failed', SKILL_DISTILL_TASK_TYPE, message);
  }
}

/** 默认草稿写入器（worker 注入用）。 */
export function defaultDraftWriter(draft: SkillDraftInput): DraftWriteResult {
  return writeDraftSkill(draft);
}

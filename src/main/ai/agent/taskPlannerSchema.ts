// ============================================
// WeaveMD — 结构化任务拆分 Schema 与严格校验（agent-multi-intent 任务 1）
// ============================================
// 职责划分（req Q3/Q4/Q7，plan §1.1/§1.2/§6.1）：
//   - TASK_PLAN_JSON_SCHEMA：提示词内嵌的 draft-07 Schema 字面量（厂商无关，
//     只用双厂商稳定交集特性，禁 oneOf/pattern/min-max/递归 $ref/根 anyOf）；
//   - parseTaskPlan：走 parseStructuredJson 通用骨架 + 逐项严格校验，
//     任一项非法整批 throw，错误带「第 N 项」序号；
//   - normalizeTaskPlan：Q7 纯函数规范化（同对象写合并 → >5 按 confidence 截断
//     记 omittedCount → 不同对象写追加 serial_after 串行标注），不改输入。
// 类型 SubtaskDef / AgentTaskPlan 在 src/shared/ai/taskPlan.ts（拆分卡要跨进程下发）。

import type { AgentTaskPlan, IntentName, SubtaskDef } from '@shared/ai';

import { parseStructuredJson } from '../llm/structuredJson';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 子任务意图枚举运行时值（与 IntentName 六值对齐，Schema 与校验共用单一口径）。 */
const INTENT_VALUES: readonly string[] = ['create', 'rewrite', 'kbQa', 'tech', 'web', 'chat'];

/** 子任务条数上限（Q7：超限按 confidence 取前 5 并明示 omittedCount）。 */
export const MAX_SUBTASKS = 5;

/** normalizeTaskPlan 给不同对象写追加的串行依赖前缀（值 = 前序写子任务 id）。 */
const SERIAL_AFTER_PREFIX = 'serial_after:';

/** 子任务必填字段（缺任一 → 整批拒绝；顺序 = 报错顺序）。 */
const REQUIRED_SUBTASK_KEYS = ['id', 'intent', 'action', 'object', 'confidence', 'rw'] as const;

// ---------------------------------------------------------------------------
// TASK_PLAN_JSON_SCHEMA（提示词内嵌，plan §6.1 稳定交集）
// ---------------------------------------------------------------------------

/** Schema 节点形状（draft-07 稳定交集子集；params 为自由字典故不设 additionalProperties）。 */
interface TaskPlanJsonSchemaNode {
  type?: string | string[];
  description?: string;
  enum?: Array<string | number | boolean | null>;
  properties?: Record<string, TaskPlanJsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: TaskPlanJsonSchemaNode;
}

export const TASK_PLAN_JSON_SCHEMA: TaskPlanJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  description: '任务拆分计划：把一次用户输入拆成 1~5 条可独立执行的子任务。',
  properties: {
    subtasks: {
      type: 'array',
      description: '子任务列表，按建议执行顺序排列，1~5 条。',
      items: {
        type: 'object',
        additionalProperties: false,
        description: '单个子任务。',
        properties: {
          id: { type: 'string', description: '子任务唯一标识，如 s1、s2。' },
          intent: {
            type: 'string',
            enum: [...INTENT_VALUES],
            description: '子任务意图：create | rewrite | kbQa | tech | web | chat。',
          },
          action: { type: 'string', description: '具体动作动词，如 search、write、summarize。' },
          object: { type: 'string', description: '操作对象：文件路径、知识库查询词或话题。' },
          params: {
            type: ['object', 'null'],
            description: '工具参数字典（键→字符串/数字/布尔），无参数时为 null。',
          },
          confidence: { type: 'number', description: '对该子任务判断的确信度，取值 0~1。' },
          rw: {
            type: 'string',
            enum: ['read', 'write'],
            description: 'read=只读；write=会写入文件或笔记。',
          },
          preconditions: {
            type: ['array', 'null'],
            items: { type: 'string', description: '一条前置条件。' },
            description: '执行前置条件列表，无则 null。',
          },
          needsClarification: {
            type: ['boolean', 'null'],
            description: '是否需要先向用户追问，无则 null。',
          },
        },
        required: [
          'id',
          'intent',
          'action',
          'object',
          'params',
          'confidence',
          'rw',
          'preconditions',
          'needsClarification',
        ],
      },
    },
    omittedCount: {
      type: ['integer', 'null'],
      description: '超出 5 条上限被省略的子任务数，未省略为 null。',
    },
    primaryIntent: {
      type: ['string', 'null'],
      enum: [...INTENT_VALUES, null],
      description: '整次输入的主意图，无法判断为 null。',
    },
  },
  required: ['subtasks', 'omittedCount', 'primaryIntent'],
};

// ---------------------------------------------------------------------------
// 严格校验
// ---------------------------------------------------------------------------

/** 是否为非数组的对象（顶层/子任务/params 共用的形状判定）。 */
function isPlainObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** confidence 归一校验：必须是有限数且落在 [0,1]（parse 与 normalize 共用单一文案）。 */
function assertConfidence(confidence: unknown, tag: string): number {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    throw new Error(`${tag} confidence 必须是数字`);
  }
  if (confidence < 0 || confidence > 1) {
    throw new Error(`${tag} confidence 必须在 [0,1] 区间`);
  }
  return confidence;
}

/** 校验单个子任务：必填缺失/类型错/枚举外/越界一律带序号抛错（整批拒绝）。 */
function validateSubtask(value: unknown, index: number): SubtaskDef {
  const tag = `task_plan: 第 ${index + 1} 项`;
  if (!isPlainObjectLike(value)) {
    throw new Error(`${tag}不是对象`);
  }
  const rec = value;

  for (const key of REQUIRED_SUBTASK_KEYS) {
    if (rec[key] === undefined || rec[key] === null) {
      throw new Error(`${tag}缺少字段 ${key}`);
    }
  }

  const id = rec.id;
  const intent = rec.intent;
  const action = rec.action;
  const object = rec.object;
  const confidence = assertConfidence(rec.confidence, tag);
  const rw = rec.rw;

  if (typeof id !== 'string') {
    throw new Error(`${tag} id 必须是字符串`);
  }
  if (typeof intent !== 'string' || !INTENT_VALUES.includes(intent)) {
    throw new Error(`${tag} intent 非法（必须是 ${INTENT_VALUES.join(' | ')}）`);
  }
  if (typeof action !== 'string') {
    throw new Error(`${tag} action 必须是字符串`);
  }
  if (typeof object !== 'string') {
    throw new Error(`${tag} object 必须是字符串`);
  }
  if (rw !== 'read' && rw !== 'write') {
    throw new Error(`${tag} rw 非法（必须是 read | write）`);
  }

  const subtask: SubtaskDef = {
    id,
    intent: intent as IntentName,
    action,
    object,
    confidence,
    rw,
  };

  // 可选字段：null 视为缺省（Schema 用 nullable 模拟可选）；params 内容宽松放行
  if (rec.params !== undefined && rec.params !== null) {
    if (!isPlainObjectLike(rec.params)) {
      throw new Error(`${tag} params 必须是对象`);
    }
    subtask.params = rec.params as Record<string, string | number | boolean>;
  }
  if (rec.preconditions !== undefined && rec.preconditions !== null) {
    const list = rec.preconditions;
    if (!Array.isArray(list)) {
      throw new Error(`${tag} preconditions 必须是数组`);
    }
    if ((list as unknown[]).some((item) => typeof item !== 'string')) {
      throw new Error(`${tag} preconditions 必须是字符串数组`);
    }
    subtask.preconditions = list as string[];
  }
  if (rec.needsClarification !== undefined && rec.needsClarification !== null) {
    if (typeof rec.needsClarification !== 'boolean') {
      throw new Error(`${tag} needsClarification 必须是布尔值`);
    }
    subtask.needsClarification = rec.needsClarification;
  }

  return subtask;
}

/** 顶层校验：对象 + subtasks 数组 + 逐项严格校验；optional 根字段按需校验。 */
function validateTaskPlan(value: unknown): AgentTaskPlan {
  if (!isPlainObjectLike(value)) {
    throw new Error('task_plan: 顶层必须是对象');
  }
  if (value.subtasks === undefined || value.subtasks === null) {
    throw new Error('task_plan: 缺少字段 subtasks');
  }
  const rawSubtasks = value.subtasks;
  if (!Array.isArray(rawSubtasks)) {
    throw new Error('task_plan: subtasks 必须是数组');
  }
  const subtasks = (rawSubtasks as unknown[]).map((item, index) => validateSubtask(item, index));

  const plan: AgentTaskPlan = { subtasks };

  const omitted = value.omittedCount;
  if (omitted !== undefined && omitted !== null) {
    if (typeof omitted !== 'number' || !Number.isInteger(omitted) || omitted < 0) {
      throw new Error('task_plan: omittedCount 必须是非负整数');
    }
    plan.omittedCount = omitted;
  }

  const primary = value.primaryIntent;
  if (primary !== undefined && primary !== null) {
    if (typeof primary !== 'string' || !INTENT_VALUES.includes(primary)) {
      throw new Error(`task_plan: primaryIntent 非法（必须是 ${INTENT_VALUES.join(' | ')}）`);
    }
    plan.primaryIntent = primary as IntentName;
  }

  return plan;
}

/**
 * 严格解析 LLM 拆分出参为 AgentTaskPlan。
 * 链路：trim → 剥围栏 → JSON.parse（失败兜底截取 {..}）→ validateTaskPlan；
 * 任一项非法整批 throw，错误带「第 N 项」序号；失败策略（重试 1 次 → 降级直通）由任务 2 接线。
 */
export function parseTaskPlan(raw: string): AgentTaskPlan {
  return parseStructuredJson(raw, { label: 'task_plan', validate: validateTaskPlan });
}

// ---------------------------------------------------------------------------
// 规范化（Q7 纯函数）
// ---------------------------------------------------------------------------

/** 同对象写合并：保留首条（id/intent/action），params 后者覆盖合并、confidence 取高、条件去重并入。 */
function mergeSameObjectWrites(subtasks: SubtaskDef[]): SubtaskDef[] {
  const out: SubtaskDef[] = [];
  for (const subtask of subtasks) {
    const target =
      subtask.rw === 'write'
        ? out.find((candidate) => candidate.rw === 'write' && candidate.object === subtask.object)
        : undefined;
    if (!target) {
      out.push({ ...subtask });
      continue;
    }
    if (subtask.params !== undefined) {
      target.params = { ...target.params, ...subtask.params };
    }
    target.confidence = Math.max(target.confidence, subtask.confidence);
    if (subtask.preconditions !== undefined && subtask.preconditions.length > 0) {
      const base = target.preconditions ?? [];
      target.preconditions = [...base, ...subtask.preconditions.filter((p) => !base.includes(p))];
    }
    if (target.needsClarification !== undefined || subtask.needsClarification !== undefined) {
      target.needsClarification =
        Boolean(target.needsClarification) || Boolean(subtask.needsClarification);
    }
  }
  return out;
}

/** 超上限按 confidence 降序取前 MAX_SUBTASKS（稳定排序保持原始相对序），返回截断条数。 */
function truncateByConfidence(subtasks: SubtaskDef[]): {
  kept: SubtaskDef[];
  omitted: number;
} {
  if (subtasks.length <= MAX_SUBTASKS) {
    return { kept: subtasks, omitted: 0 };
  }
  const ranked = [...subtasks].sort((a, b) => b.confidence - a.confidence);
  const keptSet = new Set<SubtaskDef>(ranked.slice(0, MAX_SUBTASKS));
  return {
    kept: subtasks.filter((subtask) => keptSet.has(subtask)),
    omitted: subtasks.length - MAX_SUBTASKS,
  };
}

/** 不同对象写串行标注：每条后续写子任务追加 `serial_after:<前序写 id>`（只读子任务不动）。 */
function annotateSerialWrites(subtasks: SubtaskDef[]): SubtaskDef[] {
  let prevWriteId: string | undefined;
  return subtasks.map((subtask) => {
    if (subtask.rw !== 'write') {
      return subtask;
    }
    const prev = prevWriteId;
    prevWriteId = subtask.id;
    if (prev === undefined) {
      return subtask;
    }
    const precondition = `${SERIAL_AFTER_PREFIX}${prev}`;
    const preconditions = subtask.preconditions ?? [];
    if (preconditions.includes(precondition)) {
      return subtask;
    }
    return { ...subtask, preconditions: [...preconditions, precondition] };
  });
}

/**
 * 规范化拆分计划（Q7，纯函数、不改输入）：
 * confidence 复检 [0,1] → 同对象写合并 → >5 按 confidence 截断记 omittedCount
 * → 不同对象写追加串行标注；omittedCount/primaryIntent 透传。
 */
export function normalizeTaskPlan(plan: AgentTaskPlan): AgentTaskPlan {
  plan.subtasks.forEach((subtask, index) => {
    assertConfidence(subtask.confidence, `task_plan: 第 ${index + 1} 项`);
  });

  const merged = mergeSameObjectWrites(plan.subtasks);
  const { kept, omitted } = truncateByConfidence(merged);
  const annotated = annotateSerialWrites(kept);

  const out: AgentTaskPlan = { subtasks: annotated };
  const totalOmitted = omitted + (plan.omittedCount ?? 0);
  if (totalOmitted > 0) {
    out.omittedCount = totalOmitted;
  } else if (plan.omittedCount !== undefined) {
    out.omittedCount = plan.omittedCount;
  }
  if (plan.primaryIntent !== undefined) {
    out.primaryIntent = plan.primaryIntent;
  }
  return out;
}

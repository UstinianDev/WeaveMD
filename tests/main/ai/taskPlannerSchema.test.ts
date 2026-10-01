import { describe, expect, it } from 'vitest';

import type { AgentTaskPlan, SubtaskDef } from '@shared/ai';
import { parseStructuredJson } from '@main/ai/llm/structuredJson';
import {
  TASK_PLAN_JSON_SCHEMA,
  normalizeTaskPlan,
  parseTaskPlan,
} from '@main/ai/agent/taskPlannerSchema';

// ============================================
// WeaveMD — agent-multi-intent 任务 1：结构化任务 Schema
// ============================================
// 覆盖三组出参契约（req Q3/Q4/Q5/Q7，plan §2 任务 1 / §4.2）：
//   1) parseTaskPlan 合法出参（全字段 / 可选缺省 / nullable 模拟可选）；
//   2) 非法 7 类整批拒绝（缺字段 / 类型错带序号 / confidence 越界 / intent 枚举外 /
//      非数组 / ```json 围栏坏内容 / 前后缀解说文本残缺 JSON）；
//   3) 降级 3 类（空 subtasks 直通 / >5 按 confidence 截断 + omittedCount /
//      同对象写合并 + 不同对象写串行标注）。
// 另含 TASK_PLAN_JSON_SCHEMA §6.1 特性取舍守卫与 parseStructuredJson 骨架单测。
// memory 行为不变证据 = tests/main/ai/memoryWriter.test.ts 零改动全绿（不在本文件重复断言）。

/** 合法子任务模板（按需覆盖字段，模拟 LLM 出参 JSON）。 */
const baseItem = {
  id: 's1',
  intent: 'create',
  action: 'write',
  object: 'notes/report.md',
  confidence: 0.9,
  rw: 'write',
};

/** 递归收集 Schema 全部键名（用于禁用特性守卫）。 */
function collectSchemaKeys(node: unknown, acc: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((child) => collectSchemaKeys(child, acc));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      acc.add(key);
      collectSchemaKeys(value, acc);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. 合法出参
// ---------------------------------------------------------------------------

describe('taskPlannerSchema — 合法出参', () => {
  it('全字段出参（含 params/preconditions/needsClarification/omittedCount/primaryIntent）→ 逐字段通过', () => {
    const raw = {
      subtasks: [
        {
          id: 's1',
          intent: 'kbQa',
          action: 'search',
          object: '会议纪要',
          params: { query: 'Q3 总结' },
          confidence: 0.92,
          rw: 'read',
          preconditions: ['先确认关键词'],
          needsClarification: false,
        },
        {
          id: 's2',
          intent: 'create',
          action: 'write',
          object: 'notes/report.md',
          params: { heading: '引言' },
          confidence: 0.85,
          rw: 'write',
          preconditions: [],
          needsClarification: true,
        },
      ],
      omittedCount: 0,
      primaryIntent: 'create',
    };
    expect(parseTaskPlan(JSON.stringify(raw))).toEqual(raw);
  });

  it('可选字段缺省（LLM 只给必填六字段）→ 通过并保持缺省形状', () => {
    const raw = {
      subtasks: [
        { id: 's1', intent: 'chat', action: 'answer', object: '今天天气', confidence: 0.7, rw: 'read' },
      ],
    };
    expect(parseTaskPlan(JSON.stringify(raw))).toEqual(raw);
  });

  it('可选字段为 null（Schema 用 nullable 模拟可选）→ 视为缺省', () => {
    const raw = {
      subtasks: [
        {
          ...baseItem,
          params: null,
          preconditions: null,
          needsClarification: null,
        },
      ],
      omittedCount: null,
      primaryIntent: null,
    };
    expect(parseTaskPlan(JSON.stringify(raw))).toEqual({ subtasks: [baseItem] });
  });
});

// ---------------------------------------------------------------------------
// 2. 非法出参（任一项非法整批拒绝，错误带序号）
// ---------------------------------------------------------------------------

describe('taskPlannerSchema — 非法出参（整批拒绝）', () => {
  it('缺字段 → 拒绝（根缺 subtasks / 子任务缺 confidence）', () => {
    expect(() => parseTaskPlan('{"omittedCount": 0}')).toThrow('task_plan: 缺少字段 subtasks');
    const missing = { subtasks: [{ id: 's1', intent: 'create', action: 'write', object: 'a.md', rw: 'write' }] };
    expect(() => parseTaskPlan(JSON.stringify(missing))).toThrow('task_plan: 第 1 项缺少字段 confidence');
  });

  it('类型错 → 拒绝且错误带项序号（第 2 项 id 为数字）', () => {
    const raw = { subtasks: [baseItem, { ...baseItem, id: 123 }] };
    expect(() => parseTaskPlan(JSON.stringify(raw))).toThrow('task_plan: 第 2 项 id 必须是字符串');
  });

  it('confidence 越界（>1 或 <0）→ 拒绝', () => {
    expect(() => parseTaskPlan(JSON.stringify({ subtasks: [{ ...baseItem, confidence: 1.5 }] }))).toThrow(
      'task_plan: 第 1 项 confidence 必须在 [0,1] 区间'
    );
    expect(() => parseTaskPlan(JSON.stringify({ subtasks: [{ ...baseItem, confidence: -0.1 }] }))).toThrow(
      'task_plan: 第 1 项 confidence 必须在 [0,1] 区间'
    );
  });

  it('intent 枚举外 → 拒绝', () => {
    expect(() => parseTaskPlan(JSON.stringify({ subtasks: [{ ...baseItem, intent: 'translate' }] }))).toThrow(
      'task_plan: 第 1 项 intent 非法（必须是 create | rewrite | kbQa | tech | web | chat）'
    );
  });

  it('非数组 → 拒绝（subtasks 为对象 / 顶层为数组）', () => {
    expect(() => parseTaskPlan(JSON.stringify({ subtasks: { 0: baseItem } }))).toThrow(
      'task_plan: subtasks 必须是数组'
    );
    expect(() => parseTaskPlan(JSON.stringify([baseItem]))).toThrow('task_plan: 顶层必须是对象');
  });

  it('```json 围栏包裹非 JSON 内容（拒绝文本）→ 拒绝', () => {
    expect(() => parseTaskPlan('```json\n抱歉，我无法完成该任务的拆分。\n```')).toThrow(
      'task_plan: LLM 输出不是合法 JSON'
    );
  });

  it('前后缀解说文本 + 残缺 JSON → 拒绝', () => {
    expect(() => parseTaskPlan('拆分结果如下：{"subtasks": 不合法}')).toThrow(
      'task_plan: LLM 输出不是合法 JSON'
    );
  });
});

// ---------------------------------------------------------------------------
// 3. 降级与规范化（normalizeTaskPlan，Q7 纯函数）
// ---------------------------------------------------------------------------

describe('taskPlannerSchema — 降级与规范化', () => {
  it('空 subtasks → 合法直通（0 子任务，上层走单意图直通）', () => {
    const plan = parseTaskPlan('{"subtasks": []}');
    expect(plan).toEqual({ subtasks: [] });
    expect(normalizeTaskPlan(plan)).toEqual({ subtasks: [] });
  });

  it('超过 5 条 → 按 confidence 取前 5，其余计入 omittedCount（parse 阶段不截断）', () => {
    // 置信度刻意乱序：验证截断按 confidence 而非原始顺序
    const confidences = [0.5, 0.9, 0.6, 0.95, 0.7, 0.85, 0.4];
    const subtasks = confidences.map((confidence, i) => ({
      id: `s${i + 1}`,
      intent: 'chat',
      action: 'answer',
      object: `问题 ${i + 1}`,
      confidence,
      rw: 'read',
    }));
    const plan = parseTaskPlan(JSON.stringify({ subtasks }));
    expect(plan.subtasks).toHaveLength(7); // parse 只校验不截断

    const normalized = normalizeTaskPlan(plan);
    expect(normalized.subtasks.map((s) => s.id)).toEqual(['s2', 's3', 's4', 's5', 's6']);
    expect(normalized.omittedCount).toBe(2);
  });

  it('同对象写子任务合并为一条（params 合并、confidence 取高、不改输入）', () => {
    const plan: AgentTaskPlan = {
      subtasks: [
        { id: 's1', intent: 'create', action: 'write', object: 'notes/a.md', params: { heading: '引言' }, confidence: 0.8, rw: 'write' },
        { id: 's2', intent: 'rewrite', action: 'append', object: 'notes/a.md', params: { body: '正文' }, confidence: 0.9, rw: 'write' },
      ],
    };
    const normalized = normalizeTaskPlan(plan);
    expect(normalized.subtasks).toHaveLength(1);
    expect(normalized.subtasks[0]).toEqual({
      id: 's1',
      intent: 'create',
      action: 'write',
      object: 'notes/a.md',
      params: { heading: '引言', body: '正文' },
      confidence: 0.9,
      rw: 'write',
    });
    expect(plan.subtasks).toHaveLength(2); // 纯函数：输入不被就地修改
  });

  it('不同对象写 → 后续写子任务标注串行依赖（只读子任务不动）', () => {
    const plan: AgentTaskPlan = {
      subtasks: [
        { id: 's1', intent: 'create', action: 'write', object: 'notes/a.md', confidence: 0.9, rw: 'write' },
        { id: 's2', intent: 'kbQa', action: 'search', object: '会议纪要', confidence: 0.9, rw: 'read' },
        { id: 's3', intent: 'create', action: 'write', object: 'notes/b.md', confidence: 0.8, rw: 'write' },
      ],
    };
    const normalized = normalizeTaskPlan(plan);
    expect(normalized.subtasks[0].preconditions).toBeUndefined();
    expect(normalized.subtasks[1].preconditions).toBeUndefined();
    expect(normalized.subtasks[2].preconditions).toEqual(['serial_after:s1']);
  });

  it('normalize 收到越界 confidence → 同文案拒绝（防御直传/用户编辑路径）', () => {
    const plan: AgentTaskPlan = {
      subtasks: [{ ...baseItem, confidence: 3 } as SubtaskDef],
    };
    expect(() => normalizeTaskPlan(plan)).toThrow('task_plan: 第 1 项 confidence 必须在 [0,1] 区间');
  });
});

// ---------------------------------------------------------------------------
// 4. TASK_PLAN_JSON_SCHEMA 特性取舍守卫（plan §6.1 稳定交集）
// ---------------------------------------------------------------------------

describe('taskPlannerSchema — TASK_PLAN_JSON_SCHEMA 特性取舍（§6.1）', () => {
  const FORBIDDEN_KEYS = [
    'oneOf',
    'anyOf',
    'not',
    'pattern',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    '$ref',
    '$schema',
    '$id',
    'dependencies',
  ];

  it('全 Schema 零禁用特性（oneOf/pattern/min-max/递归 $ref/根 anyOf 等）', () => {
    const keys = new Set<string>();
    collectSchemaKeys(TASK_PLAN_JSON_SCHEMA, keys);
    expect(FORBIDDEN_KEYS.filter((k) => keys.has(k))).toEqual([]);
  });

  it('根级与子任务级 required 全字段（每层全部属性必填，可选用 nullable 模拟）', () => {
    const root = TASK_PLAN_JSON_SCHEMA;
    expect([...(root.required ?? [])].sort()).toEqual(Object.keys(root.properties ?? {}).sort());
    const items = root.properties?.subtasks.items;
    expect(items).toBeDefined();
    expect([...(items?.required ?? [])].sort()).toEqual(Object.keys(items?.properties ?? {}).sort());
    // 根级与子任务级 object 每层 additionalProperties: false
    expect(root.additionalProperties).toBe(false);
    expect(items?.additionalProperties).toBe(false);
  });

  it('标量 enum 钉死（intent 六值 / rw 二值）', () => {
    const items = TASK_PLAN_JSON_SCHEMA.properties?.subtasks.items;
    expect(items?.properties?.intent.enum).toEqual(['create', 'rewrite', 'kbQa', 'tech', 'web', 'chat']);
    expect(items?.properties?.rw.enum).toEqual(['read', 'write']);
  });
});

// ---------------------------------------------------------------------------
// 5. parseStructuredJson 通用骨架（memory 委托同源，错误文案格式钉死）
// ---------------------------------------------------------------------------

describe('parseStructuredJson — 通用骨架', () => {
  it('剥 ```json 围栏后解析（数组形态不被 {} 截取破坏）', () => {
    const arr = [{ kind: 'fact', subject: '决策', content: '采用 SQLite' }];
    const out = parseStructuredJson('```json\n' + JSON.stringify(arr) + '\n```', {
      label: 'demo',
      validate: (value) => value,
    });
    expect(out).toEqual(arr);
  });

  it('直接解析失败 → 截取首个 { 到最后一个 } 兜底（前后缀解说文本）', () => {
    const out = parseStructuredJson('拆分说明前缀 {"subtasks": []} 以上是结果', {
      label: 'demo',
      validate: (value) => value,
    });
    expect(out).toEqual({ subtasks: [] });
  });

  it('非法 JSON → 抛 `${label}: LLM 输出不是合法 JSON`', () => {
    expect(() =>
      parseStructuredJson('完全不是 JSON', { label: 'demo', validate: (value) => value })
    ).toThrow('demo: LLM 输出不是合法 JSON');
  });

  it('validate 抛出的校验错误原样上抛（带序号与整批拒绝交给校验器）', () => {
    expect(() =>
      parseStructuredJson('{"a": 1}', {
        label: 'demo',
        validate: () => {
          throw new Error('demo: 第 1 项坏');
        },
      })
    ).toThrow('demo: 第 1 项坏');
  });
});

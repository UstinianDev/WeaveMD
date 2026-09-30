// ============================================
// WeaveMD — memory_write tool handler（agent-memory-optimize 第二批 C1）
// ============================================
// Agent 主动写入长期记忆，落 agent_memory（B1 单表 + 双时间），走 DAO 的 upsert 语义：
//   - source **恒为 'auto'**（B1 裁定 2 的配套约束：upsertMemory 对 manual 行恒赢，
//     Agent 不得也无法覆盖 memory.md 手写值）；
//   - 同 kind+subject+fingerprint 由 upsertMemory 关旧插新（Ledger 不删行）；
//   - 同 user+kind+subject 已有 manual active 行 → 零写入，返回既有行 id。
// 自限（Q8 裁定 agentToolPolicy 本批不接线，规则写在 policy 文件但不接调用）：
//   - 同轮同 kind+subject 只写一条（duplicate_in_turn）；
//   - 单轮写入上限 MAX_MEMORY_WRITE_PER_TURN。
// 不进 FORCE_CONFIRM_TOOLS：铁律一仅约束笔记内容写入，记忆写入不逐条确认（req C3 边界）。

import { createHash } from 'crypto';
import type { ToolDef } from '@shared/ai';
import type { ToolHandler, ToolResult } from '../toolTypes';
import { runMemoryPolicy } from '../agent/memoryPolicy';
import { writeMemoryVectorAsync } from '../knowledge/vectorBackfill';
import {
  getActiveBySubject,
  upsertMemory,
  type AgentMemoryKind,
} from '../../db/agentMemory';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const memoryWriteSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'memory_write',
    description:
      '写入或更新本用户的长期记忆（upsert 语义）。只在用户明确表达、或会话中已确认的事实/画像/实体上使用；不要把一次性问答内容写成记忆。用户手写的记忆恒赢，本工具不会覆盖。',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['profile', 'fact', 'entity'],
          description:
            '记忆分类：profile（用户画像与偏好）/ fact（事实与决策）/ entity（实体，如人、组织、项目）',
        },
        subject: {
          type: 'string',
          description: '主题标签（1~200 字符），同主题重复写入会覆盖为最新内容',
        },
        content: {
          type: 'string',
          description: '记忆内容（1~4000 字符），一句话陈述，避免口语与代词',
        },
      },
      required: ['kind', 'subject', 'content'],
    },
  },
};

// ---------------------------------------------------------------------------
// 单轮自限
// ---------------------------------------------------------------------------

/**
 * 单轮写入上限。
 * 取值理由：Q8 裁定 `agentToolPolicy` 本批不接线，上限只能在 handler 内自限；
 * 10 为**无实测数据**的保守取值（单次任务里画像/实体的合理抽取量级是个位数，
 * 上限过高会让画像被批量改写、过低会漏记），待 C2 后台写入上线后按实测分布校准。
 */
export const MAX_MEMORY_WRITE_PER_TURN = 10;

/** 单条长度上限（与设置页 memory.md `recommendedChars` = 4000 同口径）。 */
const CONTENT_MAX_CHARS = 4000;
/** 主题是短标签，超长基本等同填错字段。 */
const SUBJECT_MAX_CHARS = 200;

interface TurnMemoryState {
  /** 本任务实际落库的写入次数（manual 覆盖与同轮去重都不计数）。 */
  count: number;
  /** kind+subject → 已写入的行 id，用于同轮去重与回执。 */
  written: Map<string, number>;
}

/**
 * 单轮状态以 toolCtx 为键：`prepareAgentContext` 每次 runAgentFlow 新建 toolCtx，
 * 故一份状态天然对应「一次用户任务（含其内多轮 agentLoop）」，任务结束随 ctx 释放，
 * 不需要额外的轮次 id，也不会跨任务泄漏计数。
 */
const turnStates = new WeakMap<object, TurnMemoryState>();

function stateOf(ctx: object): TurnMemoryState {
  let state = turnStates.get(ctx);
  if (!state) {
    state = { count: 0, written: new Map() };
    turnStates.set(ctx, state);
  }
  return state;
}

/**
 * content 归一化（去首尾空白 + 折叠连续空白）后 sha256，
 * 与 B1「fingerprint = content 归一化 hash」同口径。
 */
function fingerprintOf(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function turnKey(kind: string, subject: string): string {
  return `${kind} ${subject}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handleMemoryWrite: ToolHandler = (args, ctx): ToolResult => {
  const kind = args.kind;
  if (typeof kind !== 'string' || !['profile', 'fact', 'entity'].includes(kind)) {
    return {
      content: '',
      status: 'error',
      errorDesc: 'memory_write: kind 必须为 profile | fact | entity',
    };
  }

  const subject = typeof args.subject === 'string' ? args.subject.trim() : '';
  if (subject.length < 1 || subject.length > SUBJECT_MAX_CHARS) {
    return {
      content: '',
      status: 'error',
      errorDesc: `memory_write: subject 必须为 1~${SUBJECT_MAX_CHARS} 字符的非空字符串`,
    };
  }

  const content = typeof args.content === 'string' ? args.content.trim() : '';
  if (content.length < 1 || content.length > CONTENT_MAX_CHARS) {
    return {
      content: '',
      status: 'error',
      errorDesc: `memory_write: content 必须为 1~${CONTENT_MAX_CHARS} 字符的非空字符串`,
    };
  }

  if (!ctx.db) {
    return { content: '', status: 'error', errorDesc: 'memory_write: 数据库未就绪' };
  }

  const state = stateOf(ctx);
  const key = turnKey(kind, subject);

  // 同轮同 kind+subject 去重：只留一条（先到先得，后续写入不落库也不占上限额度）
  const already = state.written.get(key);
  if (already !== undefined) {
    return {
      content: JSON.stringify({
        written: false,
        reason: 'duplicate_in_turn',
        id: already,
        kind,
        subject,
      }),
      status: 'ok',
    };
  }

  if (state.count >= MAX_MEMORY_WRITE_PER_TURN) {
    return {
      content: '',
      status: 'error',
      errorDesc: `memory_write: 单轮写入已达上限（MAX_MEMORY_WRITE_PER_TURN=${MAX_MEMORY_WRITE_PER_TURN}）`,
    };
  }

  const memoryKind = kind as AgentMemoryKind;

  // manual 恒赢（Q10）：既有手写行零写入并如实回执既有 id
  //（upsertMemory 内部同样有闸，这里先读一次只为区分回执 reason）
  const manual = getActiveBySubject(ctx.db, ctx.userId, memoryKind, subject);
  if (manual && manual.source === 'manual') {
    state.written.set(key, manual.id);
    return {
      content: JSON.stringify({
        written: false,
        reason: 'manual_override',
        id: manual.id,
        kind,
        subject,
      }),
      status: 'ok',
    };
  }

  const id = upsertMemory(ctx.db, {
    userId: ctx.userId,
    kind: memoryKind,
    subject,
    content,
    fingerprint: fingerprintOf(content),
    source: 'auto',
    conversationId: ctx.currentConversationId ?? null,
  });
  state.written.set(key, id);
  state.count += 1;

  // D6 写入接线①：写入成功后**异步**补向量（不 await → 不阻塞工具返回、不改返回结构）。
  // 失败语义与 D2/D3 一致：同步异常走 try/catch、Promise 拒绝走 .catch，
  // 两条都只 console.warn，向量保持 NULL（检索侧自动降级为 FTS5）。
  try {
    void writeMemoryVectorAsync(ctx.db, ctx.userId, id, subject, content).catch(
      (error: unknown) => {
        console.warn('[memoryWrite] 记忆向量生成失败（不影响本次工具返回）', {
          userId: ctx.userId,
          subject,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    );
  } catch (error) {
    console.warn('[memoryWrite] 记忆向量写入调度异常（不影响本次工具返回）', {
      userId: ctx.userId,
      subject,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // D2 触发时机②：C1 写入成功后跑一次记忆策略（与后台提取路径同口径）。
  // 失败必须被吞掉 —— 策略是清理动作，绝不改变工具返回结构、绝不把 error 抛回调用方。
  try {
    runMemoryPolicy(ctx.db, ctx.userId);
  } catch (error) {
    console.warn('[memoryWrite] 写入后记忆策略执行失败（不影响本次工具返回）', {
      userId: ctx.userId,
      subject,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    content: JSON.stringify({ written: true, id, kind, subject, source: 'auto' }),
    status: 'ok',
  };
};

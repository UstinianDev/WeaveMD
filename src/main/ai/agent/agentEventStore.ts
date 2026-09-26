// ============================================
// WeaveMD — Agent Event Store (持久化 + 回放)
// ============================================
// 持久化 SSE 事件到 agent_run_events，并通过 IPC 推送到渲染进程。
// 支持断线重连时从指定序列号回放。
// 性能优化：批量写入（累积事件后批量 INSERT，减少 DB 写入次数）。

import { randomUUID } from 'crypto';
import type { BrowserWindow } from 'electron';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { AgentRunEvent } from '@shared/ai';
import * as eventDao from '../../db/agentEventDao';
import { toRelativePath } from '../image/imageStorage';

// ---------------------------------------------------------------------------
// B6 五-1②：事件持久化的图片引用（存相对路径、不存 base64）
// ---------------------------------------------------------------------------

/** base64 data URL（图片）识别。 */
const IMAGE_DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

/** 疑似本地绝对路径（盘符 / UNC），只对这类字符串尝试相对化。 */
function looksLikeAbsPath(s: string): boolean {
  return /^[a-zA-Z]:[\/]/.test(s) || s.startsWith('\\');
}

/**
 * 事件入库前净化：
 * - 图片 data URL → 显式占位（base64 会撑爆 agent_run_events 表）
 * - 附件根内的绝对路径 → 相对路径（userData 迁移不失效，回放时重建）
 * - 纯文本 payload 原样返回（零改动，纯文本链路回归不变）
 */
export function sanitizeEventPayload(payload: unknown, depth = 0): unknown {
  if (depth > 8) return payload;
  if (typeof payload === 'string') {
    if (payload.length > 24 && IMAGE_DATA_URL_RE.test(payload)) {
      return '[图片已省略：内容请使用附件落盘路径引用]';
    }
    if (looksLikeAbsPath(payload)) {
      return toRelativePath(payload) ?? payload;
    }
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((v) => sanitizeEventPayload(v, depth + 1));
  }
  if (payload && typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      out[k] = sanitizeEventPayload(v, depth + 1);
    }
    return out;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// In-memory seq counter — avoids SELECT MAX(seq) on every event
// ---------------------------------------------------------------------------

const seqCounters = new Map<string, number>();

/** Reset seq counter for a session (call at session start). */
export function resetSeqCounter(sessionId: string): void {
  seqCounters.delete(sessionId);
}

// ---------------------------------------------------------------------------
// 批量写入队列（性能优化）
// ---------------------------------------------------------------------------

interface BatchEventItem {
  db: BetterSqlite3Database;
  sessionId: string;
  conversationId: string;
  seq: number;
  eventType: string;
  payloadJson: string;
  payload: unknown;
  mainWindow: BrowserWindow;
}

/** 批量写入队列。 */
const eventBatchQueue: BatchEventItem[] = [];

/** 批量刷新定时器。 */
let batchFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** 批量刷新间隔（毫秒）。 */
const BATCH_FLUSH_INTERVAL = 100;

/**
 * 刷新批量队列：将队列中的事件批量写入 DB 并发送 IPC。
 * 使用事务包裹，减少 auto-commit 开销。
 */
function flushEventBatch(): void {
  if (eventBatchQueue.length === 0) return;

  const batch = [...eventBatchQueue];
  eventBatchQueue.length = 0;

  if (batchFlushTimer) {
    clearTimeout(batchFlushTimer);
    batchFlushTimer = null;
  }

  // 按 DB 实例分组（理论上只有一个 DB，但防御性编程）
  const dbGroups = new Map<BetterSqlite3Database, BatchEventItem[]>();
  for (const item of batch) {
    const group = dbGroups.get(item.db) ?? [];
    group.push(item);
    dbGroups.set(item.db, group);
  }

  // 批量 INSERT（事务包裹）
  for (const [db, items] of dbGroups) {
    try {
      const insertStmt = db.prepare(`
        INSERT INTO agent_run_events (id, session_id, conversation_id, seq, event_type, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((batchItems: BatchEventItem[]) => {
        for (const item of batchItems) {
          const id = randomUUID();
          insertStmt.run(id, item.sessionId, item.conversationId, item.seq, item.eventType, item.payloadJson);
        }
      });

      insertMany(items);
    } catch {
      // 批量写入失败时静默跳过（不阻断主流程）
    }
  }

  // 批量 IPC 发送
  for (const item of batch) {
    try {
      const payload = item.payload;
      item.mainWindow.webContents.send(`ai:stream:${item.eventType}`, {
        sessionId: item.sessionId,
        conversationId: item.conversationId,
        seq: item.seq,
        ...(typeof payload === 'object' && payload !== null ? payload : { data: payload }),
      });
    } catch {
      // IPC 发送失败时静默跳过
    }
  }
}

// ---------------------------------------------------------------------------
// persistAndSend — 持久化事件并通过 IPC 推送（批量版本）
// ---------------------------------------------------------------------------

export function persistAndSend(
  db: BetterSqlite3Database,
  mainWindow: BrowserWindow,
  sessionId: string,
  conversationId: string,
  eventType: string,
  payload: unknown
): AgentRunEvent {
  let seq = seqCounters.get(sessionId);
  if (seq === undefined) {
    seq = eventDao.getLatestSeq(db, sessionId);
  }
  const nextSeq = seq + 1;
  seqCounters.set(sessionId, nextSeq);
  // 入库 JSON 先净化：图片引用存相对路径、base64 不进事件表（IPC 实时推送仍用原 payload）
  const payloadJson = JSON.stringify(sanitizeEventPayload(payload));

  // 加入批量队列
  eventBatchQueue.push({
    db,
    sessionId,
    conversationId,
    seq: nextSeq,
    eventType,
    payloadJson,
    payload,
    mainWindow,
  });

  // 启动批量刷新定时器（如果尚未启动）
  if (!batchFlushTimer) {
    batchFlushTimer = setTimeout(() => {
      flushEventBatch();
    }, BATCH_FLUSH_INTERVAL);
  }

  // 返回事件对象（本地构造，不等待 DB 写入）
  return {
    id: randomUUID(),
    sessionId,
    conversationId,
    seq: nextSeq,
    eventType: eventType as AgentRunEvent['eventType'],
    payloadJson,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 仅持久化事件到 DB（不发送 IPC），用于交互事件等需要自定义通道的场景。
 * 复用 persistAndSend 的 seq 计数器逻辑。
 */
export function persistOnly(
  db: BetterSqlite3Database,
  sessionId: string,
  conversationId: string,
  eventType: string,
  payload: unknown
): AgentRunEvent {
  let seq = seqCounters.get(sessionId);
  if (seq === undefined) {
    seq = eventDao.getLatestSeq(db, sessionId);
  }
  const nextSeq = seq + 1;
  seqCounters.set(sessionId, nextSeq);
  const payloadJson = JSON.stringify(sanitizeEventPayload(payload));

  return eventDao.insertEvent(
    db,
    sessionId,
    conversationId,
    nextSeq,
    eventType,
    payloadJson
  );
}

// ---------------------------------------------------------------------------
// replayFromSeq — 回放指定序列号之后的事件（断线重连）
// ---------------------------------------------------------------------------

export function replayFromSeq(
  db: BetterSqlite3Database,
  mainWindow: BrowserWindow,
  sessionId: string,
  afterSeq: number
): AgentRunEvent[] {
  const events = eventDao.getEventsAfterSeq(db, sessionId, afterSeq);

  for (const event of events) {
    const parsed = JSON.parse(event.payloadJson);
    // interaction 事件发送到 preload 监听的原始通道（agent:interaction:question），
    // 其他事件走 ai:stream:${eventType} 管道。
    const channel = event.eventType === 'interaction'
      ? 'agent:interaction:question'
      : `ai:stream:${event.eventType}`;
    mainWindow.webContents.send(channel, {
      sessionId,
      conversationId: event.conversationId,
      seq: event.seq,
      ...(typeof parsed === 'object' && parsed !== null ? parsed : { data: parsed }),
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// getLatestSeq — 获取会话最新序列号（供渲染端断线重连握手）
// ---------------------------------------------------------------------------

export function getLatestSeq(db: BetterSqlite3Database, sessionId: string): number {
  return eventDao.getLatestSeq(db, sessionId);
}

// ---------------------------------------------------------------------------
// cleanupOldEvents — 清理旧事件
// ---------------------------------------------------------------------------

export function cleanupOldEvents(db: BetterSqlite3Database, retentionDays: number = 7): number {
  return eventDao.cleanupOldEvents(db, retentionDays);
}

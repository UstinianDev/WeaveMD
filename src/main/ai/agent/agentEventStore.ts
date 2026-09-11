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
      const payload = JSON.parse(item.payloadJson);
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
  const payloadJson = JSON.stringify(payload);

  // 加入批量队列
  eventBatchQueue.push({
    db,
    sessionId,
    conversationId,
    seq: nextSeq,
    eventType,
    payloadJson,
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
  const payloadJson = JSON.stringify(payload);

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

// ============================================
// WeaveMD — Agent Event Store (持久化 + 回放)
// ============================================
// 持久化 SSE 事件到 agent_run_events，并通过 IPC 推送到渲染进程。
// 支持断线重连时从指定序列号回放。

import type { BrowserWindow } from 'electron';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { AgentRunEvent } from '@shared/ai';
import * as eventDao from '../../db/agentEventDao';

// ---------------------------------------------------------------------------
// persistAndSend — 持久化事件并通过 IPC 推送
// ---------------------------------------------------------------------------

export function persistAndSend(
  db: BetterSqlite3Database,
  mainWindow: BrowserWindow,
  sessionId: string,
  conversationId: string,
  eventType: string,
  payload: unknown
): AgentRunEvent {
  const nextSeq = eventDao.getLatestSeq(db, sessionId) + 1;
  const payloadJson = JSON.stringify(payload);

  const event = eventDao.insertEvent(
    db,
    sessionId,
    conversationId,
    nextSeq,
    eventType,
    payloadJson
  );

  mainWindow.webContents.send(`ai:stream:${eventType}`, {
    sessionId,
    conversationId,
    seq: nextSeq,
    ...(typeof payload === 'object' && payload !== null ? payload : { data: payload }),
  });

  return event;
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
    mainWindow.webContents.send(`ai:stream:${event.eventType}`, {
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

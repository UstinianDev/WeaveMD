// ============================================
// WeaveMD — Agent Checkpoint 薄封装
// ============================================
// 基于 agentSessionDao 的 checkpoint_json 字段，提供类型安全的
// CheckpointData 序列化/反序列化接口。纯新增文件，不修改已有模块。

import type { Database } from 'better-sqlite3';
import type {
  AgentCheckpoint,
  AgentLlmMessage,
  IAgentToolCall,
  IIntent,
} from '@shared/ai';
import * as sessionDao from '../db/agentSessionDao';

// ---------------------------------------------------------------------------
// CheckpointData — 检查点内部数据结构
// ---------------------------------------------------------------------------

export interface CheckpointData {
  roundIndex: number;
  llmMessages: AgentLlmMessage[];
  toolCallsHistory: IAgentToolCall[];
  roundsUsed: number;
  reasoningTokenCount: number | null;
  intent: IIntent | null;
}

// ---------------------------------------------------------------------------
// saveCheckpoint — 将 CheckpointData 序列化后写入 DB
// ---------------------------------------------------------------------------

export function saveCheckpoint(
  db: Database,
  sessionId: string,
  data: CheckpointData,
): void {
  const checkpointJson = JSON.stringify(data);
  sessionDao.saveCheckpoint(db, sessionId, checkpointJson);
}

// ---------------------------------------------------------------------------
// loadCheckpoint — 从 DB 读取并反序列化 CheckpointData
// ---------------------------------------------------------------------------

export function loadCheckpoint(
  db: Database,
  sessionId: string,
): CheckpointData | null {
  const json = sessionDao.loadCheckpoint(db, sessionId);
  if (!json) return null;

  try {
    return JSON.parse(json) as CheckpointData;
  } catch (error) {
    console.error('[agentCheckpoint] Failed to parse checkpoint:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// clearCheckpoint — 删除检查点（写入 null 清空字段）
// ---------------------------------------------------------------------------

export function clearCheckpoint(
  db: Database,
  sessionId: string,
): void {
  // DAO 签名为 string，但 SQLite 参数化查询接受 null；用 unknown 桥接类型
  sessionDao.saveCheckpoint(db, sessionId, null as unknown as string);
}

// ---------------------------------------------------------------------------
// hasCheckpoint — 检查检查点是否存在
// ---------------------------------------------------------------------------

export function hasCheckpoint(
  db: Database,
  sessionId: string,
): boolean {
  return sessionDao.loadCheckpoint(db, sessionId) !== null;
}

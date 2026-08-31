// ============================================
// WeaveMD — Agent Session State Machine (main)
// ============================================
// 会话状态机：管理 agent_sessions 的生命周期转换。
// 合法转换表硬编码，非法转换抛 Error。
// checkpoint / snapshot / rounds 代理调用 agentSessionDao。

import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { AgentSession, AgentSessionStatus } from '@shared/ai';
import * as sessionDao from '../../db/agentSessionDao';

// ---------------------------------------------------------------------------
// 合法状态转换表
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<AgentSessionStatus, AgentSessionStatus[]> = {
  created: ['queued'],
  queued: ['running', 'cancelled', 'superseded'],
  running: [
    'completed',
    'failed',
    'cancelled',
    'waiting_interaction',
    'waiting_operation_confirmation',
    'waiting_limit',
    'waiting_retry',
    'waiting_model_recovery',
  ],
  waiting_interaction: ['running', 'cancelled'],
  waiting_operation_confirmation: ['running', 'cancelled'],
  waiting_limit: ['running', 'cancelled'],
  waiting_retry: ['running', 'cancelled'],
  waiting_model_recovery: ['running', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
  superseded: [],
};

// ---------------------------------------------------------------------------
// AgentSessionStateMachine
// ---------------------------------------------------------------------------

export class AgentSessionStateMachine {
  private sessionId: string;
  private db: BetterSqlite3Database;
  private currentStatus: AgentSessionStatus;
  /** 缓存轮次，-1 表示未初始化。 */
  private _roundsUsed = -1;
  private _maxRounds = 20;

  constructor(
    db: BetterSqlite3Database,
    sessionId: string,
    initialStatus: AgentSessionStatus = 'created'
  ) {
    this.db = db;
    this.sessionId = sessionId;
    this.currentStatus = initialStatus;
  }

  /** 获取当前状态。 */
  getStatus(): AgentSessionStatus {
    return this.currentStatus;
  }

  /** 获取会话 ID。 */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 状态转换（验证合法性后写入 DB）。
   * @throws 非法转换时抛出 Error。
   * @returns 转换成功返回 true。
   */
  transition(to: AgentSessionStatus): boolean {
    const validTargets = VALID_TRANSITIONS[this.currentStatus];
    if (!validTargets.includes(to)) {
      throw new Error(
        `Invalid transition: ${this.currentStatus} -> ${to}. ` +
          `Valid targets: ${validTargets.join(', ')}`
      );
    }

    sessionDao.updateSessionStatus(this.db, this.sessionId, to);
    this.currentStatus = to;
    return true;
  }

  /** 检查是否可以转换到目标状态（不触发 DB 写入）。 */
  canTransitionTo(to: AgentSessionStatus): boolean {
    return VALID_TRANSITIONS[this.currentStatus]?.includes(to) ?? false;
  }

  /** 加载会话并恢复状态机状态。 */
  load(): AgentSession | null {
    const session = sessionDao.getSession(this.db, this.sessionId);
    if (session) {
      this.currentStatus = session.status;
      this._roundsUsed = session.roundsUsed;
      this._maxRounds = session.maxRounds;
    }
    return session;
  }

  /** 保存检查点。 */
  saveCheckpoint(checkpointJson: string): void {
    sessionDao.saveCheckpoint(this.db, this.sessionId, checkpointJson);
  }

  /** 加载检查点。 */
  loadCheckpoint(): string | null {
    return sessionDao.loadCheckpoint(this.db, this.sessionId);
  }

  /** 保存文件快照。 */
  saveSnapshot(snapshotJson: string): void {
    sessionDao.saveSnapshot(this.db, this.sessionId, snapshotJson);
  }

  /** 加载文件快照。 */
  loadSnapshot(): string | null {
    return sessionDao.loadSnapshot(this.db, this.sessionId);
  }

  /** 已用轮次 +1（原子 UPDATE，避免读-改-写往返）。 */
  incrementRounds(): void {
    sessionDao.incrementSessionRounds(this.db, this.sessionId);
    // 本地计数同步（避免下次 isNearRoundLimit 额外查库）
    this._roundsUsed++;
  }

  /** 是否接近轮次限制（>= 80%）。使用本地缓存避免额外 DB 查询。 */
  isNearRoundLimit(): boolean {
    if (this._roundsUsed < 0) {
      const session = sessionDao.getSession(this.db, this.sessionId);
      if (!session) return false;
      this._roundsUsed = session.roundsUsed;
      this._maxRounds = session.maxRounds;
    }
    return this._roundsUsed >= this._maxRounds * 0.8;
  }

  /** 是否已达到轮次限制。使用本地缓存避免额外 DB 查询。 */
  isAtRoundLimit(): boolean {
    if (this._roundsUsed < 0) {
      const session = sessionDao.getSession(this.db, this.sessionId);
      if (!session) return false;
      this._roundsUsed = session.roundsUsed;
      this._maxRounds = session.maxRounds;
    }
    return this._roundsUsed >= this._maxRounds;
  }
}

// ============================================
// WeaveMD — Agent Task Queue Manager
// ============================================
// 高层任务队列管理：入队、出队、状态流转、会话级取消与 supersede。
// 全部操作委托 agentTaskDao，无直接 SQL。
// better-sqlite3 为同步 API，因此本类方法均为同步。

import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { AgentTask, AgentTaskStatus } from '@shared/ai';
import * as taskDao from '../../db/agentTaskDao';

// ---------------------------------------------------------------------------
// EnqueuePayload — 入队参数
// ---------------------------------------------------------------------------

export interface EnqueuePayload {
  conversationId: string;
  userId: string;
  message: string;
  priority?: number;
  payloadJson?: string;
}

// ---------------------------------------------------------------------------
// AgentTaskQueue — 高层任务队列管理
// ---------------------------------------------------------------------------

export class AgentTaskQueue {
  private db: BetterSqlite3Database;

  constructor(db: BetterSqlite3Database) {
    this.db = db;
  }

  /** 入队新任务，自动 supersede 同会话旧 pending 任务。 */
  enqueue(payload: EnqueuePayload): AgentTask {
    const task = taskDao.enqueueTask(
      this.db,
      payload.conversationId,
      payload.userId,
      payload.message,
      payload.payloadJson ?? '{}',
    );

    this.supersedeOldTasks(payload.conversationId, task.id);

    return task;
  }

  /** 出队下一个待处理任务（同会话串行：会话内有 running 任务时该会话 pending 不出队）。 */
  dequeueForProcessing(): AgentTask | null {
    return taskDao.dequeueNext(this.db);
  }

  /** 更新任务状态，可选附带错误码与错误信息。 */
  updateStatus(
    taskId: string,
    status: AgentTaskStatus,
    errorCode?: string,
    errorMessage?: string,
  ): void {
    taskDao.updateTaskStatus(this.db, taskId, status, errorCode, errorMessage);
  }

  /** 按 ID 获取任务。 */
  getTask(taskId: string): AgentTask | null {
    return taskDao.getTaskById(this.db, taskId);
  }

  /** 获取会话的所有任务（按创建时间升序）。 */
  getTasksByConversation(conversationId: string): AgentTask[] {
    return taskDao.getTasksByConversation(this.db, conversationId);
  }

  /** 取消会话的所有待处理任务，返回被取消的数量。 */
  cancelPending(conversationId: string): number {
    return taskDao.cancelPendingByConversation(this.db, conversationId);
  }

  /** 取消特定任务。 */
  cancelTask(taskId: string): void {
    taskDao.updateTaskStatus(this.db, taskId, 'cancelled');
  }

  /** 检查任务是否已被 supersede。 */
  isSuperseded(taskId: string): boolean {
    const task = taskDao.getTaskById(this.db, taskId);
    return task?.status === 'superseded';
  }

  /** 获取队列统计（各状态任务数）。 */
  getStats(): { pending: number; running: number; completed: number; failed: number } {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) as count
         FROM agent_task_queue
         GROUP BY status`,
      )
      .all() as Array<{ status: string; count: number }>;

    const stats = { pending: 0, running: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = row.count;
      }
    }
    return stats;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /** 将同会话中旧的 pending 任务标记为 superseded。 */
  private supersedeOldTasks(conversationId: string, newTaskId: string): void {
    const tasks = taskDao.getTasksByConversation(this.db, conversationId);
    for (const task of tasks) {
      if (task.id !== newTaskId && task.status === 'pending') {
        taskDao.supersedeTask(this.db, task.id);
      }
    }
  }
}

export default AgentTaskQueue;

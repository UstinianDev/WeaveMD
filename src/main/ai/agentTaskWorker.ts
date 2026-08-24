// ============================================
// WeaveMD — Agent Task Worker (Background Poller)
// ============================================
// 后台轮询执行器：从 AgentTaskQueue 拉取 pending 任务，创建会话 + 文件快照，
// 调用 runAgentFlow 执行 LLM 流程，通过 IPC 推送 SSE 事件到渲染进程。
// 支持 AbortController 取消、最大并发限制、同会话串行（队列层保证）。

import { BrowserWindow } from 'electron';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type {
  AgentTask,
  AgentRunResult,
  AIErrorCode,
  IAIConfig,
  IAIConsent,
} from '@shared/ai';
import { normalizeKbSettings } from '@shared/ai';
import { IPC_CHANNELS } from '@shared/constants';
import { getAiConfig } from '../db/ai';
import * as sessionDao from '../db/agentSessionDao';
import { AgentTaskQueue } from './agentTaskQueue';
import { AgentSessionStateMachine } from './agentSession';
import { runAgentFlow } from './agentLoop';
import { searchKB } from './kbSearch';
import {
  toIAIConfig,
  toIAIConsent,
  DEFAULT_AI_CONFIG,
  DEFAULT_CONSENT,
} from './ipc/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerConfig {
  /** 轮询间隔（毫秒），默认 1000。 */
  pollIntervalMs?: number;
  /** 最大并发任务数，默认 1。 */
  maxConcurrent?: number;
}

// ---------------------------------------------------------------------------
// AgentTaskWorker
// ---------------------------------------------------------------------------

export class AgentTaskWorker {
  private db: BetterSqlite3Database;
  private queue: AgentTaskQueue;
  private config: Required<WorkerConfig>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private activeTasks: Map<string, AbortController> = new Map();
  private mainWindow: BrowserWindow | null = null;

  constructor(
    db: BetterSqlite3Database,
    queue: AgentTaskQueue,
    config?: WorkerConfig,
  ) {
    this.db = db;
    this.queue = queue;
    this.config = {
      pollIntervalMs: config?.pollIntervalMs ?? 1000,
      maxConcurrent: config?.maxConcurrent ?? 1,
    };
  }

  /** 设置主窗口引用（用于发送 IPC 事件到渲染进程）。 */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /** 启动 Worker（幂等：已运行时忽略）。 */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.poll();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.config.pollIntervalMs);
    console.log(
      '[AgentTaskWorker] Started, polling every',
      this.config.pollIntervalMs,
      'ms',
    );
  }

  /** 停止 Worker：取消所有活跃任务、清除轮询定时器。 */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const [taskId, controller] of this.activeTasks) {
      controller.abort();
      this.queue.updateStatus(taskId, 'cancelled');
    }
    this.activeTasks.clear();
    console.log('[AgentTaskWorker] Stopped');
  }

  /** 取消特定任务。 */
  cancelTask(taskId: string): void {
    const controller = this.activeTasks.get(taskId);
    if (controller) {
      controller.abort();
      this.activeTasks.delete(taskId);
      this.queue.updateStatus(taskId, 'cancelled');
    }
  }

  /** 获取当前活跃任务数。 */
  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  /** 检查指定任务是否正在执行。 */
  isTaskActive(taskId: string): boolean {
    return this.activeTasks.has(taskId);
  }

  // -----------------------------------------------------------------------
  // Private — Polling
  // -----------------------------------------------------------------------

  /** 轮询：从队列出队并执行（受 maxConcurrent 限制）。 */
  private async poll(): Promise<void> {
    if (!this.isRunning) return;
    if (this.activeTasks.size >= this.config.maxConcurrent) return;

    try {
      const task = this.queue.dequeueForProcessing();
      if (!task) return;

      console.log('[AgentTaskWorker] Processing task:', task.id);
      void this.processTask(task);
    } catch (error) {
      console.error('[AgentTaskWorker] Poll error:', error);
    }
  }

  // -----------------------------------------------------------------------
  // Private — Task Processing
  // -----------------------------------------------------------------------

  /** 处理单个任务的完整生命周期。 */
  private async processTask(task: AgentTask): Promise<void> {
    const abortController = new AbortController();
    this.activeTasks.set(task.id, abortController);

    let session: AgentSessionStateMachine | null = null;

    try {
      // 1. 创建 Agent 会话
      const sessionRow = sessionDao.createSession(
        this.db,
        task.conversationId,
        task.id,
        task.userId,
      );
      session = new AgentSessionStateMachine(
        this.db,
        sessionRow.id,
        'created',
      );

      // 2. 创建文件快照（记录操作前文件状态，用于回滚）
      this.createFileSnapshot(session.getSessionId(), task.userId);

      // 3. 状态 created -> queued -> running
      session.transition('queued');
      session.transition('running');

      // 4. 读取 AI 配置与 consent
      const row = getAiConfig(task.userId);
      const config: IAIConfig = row ? toIAIConfig(row) : DEFAULT_AI_CONFIG;
      const consent: IAIConsent = row ? toIAIConsent(row) : DEFAULT_CONSENT;

      // 5. 合并 KB 设置
      const kbDefaults = { topK: 5, fuse: 0.5, threshold: 0.6, pinnedWeight: 1.5 };
      const persisted = row
        ? normalizeKbSettings({
            topK: row.kbTopK,
            fuse: row.kbFuse,
            threshold: row.kbThreshold,
            pinnedWeight: row.kbPinnedWeight,
          })
        : kbDefaults;

      // 6. 构造合成 event shim（runAgentFlow 仅用 event.sender 获取 BrowserWindow）
      const mainWindow = this.mainWindow;
      const syntheticEvent = {
        sender: mainWindow?.webContents ?? ({
          send: () => {},
          isDestroyed: () => true,
        } as unknown as Electron.WebContents),
      } as Electron.IpcMainInvokeEvent;

      // 7. 执行 Agent 流程
      const result: AgentRunResult = await runAgentFlow(
        syntheticEvent,
        {
          userId: task.userId,
          conversationId: task.conversationId,
          message: task.message,
        },
        config,
        row?.apiKeyEnc ?? null,
        abortController,
        {
          searchKb: (u: string, q: string) =>
            searchKB(u, q, {
              topK: persisted.topK,
              fuse: persisted.fuse,
              pinnedWeight: persisted.pinnedWeight,
              threshold: persisted.threshold,
            }),
          consent,
          db: this.db,
        },
      );

      // 8. 更新任务状态为 completed
      this.queue.updateStatus(task.id, 'completed');
      session.transition('completed');

      // 9. 推送完成事件
      this.sendEvent(task.conversationId, IPC_CHANNELS.AI_STREAM_DONE, {
        conversationId: task.conversationId,
        taskId: task.id,
        sessionId: session.getSessionId(),
        success: true,
        result,
      });
    } catch (error) {
      // AbortError：任务被取消
      if (abortController.signal.aborted) {
        console.log('[AgentTaskWorker] Task cancelled:', task.id);
        if (session && session.canTransitionTo('cancelled')) {
          session.transition('cancelled');
        }
        return;
      }

      console.error('[AgentTaskWorker] Task failed:', task.id, error);

      // 更新任务为 failed
      const code: AIErrorCode =
        ((error as { code?: string }).code as AIErrorCode) ?? 'network';
      const message = error instanceof Error ? error.message : String(error);
      this.queue.updateStatus(task.id, 'failed', code, message);

      // 更新会话为 failed
      if (session && session.canTransitionTo('failed')) {
        session.transition('failed');
      }

      // 推送错误事件
      this.sendEvent(task.conversationId, IPC_CHANNELS.AI_STREAM_ERROR, {
        conversationId: task.conversationId,
        taskId: task.id,
        code,
        message,
      });
    } finally {
      this.activeTasks.delete(task.id);
      // 触发下一次轮询（可能有等待中的任务）
      void this.poll();
    }
  }

  // -----------------------------------------------------------------------
  // Private — Snapshot
  // -----------------------------------------------------------------------

  /**
   * 创建文件快照：记录当前用户的文件树结构到 session.snapshot_json。
   * 快照仅记录目录树骨架（文件路径+类型），不备份文件内容——
   * Agent 工具全部只读，无需内容级回滚。
   */
  private createFileSnapshot(sessionId: string, userId: string): void {
    try {
      // 查询用户文件列表（轻量骨架快照）
      const files = this.db
        .prepare(
          `SELECT id, name, path, type, parent_id
           FROM files WHERE user_id = ?`,
        )
        .all(userId) as Array<{
        id: string;
        name: string;
        path: string;
        type: string;
        parent_id: string | null;
      }>;

      const snapshot = JSON.stringify({
        capturedAt: new Date().toISOString(),
        fileCount: files.length,
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          path: f.path,
          type: f.type,
          parentId: f.parent_id,
        })),
      });

      sessionDao.saveSnapshot(this.db, sessionId, snapshot);
    } catch (err) {
      // 快照失败不阻塞任务执行
      console.warn('[AgentTaskWorker] Snapshot creation failed:', err);
    }
  }

  // -----------------------------------------------------------------------
  // Private — Event Delivery
  // -----------------------------------------------------------------------

  /** 向渲染进程推送 IPC 事件（无 mainWindow 时静默丢弃）。 */
  private sendEvent(
    conversationId: string,
    channel: string,
    payload: unknown,
  ): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send(channel, {
          ...(typeof payload === 'object' && payload !== null ? payload : {}),
          conversationId,
        });
      } catch (err) {
        console.warn('[AgentTaskWorker] sendEvent failed:', err);
      }
    }
  }
}

export default AgentTaskWorker;

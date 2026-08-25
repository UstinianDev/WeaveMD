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
  IClarifyQuestion,
} from '@shared/ai';
import { normalizeKbSettings } from '@shared/ai';
import { IPC_CHANNELS } from '@shared/constants';
import { getAiConfig } from '../db/ai';
import * as sessionDao from '../db/agentSessionDao';
import { AgentTaskQueue } from './agentTaskQueue';
import { AgentSessionStateMachine } from './agentSession';
import { runAgentFlow } from './agentLoop';
import { searchKB } from './kbSearch';
import { persistAndSend } from './agentEventStore';
import { createSnapshot } from './agentSnapshot';
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
  /** conversationId -> taskId 映射，用于按会话取消任务。 */
  private conversationTaskMap: Map<string, string> = new Map();
  private mainWindow: BrowserWindow | null = null;

  /** R3: 暂停等待用户交互的 Promise 控制器（sessionId -> resolve/reject + session）。 */
  private pendingInteractions: Map<
    string,
    {
      resolve: (answers: Record<string, string>) => void;
      reject: (err: Error) => void;
      session: AgentSessionStateMachine;
    }
  > = new Map();

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

  /** 取消特定任务（同时 reject 挂起的交互等待）。 */
  cancelTask(taskId: string): void {
    const controller = this.activeTasks.get(taskId);
    if (controller) {
      // R3: reject 挂起的交互等待（如有）
      for (const [sid, pending] of this.pendingInteractions) {
        // 通过 AbortController abort 触发 agentLoop catch，pending resolve 不再需要
        // 但为安全起见也 reject
        pending.reject(new Error('Task cancelled'));
        this.pendingInteractions.delete(sid);
      }
      controller.abort();
      this.activeTasks.delete(taskId);
      this.queue.updateStatus(taskId, 'cancelled');
    }
  }

  /** 按 conversationId 取消活跃任务（供 AGENT_ABORT IPC 使用）。 */
  cancelByConversationId(conversationId: string): boolean {
    const taskId = this.conversationTaskMap.get(conversationId);
    if (!taskId) return false;
    this.cancelTask(taskId);
    return true;
  }

  /** 获取当前活跃任务数。 */
  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  /** 检查指定任务是否正在执行。 */
  isTaskActive(taskId: string): boolean {
    return this.activeTasks.has(taskId);
  }

  /** R3: 恢复暂停的交互——用户提交答案后调用。 */
  resumeInteraction(sessionId: string, answers: Record<string, string>): void {
    const pending = this.pendingInteractions.get(sessionId);
    if (!pending) return;
    this.pendingInteractions.delete(sessionId);
    // 转换会话状态 waiting_interaction -> running
    if (pending.session.canTransitionTo('running')) {
      pending.session.transition('running');
    }
    pending.resolve(answers);
  }

  /** 检查指定会话是否有挂起的交互等待。 */
  hasPendingInteraction(sessionId: string): boolean {
    return this.pendingInteractions.has(sessionId);
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
    this.conversationTaskMap.set(task.conversationId, task.id);

    let session: AgentSessionStateMachine | null = null;
    const mainWindow = this.mainWindow;

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
      const sessionId = session.getSessionId();

      // 2. 创建文件快照（备份用户所有 .md 文件内容，用于回滚）
      await createSnapshot(this.db, sessionId, task.userId);

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
      const syntheticEvent = {
        sender: mainWindow?.webContents ?? ({
          send: () => {},
          isDestroyed: () => true,
        } as unknown as Electron.WebContents),
      } as Electron.IpcMainInvokeEvent;

      // 6.5. 解析 payloadJson 中的额外字段（currentDocument / useKnowledgeBase 等）
      let currentDocument: string | undefined;
      let useKnowledgeBase: boolean | undefined;
      try {
        if (task.payloadJson) {
          const extra = JSON.parse(task.payloadJson) as Record<string, unknown>;
          if (typeof extra.currentDocument === 'string') currentDocument = extra.currentDocument;
          if (typeof extra.useKnowledgeBase === 'boolean') useKnowledgeBase = extra.useKnowledgeBase;
        }
      } catch {
        /* payloadJson 解析失败不阻断主流程 */
      }

      // 7. 执行 Agent 流程（传入 sessionId + mainWindow 以启用持久化事件推送）
      const result: AgentRunResult = await runAgentFlow(
        syntheticEvent,
        {
          userId: task.userId,
          conversationId: task.conversationId,
          message: task.message,
          currentDocument,
          useKnowledgeBase,
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
          sessionId,
          mainWindow: mainWindow ?? undefined,
          // R3: ask_question_card 暂停/恢复回调
          onInteractionRequired: (questions: IClarifyQuestion[]) => {
            // 转换会话状态 running -> waiting_interaction
            if (session && session.canTransitionTo('waiting_interaction')) {
              session.transition('waiting_interaction');
            }
            // 推送问题卡片到渲染进程
            if (mainWindow && !mainWindow.isDestroyed()) {
              persistAndSend(
                this.db,
                mainWindow,
                sessionId,
                task.conversationId,
                IPC_CHANNELS.AGENT_INTERACTION_QUESTION,
                { sessionId, conversationId: task.conversationId, questions },
              );
            }
          },
          waitForInteraction: () =>
            new Promise<Record<string, string>>((resolve, reject) => {
              this.pendingInteractions.set(sessionId, { resolve, reject, session: session! });
            }),
        },
      );

      // 8. 更新任务状态为 completed
      this.queue.updateStatus(task.id, 'completed');
      session.transition('completed');

      // 9. 推送完成事件（持久化 + IPC）
      if (mainWindow && !mainWindow.isDestroyed()) {
        persistAndSend(
          this.db,
          mainWindow,
          sessionId,
          task.conversationId,
          IPC_CHANNELS.AI_STREAM_DONE,
          {
            conversationId: task.conversationId,
            taskId: task.id,
            sessionId,
            success: true,
            result,
          },
        );
      }
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

      // 推送错误事件（持久化 + IPC）
      if (mainWindow && !mainWindow.isDestroyed()) {
        persistAndSend(
          this.db,
          mainWindow,
          session?.getSessionId() ?? '',
          task.conversationId,
          IPC_CHANNELS.AI_STREAM_ERROR,
          {
            conversationId: task.conversationId,
            taskId: task.id,
            code,
            message,
          },
        );
      }
    } finally {
      // R3: 清理该会话可能残留的交互等待（任务结束时）
      if (session) {
        const sid = session.getSessionId();
        const lingering = this.pendingInteractions.get(sid);
        if (lingering) {
          lingering.reject(new Error('Task ended'));
          this.pendingInteractions.delete(sid);
        }
      }
      this.activeTasks.delete(task.id);
      this.conversationTaskMap.delete(task.conversationId);
      // 触发下一次轮询（可能有等待中的任务）
      void this.poll();
    }
  }

}

export default AgentTaskWorker;

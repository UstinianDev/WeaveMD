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
  IAttachmentMeta,
  IClarifyQuestion,
  IKbSettings,
  ModelProtocol,
} from '@shared/ai';
import { normalizeKbSettings } from '@shared/ai';
import { IPC_CHANNELS } from '@shared/constants';
import { getAiConfig, getRecentMessagesByRounds } from '../../db/ai';
import * as sessionDao from '../../db/agentSessionDao';
import { AgentTaskQueue } from './agentTaskQueue';
import { AgentSessionStateMachine } from './agentSession';
import { runAgentFlow } from './agentLoop';
import { searchKB, filterKbEgressResults } from '../knowledge/kbSearch';
import { getGrantedAttachmentDocIds } from '../../db/kb';
import { persistAndSend, persistOnly } from './agentEventStore';
import { createSnapshot } from './agentSnapshot';
import {
  isMemoryExtractTask,
  maybeEnqueueMemoryExtraction,
  runMemoryExtractionJob,
  MEMORY_EXTRACT_TIMEOUT_MS,
  type MemoryLlmCall,
  type MemoryRoundMessage,
} from './memoryWriter';
import { streamChatCompletionWithRetry } from '../llm/llmClient';
import { streamAnthropicCompletion } from '../llm/anthropicClient';
import { decryptApiKey } from '../secureConfig';
import {
  toIAIConfig,
  toIAIConsent,
  DEFAULT_AI_CONFIG,
  DEFAULT_CONSENT,
} from '../ipc/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerConfig {
  /** 轮询间隔（毫秒），默认 1000。 */
  pollIntervalMs?: number;
  /** 最大并发任务数，默认 1。 */
  maxConcurrent?: number;
}

/**
 * 后台记忆提取的对话读取（C2）：走既有轮窗口 DAO（最近 N 轮，与 KEEP_RECENT_ROUNDS 同口径）。
 * 只回传 user / assistant 正文 —— 后台提取不进主上下文，且工具结果不是记忆来源。
 * 空正文行被过滤，避免把纯工具轮拼进提示词。
 */
function readRecentRoundsForExtraction(
  conversationId: string,
  userId: string,
  rounds: number
): MemoryRoundMessage[] {
  return getRecentMessagesByRounds(conversationId, userId, rounds)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content as string }));
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
    // C2：后台记忆提取任务复用同一队列，但不走 runAgentFlow
    if (isMemoryExtractTask(task)) {
      await this.processMemoryTask(task);
      return;
    }

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

      // 5. 构造合成 event shim（runAgentFlow 仅用 event.sender 获取 BrowserWindow）
      const syntheticEvent = {
        sender: mainWindow?.webContents ?? ({
          send: () => {},
          isDestroyed: () => true,
        } as unknown as Electron.WebContents),
      } as Electron.IpcMainInvokeEvent;

      // 6. 解析 payloadJson 中的额外字段
      const { currentDocument, currentFileRef, useKnowledgeBase, fileTreePaths, kbSettings, attachments } =
        this.readTaskPayload(task);

      // 7. 构造 AgentLoopDeps（KB 检索设置在其中合并：payload 显式 > 持久化 > 默认）
      const deps = this.buildAgentDeps(
        session, sessionId, task, row, kbSettings, consent, mainWindow
      );

      // 8. 执行 Agent 流程（传入 sessionId + mainWindow 以启用持久化事件推送）
      const result: AgentRunResult = await runAgentFlow(
        syntheticEvent,
        {
          userId: task.userId,
          conversationId: task.conversationId,
          message: task.message,
          currentDocument,
          ...(currentFileRef ? { currentFileRef } : {}),
          useKnowledgeBase,
          fileTreePaths,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        },
        config,
        row?.apiKeyEnc ?? null,
        abortController,
        deps,
      );

      // 9. 成功后续处理
      this.handleTaskSuccess(task, session, sessionId, mainWindow, result);
    } catch (error) {
      // AbortError：任务被取消
      if (abortController.signal.aborted) {
        console.log('[AgentTaskWorker] Task cancelled:', task.id);
        if (session && session.canTransitionTo('cancelled')) {
          session.transition('cancelled');
        }
        return;
      }

      // 错误处理
      this.handleTaskError(task, session, mainWindow, error);
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

      // 清理 AbortController 的所有事件监听器
      try {
        abortController.abort(); // 确保 abort 状态被设置
      } catch {
        // 忽略已经 abort 的情况
      }

      // 触发下一次轮询（可能有等待中的任务）
      void this.poll();
    }
  }

  /**
   * 处理后台记忆提取任务（C2）。
   * 复用同一队列与同一个并发闸，但完全独立于 runAgentFlow：
   * - 所有异常在 runMemoryExtractionJob 内收敛 → 落 failed 不重试、不 reject（Q9）；
   * - 这里再兜一层 catch，保证 worker 自身永不因记忆提取而抛出（不阻塞用户下一轮提问）；
   * - 不写 conversationTaskMap：记忆提取不该被 AGENT_ABORT 当作当前会话的作答任务取消。
   */
  private async processMemoryTask(task: AgentTask): Promise<void> {
    const abortController = new AbortController();
    this.activeTasks.set(task.id, abortController);

    try {
      await runMemoryExtractionJob(
        {
          db: this.db,
          llm: this.buildMemoryLlm(task.userId, abortController.signal),
          readRounds: readRecentRoundsForExtraction,
        },
        { conversationId: task.conversationId, userId: task.userId },
        (status, errorCode, errorMessage) => {
          this.queue.updateStatus(task.id, status, errorCode, errorMessage);
        },
      );
    } catch (error) {
      // 兜底：runMemoryExtractionJob 承诺不抛，这里仍落 failed 且只记日志
      const message = error instanceof Error ? error.message : String(error);
      console.error('[AgentTaskWorker] Memory extraction crashed:', task.id, error);
      try {
        this.queue.updateStatus(task.id, 'failed', 'memory_extract', message);
      } catch (statusError) {
        console.error('[AgentTaskWorker] Failed to mark memory task failed:', statusError);
      }
    } finally {
      this.activeTasks.delete(task.id);
      abortController.abort();
      void this.poll();
    }
  }

  /**
   * 构造后台记忆提取的 LLM 调用（按配置协议分流，非流式累积为整段文本）。
   * 任何缺配置/解密失败都会让返回的函数抛错 → 由 runMemoryExtractionJob 落 failed。
   */
  private buildMemoryLlm(userId: string, signal: AbortSignal): MemoryLlmCall {
    let baseUrl = '';
    let model = '';
    let apiKey: string | null = null;
    let protocol: ModelProtocol = 'openai';
    try {
      const row = getAiConfig(userId);
      if (!row) throw new Error('未配置 AI 模型（ai_config 为空）');
      baseUrl = row.remoteBaseUrl;
      model = row.model;
      protocol = row.protocol ?? 'openai';
      apiKey = row.apiKeyEnc ? decryptApiKey(row.apiKeyEnc) : null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`memory_extract: 读取 AI 配置失败 → ${reason}`);
    }

    return async (messages) => {
      const opts = {
        baseUrl,
        model,
        apiKey: apiKey ?? undefined,
        messages,
        timeoutMs: MEMORY_EXTRACT_TIMEOUT_MS,
        signal,
      };
      const gen =
        protocol === 'anthropic' ? streamAnthropicCompletion(opts) : streamChatCompletionWithRetry(opts);
      let acc = '';
      for await (const chunk of gen) {
        acc += chunk.delta;
      }
      return acc;
    };
  }

  // -----------------------------------------------------------------------
  // Private — Task Helpers
  // -----------------------------------------------------------------------

  /** 解析 payloadJson 中的额外字段（currentDocument / currentFileRef / useKnowledgeBase / fileTreePaths / kbSettings / attachments）。 */
  private readTaskPayload(task: AgentTask): {
    currentDocument: string | undefined;
    currentFileRef: { name: string; path: string } | undefined;
    useKnowledgeBase: boolean | undefined;
    fileTreePaths: { files: string[]; folders: string[] } | undefined;
    kbSettings: Partial<IKbSettings> | undefined;
    attachments: IAttachmentMeta[] | undefined;
  } {
    let currentDocument: string | undefined;
    let currentFileRef: { name: string; path: string } | undefined;
    let useKnowledgeBase: boolean | undefined;
    let fileTreePaths: { files: string[]; folders: string[] } | undefined;
    let kbSettings: Partial<IKbSettings> | undefined;
    let attachments: IAttachmentMeta[] | undefined;
    try {
      if (task.payloadJson) {
        const extra = JSON.parse(task.payloadJson) as Record<string, unknown>;
        if (typeof extra.currentDocument === 'string') currentDocument = extra.currentDocument;
        // B9 三-1②：文件引用白名单校验（渲染层只回传 name/path 两个字符串字段）
        if (extra.currentFileRef && typeof extra.currentFileRef === 'object') {
          const ref = extra.currentFileRef as Record<string, unknown>;
          if (typeof ref.name === 'string' && typeof ref.path === 'string' && ref.path) {
            currentFileRef = { name: ref.name, path: ref.path };
          }
        }
        if (typeof extra.useKnowledgeBase === 'boolean') useKnowledgeBase = extra.useKnowledgeBase;
        if (extra.kbSettings && typeof extra.kbSettings === 'object') {
          kbSettings = extra.kbSettings as Partial<IKbSettings>;
        }
        if (extra.fileTreePaths && typeof extra.fileTreePaths === 'object') {
          const ftp = extra.fileTreePaths as Record<string, unknown>;
          if (Array.isArray(ftp.files) && Array.isArray(ftp.folders)) {
            fileTreePaths = {
              files: ftp.files.filter((f): f is string => typeof f === 'string'),
              folders: ftp.folders.filter((f): f is string => typeof f === 'string'),
            };
          }
        }
        // 附件元数据（B3 一-4：AGENT_RUN 已落库，此处仅透传给 appendMessage）
        if (Array.isArray(extra.attachments)) {
          attachments = extra.attachments.filter(
            (a): a is IAttachmentMeta =>
              !!a &&
              typeof a === 'object' &&
              typeof (a as IAttachmentMeta).id === 'string' &&
              typeof (a as IAttachmentMeta).name === 'string' &&
              ((a as IAttachmentMeta).type === 'file' || (a as IAttachmentMeta).type === 'image')
          );
        }
      }
    } catch {
      /* payloadJson 解析失败不阻断主流程 */
    }
    return { currentDocument, currentFileRef, useKnowledgeBase, fileTreePaths, kbSettings, attachments };
  }

  /** 构造 AgentLoopDeps（含 searchKb + consent + 交互回调）。 */
  private buildAgentDeps(
    session: AgentSessionStateMachine,
    sessionId: string,
    task: AgentTask,
    row: ReturnType<typeof getAiConfig>,
    kbSettings: Partial<IKbSettings> | undefined,
    consent: IAIConsent,
    mainWindow: BrowserWindow | null,
  ): import('./agentLoop').AgentLoopDeps {
    // KB 检索设置合并：payload 显式 > 持久化配置 > 默认值（normalizeKbSettings 统一兜底）
    const persisted = normalizeKbSettings({
      topK: kbSettings?.topK ?? row?.kbTopK,
      fuse: kbSettings?.fuse ?? row?.kbFuse,
      threshold: kbSettings?.threshold ?? row?.kbThreshold,
      pinnedWeight: kbSettings?.pinnedWeight ?? row?.kbPinnedWeight,
    });
    return {
      searchKb: async (u: string, q: string, opts?: { topK?: number; queryVector?: number[]; searchMode?: 'fts5' | 'vector' | 'hybrid'; expandedQueries?: string[] }) => {
        const res = await searchKB(u, q, {
          topK: opts?.topK ?? persisted.topK,
          fuse: persisted.fuse,
          pinnedWeight: persisted.pinnedWeight,
          threshold: persisted.threshold,
          queryVector: opts?.queryVector,
          searchMode: opts?.searchMode,
          // P0-6 双路召回：原 query 必须透传，否则改写后的双路融合被静默丢弃
          expandedQueries: opts?.expandedQueries,
        });
        // B11 八-1②：allowSend=false → 外发结果过滤到仅勾选授权附件（fail-closed）。
        // 这是 searchKB 结果走向 LLM 的唯一出口（preloader/citation 均继承此闭包）。
        if (consent.allowSend) return res;
        try {
          return filterKbEgressResults(res, false, getGrantedAttachmentDocIds(u));
        } catch {
          // 授权集合查询失败 → 空白名单兜底（笔记与未授权附件全滤，不放宽 allowSend）
          return filterKbEgressResults(res, false, new Set());
        }
      },
      consent,
      db: this.db,
      sessionId,
      mainWindow: mainWindow ?? undefined,
      // R3: ask_question_card 暂停/恢复回调
      // R5: variant 用于区分 delete_confirm 等特殊确认卡片样式
      onInteractionRequired: (questions: IClarifyQuestion[], variant?: string, round?: number, totalRounds?: number) => {
        // 转换会话状态 running -> waiting_interaction
        if (session && session.canTransitionTo('waiting_interaction')) {
          session.transition('waiting_interaction');
        }
        // 推送问题卡片到渲染进程
        if (mainWindow && !mainWindow.isDestroyed()) {
          const interactionPayload = { sessionId, conversationId: task.conversationId, questions, variant, round, totalRounds };
          try {
            persistOnly(this.db, sessionId, task.conversationId, 'interaction', interactionPayload);
          } catch {
            /* 持久化失败不阻断主流程 */
          }
          mainWindow.webContents.send(
            IPC_CHANNELS.AGENT_INTERACTION_QUESTION,
            interactionPayload,
          );
        }
      },
      waitForInteraction: () =>
        new Promise<Record<string, string>>((resolve, reject) => {
          this.pendingInteractions.set(sessionId, { resolve, reject, session: session! });
        }),
    };
  }

  /** 任务成功后续处理：更新状态 + 推送完成事件。 */
  private handleTaskSuccess(
    task: AgentTask,
    session: AgentSessionStateMachine,
    sessionId: string,
    mainWindow: BrowserWindow | null,
    result: AgentRunResult,
  ): void {
    this.queue.updateStatus(task.id, 'completed');
    session.transition('completed');

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

      // C2：AI_STREAM_DONE 之后入队后台记忆提取。
      // maybeEnqueueMemoryExtraction 自身同步快速返回并吞掉全部异常（节流 + 同会话 pending
      // 去重 + 入队，绝不在此调 LLM），因此这里无需再包一层 try/catch，不会影响完成事件。
      maybeEnqueueMemoryExtraction(
        { queue: this.queue },
        { conversationId: task.conversationId, userId: task.userId },
      );
    }
  }

  /** 任务错误处理：更新状态 + 推送错误事件。 */
  private handleTaskError(
    task: AgentTask,
    session: AgentSessionStateMachine | null,
    mainWindow: BrowserWindow | null,
    error: unknown,
  ): void {
    console.error('[AgentTaskWorker] Task failed:', task.id, error);

    const code: AIErrorCode =
      ((error as { code?: string }).code as AIErrorCode) ?? 'network';
    const message = error instanceof Error ? error.message : String(error);
    this.queue.updateStatus(task.id, 'failed', code, message);

    if (session && session.canTransitionTo('failed')) {
      session.transition('failed');
    }

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
  }
}

export default AgentTaskWorker;

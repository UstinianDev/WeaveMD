// ============================================
// Agent IPC Handlers
// ============================================

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { IPC_CHANNELS } from '@shared/constants';
import type { AIErrorCode, AgentRunPayload } from '@shared/ai';
import { normalizeKbSettings } from '@shared/ai';
import { getAiConfig, getConversation } from '../../db/ai';
import { runAgentFlow } from '../agent/agentLoop';
import { searchKB } from '../knowledge/kbSearch';
import { listSkillsForUi, loadUserSkillsFromDirs } from '../skills/skillLoader';
import { AgentTaskQueue } from '../agent/agentTaskQueue';
import { AgentTaskWorker } from '../agent/agentTaskWorker';
import { replayFromSeq } from '../agent/agentEventStore';
import { rollbackToSnapshot } from '../agent/agentSnapshot';
import { getGlobalAgentFiles, setGlobalAgentFiles, getDefaultAgentFileContent } from '../files/globalAgentFiles';
import { activeStreams, DEFAULT_AI_CONFIG, DEFAULT_CONSENT, toIAIConfig, toIAIConsent } from './shared';

/** 内置 skills 名称列表（不暴露给 UI，仅 agent 内部使用）。 */
const BUILTIN_SKILL_NAMES = new Set(['polish_rewrite', 'tech_organize', 'kb_qa_guide']);

/** 5a: AGENT_SKILLS_LIST 30s TTL 缓存（避免高频调用重复扫描 5 个目录）。 */
interface SkillsCacheEntry {
  data: Array<{ name: string; description: string }>;
  timestamp: number;
}
let skillsCache: SkillsCacheEntry | null = null;
const SKILLS_CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Task Queue / Worker 单例
// ---------------------------------------------------------------------------

let taskQueue: AgentTaskQueue | null = null;
let taskWorker: AgentTaskWorker | null = null;
let dbRef: BetterSqlite3Database | null = null;
let mainWindowRef: BrowserWindow | null = null;

/** 初始化 Agent 任务队列与 Worker（主进程启动时调用）。 */
export function initAgentQueue(db: BetterSqlite3Database, mainWindow: BrowserWindow): void {
  dbRef = db;
  mainWindowRef = mainWindow;
  taskQueue = new AgentTaskQueue(db);
  taskWorker = new AgentTaskWorker(db, taskQueue);
  taskWorker.setMainWindow(mainWindow);
  taskWorker.start();
  console.log('[AgentHandlers] Agent task queue initialized');
}

/** 清理 Agent 任务队列与 Worker（应用退出时调用）。 */
export function cleanupAgentQueue(): void {
  if (taskWorker) {
    taskWorker.stop();
    taskWorker = null;
  }
  taskQueue = null;
  console.log('[AgentHandlers] Agent task queue cleaned up');
}

// ---------------------------------------------------------------------------
// Handler Registration
// ---------------------------------------------------------------------------

export function registerAgentHandlers(): void {
  // --- agent: run (异步入队，立即返回 taskId) ---
  ipcMain.handle(IPC_CHANNELS.AGENT_RUN, async (event, payload: AgentRunPayload) => {
    if (!taskQueue) {
      return { success: false, code: 'network' as AIErrorCode, message: 'Agent queue not initialized' };
    }

    const { userId, conversationId } = payload;

    const row = getAiConfig(userId);

    // 会话存在性校验
    if (conversationId && !getConversation(conversationId, userId)) {
      return { success: false, code: 'not_found' as AIErrorCode, message: 'Conversation not found' };
    }

    try {
      // 合并 payload 中的额外字段为 payloadJson
      const extra: Record<string, unknown> = {};
      if (payload.mode) extra.mode = payload.mode;
      if (payload.useKnowledgeBase !== undefined) extra.useKnowledgeBase = payload.useKnowledgeBase;
      if (payload.kbSettings) extra.kbSettings = payload.kbSettings;
      if (payload.currentDocument) extra.currentDocument = payload.currentDocument;
      if (payload.fileTreePaths) extra.fileTreePaths = payload.fileTreePaths;

      const task = taskQueue.enqueue({
        conversationId: conversationId ?? '',
        userId,
        message: payload.message,
        payloadJson: JSON.stringify(extra),
      });

      // 立即返回任务 ID，实际结果通过 SSE 推送
      return {
        success: true,
        data: {
          taskId: task.id,
          status: 'queued' as const,
        },
      };
    } catch (err) {
      const code = ((err as { code?: string })?.code ?? 'network') as AIErrorCode;
      return { success: false, code, message: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- agent: abort (复用 activeStreams + 归属校验) ---
  ipcMain.handle(
    IPC_CHANNELS.AGENT_ABORT,
    (_event, conversationId: string, userId: string) => {
      if (!getConversation(conversationId, userId)) {
        return {
          success: false,
          message: 'Conversation not found',
          data: { aborted: false },
        };
      }
      const controller = activeStreams.get(conversationId);
      if (controller) {
        controller.abort();
        activeStreams.delete(conversationId);
      }
      // 同时尝试取消队列中的 pending 任务
      if (taskQueue) {
        taskQueue.cancelPending(conversationId);
      }
      // 桥接：通过 taskWorker 取消运行中的 Agent 任务
      let taskAborted = false;
      if (taskWorker) {
        taskAborted = taskWorker.cancelByConversationId(conversationId);
      }
      return { success: true, data: { aborted: !!controller || taskAborted } };
    }
  );

  // --- agent: task status（查询任务状态） ---
  ipcMain.handle(IPC_CHANNELS.AGENT_TASK_STATUS, (_event, taskId: string) => {
    if (!taskQueue) {
      return { success: false, message: 'Agent queue not initialized' };
    }
    if (!taskId || typeof taskId !== 'string') {
      return { success: false, message: 'taskId required' };
    }
    const task = taskQueue.getTask(taskId);
    if (!task) {
      return { success: false, message: 'Task not found' };
    }
    return { success: true, data: task };
  });

  // --- agent: task cancel（取消任务） ---
  ipcMain.handle(IPC_CHANNELS.AGENT_TASK_CANCEL, (_event, taskId: string) => {
    if (!taskWorker) {
      return { success: false, message: 'Agent worker not initialized' };
    }
    if (!taskId || typeof taskId !== 'string') {
      return { success: false, message: 'taskId required' };
    }
    taskWorker.cancelTask(taskId);
    return { success: true, data: { cancelled: true } };
  });

  // --- agent: replay events（写控制模块：断线重连回放） ---
  ipcMain.handle(
    IPC_CHANNELS.AGENT_REPLAY_EVENTS,
    (_event, sessionId: string, lastSeq: number) => {
      if (!dbRef || !mainWindowRef) {
        return { success: false, message: 'Agent handlers not initialized' };
      }
      if (!sessionId || typeof sessionId !== 'string') {
        return { success: false, message: 'sessionId required' };
      }
      if (typeof lastSeq !== 'number' || lastSeq < 0) {
        return { success: false, message: 'lastSeq must be a non-negative number' };
      }
      try {
        const events = replayFromSeq(dbRef, mainWindowRef, sessionId, lastSeq);
        return { success: true, data: events };
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // --- agent: rollback snapshot（写控制模块：回滚到会话快照） ---
  ipcMain.handle(
    IPC_CHANNELS.AGENT_ROLLBACK_SNAPSHOT,
    async (_event, sessionId: string, userId: string) => {
      if (!dbRef) {
        return { success: false, message: 'Agent handlers not initialized' };
      }
      if (!sessionId || typeof sessionId !== 'string') {
        return { success: false, message: 'sessionId required' };
      }
      if (!userId || typeof userId !== 'string') {
        return { success: false, message: 'userId required' };
      }
      try {
        const result = await rollbackToSnapshot(dbRef, sessionId, userId);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // --- agent: resume interaction（R3：用户提交 ask_question_card 答案后恢复任务） ---
  ipcMain.handle(
    IPC_CHANNELS.AGENT_RESUME_INTERACTION,
    (_event, payload: { sessionId: string; answers: Record<string, string> }) => {
      if (!taskWorker) {
        return { success: false, message: 'Agent worker not initialized' };
      }
      if (!payload?.sessionId || typeof payload.sessionId !== 'string') {
        return { success: false, message: 'sessionId required' };
      }
      if (!payload?.answers || typeof payload.answers !== 'object') {
        return { success: false, message: 'answers required' };
      }
      try {
        taskWorker.resumeInteraction(payload.sessionId, payload.answers);
        return { success: true, data: { resumed: true } };
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // --- agent: retry task（R4：重试失败任务） ---
  ipcMain.handle(
    IPC_CHANNELS.AGENT_RETRY_TASK,
    (_event, taskId: string) => {
      if (!taskQueue) {
        return { success: false, message: 'Agent queue not initialized' };
      }
      if (!taskId || typeof taskId !== 'string') {
        return { success: false, message: 'taskId required' };
      }
      try {
        const task = taskQueue.getTask(taskId);
        if (!task) {
          return { success: false, message: 'Task not found' };
        }
        if (task.status !== 'failed') {
          return { success: false, message: 'Only failed tasks can be retried' };
        }
        // 重新入队：创建新任务，复用原 conversationId + message
        const newTask = taskQueue.enqueue({
          conversationId: task.conversationId,
          userId: task.userId,
          message: task.message,
          payloadJson: task.payloadJson,
        });
        return { success: true, data: { taskId: newTask.id, status: 'queued' } };
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // --- agent: skills list（第 7 期 B1：渲染侧 / 补全菜单技能清单，只读 IPC) ---
  ipcMain.handle(
    IPC_CHANNELS.AGENT_SKILLS_LIST,
    (_event, payload: { userId: string }) => {
      if (!payload || typeof payload.userId !== 'string' || !payload.userId) {
        return { success: false, message: 'userId required' };
      }
      try {
        // 5a: 检查缓存（30s TTL）
        if (skillsCache && Date.now() - skillsCache.timestamp < SKILLS_CACHE_TTL_MS) {
          return { success: true, data: skillsCache.data };
        }
        // 扫描多个目录下的用户自定义 skills（支持子目录+SKILL.md 和扁平.md 两种格式）
        const homeDir = app.getPath('home');
        const userDataDir = app.getPath('userData');
        const scanDirs = [
          join(homeDir, 'skills'),
          join(homeDir, 'AI tools'),
          join(homeDir, 'AI tools', 'skills'),
          join(homeDir, '.claude', 'skills'),
          join(userDataDir, 'skills'),
        ];
        const userSkillsRaw = loadUserSkillsFromDirs(scanDirs);
        const userSkills = userSkillsRaw
          .filter((s) => !BUILTIN_SKILL_NAMES.has(s.name))
          .map((s) => ({ name: s.name, description: s.description }));
        skillsCache = { data: userSkills, timestamp: Date.now() };
        return { success: true, data: userSkills };
      } catch {
        return { success: false, message: 'Failed to list skills' };
      }
    }
  );

  // --- agent: global files get（阶段 2：读取全局 Agent 文件） ---
  ipcMain.handle(IPC_CHANNELS.AGENT_GLOBAL_FILES_GET, () => {
    try {
      const files = getGlobalAgentFiles();
      return { success: true, data: files };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- agent: global files set（阶段 2：更新全局 Agent 文件） ---
  ipcMain.handle(
    IPC_CHANNELS.AGENT_GLOBAL_FILES_SET,
    (_event, updates: { soul?: string; memory?: string; style?: string }) => {
      if (!updates || typeof updates !== 'object') {
        return { success: false, message: 'updates object required' };
      }
      try {
        const files = setGlobalAgentFiles(updates);
        return { success: true, data: files };
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // --- agent: global files default（获取单个文件的默认内容） ---
  ipcMain.handle(
    IPC_CHANNELS.AGENT_GLOBAL_FILES_DEFAULT,
    (_event, file: 'soul' | 'style' | 'memory') => {
      try {
        const content = getDefaultAgentFileContent(file);
        return { success: true, data: { content } };
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}

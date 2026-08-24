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
import { runAgentFlow } from '../agentLoop';
import { searchKB } from '../kbSearch';
import { listSkillsForUi, loadUserSkillsFromDirs } from '../skillLoader';
import { needsConsent } from '../consent';
import { AgentTaskQueue } from '../agentTaskQueue';
import { AgentTaskWorker } from '../agentTaskWorker';
import { activeStreams, DEFAULT_AI_CONFIG, DEFAULT_CONSENT, toIAIConfig, toIAIConsent } from './shared';

/** 内置 skills 名称列表（不暴露给 UI，仅 agent 内部使用）。 */
const BUILTIN_SKILL_NAMES = new Set(['polish_rewrite', 'tech_organize', 'kb_qa_guide']);

// ---------------------------------------------------------------------------
// Task Queue / Worker 单例
// ---------------------------------------------------------------------------

let taskQueue: AgentTaskQueue | null = null;
let taskWorker: AgentTaskWorker | null = null;

/** 初始化 Agent 任务队列与 Worker（主进程启动时调用）。 */
export function initAgentQueue(db: BetterSqlite3Database, mainWindow: BrowserWindow): void {
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

    // 入队前检查 consent（consent_required 必须同步返回，不能入队后再拒绝）
    const row = getAiConfig(userId);
    const config = row ? toIAIConfig(row) : DEFAULT_AI_CONFIG;
    const consent = row ? toIAIConsent(row) : DEFAULT_CONSENT;

    // consent 分层检查：联网闸 allowNetwork（远程后端必填）
    if (needsConsent(consent)) {
      return { success: false, code: 'consent_required' as AIErrorCode, message: 'Consent required' };
    }

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
      return { success: true, data: { aborted: !!controller } };
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

  // --- agent: skills list（第 7 期 B1：渲染侧 / 补全菜单技能清单，只读 IPC) ---
  ipcMain.handle(
    IPC_CHANNELS.AGENT_SKILLS_LIST,
    (_event, payload: { userId: string }) => {
      if (!payload || typeof payload.userId !== 'string' || !payload.userId) {
        return { success: false, message: 'userId required' };
      }
      try {
        // 扫描多个目录下的用户自定义 skills（支持子目录+SKILL.md 和扁平.md 两种格式）
        const homeDir = app.getPath('home');
        const scanDirs = process.platform === 'win32'
          ? [
              'C:\\AI tools',
              'C:\\AI tools\\skills',
              'C:\\skills',
              'C:\\Users\\lenovo\\skills',
              'C:\\Users\\lenovo\\AI tools',
              'C:\\Users\\lenovo\\AI tools\\skills',
              'C:\\Users\\lenovo\\.claude\\skills',
              join(homeDir, 'skills'),
              join(homeDir, 'AI tools'),
              join(homeDir, '.claude', 'skills'),
            ]
          : [
              join(homeDir, 'AI tools'),
              join(homeDir, 'AI tools', 'skills'),
              join(homeDir, 'skills'),
              join(homeDir, '.claude', 'skills'),
            ];
        const userSkillsRaw = loadUserSkillsFromDirs(scanDirs);
        const userSkills = userSkillsRaw
          .filter((s) => !BUILTIN_SKILL_NAMES.has(s.name))
          .map((s) => ({ name: s.name, description: s.description }));
        return { success: true, data: userSkills };
      } catch {
        return { success: false, message: 'Failed to list skills' };
      }
    }
  );
}

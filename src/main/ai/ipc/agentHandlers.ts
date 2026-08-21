// ============================================
// Agent IPC Handlers
// ============================================

import { app, ipcMain } from 'electron';
import { join } from 'path';
import { IPC_CHANNELS } from '@shared/constants';
import type { AIErrorCode, AgentRunPayload } from '@shared/ai';
import { normalizeKbSettings } from '@shared/ai';
import { getAiConfig, getConversation } from '../../db/ai';
import { runAgentFlow } from '../agentLoop';
import { searchKB } from '../kbSearch';
import { listSkillsForUi } from '../skillLoader';
import { needsConsent } from '../consent';
import { activeStreams, DEFAULT_AI_CONFIG, DEFAULT_CONSENT, toIAIConfig, toIAIConsent } from './shared';

export function registerAgentHandlers(): void {
  // --- agent: run (invoke + stream via runAgentFlow) ---
  ipcMain.handle(IPC_CHANNELS.AGENT_RUN, async (event, payload: AgentRunPayload) => {
    const { userId } = payload;
    const row = getAiConfig(userId);
    const config = row ? toIAIConfig(row) : DEFAULT_AI_CONFIG;
    const consent = row ? toIAIConsent(row) : DEFAULT_CONSENT;

    const controller = new AbortController();

    const run = async (): Promise<unknown> => {
      try {
        const agentPayload = {
          userId: payload.userId,
          message: payload.message,
          ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
          useKnowledgeBase: payload.useKnowledgeBase,
          ...(payload.currentDocument ? { currentDocument: payload.currentDocument } : {}),
        };
        // 合并优先级：payload 显式字段 > 持久化 DB 值 > kbSearch 内置默认
        const persisted = row
          ? normalizeKbSettings({
              topK: row.kbTopK,
              fuse: row.kbFuse,
              threshold: row.kbThreshold,
              pinnedWeight: row.kbPinnedWeight,
            })
          : {};
        const kb = { ...persisted, ...(payload.kbSettings ?? {}) };
        const result = await runAgentFlow(event, agentPayload, config, row?.apiKeyEnc ?? null, controller, {
          searchKb: (u, q, o) =>
            searchKB(u, q, {
              topK: kb.topK,
              fuse: kb.fuse,
              pinnedWeight: kb.pinnedWeight,
              threshold: kb.threshold,
            }),
          consent,
        });
        return { success: true, data: result };
      } catch (err) {
        const code = ((err as { code?: string })?.code ?? 'network') as AIErrorCode;
        return { success: false, code, message: err instanceof Error ? err.message : String(err) };
      } finally {
        activeStreams.delete(payload.conversationId ?? '');
      }
    };

    // runAgentFlow 内部以真实 convId 注册 activeStreams 于流开始；此处预注册 abort 上下文
    const convId = payload.conversationId ?? '';
    if (convId) {
      activeStreams.set(convId, controller);
    }
    const result = await run();
    if (convId) activeStreams.delete(convId);
    return result;
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
      return { success: true, data: { aborted: !!controller } };
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
        const userDataSkillsDir = join(app.getPath('userData'), 'skills');
        const skills = listSkillsForUi(userDataSkillsDir);
        return { success: true, data: skills };
      } catch (error) {
        return { success: false, message: 'Failed to list skills' };
      }
    }
  );
}

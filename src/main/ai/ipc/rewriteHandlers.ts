// ============================================
// Rewrite IPC Handlers
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { AIErrorCode, RewriteRequestPayload } from '@shared/ai';
import { getAiConfig } from '../../db/ai';
import { runRewrite } from '../rewrite';
import { DEFAULT_AI_CONFIG, DEFAULT_CONSENT, toIAIConfig, toIAIConsent } from './shared';

export function registerRewriteHandlers(): void {
  // --- rewrite: preview（第 5 期：主进程薄 LLM 代理，一次性 invoke，返回原始文本） ---
  ipcMain.handle(
    IPC_CHANNELS.AI_REWRITE_PREVIEW,
    async (event, payload: RewriteRequestPayload) => {
      const { userId } = payload;
      const row = getAiConfig(userId);
      const config = row ? toIAIConfig(row) : DEFAULT_AI_CONFIG;
      const consent = row ? toIAIConsent(row) : DEFAULT_CONSENT;

      const controller = new AbortController();
      try {
        const reply = await runRewrite(event, payload, config, row?.apiKeyEnc ?? null, controller);
        return { success: true, data: reply };
      } catch (err) {
        // 透传 llmClient 结构化错误码（parse/network/http_*/timeout/aborted/config_incomplete）
        const code = ((err as { code?: string })?.code ?? 'network') as AIErrorCode;
        return {
          success: false,
          code,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );
}

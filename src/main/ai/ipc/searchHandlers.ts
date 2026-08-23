// ============================================
// Search IPC Handlers
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { SearchProvider } from '@shared/ai';
import { search } from '../searchClient';

const VALID_PROVIDERS: SearchProvider[] = ['firecrawl', 'zhipu', 'tavily', 'exa'];

export function registerSearchHandlers(): void {
  // --- 测试搜索引擎连接 ---
  ipcMain.handle(
    IPC_CHANNELS.AI_SEARCH_TEST,
    async (
      _event,
      payload: { provider: string; apiKey: string }
    ) => {
      try {
        if (!payload?.provider || !payload?.apiKey) {
          return { success: false, message: 'provider and apiKey are required' };
        }
        if (!VALID_PROVIDERS.includes(payload.provider as SearchProvider)) {
          return { success: false, message: `Unknown provider: ${payload.provider}` };
        }
        const res = await search({
          provider: payload.provider as SearchProvider,
          apiKey: payload.apiKey,
          query: 'test query',
          maxResults: 1,
        });
        return {
          success: true,
          message: `Search OK (${res.provider}: ${res.results.length} result(s))`,
        };
      } catch (err) {
        const code = err instanceof Error && 'code' in err ? (err as Error & { code: string }).code : 'unknown';
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, message: `[${code}] ${message}` };
      }
    }
  );

  // --- 执行搜索 ---
  ipcMain.handle(
    IPC_CHANNELS.AI_SEARCH_RUN,
    async (
      _event,
      payload: { provider: string; apiKey: string; query: string; maxResults?: number }
    ) => {
      try {
        if (!payload?.provider || !payload?.apiKey) {
          return { success: false, message: 'provider and apiKey are required' };
        }
        if (!payload.query?.trim()) {
          return { success: false, message: 'query must not be empty' };
        }
        if (!VALID_PROVIDERS.includes(payload.provider as SearchProvider)) {
          return { success: false, message: `Unknown provider: ${payload.provider}` };
        }
        const res = await search({
          provider: payload.provider as SearchProvider,
          apiKey: payload.apiKey,
          query: payload.query,
          maxResults: payload.maxResults,
        });
        return { success: true, data: res };
      } catch (err) {
        const code = err instanceof Error && 'code' in err ? (err as Error & { code: string }).code : 'unknown';
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, message: `[${code}] ${message}` };
      }
    }
  );
}

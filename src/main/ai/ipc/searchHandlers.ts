// ============================================
// Search IPC Handlers
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { SearchProvider } from '@shared/ai';
import { search } from '../searchClient';
import { getSearchConfig } from '../../db/searchConfig';
import { decryptApiKey } from '../secureConfig';

const VALID_PROVIDERS: SearchProvider[] = ['firecrawl', 'zhipu', 'tavily', 'exa'];

export function registerSearchHandlers(): void {
  // --- 测试搜索引擎连接 ---
  ipcMain.handle(
    IPC_CHANNELS.AI_SEARCH_TEST,
    async (
      _event,
      payload: { provider: string; apiKey: string; userId?: string }
    ) => {
      try {
        if (!payload?.provider) {
          return { success: false, message: 'provider is required' };
        }
        if (!VALID_PROVIDERS.includes(payload.provider as SearchProvider)) {
          return { success: false, message: `Unknown provider: ${payload.provider}` };
        }
        // 如果没传 apiKey 但传了 userId，从数据库取已保存的 key
        let apiKey = payload.apiKey;
        if (!apiKey && payload.userId) {
          const saved = getSearchConfig(payload.userId);
          console.log('[searchHandlers] test: saved config:', saved ? {
            provider: saved.provider,
            firecrawlKeyEnc: saved.firecrawlKeyEnc ? `${saved.firecrawlKeyEnc.slice(0, 20)}...` : null,
            zhipuKeyEnc: saved.zhipuKeyEnc ? `${saved.zhipuKeyEnc.slice(0, 20)}...` : null,
          } : null);
          if (saved) {
            const encField = `${payload.provider}KeyEnc` as keyof typeof saved;
            const enc = saved[encField];
            console.log('[searchHandlers] test: encField=', encField, 'enc type=', typeof enc, 'enc truthy=', !!enc);
            if (typeof enc === 'string' && enc) {
              try {
                apiKey = decryptApiKey(enc);
                console.log('[searchHandlers] test: decrypted key length:', apiKey.length);
              } catch (decErr) {
                console.error('[searchHandlers] test: decrypt failed:', decErr);
              }
            }
          }
        }
        if (!apiKey) {
          console.error('[searchHandlers] test: no apiKey available. payload.apiKey=', JSON.stringify(payload.apiKey), 'userId=', payload.userId);
          return { success: false, message: 'API Key is required' };
        }
        const res = await search({
          provider: payload.provider as SearchProvider,
          apiKey,
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

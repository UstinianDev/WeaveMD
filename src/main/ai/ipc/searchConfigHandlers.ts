// ============================================
// Search Config IPC Handlers（独立配置 CRUD）
// 测试/执行通道（AI_SEARCH_TEST/RUN）由 searchHandlers.ts 注册，此处不重复。
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { ISearchConfig, SearchProvider } from '@shared/ai';
import { getSearchConfig, upsertSearchConfig } from '../../db/searchConfig';
import { encryptApiKey } from '../secureConfig';

function toISearchConfig(row: {
  enabled: boolean;
  provider: SearchProvider;
  callMode: string;
  maxResults: number;
  firecrawlKeyEnc: string | null;
  zhipuKeyEnc: string | null;
  tavilyKeyEnc: string | null;
  exaKeyEnc: string | null;
}): ISearchConfig {
  return {
    enabled: row.enabled,
    provider: row.provider,
    callMode: row.callMode,
    maxResults: row.maxResults,
    hasApiKeys: {
      firecrawl: !!row.firecrawlKeyEnc,
      zhipu: !!row.zhipuKeyEnc,
      tavily: !!row.tavilyKeyEnc,
      exa: !!row.exaKeyEnc,
    },
  };
}

export function registerSearchConfigHandlers(): void {
  // 获取搜索配置
  ipcMain.handle(
    IPC_CHANNELS.AI_SEARCH_GET_CONFIG,
    (_event, userId: string) => {
      try {
        const row = getSearchConfig(userId);
        if (!row) {
          return {
            success: true,
            data: {
              enabled: false,
              provider: 'firecrawl' as SearchProvider,
              callMode: 'scrape_and_search',
              maxResults: 10,
              hasApiKeys: {
                firecrawl: false,
                zhipu: false,
                tavily: false,
                exa: false,
              },
            },
          };
        }
        return { success: true, data: toISearchConfig(row) };
      } catch (err) {
        console.error('[searchConfigHandlers] get error:', err);
        return { success: false, message: 'Failed to get search config' };
      }
    }
  );

  // 保存搜索配置
  ipcMain.handle(
    IPC_CHANNELS.AI_SEARCH_SET_CONFIG,
    (
      _event,
      payload: {
        userId: string;
        config: {
          enabled?: boolean;
          provider?: SearchProvider;
          callMode?: string;
          maxResults?: number;
          apiKeys?: Partial<Record<SearchProvider, string>>;
        };
      }
    ) => {
      try {
        const keyUpdates: Record<string, string | null | undefined> = {};
        if (payload.config.apiKeys) {
          for (const [prov, key] of Object.entries(payload.config.apiKeys)) {
            // DAO 期望 camelCase 字段名（firecrawlKeyEnc 等）
            const propName = `${prov}KeyEnc`;
            keyUpdates[propName] = key ? encryptApiKey(key).enc : null;
            console.log(`[searchConfigHandlers] set: ${propName} =`, keyUpdates[propName] ? `${String(keyUpdates[propName]).slice(0, 20)}...` : null);
          }
        }
        const row = upsertSearchConfig(payload.userId, {
          enabled: payload.config.enabled,
          provider: payload.config.provider,
          callMode: payload.config.callMode,
          maxResults: payload.config.maxResults,
          ...keyUpdates,
        });
        console.log('[searchConfigHandlers] set: saved row:', {
          provider: row.provider,
          firecrawlKeyEnc: row.firecrawlKeyEnc ? `${row.firecrawlKeyEnc.slice(0, 20)}...` : null,
          hasApiKeys: {
            firecrawl: !!row.firecrawlKeyEnc,
            zhipu: !!row.zhipuKeyEnc,
          },
        });
        return { success: true, data: toISearchConfig(row) };
      } catch (err) {
        console.error('[searchConfigHandlers] set error:', err);
        return { success: false, message: `Failed to save search config: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  );

}

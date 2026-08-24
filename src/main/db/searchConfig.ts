// ============================================
// WeaveMD — Search Config DAO
// ============================================

import { randomUUID } from 'crypto';
import { getDatabase } from './index';
import type { SearchProvider } from '@shared/ai';

export interface SearchConfigRow {
  id: string;
  userId: string;
  enabled: boolean;
  provider: SearchProvider;
  callMode: string;
  maxResults: number;
  firecrawlKeyEnc: string | null;
  zhipuKeyEnc: string | null;
  tavilyKeyEnc: string | null;
  exaKeyEnc: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SearchConfigDbRow {
  id: string;
  user_id: string;
  enabled: number;
  provider: string;
  call_mode: string;
  max_results: number;
  firecrawl_key_enc: string | null;
  zhipu_key_enc: string | null;
  tavily_key_enc: string | null;
  exa_key_enc: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: SearchConfigDbRow): SearchConfigRow {
  return {
    id: row.id,
    userId: row.user_id,
    enabled: !!row.enabled,
    provider: (row.provider as SearchProvider) || 'firecrawl',
    callMode: row.call_mode || 'scrape_and_search',
    maxResults: row.max_results || 10,
    firecrawlKeyEnc: row.firecrawl_key_enc,
    zhipuKeyEnc: row.zhipu_key_enc,
    tavilyKeyEnc: row.tavily_key_enc,
    exaKeyEnc: row.exa_key_enc,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSearchConfig(userId: string): SearchConfigRow | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM ai_search_config WHERE user_id = ?')
    .get(userId) as SearchConfigDbRow | undefined;
  return row ? mapRow(row) : null;
}

export function upsertSearchConfig(
  userId: string,
  data: {
    enabled?: boolean;
    provider?: SearchProvider;
    callMode?: string;
    maxResults?: number;
    firecrawlKeyEnc?: string | null;
    zhipuKeyEnc?: string | null;
    tavilyKeyEnc?: string | null;
    exaKeyEnc?: string | null;
  }
): SearchConfigRow {
  const db = getDatabase();
  const existing = getSearchConfig(userId);

  if (existing) {
    db.prepare(
      `UPDATE ai_search_config SET
         enabled = ?, provider = ?, call_mode = ?, max_results = ?,
         firecrawl_key_enc = ?, zhipu_key_enc = ?, tavily_key_enc = ?, exa_key_enc = ?,
         updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(
      data.enabled !== undefined ? (data.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
      data.provider ?? existing.provider,
      data.callMode ?? existing.callMode,
      data.maxResults ?? existing.maxResults,
      data.firecrawlKeyEnc !== undefined ? data.firecrawlKeyEnc : existing.firecrawlKeyEnc,
      data.zhipuKeyEnc !== undefined ? data.zhipuKeyEnc : existing.zhipuKeyEnc,
      data.tavilyKeyEnc !== undefined ? data.tavilyKeyEnc : existing.tavilyKeyEnc,
      data.exaKeyEnc !== undefined ? data.exaKeyEnc : existing.exaKeyEnc,
      userId
    );
  } else {
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    db.prepare(
      `INSERT INTO ai_search_config (id, user_id, enabled, provider, call_mode, max_results,
         firecrawl_key_enc, zhipu_key_enc, tavily_key_enc, exa_key_enc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      userId,
      data.enabled ? 1 : 0,
      data.provider ?? 'firecrawl',
      data.callMode ?? 'scrape_and_search',
      data.maxResults ?? 10,
      data.firecrawlKeyEnc ?? null,
      data.zhipuKeyEnc ?? null,
      data.tavilyKeyEnc ?? null,
      data.exaKeyEnc ?? null,
      now,
      now
    );
  }

  const fresh = getSearchConfig(userId);
  if (!fresh) throw new Error('Failed to upsert search config');
  return fresh;
}

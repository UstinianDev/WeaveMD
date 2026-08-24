// ============================================
// WeaveMD — Embedding Config DAO（独立于 AI 模型配置）
// ============================================

import { randomUUID } from 'crypto';
import { getDatabase } from './index';

export interface EmbeddingConfigRow {
  id: string;
  userId: string;
  baseUrl: string;
  model: string;
  apiKeyEnc: string | null;
  multimodal: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EmbeddingConfigDbRow {
  id: string;
  user_id: string;
  base_url: string;
  model: string;
  api_key_enc: string | null;
  multimodal: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: EmbeddingConfigDbRow): EmbeddingConfigRow {
  return {
    id: row.id,
    userId: row.user_id,
    baseUrl: row.base_url || '',
    model: row.model || '',
    apiKeyEnc: row.api_key_enc,
    multimodal: !!row.multimodal,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getEmbeddingConfig(userId: string): EmbeddingConfigRow | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM ai_embedding_config WHERE user_id = ?')
    .get(userId) as EmbeddingConfigDbRow | undefined;
  return row ? mapRow(row) : null;
}

export function upsertEmbeddingConfig(
  userId: string,
  data: {
    baseUrl?: string;
    model?: string;
    apiKeyEnc?: string | null;
    multimodal?: boolean;
  }
): EmbeddingConfigRow {
  const db = getDatabase();
  const existing = getEmbeddingConfig(userId);

  if (existing) {
    db.prepare(
      `UPDATE ai_embedding_config SET
         base_url = ?, model = ?, api_key_enc = ?, multimodal = ?,
         updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(
      data.baseUrl ?? existing.baseUrl,
      data.model ?? existing.model,
      data.apiKeyEnc !== undefined ? data.apiKeyEnc : existing.apiKeyEnc,
      data.multimodal !== undefined ? (data.multimodal ? 1 : 0) : (existing.multimodal ? 1 : 0),
      userId
    );
  } else {
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    db.prepare(
      `INSERT INTO ai_embedding_config (id, user_id, base_url, model, api_key_enc, multimodal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      userId,
      data.baseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      data.model ?? 'text-embedding-v3',
      data.apiKeyEnc ?? null,
      data.multimodal ? 1 : 0,
      now,
      now
    );
  }

  const fresh = getEmbeddingConfig(userId);
  if (!fresh) throw new Error('Failed to upsert embedding config');
  return fresh;
}

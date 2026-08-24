// ============================================
// WeaveMD — AI Model Configs DAO（多模型配置）
// ============================================

import { randomUUID } from 'crypto';
import { getDatabase } from './index';
import type { ModelProtocol } from '@shared/ai';

export interface ModelConfigRow {
  id: string;
  userId: string;
  name: string;
  protocol: ModelProtocol;
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyEnc: string | null;
  hint: string;
  createdAt: string;
  updatedAt: string;
}

interface ModelConfigDbRow {
  id: string;
  user_id: string;
  name: string;
  protocol: string;
  provider: string;
  base_url: string;
  model: string;
  api_key_enc: string | null;
  hint: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ModelConfigDbRow): ModelConfigRow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name || '',
    protocol: (row.protocol as ModelProtocol) || 'openai',
    provider: row.provider || '',
    baseUrl: row.base_url || '',
    model: row.model || '',
    apiKeyEnc: row.api_key_enc,
    hint: row.hint || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listModelConfigs(userId: string): ModelConfigRow[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM ai_model_configs WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId) as ModelConfigDbRow[];
  return rows.map(mapRow);
}

export function getModelConfig(id: string): ModelConfigRow | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM ai_model_configs WHERE id = ?')
    .get(id) as ModelConfigDbRow | undefined;
  return row ? mapRow(row) : null;
}

export function createModelConfig(
  userId: string,
  data: {
    name?: string;
    protocol: ModelProtocol;
    provider: string;
    baseUrl: string;
    model: string;
    apiKeyEnc?: string | null;
    hint?: string;
  }
): ModelConfigRow {
  const db = getDatabase();
  const id = randomUUID();
  const name = data.name || `${data.provider} - ${data.model}`;
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
  db.prepare(
    `INSERT INTO ai_model_configs (id, user_id, name, protocol, provider, base_url, model, api_key_enc, hint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    name,
    data.protocol,
    data.provider,
    data.baseUrl,
    data.model,
    data.apiKeyEnc ?? null,
    data.hint ?? '',
    now,
    now
  );
  const fresh = getModelConfig(id);
  if (!fresh) throw new Error('Failed to create model config');
  return fresh;
}

export function updateModelConfig(
  id: string,
  data: {
    name?: string;
    protocol?: ModelProtocol;
    provider?: string;
    baseUrl?: string;
    model?: string;
    apiKeyEnc?: string | null;
    hint?: string;
  }
): ModelConfigRow | null {
  const db = getDatabase();
  const existing = getModelConfig(id);
  if (!existing) return null;
  db.prepare(
    `UPDATE ai_model_configs SET
       name = ?, protocol = ?, provider = ?, base_url = ?, model = ?,
       api_key_enc = ?, hint = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    data.name ?? existing.name,
    data.protocol ?? existing.protocol,
    data.provider ?? existing.provider,
    data.baseUrl ?? existing.baseUrl,
    data.model ?? existing.model,
    data.apiKeyEnc !== undefined ? data.apiKeyEnc : existing.apiKeyEnc,
    data.hint ?? existing.hint,
    id
  );
  return getModelConfig(id);
}

export function deleteModelConfig(id: string): boolean {
  const db = getDatabase();
  const info = db.prepare('DELETE FROM ai_model_configs WHERE id = ?').run(id);
  return info.changes > 0;
}

// ============================================
// WeaveMD — AI Database Operations
// ============================================
// ai_config / ai_conversations / ai_messages 表 DAO。
// 全部操作按 user_id / conversation_id 参数化过滤，绝无字符串拼接。
// API key 仅以密文 (api_key_enc) 存储/读取；明文经 safeStorage 在 secureConfig 层加解密，
// 明文绝不落库、绝不出主进程。

import { randomUUID } from 'crypto';
import { getDatabase } from './index';
import {
  DEFAULT_KB_SETTINGS,
  normalizeKbSettings,
  type ChatBackend,
  type ConversationMode,
  type IAIMessage,
  type IAIConversation,
} from '@shared/ai';

// ---------------------------------------------------------------------------
// ai_config
// ---------------------------------------------------------------------------

export interface AiConfigRow {
  id: string;
  userId: string;
  backend: ChatBackend;
  ollamaBaseUrl: string;
  remoteBaseUrl: string;
  model: string;
  /** safeStorage 密文(base64)；无 key 时为 null */
  apiKeyEnc: string | null;
  allowNetwork: boolean;
  allowSend: boolean;
  consentUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // ---- 第 6 期批次 2：知识库检索参数（NULL 由 mapConfigRow 兜底默认） ----
  kbTopK: number;
  kbFuse: number;
  kbThreshold: number;
  kbPinnedWeight: number;
  // ---- ai-settings-redesign：多模型配置激活 ID ----
  activeModelConfigId: string | null;
}

interface AiConfigDbRow {
  id: string;
  user_id: string;
  backend: string;
  ollama_base_url: string;
  remote_base_url: string;
  model: string;
  api_key_enc: string | null;
  allow_network: number;
  allow_send: number;
  consent_updated_at: string | null;
  created_at: string;
  updated_at: string;
  kb_top_k: number | null;
  kb_fuse: number | null;
  kb_threshold: number | null;
  kb_pinned_weight: number | null;
  active_model_config_id: string | null;
  // 遗留列（kb_embedding_host / kb_embedding_model）不再读取/写入，保留 NULL
}

function mapConfigRow(row: AiConfigDbRow): AiConfigRow {
  // KB 设置列在既有库/旧 INSERT 下可能为 NULL → 用 normalizeKbSettings 对 NULL 兜底默认
  const kb = normalizeKbSettings({
    topK: row.kb_top_k ?? undefined,
    fuse: row.kb_fuse ?? undefined,
    threshold: row.kb_threshold ?? undefined,
    pinnedWeight: row.kb_pinned_weight ?? undefined,
  });
  return {
    id: row.id,
    userId: row.user_id,
    // 后端恒 remote；遗留 'ollama' 值视同 remote（收敛，不做 schema 迁移）
    backend: 'remote',
    ollamaBaseUrl: row.ollama_base_url,
    remoteBaseUrl: row.remote_base_url,
    model: row.model || '',
    apiKeyEnc: row.api_key_enc,
    allowNetwork: !!row.allow_network,
    allowSend: !!row.allow_send,
    consentUpdatedAt: row.consent_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    kbTopK: kb.topK,
    kbFuse: kb.fuse,
    kbThreshold: kb.threshold,
    kbPinnedWeight: kb.pinnedWeight,
    activeModelConfigId: row.active_model_config_id ?? null,
  };
}

export function getAiConfig(userId: string): AiConfigRow | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM ai_config WHERE user_id = ?')
    .get(userId) as AiConfigDbRow | undefined;
  if (!row) return null;
  return mapConfigRow(row);
}

export interface AiConfigUpdate {
  backend?: ChatBackend;
  ollamaBaseUrl?: string;
  remoteBaseUrl?: string;
  model?: string;
  apiKeyEnc?: string | null;
  allowNetwork?: boolean;
  allowSend?: boolean;
  consentUpdatedAt?: string | null;
  // ---- 第 6 期批次 2：知识库检索参数（可选，缺省不回写） ----
  kbTopK?: number;
  kbFuse?: number;
  kbThreshold?: number;
  kbPinnedWeight?: number;
}

export function upsertAiConfig(userId: string, update: AiConfigUpdate): AiConfigRow {
  const db = getDatabase();
  const existing = getAiConfig(userId);

  if (existing) {
    // UPDATE 沿用「只改渲染传的字段」语义：update.x ?? existing.x 保留其余
    db.prepare(
      `UPDATE ai_config SET
         backend = ?, ollama_base_url = ?, remote_base_url = ?, model = ?,
         api_key_enc = ?, allow_network = ?, allow_send = ?, consent_updated_at = ?,
         kb_top_k = ?, kb_fuse = ?, kb_threshold = ?, kb_pinned_weight = ?,
         updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(
      update.backend ?? existing.backend,
      update.ollamaBaseUrl ?? existing.ollamaBaseUrl,
      update.remoteBaseUrl ?? existing.remoteBaseUrl,
      update.model ?? existing.model,
      update.apiKeyEnc !== undefined ? update.apiKeyEnc : existing.apiKeyEnc,
      update.allowNetwork ?? existing.allowNetwork ? 1 : 0,
      update.allowSend ?? existing.allowSend ? 1 : 0,
      update.consentUpdatedAt !== undefined ? update.consentUpdatedAt : existing.consentUpdatedAt,
      update.kbTopK ?? existing.kbTopK,
      update.kbFuse ?? existing.kbFuse,
      update.kbThreshold ?? existing.kbThreshold,
      update.kbPinnedWeight ?? existing.kbPinnedWeight,
      userId
    );
  } else {
    const id = randomUUID();
    // INSERT 在无配置新建时用 update.x ?? DEFAULT_KB_SETTINGS.x 兜底
    db.prepare(
      `INSERT INTO ai_config
         (id, user_id, backend, ollama_base_url, remote_base_url, model,
          api_key_enc, allow_network, allow_send, consent_updated_at,
          kb_top_k, kb_fuse, kb_threshold, kb_pinned_weight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      userId,
      'remote',
      update.ollamaBaseUrl ?? 'http://localhost:11434',
      update.remoteBaseUrl ?? 'https://api.deepseek.com',
      update.model ?? '',
      update.apiKeyEnc ?? null,
      update.allowNetwork ?? false ? 1 : 0,
      update.allowSend ?? false ? 1 : 0,
      update.consentUpdatedAt ?? null,
      update.kbTopK ?? DEFAULT_KB_SETTINGS.topK,
      update.kbFuse ?? DEFAULT_KB_SETTINGS.fuse,
      update.kbThreshold ?? DEFAULT_KB_SETTINGS.threshold,
      update.kbPinnedWeight ?? DEFAULT_KB_SETTINGS.pinnedWeight
    );
  }

  const fresh = getAiConfig(userId);
  if (!fresh) throw new Error('Failed to upsert ai_config');
  return fresh;
}

// ---------------------------------------------------------------------------
// ai_conversations
// ---------------------------------------------------------------------------

interface AiConversationDbRow {
  id: string;
  user_id: string;
  mode: string;
  summary: string;
  created_at: string;
  updated_at: string;
}

function mapConversationRow(row: AiConversationDbRow): IAIConversation {
  return {
    id: row.id,
    userId: row.user_id,
    mode: (row.mode as ConversationMode) || 'chat',
    summary: row.summary || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createConversation(userId: string, mode: ConversationMode): IAIConversation {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO ai_conversations (id, user_id, mode, summary) VALUES (?, ?, ?, ?)'
  ).run(id, userId, mode || 'chat', '');
  const row = db
    .prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?')
    .get(id, userId) as AiConversationDbRow;
  return mapConversationRow(row);
}

export function getConversation(conversationId: string, userId: string): IAIConversation | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId) as AiConversationDbRow | undefined;
  if (!row) return null;
  return mapConversationRow(row);
}

export function listConversationsByUser(userId: string, mode?: ConversationMode): IAIConversation[] {
  const db = getDatabase();
  const rows =
    mode !== undefined
      ? (db
          .prepare(
            'SELECT * FROM ai_conversations WHERE user_id = ? AND mode = ? ORDER BY updated_at DESC'
          )
          .all(userId, mode) as AiConversationDbRow[])
      : (db
          .prepare('SELECT * FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC')
          .all(userId) as AiConversationDbRow[]);
  return rows.map(mapConversationRow);
}

export function deleteConversation(conversationId: string, userId: string): boolean {
  const db = getDatabase();
  const info = db
    .prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?')
    .run(conversationId, userId);
  return info.changes > 0;
}

export function updateConversationSummary(
  conversationId: string,
  userId: string,
  summary: string
): IAIConversation | null {
  const db = getDatabase();
  db.prepare(
    'UPDATE ai_conversations SET summary = ?, updated_at = datetime(?) WHERE id = ? AND user_id = ?'
  ).run(summary, 'now', conversationId, userId);
  return getConversation(conversationId, userId);
}

// ---------------------------------------------------------------------------
// ai_messages
// ---------------------------------------------------------------------------

interface AiMessageDbRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  refs_json: string | null;
  created_at: string;
}

function mapMessageRow(row: AiMessageDbRow): IAIMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role as IAIMessage['role'],
    content: row.content || '',
    refsJson: row.refs_json,
    createdAt: row.created_at,
  };
}

export function appendMessage(msg: {
  conversationId: string;
  userId: string;
  role: IAIMessage['role'];
  content: string;
  refsJson?: string | null;
}): IAIMessage {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO ai_messages (id, conversation_id, user_id, role, content, refs_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, msg.conversationId, msg.userId, msg.role, msg.content, msg.refsJson ?? null);
  db.prepare(
    "UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(msg.conversationId, msg.userId);
  const row = db
    .prepare('SELECT * FROM ai_messages WHERE id = ?')
    .get(id) as AiMessageDbRow;
  return mapMessageRow(row);
}

export function getMessagesByConversation(
  conversationId: string,
  userId: string
): IAIMessage[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT m.* FROM ai_messages m
         JOIN ai_conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = ? AND c.user_id = ?
        ORDER BY m.created_at ASC`
    )
    .all(conversationId, userId) as AiMessageDbRow[];
  return rows.map(mapMessageRow);
}

/** 校验会话归属后追加用户消息（供 IPC App 组装消息） */
export function assertConversationOwned(conversationId: string, userId: string): boolean {
  return getConversation(conversationId, userId) !== null;
}

// ---------------------------------------------------------------------------
// 消息编辑 / 删除后续
// ---------------------------------------------------------------------------

/** 删除指定消息之后的所有消息（按 created_at 排序）。返回被删除行数。 */
export function deleteMessagesAfter(
  conversationId: string,
  messageId: string
): number {
  const db = getDatabase();
  const target = db
    .prepare('SELECT created_at FROM ai_messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId) as { created_at: string } | undefined;
  if (!target) return 0;

  const info = db
    .prepare('DELETE FROM ai_messages WHERE conversation_id = ? AND created_at > ?')
    .run(conversationId, target.created_at);
  return info.changes;
}

/** 更新消息内容。返回是否成功（消息存在）。 */
export function updateMessageContent(
  messageId: string,
  content: string
): boolean {
  const db = getDatabase();
  const info = db
    .prepare('UPDATE ai_messages SET content = ? WHERE id = ?')
    .run(content, messageId);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// 搜索对话（按标题 + 消息内容）
// ---------------------------------------------------------------------------

export function searchConversations(
  userId: string,
  query: string,
  limit: number = 20
): IAIConversation[] {
  const db = getDatabase();
  const searchTerm = `%${query}%`;

  const rows = db
    .prepare(
      `SELECT DISTINCT c.*
       FROM ai_conversations c
       LEFT JOIN ai_messages m ON c.id = m.conversation_id
       WHERE c.user_id = ?
         AND (
           c.summary LIKE ?
           OR m.content LIKE ?
         )
       ORDER BY c.updated_at DESC
       LIMIT ?`
    )
    .all(userId, searchTerm, searchTerm, limit) as AiConversationDbRow[];

  return rows.map(mapConversationRow);
}

// ============================================
// WeaveMD — AI Database Operations
// ============================================
// ai_config / ai_conversations / ai_messages 表 DAO。
// 全部操作按 user_id / conversation_id 参数化过滤，绝无字符串拼接。
// API key 仅以密文 (api_key_enc) 存储/读取；明文经 safeStorage 在 secureConfig 层加解密，
// 明文绝不落库、绝不出主进程。

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { getDatabase } from './index';
import {
  DEFAULT_KB_SETTINGS,
  normalizeKbSettings,
  type ChatBackend,
  type ConversationMode,
  type WriteMode,
  type IAIMessage,
  type IAIConversation,
} from '@shared/ai';

// ---------------------------------------------------------------------------
// Prepared statement cache — avoids repeated SQL compilation overhead
// ---------------------------------------------------------------------------

const stmtCache = new Map<string, Database.Statement>();

/** Return a cached prepared statement for the given SQL string. */
function cachedPrepare(db: Database.Database, sql: string): Database.Statement {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}

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
  // ---- 写模式（auto / manual） ----
  writeMode: WriteMode;
  // ---- R2~R10: 扩展 KB 设置（由 normalizeKbSettings 兜底） ----
  kbRrfK: number;
  kbCandidateMultiplier: number;
  kbVecScoreThreshold: number;
  kbCurrentFileBoost: number;
  kbRecencyBoost: number;
  kbHeadingBoost: number;
  kbMaxChunksPerFile: number;
  kbContextExpand: number;
  kbEnableQueryUnderstanding: boolean;
  kbEnableConditionalRerank: boolean;
  kbEnableClarify: boolean;
  kbEnableEvidenceGrading: boolean;
  kbEnableResearchLoop: boolean;
  kbEnableDocumentContext: boolean;
  kbDocumentContextBudget: number;
  kbEmbeddingProvider: string;
  kbEmbeddingDimension: number;
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
  write_mode: string | null;
  // R2~R10: 新增 KB 配置列（NULL 时由 normalizeKbSettings 兜底）
  kb_rrf_k: number | null;
  kb_candidate_multiplier: number | null;
  kb_vec_score_threshold: number | null;
  kb_current_file_boost: number | null;
  kb_recency_boost: number | null;
  kb_heading_boost: number | null;
  kb_max_chunks_per_file: number | null;
  kb_context_expand: number | null;
  kb_enable_query_understanding: number | null;
  kb_enable_conditional_rerank: number | null;
  kb_enable_clarify: number | null;
  kb_enable_evidence_grading: number | null;
  kb_enable_research_loop: number | null;
  kb_enable_document_context: number | null;
  kb_document_context_budget: number | null;
  kb_embedding_provider: string | null;
  kb_embedding_dimension: number | null;
}

function mapConfigRow(row: AiConfigDbRow): AiConfigRow {
  // KB 设置列在既有库/旧 INSERT 下可能为 NULL → 用 normalizeKbSettings 对 NULL 兜底默认
  const kb = normalizeKbSettings({
    topK: row.kb_top_k ?? undefined,
    fuse: row.kb_fuse ?? undefined,
    threshold: row.kb_threshold ?? undefined,
    pinnedWeight: row.kb_pinned_weight ?? undefined,
    rrfK: row.kb_rrf_k ?? undefined,
    candidateMultiplier: row.kb_candidate_multiplier ?? undefined,
    vecScoreThreshold: row.kb_vec_score_threshold ?? undefined,
    currentFileBoost: row.kb_current_file_boost ?? undefined,
    recencyBoost: row.kb_recency_boost ?? undefined,
    headingBoost: row.kb_heading_boost ?? undefined,
    maxChunksPerFile: row.kb_max_chunks_per_file ?? undefined,
    contextExpand: row.kb_context_expand ?? undefined,
    enableQueryUnderstanding: row.kb_enable_query_understanding != null ? !!row.kb_enable_query_understanding : undefined,
    enableConditionalRerank: row.kb_enable_conditional_rerank != null ? !!row.kb_enable_conditional_rerank : undefined,
    enableClarify: row.kb_enable_clarify != null ? !!row.kb_enable_clarify : undefined,
    enableEvidenceGrading: row.kb_enable_evidence_grading != null ? !!row.kb_enable_evidence_grading : undefined,
    enableResearchLoop: row.kb_enable_research_loop != null ? !!row.kb_enable_research_loop : undefined,
    enableDocumentContext: row.kb_enable_document_context != null ? !!row.kb_enable_document_context : undefined,
    documentContextBudget: row.kb_document_context_budget ?? undefined,
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
    // write_mode: 新旧库兼容，NULL 或非 'auto' 值一律收敛为 'manual'
    writeMode: row.write_mode === 'auto' ? 'auto' : 'manual',
    // R2~R10: 扩展 KB 设置
    kbRrfK: kb.rrfK!,
    kbCandidateMultiplier: kb.candidateMultiplier!,
    kbVecScoreThreshold: kb.vecScoreThreshold!,
    kbCurrentFileBoost: kb.currentFileBoost!,
    kbRecencyBoost: kb.recencyBoost!,
    kbHeadingBoost: kb.headingBoost!,
    kbMaxChunksPerFile: kb.maxChunksPerFile!,
    kbContextExpand: kb.contextExpand!,
    kbEnableQueryUnderstanding: kb.enableQueryUnderstanding!,
    kbEnableConditionalRerank: kb.enableConditionalRerank!,
    kbEnableClarify: kb.enableClarify!,
    kbEnableEvidenceGrading: kb.enableEvidenceGrading!,
    kbEnableResearchLoop: kb.enableResearchLoop!,
    kbEnableDocumentContext: kb.enableDocumentContext!,
    kbDocumentContextBudget: kb.documentContextBudget!,
    kbEmbeddingProvider: row.kb_embedding_provider ?? 'openai',
    kbEmbeddingDimension: row.kb_embedding_dimension ?? 1536,
  };
}

export function getAiConfig(userId: string): AiConfigRow | null {
  const db = getDatabase();
  const row = cachedPrepare(db, 'SELECT * FROM ai_config WHERE user_id = ?')
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
  // ---- 写模式（可选，缺省不回写） ----
  writeMode?: WriteMode;
}

export function upsertAiConfig(userId: string, update: AiConfigUpdate): AiConfigRow {
  const db = getDatabase();
  const existing = getAiConfig(userId);

  if (existing) {
    // UPDATE 沿用「只改渲染传的字段」语义：update.x ?? existing.x 保留其余
    cachedPrepare(db,
      `UPDATE ai_config SET
         backend = ?, ollama_base_url = ?, remote_base_url = ?, model = ?,
         api_key_enc = ?, allow_network = ?, allow_send = ?, consent_updated_at = ?,
         kb_top_k = ?, kb_fuse = ?, kb_threshold = ?, kb_pinned_weight = ?,
         write_mode = ?,
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
      update.writeMode ?? existing.writeMode,
      userId
    );
  } else {
    const id = randomUUID();
    // INSERT 在无配置新建时用 update.x ?? DEFAULT_KB_SETTINGS.x 兜底
    cachedPrepare(db,
      `INSERT INTO ai_config
         (id, user_id, backend, ollama_base_url, remote_base_url, model,
          api_key_enc, allow_network, allow_send, consent_updated_at,
          kb_top_k, kb_fuse, kb_threshold, kb_pinned_weight,
          write_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      update.kbPinnedWeight ?? DEFAULT_KB_SETTINGS.pinnedWeight,
      update.writeMode ?? 'manual'
    );
  }

  const fresh = getAiConfig(userId);
  if (!fresh) throw new Error('Failed to upsert ai_config');
  return fresh;
}

/**
 * 更新扩展 KB 设置（R2~R12 新增列）。
 * 仅更新传入的字段，未传入的保持原值。
 * 列不存在时静默跳过（幂等兼容旧库）。
 */
export function updateKbExtendedSettings(
  userId: string,
  settings: Record<string, unknown>
): void {
  const db = getDatabase();
  const existing = getAiConfig(userId);
  if (!existing) return;

  // 字段映射：camelCase → snake_case
  const fieldMap: Array<[string, string, 'number' | 'boolean' | 'string']> = [
    ['rrfK', 'kb_rrf_k', 'number'],
    ['candidateMultiplier', 'kb_candidate_multiplier', 'number'],
    ['vecScoreThreshold', 'kb_vec_score_threshold', 'number'],
    ['currentFileBoost', 'kb_current_file_boost', 'number'],
    ['recencyBoost', 'kb_recency_boost', 'number'],
    ['headingBoost', 'kb_heading_boost', 'number'],
    ['maxChunksPerFile', 'kb_max_chunks_per_file', 'number'],
    ['contextExpand', 'kb_context_expand', 'number'],
    ['enableQueryUnderstanding', 'kb_enable_query_understanding', 'boolean'],
    ['enableConditionalRerank', 'kb_enable_conditional_rerank', 'boolean'],
    ['enableClarify', 'kb_enable_clarify', 'boolean'],
    ['enableEvidenceGrading', 'kb_enable_evidence_grading', 'boolean'],
    ['enableResearchLoop', 'kb_enable_research_loop', 'boolean'],
    ['enableDocumentContext', 'kb_enable_document_context', 'boolean'],
    ['documentContextBudget', 'kb_document_context_budget', 'number'],
    ['embeddingProvider', 'kb_embedding_provider', 'string'],
    ['embeddingDimension', 'kb_embedding_dimension', 'number'],
  ];

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [camel, snake, type] of fieldMap) {
    if (!(camel in settings)) continue;
    const val = settings[camel];
    if (type === 'boolean') {
      values.push(val ? 1 : 0);
    } else {
      values.push(val ?? null);
    }
    setClauses.push(`${snake} = ?`);
  }

  if (setClauses.length === 0) return;

  setClauses.push("updated_at = datetime('now')");
  values.push(userId);

  try {
    db.prepare(`UPDATE ai_config SET ${setClauses.join(', ')} WHERE user_id = ?`).run(...values);
  } catch {
    // 列不存在时静默跳过（旧库未迁移）
  }
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
  cachedPrepare(db,
    'INSERT INTO ai_conversations (id, user_id, mode, summary) VALUES (?, ?, ?, ?)'
  ).run(id, userId, mode || 'chat', '');
  const row = cachedPrepare(db, 'SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?')
    .get(id, userId) as AiConversationDbRow;
  return mapConversationRow(row);
}

export function getConversation(conversationId: string, userId: string): IAIConversation | null {
  const db = getDatabase();
  const row = cachedPrepare(db, 'SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId) as AiConversationDbRow | undefined;
  if (!row) return null;
  return mapConversationRow(row);
}

export function listConversationsByUser(userId: string, mode?: ConversationMode): IAIConversation[] {
  const db = getDatabase();
  const rows =
    mode !== undefined
      ? (cachedPrepare(db,
            'SELECT * FROM ai_conversations WHERE user_id = ? AND mode = ? ORDER BY updated_at DESC'
          )
          .all(userId, mode) as AiConversationDbRow[])
      : (cachedPrepare(db, 'SELECT * FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC')
          .all(userId) as AiConversationDbRow[]);
  return rows.map(mapConversationRow);
}

export function deleteConversation(conversationId: string, userId: string): boolean {
  const db = getDatabase();
  const info = cachedPrepare(db, 'DELETE FROM ai_conversations WHERE id = ? AND user_id = ?')
    .run(conversationId, userId);
  return info.changes > 0;
}

export function updateConversationSummary(
  conversationId: string,
  userId: string,
  summary: string
): IAIConversation | null {
  const db = getDatabase();
  cachedPrepare(db,
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
  tool_call_id: string | null;
  tool_calls: string | null;
  created_at: string;
}

function mapMessageRow(row: AiMessageDbRow): IAIMessage {
  let toolCalls: IAIMessage['toolCalls'];
  if (row.tool_calls) {
    try {
      toolCalls = JSON.parse(row.tool_calls);
    } catch {
      toolCalls = undefined;
    }
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role as IAIMessage['role'],
    content: row.content || '',
    refsJson: row.refs_json,
    toolCallId: row.tool_call_id,
    createdAt: row.created_at,
    toolCalls,
  };
}

export function appendMessage(msg: {
  conversationId: string;
  userId: string;
  role: IAIMessage['role'];
  content: string;
  refsJson?: string | null;
  toolCallId?: string | null;
  toolCalls?: IAIMessage['toolCalls'];
}): IAIMessage {
  const db = getDatabase();
  const id = randomUUID();
  const toolCallsJson = msg.toolCalls && msg.toolCalls.length > 0
    ? JSON.stringify(msg.toolCalls)
    : null;
  cachedPrepare(db,
    'INSERT INTO ai_messages (id, conversation_id, user_id, role, content, refs_json, tool_call_id, tool_calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, msg.conversationId, msg.userId, msg.role, msg.content, msg.refsJson ?? null, msg.toolCallId ?? null, toolCallsJson);
  cachedPrepare(db,
    "UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(msg.conversationId, msg.userId);
  const row = cachedPrepare(db, 'SELECT * FROM ai_messages WHERE id = ?')
    .get(id) as AiMessageDbRow;
  return mapMessageRow(row);
}

export function getMessagesByConversation(
  conversationId: string,
  userId: string
): IAIMessage[] {
  const db = getDatabase();
  const rows = cachedPrepare(db,
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
  const target = cachedPrepare(db, 'SELECT created_at FROM ai_messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId) as { created_at: string } | undefined;
  if (!target) return 0;

  const info = cachedPrepare(db, 'DELETE FROM ai_messages WHERE conversation_id = ? AND created_at > ?')
    .run(conversationId, target.created_at);
  return info.changes;
}

/** 更新消息内容。返回是否成功（消息存在）。 */
export function updateMessageContent(
  messageId: string,
  content: string
): boolean {
  const db = getDatabase();
  const info = cachedPrepare(db, 'UPDATE ai_messages SET content = ? WHERE id = ?')
    .run(content, messageId);
  return info.changes > 0;
}

/** 更新指定消息的 tool_calls JSON 快照。返回是否成功。 */
export function updateMessageToolCalls(
  messageId: string,
  toolCalls: IAIMessage['toolCalls']
): boolean {
  const db = getDatabase();
  const json = toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
  const info = cachedPrepare(db, 'UPDATE ai_messages SET tool_calls = ? WHERE id = ?')
    .run(json, messageId);
  return info.changes > 0;
}

/**
 * 更新会话中最新一条 assistant 消息的 tool_calls。
 * 渲染进程不知道主进程生成的 DB 消息 ID，故按 conversationId + role 定位。
 */
export function updateLatestAssistantToolCalls(
  conversationId: string,
  toolCalls: IAIMessage['toolCalls']
): boolean {
  const db = getDatabase();
  const row = cachedPrepare(db,
      `SELECT id FROM ai_messages
       WHERE conversation_id = ? AND role = 'assistant'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(conversationId) as { id: string } | undefined;
  if (!row) return false;
  return updateMessageToolCalls(row.id, toolCalls);
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

  const rows = cachedPrepare(db,
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

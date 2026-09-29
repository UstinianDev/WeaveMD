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
// R7：消息删除级联清理附件（唯一删除点，内含 KB 关联行 + 落盘图片清理）
import { removeParsedAttachment } from './attachments';
// B6 五-2：图片附件存相对路径、读取时重建绝对路径（electron 不可用时原样透传）
import {
  isRelativeAttachmentPath,
  resolveStoredPath,
  toRelativePath,
} from '../ai/image/imageStorage';
import {
  DEFAULT_KB_SETTINGS,
  normalizeKbSettings,
  type ChatBackend,
  type ConversationMode,
  type ModelProtocol,
  type WriteMode,
  type IAIMessage,
  type IAIConversation,
  type IAttachmentMeta,
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
  /** LLM 协议（openai / anthropic），决定调用点分流到哪个客户端。旧库缺列时兜底 openai。 */
  protocol: ModelProtocol;
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
  // ---- remedial D8：vision 覆盖三态（null=自动判定） ----
  visionOverride: boolean | null;
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
  protocol: string | null;
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
  // remedial D8：vision 覆盖三态（NULL=自动 / 1=强制支持 / 0=强制不支持）
  vision_override: number | null;
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
    // 旧库/非法值一律收敛 openai，避免误打 /v1/messages
    protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
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
    // D8 三态：NULL/缺列 → null（自动判定），1 → true，0 → false
    visionOverride: row.vision_override == null ? null : row.vision_override !== 0,
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

/**
 * B11 Q2/D5：读勾选「加入知识库」默认值。
 * 行不存在或列 NULL → true（Q2 默认勾选，与「勾选=显式授权」语义自洽）。
 */
export function getUploadKbDefault(userId: string): boolean {
  const db = getDatabase();
  const row = cachedPrepare(db, 'SELECT upload_kb_default FROM ai_config WHERE user_id = ?')
    .get(userId) as { upload_kb_default: number | null } | undefined;
  if (!row || row.upload_kb_default == null) return true;
  return row.upload_kb_default !== 0;
}

/**
 * B11 Q2/D5：写勾选「加入知识库」默认值（参数化；行不存在时补建最小行）。
 * 返回是否写入成功。
 */
export function setUploadKbDefault(userId: string, enabled: boolean): boolean {
  const db = getDatabase();
  const info = cachedPrepare(
    db,
    "UPDATE ai_config SET upload_kb_default = ?, updated_at = datetime('now') WHERE user_id = ?"
  ).run(enabled ? 1 : 0, userId);
  if (info.changes > 0) return true;
  // 行不存在（从未保存过 AI 配置）→ 补建最小行（其余列走 DEFAULT）
  try {
    cachedPrepare(
      db,
      'INSERT INTO ai_config (id, user_id, upload_kb_default) VALUES (?, ?, ?)'
    ).run(randomUUID(), userId, enabled ? 1 : 0);
    return true;
  } catch {
    return false;
  }
}

export interface AiConfigUpdate {
  backend?: ChatBackend;
  /** 激活模型配置时同步下来的协议 */
  protocol?: ModelProtocol;
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
  // ---- remedial D8：vision 覆盖三态（缺省不回写，保留既有值） ----
  visionOverride?: boolean;
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
         write_mode = ?, protocol = ?,
         vision_override = ?,
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
      update.protocol ?? existing.protocol,
      // D8 三态：缺省保留既有值（null 也原样回写，保持自动判定）
      update.visionOverride !== undefined
        ? update.visionOverride
          ? 1
          : 0
        : existing.visionOverride == null
          ? null
          : existing.visionOverride
            ? 1
            : 0,
      userId
    );
    // 直接构造返回值，省掉回读 SELECT
    return {
      ...existing,
      backend: 'remote',
      protocol: update.protocol ?? existing.protocol,
      ollamaBaseUrl: update.ollamaBaseUrl ?? existing.ollamaBaseUrl,
      remoteBaseUrl: update.remoteBaseUrl ?? existing.remoteBaseUrl,
      model: update.model ?? existing.model,
      apiKeyEnc: update.apiKeyEnc !== undefined ? update.apiKeyEnc : existing.apiKeyEnc,
      allowNetwork: update.allowNetwork ?? existing.allowNetwork,
      allowSend: update.allowSend ?? existing.allowSend,
      consentUpdatedAt: update.consentUpdatedAt !== undefined ? update.consentUpdatedAt : existing.consentUpdatedAt,
      kbTopK: update.kbTopK ?? existing.kbTopK,
      kbFuse: update.kbFuse ?? existing.kbFuse,
      kbThreshold: update.kbThreshold ?? existing.kbThreshold,
      kbPinnedWeight: update.kbPinnedWeight ?? existing.kbPinnedWeight,
      writeMode: update.writeMode ?? existing.writeMode,
      visionOverride: update.visionOverride !== undefined ? update.visionOverride : existing.visionOverride,
      updatedAt: new Date().toISOString(),
    };
  } else {
    const id = randomUUID();
    // INSERT 在无配置新建时用 update.x ?? DEFAULT_KB_SETTINGS.x 兜底
    cachedPrepare(db,
      `INSERT INTO ai_config
         (id, user_id, backend, ollama_base_url, remote_base_url, model,
          api_key_enc, allow_network, allow_send, consent_updated_at,
          kb_top_k, kb_fuse, kb_threshold, kb_pinned_weight,
          write_mode, protocol)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      update.writeMode ?? 'manual',
      update.protocol ?? 'openai'
    );
    // 直接构造返回值，省掉回读 SELECT
    const kb = normalizeKbSettings({
      topK: update.kbTopK ?? DEFAULT_KB_SETTINGS.topK,
      fuse: update.kbFuse ?? DEFAULT_KB_SETTINGS.fuse,
      threshold: update.kbThreshold ?? DEFAULT_KB_SETTINGS.threshold,
      pinnedWeight: update.kbPinnedWeight ?? DEFAULT_KB_SETTINGS.pinnedWeight,
    });
    return {
      id,
      userId,
      backend: 'remote',
      protocol: update.protocol ?? 'openai',
      ollamaBaseUrl: update.ollamaBaseUrl ?? 'http://localhost:11434',
      remoteBaseUrl: update.remoteBaseUrl ?? 'https://api.deepseek.com',
      model: update.model ?? '',
      apiKeyEnc: update.apiKeyEnc ?? null,
      allowNetwork: update.allowNetwork ?? false,
      allowSend: update.allowSend ?? false,
      consentUpdatedAt: update.consentUpdatedAt ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      activeModelConfigId: null,
      writeMode: update.writeMode ?? 'manual',
      visionOverride: update.visionOverride ?? null,
      kbTopK: kb.topK,
      kbFuse: kb.fuse,
      kbThreshold: kb.threshold,
      kbPinnedWeight: kb.pinnedWeight,
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
      kbEmbeddingProvider: 'openai',
      kbEmbeddingDimension: 1536,
    };
  }
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
  attachments_json: string | null;
  created_at: string;
}

/**
 * 附件元数据白名单序列化（一-4②：只存 id/type/name/path/size/parseStatus）。
 * `thumb` 等渲染层存活态与正文一律剔除 —— 消息表不膨胀（一物两表）。
 */
function serializeAttachments(attachments: IAttachmentMeta[]): string {
  return JSON.stringify(
    attachments.map((a) => {
      // 图片一律以相对路径落库（附件根本外的原始路径保留原样，B6 五-2②）
      const rel = a.path && a.type === 'image' ? toRelativePath(a.path) ?? a.path : a.path;
      return {
        id: a.id,
        type: a.type,
        name: a.name,
        ...(rel ? { path: rel } : {}),
        ...(typeof a.size === 'number' ? { size: a.size } : {}),
        ...(a.parseStatus ? { parseStatus: a.parseStatus } : {}),
        ...(a.error ? { error: a.error.slice(0, 200) } : {}),
      };
    })
  );
}

/** 读取时把图片相对路径重建为绝对路径（userData 迁移不失效；非图片/绝对路径原样返回）。 */
function resolveAttachmentPaths(attachments: IAttachmentMeta[]): IAttachmentMeta[] {
  return attachments.map((a) =>
    a.type === 'image' && a.path && isRelativeAttachmentPath(a.path)
      ? { ...a, path: resolveStoredPath(a.path) }
      : a
  );
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
  // 附件元数据：旧消息无列值/坏 JSON → undefined（渲染按可选处理，向后兼容）
  let attachments: IAIMessage['attachments'];
  if (row.attachments_json) {
    try {
      const parsed: unknown = JSON.parse(row.attachments_json);
      if (Array.isArray(parsed)) attachments = resolveAttachmentPaths(parsed as IAttachmentMeta[]);
    } catch {
      attachments = undefined;
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
    ...(attachments ? { attachments } : {}),
  };
}

// ---------------------------------------------------------------------------
// B-a（P0-5 / Q13 / Q15）：按轮流式读取窗口
// ---------------------------------------------------------------------------

/** UTF-8 字节长度（不依赖 Buffer，主进程与测试环境皆可用）。 */
function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 参与轮窗口计算的行（IAIMessage 满足该结构）。 */
export interface RoundWindowRow {
  role: string;
  content?: string;
  toolCalls?: unknown;
}

export interface RoundWindowOptions {
  /** 保留的最近轮数（默认 3，对应 KEEP_RECENT_ROUNDS） */
  rounds?: number;
  /** 软字节预算（UTF-8 字节）：超预算在轮边界停，但至少保留最近 1 轮；缺省不限制 */
  byteBudget?: number;
  /** 行数水位线（默认 20）：20 是下限不是上限，轮数满足后不足该行数继续向前补 */
  watermarkRows?: number;
  /** 单行字节数算法（缺省：正文 + tool_calls JSON 的 UTF-8 字节数） */
  sizeOf?: (row: RoundWindowRow) => number;
}

/** 最近轮数缺省值。 */
export const DEFAULT_WINDOW_ROUNDS = 3;
/** 行数水位线缺省值（Q15：由上限降为下限）。 */
export const DEFAULT_WATERMARK_ROWS = 20;

function defaultRowBytes(row: RoundWindowRow): number {
  const content = typeof row.content === 'string' ? row.content : '';
  const toolCalls = row.toolCalls ? JSON.stringify(row.toolCalls) : '';
  return utf8Length(content) + utf8Length(toolCalls);
}

/**
 * 按轮窗口构建器（纯内存、不触库，便于单测）。
 * 输入行序为「新 → 旧」（对应 `ORDER BY created_at DESC, rowid DESC`），`build()` 输出时间正序。
 * 轮边界 = user 行（与 `contextManager.keepRecentTail` 口径一致，tool 归属其 assistant 轮）。
 * 停机条件（均在轮边界判定，任一满足即停）：
 *  1. 累计字节 > byteBudget —— 首轮无条件保留，故至少留最近 1 轮；
 *  2. 已取轮数 ≥ rounds 且已取行数 ≥ watermarkRows —— 即 max(最近 3 轮全量, 20 行)。
 * 注：会话必有 user 行（用户消息先落库），故轮边界必然出现，不存在无边界长读。
 */
export class RoundWindowBuilder<T extends RoundWindowRow> {
  private readonly rounds: number;
  private readonly watermarkRows: number;
  private readonly byteBudget: number | undefined;
  private readonly sizeOf: (row: RoundWindowRow) => number;
  private readonly groups: T[][] = [];
  private current: T[] = [];
  private bytesTotal = 0;
  private bytesCurrent = 0;
  private rowCount = 0;

  constructor(options: RoundWindowOptions = {}) {
    this.rounds = options.rounds ?? DEFAULT_WINDOW_ROUNDS;
    this.watermarkRows = options.watermarkRows ?? DEFAULT_WATERMARK_ROWS;
    this.byteBudget = options.byteBudget;
    this.sizeOf = options.sizeOf ?? defaultRowBytes;
  }

  /** 推入一行（新 → 旧）；返回 false 表示窗口已满，调用方应停止迭代。 */
  push(row: T): boolean {
    this.current.push(row);
    this.bytesCurrent += this.sizeOf(row);
    this.rowCount += 1;
    if (row.role !== 'user') return true; // 轮未闭合，继续读
    this.groups.push(this.current);
    this.bytesTotal += this.bytesCurrent;
    this.current = [];
    this.bytesCurrent = 0;
    if (this.byteBudget !== undefined && this.bytesTotal > this.byteBudget) return false;
    if (this.groups.length >= this.rounds && this.rowCount >= this.watermarkRows) return false;
    return true;
  }

  /** 收尾：最早端残缺轮（无前置 user 行）原样并入，返回时间正序。 */
  build(): T[] {
    const groups = this.current.length > 0 ? [...this.groups, this.current] : this.groups;
    return groups.flat().reverse();
  }
}

/** 纯函数包装：数组（新 → 旧）→ 窗口（时间正序）。 */
export function buildRoundWindow<T extends RoundWindowRow>(
  rows: readonly T[],
  options: RoundWindowOptions = {}
): T[] {
  const builder = new RoundWindowBuilder<T>(options);
  for (const row of rows) {
    if (!builder.push(row)) break;
  }
  return builder.build();
}

/**
 * 按轮读取会话历史（P0-5）：流式累加字节预算、超预算在轮边界停，取 max(最近 rounds 轮全量, 20 行)。
 * 不设行数硬上限；返回时间正序。
 * @param options.byteBudget 软字节闸（UTF-8 字节），缺省不限制
 */
export function getRecentMessagesByRounds(
  conversationId: string,
  userId: string,
  rounds: number = DEFAULT_WINDOW_ROUNDS,
  options: { byteBudget?: number } = {}
): IAIMessage[] {
  const db = getDatabase();
  // created_at 为毫秒 ISO 串，同轮批量写会并列 → rowid DESC 兜底，防止切出半截轮
  const stmt = cachedPrepare(db,
    `SELECT * FROM ai_messages
      WHERE conversation_id = ? AND user_id = ?
      ORDER BY created_at DESC, rowid DESC`
  );
  const builder = new RoundWindowBuilder<IAIMessage>({ rounds, byteBudget: options.byteBudget });
  // 迭代器关闭：for-of 的 break / 循环体抛错按 ES 规范调用 iterator.return()（→ 解锁语句），
  // 正常耗尽时 better-sqlite3 在 next() 收到 SQLITE_DONE 后已自行 Cleanup —— 两条路径都
  // 不可再手动 return()，否则二次递减 iterators 计数；显式再调一次反而会重复关闭。
  for (const row of stmt.iterate(conversationId, userId)) {
    if (!builder.push(mapMessageRow(row as AiMessageDbRow))) break;
  }
  return builder.build();
}

// ---------------------------------------------------------------------------
// 工具轮单事务写入（P0-4 / Q7 / Q14）
// ---------------------------------------------------------------------------

/** 本轮一条 tool 结果（数组下标即确定性 id 的 index）。 */
export interface ToolTurnToolWrite {
  toolCallId: string;
  content: string;
}

export interface ToolTurnWriteInput {
  conversationId: string;
  userId: string;
  /** 工具轮序号（确定性 id 的组成部分） */
  round: number;
  /** assistant 正文（流式收敛前可为空串） */
  assistantContent: string;
  /** 本轮 assistant 的工具调用轨迹（落 tool_calls 列） */
  toolCalls: IAIMessage['toolCalls'];
  /** 本轮 tool 结果，顺序即 `t_${conv}_${round}_${index}` 的 index */
  tools: ToolTurnToolWrite[];
}

export interface ToolTurnWriteResult {
  assistantId: string;
  toolIds: string[];
}

const ASSISTANT_UPSERT_SQL =
  'INSERT INTO ai_messages (id, conversation_id, user_id, role, content, refs_json, tool_call_id, tool_calls, attachments_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, tool_calls = excluded.tool_calls';

const TOOL_INSERT_SQL =
  'INSERT OR IGNORE INTO ai_messages (id, conversation_id, user_id, role, content, refs_json, tool_call_id, tool_calls, attachments_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

/**
 * 一个工具轮的原子写入（P0-4）：事务边界 = 本轮 assistant(tool_calls) 行 + N 条 tool 行。
 * - 先 upsert assistant（确定性 id `aturn_${conv}_${round}`，`ON CONFLICT DO UPDATE` 不重复落库、
 *   不改 created_at 以保持行序），再 `INSERT OR IGNORE` 本轮 tool 行（`t_${conv}_${round}_${index}`）；
 * - 任一语句抛出即整体回滚，不产生半截轮；
 * - IPC 发送不在事务内（避免同步 IPC 阻塞持有事务）。
 */
export function appendToolTurnWithAssistant(input: ToolTurnWriteInput): ToolTurnWriteResult {
  const db = getDatabase();
  const assistantId = `aturn_${input.conversationId}_${input.round}`;
  const toolIds = input.tools.map(
    (_tool, index) => `t_${input.conversationId}_${input.round}_${index}`
  );
  const toolCallsJson =
    input.toolCalls && input.toolCalls.length > 0 ? JSON.stringify(input.toolCalls) : null;
  // 同轮共用一个时间戳：行序由 assistant 先写（rowid 更小）保证
  const createdAt = new Date().toISOString();

  const writeTurn = db.transaction(() => {
    cachedPrepare(db, ASSISTANT_UPSERT_SQL).run(
      assistantId,
      input.conversationId,
      input.userId,
      'assistant',
      input.assistantContent,
      null,
      null,
      toolCallsJson,
      null,
      createdAt
    );
    for (let index = 0; index < input.tools.length; index += 1) {
      const tool = input.tools[index];
      cachedPrepare(db, TOOL_INSERT_SQL).run(
        toolIds[index],
        input.conversationId,
        input.userId,
        'tool',
        tool.content,
        null,
        tool.toolCallId,
        null,
        null,
        createdAt
      );
    }
    cachedPrepare(db,
      "UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ? AND user_id = ?"
    ).run(input.conversationId, input.userId);
  });
  writeTurn();

  return { assistantId, toolIds };
}

export function appendMessage(msg: {
  conversationId: string;
  userId: string;
  role: IAIMessage['role'];
  content: string;
  refsJson?: string | null;
  toolCallId?: string | null;
  toolCalls?: IAIMessage['toolCalls'];
  /** 附件轻量元数据（一-4②：正文入 parsed_attachments，此处只写 attachments_json） */
  attachments?: IAttachmentMeta[];
}): IAIMessage {
  const db = getDatabase();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const toolCallsJson = msg.toolCalls && msg.toolCalls.length > 0
    ? JSON.stringify(msg.toolCalls)
    : null;
  const attachmentsJson =
    msg.attachments && msg.attachments.length > 0
      ? serializeAttachments(msg.attachments)
      : null;
  cachedPrepare(db,
    'INSERT INTO ai_messages (id, conversation_id, user_id, role, content, refs_json, tool_call_id, tool_calls, attachments_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, msg.conversationId, msg.userId, msg.role, msg.content, msg.refsJson ?? null, msg.toolCallId ?? null, toolCallsJson, attachmentsJson, createdAt);
  cachedPrepare(db,
    "UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(msg.conversationId, msg.userId);
  return {
    id,
    conversationId: msg.conversationId,
    userId: msg.userId,
    role: msg.role,
    content: msg.content,
    refsJson: msg.refsJson ?? null,
    toolCallId: msg.toolCallId ?? null,
    createdAt,
    toolCalls: msg.toolCalls,
    ...(msg.attachments ? { attachments: msg.attachments } : {}),
  };
}

/**
 * 按附件 id 反查其原始本地路径（B8 六-2 citation 附件回链）。
 * 只扫当前用户自己的消息（参数化 LIKE 收窄 + 逐条 JSON 解析精确定位 id），
 * 命中第一个非空 path（文件附件为原始绝对路径；图片为相对路径由调用方拒绝）。
 */
export function findAttachmentFilePath(userId: string, attachmentId: string): string | null {
  const db = getDatabase();
  const rows = cachedPrepare(
    db,
    `SELECT attachments_json FROM ai_messages
      WHERE user_id = ? AND attachments_json IS NOT NULL AND attachments_json LIKE '%' || ? || '%'
      ORDER BY created_at DESC LIMIT 50`
  ).all(userId, attachmentId) as Array<{ attachments_json: string | null }>;
  for (const row of rows) {
    if (!row.attachments_json) continue;
    try {
      const arr: unknown = JSON.parse(row.attachments_json);
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as { id?: unknown; path?: unknown };
        if (rec.id === attachmentId && typeof rec.path === 'string' && rec.path) {
          return rec.path;
        }
      }
    } catch {
      /* 坏 JSON 容错：跳过该行继续找 */
    }
  }
  return null;
}

export function getMessagesByConversation(
  conversationId: string,
  userId: string
): IAIMessage[] {
  const db = getDatabase();
  // userId 已由上游 prepareAgentContext 校验会话归属，此处无需 JOIN
  // created_at 同毫秒批写（同轮 assistant + tool 行）并列 → rowid ASC 兜底保序
  const rows = cachedPrepare(db,
      `SELECT * FROM ai_messages
        WHERE conversation_id = ? AND user_id = ?
        ORDER BY created_at ASC, rowid ASC`
    )
    .all(conversationId, userId) as AiMessageDbRow[];
  return rows.map(mapMessageRow);
}

/**
 * 分页加载消息（性能优化）。
 * 只加载最近 N 条消息，避免长对话时全表扫描。
 * @param conversationId 会话 ID
 * @param userId 用户 ID
 * @param limit 最大条数（默认 20）
 * @param offset 偏移量（默认 0，从最新消息开始倒序）
 * @returns 消息列表（按时间正序）
 */
export function getMessagesByConversationPaginated(
  conversationId: string,
  userId: string,
  limit: number = 20,
  offset: number = 0
): IAIMessage[] {
  const db = getDatabase();
  // 倒序加载最近 N 条，然后反转为正序
  const rows = cachedPrepare(db,
      `SELECT * FROM ai_messages
        WHERE conversation_id = ? AND user_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(conversationId, userId, limit, offset) as AiMessageDbRow[];
  return rows.reverse().map(mapMessageRow);
}

/** 校验会话归属后追加用户消息（供 IPC App 组装消息） */
export function assertConversationOwned(conversationId: string, userId: string): boolean {
  return getConversation(conversationId, userId) !== null;
}

// ---------------------------------------------------------------------------
// 消息编辑 / 删除后续
// ---------------------------------------------------------------------------

/**
 * 删除指定消息之后的所有消息（按 created_at 排序）。返回被删除行数。
 * R7（裁定：消息级级联，不做 chip 独立删除）：删除前收集受影响行的
 * attachments_json 附件 id，删除后逐 id 调 removeParsedAttachment ——
 * 级联清理 parsed_attachments 行 + KB 关联（removeByAttachment）+ 落盘图片。
 * 无附件行零副作用；坏 JSON 容错跳过。
 */
export function deleteMessagesAfter(
  conversationId: string,
  messageId: string
): number {
  const db = getDatabase();
  const target = cachedPrepare(db, 'SELECT created_at FROM ai_messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId) as { created_at: string } | undefined;
  if (!target) return 0;

  // 先收集将删行的附件 id（user_id 随行取值，跨用户不可能：行已按 conversation 归属）
  const affected = cachedPrepare(
    db,
    'SELECT user_id, attachments_json FROM ai_messages WHERE conversation_id = ? AND created_at > ?'
  ).all(conversationId, target.created_at) as Array<{
    user_id: string;
    attachments_json: string | null;
  }>;

  const info = cachedPrepare(db, 'DELETE FROM ai_messages WHERE conversation_id = ? AND created_at > ?')
    .run(conversationId, target.created_at);

  for (const row of affected) {
    if (!row.attachments_json) continue;
    try {
      const arr: unknown = JSON.parse(row.attachments_json);
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const id = (item as { id?: unknown } | null)?.id;
        if (typeof id === 'string' && id) {
          try {
            removeParsedAttachment(id, row.user_id);
          } catch {
            // 单附件级联失败不断批（其余附件照常清理）
          }
        }
      }
    } catch {
      /* 坏 JSON 容错：跳过该行 */
    }
  }
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

/**
 * 更新指定消息的 tool_calls JSON 快照。返回是否成功。
 * （渲染侧「按会话更新最新一条 assistant」的回写入口已随 Q7 拆除：
 *  tool_calls 由 appendToolTurnWithAssistant 在写入轮次时一并落库，不再有第二处写入点。）
 */
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

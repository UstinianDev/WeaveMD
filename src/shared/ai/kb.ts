// 知识库类型

// ---------------------------------------------------------------------------
// Embedding 提供商（R1）
// ---------------------------------------------------------------------------

/** Embedding 提供商类型。 */
export type EmbeddingProviderType = 'openai' | 'qwen' | 'doubao' | 'zhipu' | 'custom';

/** Embedding 提供商配置。 */
export interface IEmbeddingProviderConfig {
  provider: EmbeddingProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  dimension: number;
  /** 批量大小上限（Qwen/Aliyun 限 10，其余默认 20）。 */
  batchSize?: number;
  /** 多模态模型（图片 embedding）。 */
  multimodal?: boolean;
  multimodalModel?: string;
}

/** Embedding 提供商默认配置。 */
export const EMBEDDING_PROVIDER_DEFAULTS: Record<EmbeddingProviderType, Partial<IEmbeddingProviderConfig>> = {
  openai: { baseUrl: 'https://api.openai.com', model: 'text-embedding-3-small', dimension: 1536, batchSize: 20 },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v3', dimension: 1024, batchSize: 10 },
  doubao: { baseUrl: 'https://ark.cn-beijing.volces.com', model: 'doubao-embedding', dimension: 2048, batchSize: 20 },
  zhipu: { baseUrl: 'https://open.bigmodel.cn', model: 'embedding-3', dimension: 2048, batchSize: 20 },
  custom: { baseUrl: '', model: '', dimension: 1536, batchSize: 20 },
};

// ---------------------------------------------------------------------------
// 查询意图（R5）
// ---------------------------------------------------------------------------

/** 查询意图类型。 */
export type QueryIntentType = 'fact' | 'summary' | 'comparison' | 'follow_up' | 'procedure';

/** 模糊检测类型。 */
export type AmbiguityType = 'pronoun_reference' | 'missing_subject' | 'broad_scope' | 'too_short';

/** 查询理解结果。 */
export interface IQueryUnderstanding {
  intent: QueryIntentType;
  standalone: string;
  expanded: string[];
  ambiguities: AmbiguityType[];
  confidence: number;
}

// ---------------------------------------------------------------------------
// 证据分级（R8）
// ---------------------------------------------------------------------------

/** 证据等级。 */
export type EvidenceGrade = 'grounded' | 'weak_evidence' | 'conflicting_evidence' | 'no_evidence';

/** 证据评估结果。 */
export interface IEvidenceAssessment {
  grade: EvidenceGrade;
  confidence: number;
  /** 来源冲突组（仅 conflicting_evidence 时有值）。 */
  conflictGroups?: Array<{ sources: string[]; claim: string }>;
}

// ---------------------------------------------------------------------------
// 知识库检索命中结果
// ---------------------------------------------------------------------------

/** KB 检索命中结果。 */
export interface IKbSearchResult {
  docId: string;
  chunkId: string;
  fileName: string;
  content: string;
  seq: number;
  score: number;
  pinned: boolean;
  sourceRef: string | null;
  /** 标题类型 chunk（heading boost 用）。 */
  isHeading?: boolean;
  /** 来自当前打开文件。 */
  isCurrentFile?: boolean;
  /** RRF 各路原始排名（调试用）。 */
  rrfRanks?: { vec?: number; fts?: number; title?: number };
}

/** KB 详细检索结果（含证据分级）。 */
export interface IKbSearchDetailedResponse {
  refused: boolean;
  threshold: number;
  best: IKbSearchResult | null;
  results: IKbSearchResult[];
  /** 证据评估。 */
  evidence?: IEvidenceAssessment;
  /** 查询理解。 */
  queryUnderstanding?: IQueryUnderstanding;
}

// ---------------------------------------------------------------------------
// 知识库文档索引状态
// ---------------------------------------------------------------------------

/** 知识库文档索引状态。 */
export interface IKbDocumentStatus {
  docId: string;
  fileId: string | null;
  title: string;
  sourceType: 'db' | 'disk' | 'import';
  pinned: boolean;
  status: 'pending' | 'importing' | 'done' | 'error';
  chunkCount: number;
}

/** KB 导入/重建结果。 */
export interface IKbImportResult {
  docId: string;
  title: string;
  chunks: number;
  status: IKbDocumentStatus['status'];
}

// ---------------------------------------------------------------------------
// 知识库检索/召回设置
// ---------------------------------------------------------------------------

/** 知识库检索/召回设置（扩展版）。 */
export interface IKbSettings {
  topK: number;
  fuse: number;
  threshold: number;
  pinnedWeight: number;
  // R2: RRF 融合参数
  rrfK?: number;
  candidateMultiplier?: number;
  vecScoreThreshold?: number;
  // R3: 加权参数
  currentFileBoost?: number;
  recencyBoost?: number;
  headingBoost?: number;
  // R4: 段聚合参数
  maxChunksPerFile?: number;
  contextExpand?: number;
  // R5~R9: 高级功能开关
  enableQueryUnderstanding?: boolean;
  enableConditionalRerank?: boolean;
  enableClarify?: boolean;
  enableEvidenceGrading?: boolean;
  enableResearchLoop?: boolean;
  // R10: 文档上下文
  enableDocumentContext?: boolean;
  documentContextBudget?: number;
}

/** KB 设置默认值。 */
export const DEFAULT_KB_SETTINGS: IKbSettings = {
  topK: 5,
  fuse: 0.5,
  threshold: 0.6,
  pinnedWeight: 1.5,
  rrfK: 60,
  candidateMultiplier: 4,
  vecScoreThreshold: 0.5,
  currentFileBoost: 0.08,
  recencyBoost: 0.05,
  headingBoost: 0.1,
  maxChunksPerFile: 3,
  contextExpand: 1,
  enableQueryUnderstanding: true,
  enableConditionalRerank: true,
  enableClarify: true,
  enableEvidenceGrading: true,
  enableResearchLoop: true,
  enableDocumentContext: true,
  documentContextBudget: 50000,
};

/** 将部分 KB 设置合并到默认值。 */
export function normalizeKbSettings(
  partial?: Partial<IKbSettings> | null | undefined
): IKbSettings {
  const n = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const b = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;
  return {
    topK: n(partial?.topK, DEFAULT_KB_SETTINGS.topK),
    fuse: n(partial?.fuse, DEFAULT_KB_SETTINGS.fuse),
    threshold: n(partial?.threshold, DEFAULT_KB_SETTINGS.threshold),
    pinnedWeight: n(partial?.pinnedWeight, DEFAULT_KB_SETTINGS.pinnedWeight),
    rrfK: n(partial?.rrfK, DEFAULT_KB_SETTINGS.rrfK!),
    candidateMultiplier: n(partial?.candidateMultiplier, DEFAULT_KB_SETTINGS.candidateMultiplier!),
    vecScoreThreshold: n(partial?.vecScoreThreshold, DEFAULT_KB_SETTINGS.vecScoreThreshold!),
    currentFileBoost: n(partial?.currentFileBoost, DEFAULT_KB_SETTINGS.currentFileBoost!),
    recencyBoost: n(partial?.recencyBoost, DEFAULT_KB_SETTINGS.recencyBoost!),
    headingBoost: n(partial?.headingBoost, DEFAULT_KB_SETTINGS.headingBoost!),
    maxChunksPerFile: n(partial?.maxChunksPerFile, DEFAULT_KB_SETTINGS.maxChunksPerFile!),
    contextExpand: n(partial?.contextExpand, DEFAULT_KB_SETTINGS.contextExpand!),
    enableQueryUnderstanding: b(partial?.enableQueryUnderstanding, DEFAULT_KB_SETTINGS.enableQueryUnderstanding!),
    enableConditionalRerank: b(partial?.enableConditionalRerank, DEFAULT_KB_SETTINGS.enableConditionalRerank!),
    enableClarify: b(partial?.enableClarify, DEFAULT_KB_SETTINGS.enableClarify!),
    enableEvidenceGrading: b(partial?.enableEvidenceGrading, DEFAULT_KB_SETTINGS.enableEvidenceGrading!),
    enableResearchLoop: b(partial?.enableResearchLoop, DEFAULT_KB_SETTINGS.enableResearchLoop!),
    enableDocumentContext: b(partial?.enableDocumentContext, DEFAULT_KB_SETTINGS.enableDocumentContext!),
    documentContextBudget: n(partial?.documentContextBudget, DEFAULT_KB_SETTINGS.documentContextBudget!),
  };
}

// ---------------------------------------------------------------------------
// 通用响应
// ---------------------------------------------------------------------------

/** KB_STATUS invoke 响应。 */
export interface KbStatusResponse {
  documents: number;
  embedding: { available: boolean; dims: number | null };
}

/** KB_DELETE invoke 响应。 */
export interface KbDeleteResult {
  deleted: boolean;
}

/** KB_IMPORT_DIR invoke 请求。 */
export interface KbImportDirRequest {
  userId: string;
  folderPath: string;
}

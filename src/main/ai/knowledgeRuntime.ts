// ============================================
// WeaveMD — 知识库运行时上下文
// ============================================
// 管理知识库运行时状态（索引进度、健康状态、配置）（K6）。

export interface KnowledgeRuntimeState {
  /** 索引状态。 */
  indexing: {
    isRunning: boolean;
    totalDocuments: number;
    indexedDocuments: number;
    lastIndexedAt: number | null;
  };
  /** 健康状态。 */
  health: {
    status: 'healthy' | 'degraded' | 'unavailable';
    message: string;
    lastCheckedAt: number;
  };
  /** 配置。 */
  config: {
    topK: number;
    threshold: number;
    enableVectorSearch: boolean;
  };
}

/** 默认运行时状态。 */
const DEFAULT_STATE: KnowledgeRuntimeState = {
  indexing: {
    isRunning: false,
    totalDocuments: 0,
    indexedDocuments: 0,
    lastIndexedAt: null,
  },
  health: {
    status: 'healthy',
    message: '知识库正常',
    lastCheckedAt: Date.now(),
  },
  config: {
    topK: 5,
    threshold: 0.6,
    enableVectorSearch: true,
  },
};

/** 当前运行时状态（单例）。 */
let currentState: KnowledgeRuntimeState = { ...DEFAULT_STATE };

/** 获取运行时状态。 */
export function getKnowledgeRuntimeState(): KnowledgeRuntimeState {
  return { ...currentState };
}

/** 更新索引状态。 */
export function updateIndexingState(
  partial: Partial<KnowledgeRuntimeState['indexing']>
): void {
  currentState.indexing = { ...currentState.indexing, ...partial };
}

/** 更新健康状态。 */
export function updateHealthState(
  status: KnowledgeRuntimeState['health']['status'],
  message: string
): void {
  currentState.health = {
    status,
    message,
    lastCheckedAt: Date.now(),
  };
}

/** 更新配置。 */
export function updateKnowledgeConfig(
  partial: Partial<KnowledgeRuntimeState['config']>
): void {
  currentState.config = { ...currentState.config, ...partial };
}

/** 重置运行时状态。 */
export function resetKnowledgeRuntime(): void {
  currentState = { ...DEFAULT_STATE };
}

/** 检查知识库是否可用。 */
export function isKnowledgeAvailable(): boolean {
  return currentState.health.status !== 'unavailable';
}

/** 获取索引进度百分比（0-100）。 */
export function getIndexingProgress(): number {
  const { totalDocuments, indexedDocuments } = currentState.indexing;
  if (totalDocuments === 0) return 100;
  return Math.round((indexedDocuments / totalDocuments) * 100);
}

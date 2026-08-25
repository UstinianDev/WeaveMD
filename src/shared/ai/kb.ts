// 知识库类型

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
}

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

/** 知识库检索/召回设置。 */
export interface IKbSettings {
  topK: number;
  fuse: number;
  threshold: number;
  pinnedWeight: number;
}

/** KB 设置默认值。 */
export const DEFAULT_KB_SETTINGS: IKbSettings = {
  topK: 5,
  fuse: 0.5,
  threshold: 0.6,
  pinnedWeight: 1.5,
};

/** 将部分 KB 设置合并到默认值。 */
export function normalizeKbSettings(
  partial?: Partial<IKbSettings> | null | undefined
): IKbSettings {
  const n = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    topK: n(partial?.topK, DEFAULT_KB_SETTINGS.topK),
    fuse: n(partial?.fuse, DEFAULT_KB_SETTINGS.fuse),
    threshold: n(partial?.threshold, DEFAULT_KB_SETTINGS.threshold),
    pinnedWeight: n(partial?.pinnedWeight, DEFAULT_KB_SETTINGS.pinnedWeight),
  };
}

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

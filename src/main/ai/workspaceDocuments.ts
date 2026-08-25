// ============================================
// WeaveMD — 工作区文档上下文
// ============================================
// 管理工作区文档上下文（F6）。
// 提供当前工作区的文档列表和内容摘要。

import { listFiles } from '../db/files';

export interface WorkspaceDocument {
  id: string;
  name: string;
  /** 内容摘要（前 200 字符）。 */
  summary: string;
  modifiedAt: string;
  /** 文件大小（字符数）。 */
  size: number;
}

/** 获取工作区文档列表（带摘要）。 */
export function getWorkspaceDocuments(userId: string): WorkspaceDocument[] {
  const files = listFiles(userId);

  return files.map((file) => ({
    id: file.id,
    name: file.name,
    summary: file.content.slice(0, 200) + (file.content.length > 200 ? '...' : ''),
    modifiedAt: file.modifiedAt,
    size: file.content.length,
  }));
}

/** 搜索工作区文档（按名称/内容）。 */
export function searchWorkspaceDocuments(
  userId: string,
  query: string
): WorkspaceDocument[] {
  const docs = getWorkspaceDocuments(userId);
  const q = query.toLowerCase();

  return docs.filter(
    (doc) =>
      doc.name.toLowerCase().includes(q) ||
      doc.summary.toLowerCase().includes(q)
  );
}

/** 获取工作区统计信息。 */
export function getWorkspaceStats(userId: string): {
  totalDocuments: number;
  totalSize: number;
  lastModified: string | null;
} {
  const files = listFiles(userId);

  let totalSize = 0;
  let lastModified: string | null = null;

  for (const file of files) {
    totalSize += file.content.length;
    if (!lastModified || file.modifiedAt > lastModified) {
      lastModified = file.modifiedAt;
    }
  }

  return {
    totalDocuments: files.length,
    totalSize,
    lastModified,
  };
}

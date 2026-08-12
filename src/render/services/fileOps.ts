// ============================================
// WeaveMD — File Operations Helpers
// ============================================
// 磁盘文件打开/新建的公共数据构造，消除 TopBar 等处的重复 IFile 构造。

import type { IFile, IUserPublic } from '@shared/types';

export interface DiskFileData {
  path: string;
  name: string;
  content: string;
}

/** 由读盘结果构造 IFile（磁盘路径作为 file id，支持文件系统实时同步） */
export function createDiskFile(user: IUserPublic, data: DiskFileData): IFile {
  const now = new Date().toISOString();
  return {
    id: data.path,
    userId: user.id,
    name: data.name,
    content: data.content,
    createdAt: now,
    modifiedAt: now,
    deletedAt: null,
  };
}

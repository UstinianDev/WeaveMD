// ============================================
// WeaveMD — 内置欢迎文档（每次启动注入）
// ============================================
// 欢迎项只活在内存 fileTreeStore，不写 DB / 磁盘，可独立删除、重启重建。
// 注入判定唯一依据：树中无 welcome:// 节点即注入（不以 currentFile===null 触发）。
// 保存 / 读盘对 welcome:// 短路，避免误走磁盘 / DB 或 readDisk 失败。

import type { IFile } from '@shared/types';
import { useEditorStore } from '@render/stores/editorStore';
import { useFileTreeStore, type IFileNode } from '@render/stores/fileTreeStore';
import welcomeMd from '@render/assets/welcome.md?raw';

/** 欢迎文档唯一 id（welcome:// 前缀与磁盘路径 / DB UUID 天然区分） */
export const WELCOME_ID = 'welcome://welcome.md';
/** 欢迎文档在文件树中的展示名 */
export const WELCOME_NAME = '欢迎文档.md';

/** 是否 welcome:// 类型文件（安全保存 / 点击短路的判定依据） */
export function isWelcomeFile(id: string | null | undefined): boolean {
  return !!id && id.startsWith('welcome://') && id.length > 'welcome://'.length;
}

/** 打包的欢迎文档正文（供测试 / 注入共用） */
export function welcomeContent(): string {
  return welcomeMd;
}

/** 由欢迎正文构造内存态 IFile（id/path 均为 welcome://，不入盘） */
export function welcomeToIFile(): IFile {
  const now = new Date().toISOString();
  return {
    id: WELCOME_ID,
    userId: '',
    name: WELCOME_NAME,
    content: welcomeMd,
    createdAt: now,
    modifiedAt: now,
    deletedAt: null,
  };
}

/** 构造 fileTree 中的 welcome IFileNode（content 携带全文，供点击打开免读盘） */
export function welcomeToIFileNode(): IFileNode {
  return {
    id: WELCOME_ID,
    name: WELCOME_NAME,
    path: WELCOME_ID,
    content: welcomeMd,
  };
}

/**
 * 注入欢迎文档：树中无 welcome:// 节点时才注入（幂等）。
 * 注入后若当前没有打开任何文件，则将欢迎文档设为当前编辑文件。
 * @returns 是否执行了注入
 */
export async function injectWelcomeDocument(): Promise<boolean> {
  const tree = useFileTreeStore.getState();
  // 判定唯一依据：树中无 welcome:// 节点（无论空树还是已有其他文件）
  const hasWelcome = tree.looseFiles.some((f) => isWelcomeFile(f.id));
  if (hasWelcome) return false;

  useFileTreeStore.getState().addFile(welcomeToIFileNode());

  // 仅当 currentFile 为 null 时打开欢迎文档（已有编辑文件则尊重用户当前视图）
  if (!useEditorStore.getState().currentFile) {
    useEditorStore.getState().openFile(welcomeToIFile());
  }
  return true;
}

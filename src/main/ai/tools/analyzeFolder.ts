// ============================================
// WeaveMD — analyze_folder Agent Tool
// ============================================
// 目录分析工具：从数据库查询用户文件，解析文件名中的路径结构，
// 返回目录树摘要与文件类型统计。
// 注意：files 表是扁平的（无 parent_path 列），目录结构通过文件名中的
// 路径分隔符（/）推断，与渲染侧 fileTreeStore 逻辑一致。
// 只读工具，不修改任何数据。

import type { ToolDef } from '@shared/ai';
import { listFiles } from '../../db/files';

// ---------------------------------------------------------------------------
// Tool Schema（OpenAI function JSON Schema）
// ---------------------------------------------------------------------------

export const analyzeFolderSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'analyze_folder',
    description:
      'Analyze a folder structure and return a summary. Use this to understand the organization of files.',
    parameters: {
      type: 'object',
      properties: {
        folderPath: {
          type: 'string',
          description: 'Path to the folder to analyze (use "/" for root)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to traverse (default 2, max 5)',
        },
      },
      required: ['folderPath'],
    },
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FolderNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  childCount?: number;
  children?: FolderNode[];
}

export interface FolderAnalysis {
  path: string;
  totalFiles: number;
  totalFolders: number;
  fileTypes: Record<string, number>;
  tree: FolderNode;
}

export interface AnalyzeFolderResponse {
  success: boolean;
  analysis?: FolderAnalysis;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** 将扁平文件名列表解析为路径树节点 */
function buildPathTree(
  files: Array<{ name: string; id: string }>,
  rootPath: string,
  maxDepth: number
): FolderNode {
  // 路径前缀到子节点的映射
  const childrenMap = new Map<string, FolderNode[]>();

  // 规范化根路径
  const normalizedRoot = rootPath === '/' ? '' : rootPath.replace(/^\/|\/$/g, '');

  for (const file of files) {
    const name = file.name;
    // 计算相对于根路径的部分
    let relativePath: string;
    if (normalizedRoot === '') {
      relativePath = name;
    } else if (name.startsWith(normalizedRoot + '/')) {
      relativePath = name.slice(normalizedRoot.length + 1);
    } else if (name === normalizedRoot) {
      // 根路径本身是文件
      relativePath = '';
    } else {
      // 不在目标目录下，跳过
      continue;
    }

    if (!relativePath) continue;

    const parts = relativePath.split('/');

    // 构建从根到文件的路径节点
    let currentPath = normalizedRoot ? normalizedRoot : '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      // 超过深度限制时停止
      if (i >= maxDepth) break;

      if (i === parts.length - 1) {
        // 叶子节点 = 文件
        const fileNode: FolderNode = {
          name: part,
          path: currentPath,
          type: 'file',
        };
        if (!childrenMap.has(parentPath)) {
          childrenMap.set(parentPath, []);
        }
        childrenMap.get(parentPath)!.push(fileNode);
      } else {
        // 中间节点 = 文件夹（仅当不存在时添加）
        if (!childrenMap.has(parentPath)) {
          childrenMap.set(parentPath, []);
        }
        const siblings = childrenMap.get(parentPath)!;
        const existing = siblings.find((n) => n.name === part && n.type === 'folder');
        if (!existing) {
          const folderNode: FolderNode = {
            name: part,
            path: currentPath,
            type: 'folder',
            childCount: 0,
            children: [],
          };
          siblings.push(folderNode);
        }
      }
    }
  }

  // 递归填充子节点
  const fillChildren = (node: FolderNode, depth: number): void => {
    if (depth >= maxDepth) {
      node.children = [];
      node.childCount = 0;
      return;
    }
    const children = childrenMap.get(node.path) || [];
    node.children = children;
    node.childCount = children.length;
    for (const child of children) {
      if (child.type === 'folder') {
        fillChildren(child, depth + 1);
      }
    }
  };

  // 构建根节点
  const rootName = normalizedRoot === '' ? 'root' : normalizedRoot.split('/').pop() || normalizedRoot;
  const rootNode: FolderNode = {
    name: rootName,
    path: normalizedRoot,
    type: 'folder',
    childCount: 0,
    children: [],
  };

  fillChildren(rootNode, 0);

  return rootNode;
}

/** 统计文件类型分布 */
function countFileTypes(node: FolderNode): { totalFiles: number; totalFolders: number; fileTypes: Record<string, number> } {
  let totalFiles = 0;
  let totalFolders = 0;
  const fileTypes: Record<string, number> = {};

  const walk = (n: FolderNode): void => {
    if (n.type === 'file') {
      totalFiles++;
      const ext = n.name.includes('.') ? n.name.split('.').pop()!.toLowerCase() : 'unknown';
      fileTypes[ext] = (fileTypes[ext] || 0) + 1;
    } else {
      totalFolders++;
    }
    if (n.children) {
      for (const child of n.children) {
        walk(child);
      }
    }
  };

  // 不统计根节点本身作为 folder
  if (node.children) {
    for (const child of node.children) {
      walk(child);
    }
  }

  return { totalFiles, totalFolders, fileTypes };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/**
 * 执行 analyze_folder 工具：从数据库查询文件列表，解析路径结构，返回目录树摘要。
 * 只读操作，不修改任何数据。
 */
export function executeAnalyzeFolder(
  userId: string,
  args: Record<string, unknown>
): AnalyzeFolderResponse {
  // 参数提取与验证
  const folderPath = typeof args.folderPath === 'string' ? args.folderPath : '';
  if (!folderPath) {
    return { success: false, error: 'folderPath is required' };
  }

  const rawMaxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : 2;
  const maxDepth = Math.min(Math.max(Math.floor(rawMaxDepth), 1), 5);

  try {
    // 从数据库查询用户的文件列表
    const files = listFiles(userId);

    // 构建路径树
    const tree = buildPathTree(
      files.map((f) => ({ name: f.name, id: f.id })),
      folderPath,
      maxDepth
    );

    // 统计文件类型分布
    const { totalFiles, totalFolders, fileTypes } = countFileTypes(tree);

    return {
      success: true,
      analysis: {
        path: folderPath,
        totalFiles,
        totalFolders,
        fileTypes,
        tree,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to analyze folder: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

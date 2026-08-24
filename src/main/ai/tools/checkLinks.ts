// ============================================
// WeaveMD — check_links Agent Tool
// ============================================
// 内部链接检查工具：从 Markdown 内容中提取 [text](target) 格式的内部链接，
// 在数据库中验证目标文件是否存在，返回断链列表。
// 只读工具，不修改任何数据。

import type { ToolDef } from '@shared/ai';
import { getDatabase } from '../../db/index';

// ---------------------------------------------------------------------------
// Tool Schema（OpenAI function JSON Schema）
// ---------------------------------------------------------------------------

export const checkLinksSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'check_links',
    description: 'Check internal links in a markdown file. Use this to find broken links.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the markdown file to check',
        },
        content: {
          type: 'string',
          description: 'Markdown content to check (optional, will read file if not provided)',
        },
      },
      required: ['filePath'],
    },
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrokenLink {
  line: number;
  column: number;
  text: string;
  target: string;
  reason: 'file_not_found' | 'invalid_format';
}

export interface CheckLinksResult {
  success: boolean;
  brokenLinks: BrokenLink[];
  totalLinks: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ExtractedLink {
  line: number;
  column: number;
  text: string;
  target: string;
}

/** 从 Markdown 内容中提取内部链接（排除 http/https 开头的外部链接） */
function extractLinks(content: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const lines = content.split('\n');
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;

    // 每行重置 lastIndex
    linkRegex.lastIndex = 0;
    while ((match = linkRegex.exec(line)) !== null) {
      const target = match[2];
      // 只处理内部链接（不以 http/https 开头）
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        links.push({
          line: i + 1,
          column: match.index + 1,
          text: match[1],
          target,
        });
      }
    }
  }

  return links;
}

/** 解析内部链接的目标路径（处理相对路径、去除锚点） */
function resolveTarget(target: string, currentFilePath: string): string {
  // 去除锚点部分
  const pathWithoutAnchor = target.split('#')[0];
  if (!pathWithoutAnchor) return '';

  // 绝对路径（以 / 开头）直接返回
  if (pathWithoutAnchor.startsWith('/')) {
    return pathWithoutAnchor.slice(1); // 去掉前导 /
  }

  // 相对路径：基于当前文件目录解析
  const currentDir = currentFilePath.split('/').slice(0, -1).join('/');
  if (!currentDir) return pathWithoutAnchor;

  // 简单的路径拼接（不做 .. 的复杂解析）
  return `${currentDir}/${pathWithoutAnchor}`;
}

/** 检查链接目标文件是否存在于数据库中 */
function checkLinkTarget(userId: string, target: string, currentFilePath: string): boolean {
  const resolved = resolveTarget(target, currentFilePath);
  if (!resolved) return false;

  const db = getDatabase();
  const file = db
    .prepare(
      'SELECT id FROM files WHERE user_id = ? AND name = ? AND deleted_at IS NULL'
    )
    .get(userId, resolved) as { id: string } | undefined;

  return file !== undefined;
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/**
 * 执行 check_links 工具：提取 Markdown 中的内部链接，检查目标文件是否存在。
 * 只读操作，不修改任何数据。
 */
export function executeCheckLinks(
  userId: string,
  args: Record<string, unknown>
): CheckLinksResult {
  const filePath = typeof args.filePath === 'string' ? args.filePath : '';
  if (!filePath) {
    return { success: false, brokenLinks: [], totalLinks: 0, error: 'filePath is required' };
  }

  let fileContent: string;

  // 优先使用传入的 content，否则从数据库读取
  if (typeof args.content === 'string' && args.content.length > 0) {
    fileContent = args.content;
  } else {
    const db = getDatabase();
    const row = db
      .prepare(
        'SELECT content FROM files WHERE user_id = ? AND name = ? AND deleted_at IS NULL'
      )
      .get(userId, filePath) as { content: string } | undefined;

    if (!row) {
      return {
        success: false,
        brokenLinks: [],
        totalLinks: 0,
        error: `File not found: ${filePath}`,
      };
    }
    fileContent = row.content;
  }

  try {
    const links = extractLinks(fileContent);
    const brokenLinks: BrokenLink[] = [];

    for (const link of links) {
      const exists = checkLinkTarget(userId, link.target, filePath);
      if (!exists) {
        brokenLinks.push({
          line: link.line,
          column: link.column,
          text: link.text,
          target: link.target,
          reason: 'file_not_found',
        });
      }
    }

    return { success: true, brokenLinks, totalLinks: links.length };
  } catch (error) {
    return {
      success: false,
      brokenLinks: [],
      totalLinks: 0,
      error: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

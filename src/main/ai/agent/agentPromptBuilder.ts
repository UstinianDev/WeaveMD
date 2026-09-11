// ============================================
// WeaveMD — Agent Prompt Builder
// ============================================
// 从 agentLoop.ts 提取：系统提示组装 + 文档上下文构建。
// 纯函数，不依赖 IPC / 数据库（listFiles 由调用方注入快照）。

import { estimateTokens } from '../utils/tokenEstimator';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 文档上下文注入：估算 >5000 tokens（约 2 万字符）时截断到 20000 字符 + 尾部标记。 */
const DOC_CONTEXT_TOKEN_LIMIT = 5000;
const DOC_CONTEXT_CHAR_LIMIT = 20_000;
const DOC_CONTEXT_CUT_MARKER = '\n\n[文档过长已截断…]';

/** 文件列表截断限制。 */
const MAX_FILE_LIST = 50;
const MAX_LOCAL_TREE = 30;

// ---------------------------------------------------------------------------
// 文档上下文构建
// ---------------------------------------------------------------------------

/**
 * 组装当前文档上下文 system 消息（只读，供 LLM 优化/改写整篇参考）。
 * 无文档 / 空文档 → 返回 null（不注入）。超长截断而非二次 LLM 压缩。
 */
export function buildDocumentContext(currentDocument: string | undefined): string | null {
  const doc = (currentDocument ?? '').trim();
  if (!doc) return null;
  if (estimateTokens(doc) > DOC_CONTEXT_TOKEN_LIMIT) {
    return `以下为当前编辑文档内容（只读，供改写/优化参考）：\n\n${doc.slice(
      0,
      DOC_CONTEXT_CHAR_LIMIT
    )}${DOC_CONTEXT_CUT_MARKER}`;
  }
  return `以下为当前编辑文档内容（只读，供改写/优化参考）：\n\n${doc}`;
}

// ---------------------------------------------------------------------------
// 文件列表快照构建
// ---------------------------------------------------------------------------

/** 文件列表项。 */
interface FileEntry {
  id: string;
  name: string;
}

/**
 * 构建数据库文件列表快照（注入 system prompt）。
 * 文件列表由调用方从 DB 查询后传入。
 */
export function buildFileListSnapshot(files: FileEntry[]): string {
  if (files.length === 0) return '';
  const truncated = files.slice(0, MAX_FILE_LIST);
  const fileList = truncated.map((f) => `- ${f.name} (id: ${f.id})`).join('\n');
  const suffix = files.length > MAX_FILE_LIST
    ? `\n- ...（还有 ${files.length - MAX_FILE_LIST} 个文件，用 listFiles 工具查看完整列表）`
    : '';
  return `\n\n以下是你可访问的工作区文件列表（数据库）：\n${fileList}${suffix}`;
}

/**
 * 构建本地文件/文件夹快照（注入 system prompt）。
 * 路径由调用方从 payload.fileTreePaths 传入。
 */
export function buildLocalTreeSnapshot(
  fileTreePaths?: { files: string[]; folders: string[] }
): string {
  if (!fileTreePaths) return '';
  const { files: localFiles, folders: localFolders } = fileTreePaths;
  const parts: string[] = [];

  if (localFiles.length > 0) {
    const truncated = localFiles.slice(0, MAX_LOCAL_TREE);
    let list = truncated.map((p) => `- ${p}`).join('\n');
    if (localFiles.length > MAX_LOCAL_TREE) {
      list += `\n- ...（还有 ${localFiles.length - MAX_LOCAL_TREE} 个文件）`;
    }
    parts.push(`本地文件（可用 readLocalFile 读取，用 editBlocks 改写）：\n${list}`);
  }
  if (localFolders.length > 0) {
    parts.push(`本地文件夹（可用 listLocalDirectory 浏览）：\n${localFolders.map((p) => `- ${p}`).join('\n')}`);
  }

  return parts.length > 0 ? `\n\n用户已打开/导入的本地资源：\n${parts.join('\n\n')}` : '';
}

// ---------------------------------------------------------------------------
// 系统提示组装
// ---------------------------------------------------------------------------

/** 组装 Agent 系统提示（非 chat 意图）。 */
export function buildAgentSystemPrompt(
  fileListSnapshot: string,
  localFileTreeSnapshot: string
): string {
  return [
    '你是 WeaveMD 的 AI 写作助手。',
    '',
    '【重要】你必须且只能回答用户的最后一条消息。历史摘要仅供参考，不要延续之前的问题或答案。每条用户消息都是独立的新指令。',
    '',
    '## 工作流',
    '1. 简单问题（计算/闲聊/通用知识）直接回答，不调工具。',
    '2. 信息不足时用 ask_question_card 提问澄清，不猜测。',
    '3. 创建/修改文件前先用 readFile/searchKB 检索资料。',
    '4. 复杂任务先拆分步骤，逐步执行。',
    '',
    '## 工具规则',
    '- 创建文件 → 必须调 createFile，不要在聊天中输出内容。',
    '- 修改文件 → editBlocks（当前文档）/ preview_file_revision（任意文件）。',
    '- 本地文件 → readLocalFile/editLocalFile/listLocalDirectory，返回绝对路径后续直接使用。',
    '- 检索 → searchKB：当用户问题可能与笔记/文档相关时，主动检索知识库。首次用宽泛关键词，后续换不同角度，最多 2-3 次。信息不足时如实说明。传 hyde:true 可启用假设性文档检索（适合语义复杂的查询）。',
    '- 联网搜索 → web_search：搜索互联网获取最新信息。搜索结果包含 title、url、snippet（摘要）。**必须基于搜索结果回答问题**，不得声称"没有找到信息"。如果结果中有相关内容，直接引用并注明来源 URL；如果结果确实不相关，尝试换关键词重新搜索。',
    '- 提问 → ask_question_card（支持文本/选择/确认），暂停等待回答。',
    '',
    '## 写入规则',
    '- 安全变更（新增内容、小段改写）：直接执行并告知结果。',
    '- 高风险操作（删除、覆盖整个文件）：先说明变更内容，等待用户确认。',
    '',
    '## 要点',
    '- 大型写作任务按章节拆分，每步处理一个文件。',
    '- 用户问文件是否存在，先看文件列表，没有再调 listFiles。',
    '- 文件夹支持嵌套路径（如 "子目录/深层目录"）。',
    '',
    '## 回答格式',
    '- 使用 Markdown 格式组织回答，善用标题（#/##/###）、列表、代码块、粗体等。',
    '- 长回答用标题分段，短回答直接输出。',
    '- 代码示例使用 fenced code block（```语言名）。',
    fileListSnapshot,
    localFileTreeSnapshot,
  ].filter(Boolean).join('\n');
}

/** Chat 意图的简短系统提示。 */
export const CHAT_SYSTEM_PROMPT =
  '你是 WeaveMD 的 AI 助手。直接、简洁地回答用户问题。不要提及工具、文件或文档。\n\n【重要】你必须且只能回答用户的最后一条消息。忽略之前的所有对话内容和历史摘要，不要延续之前的问题或答案。每条用户消息都是独立的新问题。';

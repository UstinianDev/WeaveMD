// ============================================
// AI Conversation Export — Markdown 格式导出
// ============================================

import type { Database } from 'better-sqlite3';

interface ExportResult {
  success: boolean;
  markdown?: string;
  error?: string;
}

/**
 * 导出对话为 Markdown 格式
 * @param db 数据库实例
 * @param conversationId 会话 ID
 * @param userId 用户 ID（归属校验）
 * @returns 导出结果
 */
export function exportConversationToMarkdown(
  db: Database,
  conversationId: string,
  userId: string
): ExportResult {
  try {
    // 获取对话信息（参数化查询，防止 SQL 注入）
    const conversation = db.prepare(`
      SELECT * FROM ai_conversations
      WHERE id = ? AND user_id = ?
    `).get(conversationId, userId) as {
      id: string;
      user_id: string;
      mode: string;
      summary: string;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!conversation) {
      return {
        success: false,
        error: 'Conversation not found',
      };
    }

    // 获取消息列表（参数化查询）
    const messages = db.prepare(`
      SELECT * FROM ai_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversationId) as Array<{
      id: string;
      conversation_id: string;
      user_id: string;
      role: string;
      content: string;
      refs_json: string | null;
      created_at: string;
    }>;

    // 构建 Markdown
    const lines: string[] = [];

    // 标题
    lines.push(`# ${conversation.summary || 'Conversation'}`);
    lines.push('');
    lines.push(`**Date:** ${new Date(conversation.created_at).toLocaleString()}`);
    lines.push(`**Messages:** ${messages.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // 消息内容
    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const time = new Date(msg.created_at).toLocaleTimeString();

      lines.push(`### ${role} (${time})`);
      lines.push('');
      lines.push(msg.content || '');
      lines.push('');

      // 工具调用（如果有）
      if (msg.refs_json) {
        try {
          const toolCalls = JSON.parse(msg.refs_json) as Array<{
            name: string;
            args: unknown;
            result: unknown;
          }>;
          if (Array.isArray(toolCalls) && toolCalls.length > 0) {
            lines.push('<details>');
            lines.push('<summary>Tool Calls</summary>');
            lines.push('');

            for (const tc of toolCalls) {
              lines.push(`**${tc.name}**`);
              lines.push('```json');
              lines.push(JSON.stringify(tc.args, null, 2));
              lines.push('```');

              if (tc.result) {
                lines.push('Result:');
                lines.push('```json');
                lines.push(JSON.stringify(tc.result, null, 2));
                lines.push('```');
              }

              lines.push('');
            }

            lines.push('</details>');
            lines.push('');
          }
        } catch {
          // 忽略解析错误
        }
      }

      lines.push('---');
      lines.push('');
    }

    return {
      success: true,
      markdown: lines.join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      error: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

import type { ToolCtx, ToolResult } from '../toolTypes';
import { executeWebSearch } from './webSearch';

export async function handleWebSearch(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> {
  const searchResult = await executeWebSearch(args, ctx.userId);

  if (!searchResult.success) {
    const errorCode = searchResult.errorDesc || 'SEARCH_FAILED';

    // 根据错误码构建用户友好消息
    let userMessage: string;
    switch (errorCode) {
      case 'SEARCH_NOT_CONFIGURED':
        userMessage = '搜索服务未配置。请在设置 > 搜索中启用搜索服务并配置 API Key。';
        break;
      case 'SEARCH_API_KEY_INVALID':
        userMessage = '搜索 API Key 无效或已过期，请在设置中检查并更新。';
        break;
      case 'SEARCH_TIMEOUT':
        userMessage = '搜索请求超时，请稍后重试。';
        break;
      default:
        userMessage = `搜索失败：${searchResult.error || '未知错误'}`;
    }

    return {
      content: JSON.stringify({
        provider: null,
        results: [],
        count: 0,
        error: errorCode,
        message: userMessage,
      }),
      status: 'error',
      errorDesc: errorCode,
    };
  }

  // 成功路径：搜索服务正常但无结果时，添加 suggestion 引导 LLM 改换策略
  const payload: Record<string, unknown> = {
    provider: searchResult.provider,
    results: searchResult.results,
    count: searchResult.results.length,
  };

  if (searchResult.results.length === 0) {
    payload.suggestion = '搜索未返回结果。请尝试：1) 简化关键词；2) 换用同义词；3) 拆分为多个子查询。如果多次搜索无结果，请如实告知用户未找到相关信息。';
  } else {
    // 检查是否有有效 snippet
    const hasUsefulSnippet = searchResult.results.some((r) => r.snippet && r.snippet.trim().length > 20);
    if (!hasUsefulSnippet) {
      // 所有结果的 snippet 都很短或为空，可能是搜索引擎未返回详细内容
      payload.note = '搜索结果已返回，但摘要内容较短。请根据标题和 URL 判断结果是否与用户问题相关。如果相关，可以告知用户找到了相关页面并提供链接；如果不相关，尝试换关键词重新搜索。';
    }
    // REMINDER：引导 LLM 基于搜索结果回答（参考 Claude Code 的引用强制机制）
    payload.reminder = '请基于以上搜索结果回答用户问题。引用结果中的信息时注明来源 URL。如果搜索结果包含用户查询的答案，直接回答，不要声称"没有找到信息"。';
  }

  return {
    content: JSON.stringify(payload),
    status: 'ok',
  };
}

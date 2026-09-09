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
  }

  return {
    content: JSON.stringify(payload),
    status: 'ok',
  };
}

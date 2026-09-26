// ============================================
// WeaveMD — D 路线：远程多模态文档识读（doc-pipeline B7 二-4）
// ============================================
// 二-4② 硬约束：
// - 触发条件显式（由调用方 pdfLayout.shouldUseDRoute 判定，本模块只执行，不自行烧 token）
// - 页数上限 + 并发上限；按页估算 token 成本（复用 B6 estimateImageTokens 计价）
// - 模型不支持 vision → 降级 A 路线纯文本 + 显式提示（不静默出垃圾）
// - 提示词要求输出结构化表格/数据而非感想
// - `.doc` 走 D 路线优先（Q3：无 vision 提示另存为 docx，本模块降级由调用方补文案）
//
// 页面渲染选型（调研 + 实测结论，记录于 TDD 报告）：
//   @llamaindex/liteparse `screenshot(input, pageNumbers)` 直接产出 PNG buffer
//   （Node 主进程实测可用，pdfium 栅格化）→ **不引入 pdfjs-dist，体积零增量**。
//
// 依赖注入：全部外部 IO 走 deps（resolveConfig/renderPages/readPage），
// 单测注入假实现即可覆盖全部路径，不加载 native、不发网络请求。

import { estimateImageTokens, getCostTracker } from '../costTracker';
import { supportsVision } from '../llm/modelDiscovery';
import { TABLE_CONFIDENCE_THRESHOLD } from './pdfLayout';
import type { DRouteReason } from './pdfLayout';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** D 路线单文档页数上限（超出截断并显式提示）。 */
export const MAX_D_ROUTE_PAGES = 10;
/** 单页识读并发上限。 */
export const D_ROUTE_CONCURRENCY = 2;
/** 每页文本 token 预算（prompt + 结构化输出粗估）。 */
export const D_ROUTE_TEXT_TOKENS_PER_PAGE = 120;

/**
 * D 路线系统提示词：强制结构化表格/数据输出，禁止评论感想（二-4②）。
 */
export const D_ROUTE_SYSTEM_PROMPT = [
  '你是文档版面还原引擎。将给定页面图片转换为结构化 Markdown 文本：',
  '1. 按版面阅读顺序输出（双栏先左栏后右栏）；',
  '2. 标题用 # 表示层级，正文保持段落；',
  '3. 表格必须完整还原为 Markdown 管道表格（含表头与全部行列数据），数字与单元格原样输出；',
  '4. 只输出结构化内容本身——禁止输出评论、感想、总结或任何解释；',
  '5. 图表输出其关联的数据表格，无法识别为表格的数据用列表罗列。',
].join('\n');

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 远程模型配置（识读所需最小集）。 */
export interface DRouteModelConfig {
  model: string;
  baseUrl: string;
  protocol?: 'openai' | 'anthropic';
  apiKey?: string;
}

/** 单页识读请求。 */
export interface DRoutePageRequest {
  config: DRouteModelConfig;
  pageNum: number;
  totalPages: number;
  /** 页面 PNG 的 base64（无 data: 前缀）。 */
  imageBase64: string;
  /** 本页识读提示词（含系统要求 + 页码定位）。 */
  prompt: string;
}

/** D 路线外部依赖（测试注入；默认实现读配置/渲染/调用 LLM）。 */
export interface DRouteDeps {
  /** 解析识读模型配置；null = 未配置（降级 no-config）。允许异步（默认实现动态加载 DB 模块）。 */
  resolveConfig: (userId: string) => Promise<DRouteModelConfig | null> | DRouteModelConfig | null;
  /** 渲染指定页为 PNG base64（默认 liteparse screenshot）。 */
  renderPages: (buffer: Buffer, pageNumbers: number[]) => Promise<Array<{ pageNum: number; base64: string }>>;
  /** 识读单页（默认走 llmClient，含计价上报）。 */
  readPage: (req: DRoutePageRequest) => Promise<string>;
  /** vision 能力判定（默认 modelDiscovery.supportsVision；测试可注入）。 */
  supportsVision?: (model: string) => boolean;
}

/** 降级原因（显式提示用）。 */
export type DRouteDegradedReason = 'no-config' | 'no-vision' | 'render-failed' | 'llm-failed';

export type DRouteOutcome =
  | {
      status: 'used';
      text: string;
      /** 各页输出在 text 中的起始偏移。 */
      pageOffsets: number[];
      pagesRendered: number;
      /** 因页数上限被截断的页数（0 = 未截断）。 */
      truncatedPages: number;
      estimatedTokens: number;
    }
  | {
      status: 'degraded';
      reason: DRouteDegradedReason;
      /** A 路线纯文本（调用方原样返回，不产出残缺 D 文本）。 */
      text: string;
      /** 给用户的显式提示。 */
      notice: string;
    };

export interface DRouteInput {
  buffer: Buffer;
  fileName: string;
  fileType: string;
  pageCount: number;
  /** A 路线纯文本（降级时原样回传）。 */
  fallbackText: string;
  userId?: string;
  /** 触发原因（进提示词上下文，可空）。 */
  reason?: DRouteReason;
  deps?: Partial<DRouteDeps>;
}

// ---------------------------------------------------------------------------
// 纯函数：token 成本估算（二-4② 按页估算，复用 B6 计价）
// ---------------------------------------------------------------------------

/** D 路线识读 pageCount 页的估算 token（图片按 B6 单价 + 每页文本预算）。 */
export function estimateDRouteTokens(pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return 0;
  return estimateImageTokens(pageCount) + Math.round(pageCount) * D_ROUTE_TEXT_TOKENS_PER_PAGE;
}

// ---------------------------------------------------------------------------
// 降级提示文案（显式、含原因）
// ---------------------------------------------------------------------------

export function dRouteNotice(reason: DRouteDegradedReason, model?: string): string {
  switch (reason) {
    case 'no-config':
      return '已按本地版面规则解析；未配置可用的多模态模型，无法执行多模态识读（D 路线）。';
    case 'no-vision':
      return `当前模型（${model ?? '未知'}）不支持图片理解，无法执行多模态识读（D 路线），以下为本地纯文本解析结果。如需识读扫描件，请更换支持视觉的模型或将文档另存为 .docx。`;
    case 'render-failed':
      return '页面渲染失败，无法执行多模态识读（D 路线），以下为本地纯文本解析结果。';
    case 'llm-failed':
      return '多模态识读失败（模型调用出错），未采用其输出，以下为本地纯文本解析结果。';
    default:
      return '多模态识读不可用，以下为本地纯文本解析结果。';
  }
}

// ---------------------------------------------------------------------------
// 默认依赖（动态 import：native/DB/网络只在真正执行 D 路线时加载）
// ---------------------------------------------------------------------------

async function defaultRenderPages(
  buffer: Buffer,
  pageNumbers: number[]
): Promise<Array<{ pageNum: number; base64: string }>> {
  const mod = await import('@llamaindex/liteparse');
  const LiteParse = mod.LiteParse ?? mod.default;
  const lp = new LiteParse({ ocrEnabled: false, quiet: true });
  // 空数组 = 全部页（native 侧 null 语义）
  const shots =
    pageNumbers.length > 0
      ? await lp.screenshot(new Uint8Array(buffer), pageNumbers)
      : await lp.screenshot(new Uint8Array(buffer));
  return shots.map((s) => ({ pageNum: s.pageNum, base64: s.imageBuffer.toString('base64') }));
}

async function defaultResolveConfig(userId: string): Promise<DRouteModelConfig | null> {
  try {
    const { getAiConfig } = await import('../../db/ai');
    const row = getAiConfig(userId);
    if (!row?.model || !row.remoteBaseUrl) return null;
    let apiKey: string | undefined;
    if (row.apiKeyEnc) {
      const { decryptApiKey } = await import('../secureConfig');
      try {
        apiKey = decryptApiKey(row.apiKeyEnc);
      } catch {
        apiKey = undefined;
      }
    }
    return {
      model: row.model,
      baseUrl: row.remoteBaseUrl,
      protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
      ...(apiKey ? { apiKey } : {}),
    };
  } catch {
    return null;
  }
}

async function defaultReadPage(req: DRoutePageRequest): Promise<string> {
  const { streamChatCompletion } = await import('../llm/llmClient');
  const { streamAnthropicCompletion } = await import('../llm/anthropicClient');
  const isAnthropic =
    req.config.protocol === 'anthropic' || req.config.model.toLowerCase().includes('claude');
  const gen = isAnthropic
    ? streamAnthropicCompletion({
        baseUrl: req.config.baseUrl,
        model: req.config.model,
        ...(req.config.apiKey ? { apiKey: req.config.apiKey } : {}),
        messages: [
          { role: 'user', content: [{ type: 'text', text: req.prompt }, { type: 'image_url', image_url: { url: `data:image/png;base64,${req.imageBase64}` } }] },
        ],
        timeoutMs: 90_000,
      })
    : streamChatCompletion({
        baseUrl: req.config.baseUrl,
        model: req.config.model,
        ...(req.config.apiKey ? { apiKey: req.config.apiKey } : {}),
        messages: [
          { role: 'system', content: D_ROUTE_SYSTEM_PROMPT },
          { role: 'user', content: [{ type: 'text', text: req.prompt }, { type: 'image_url', image_url: { url: `data:image/png;base64,${req.imageBase64}` } }] },
        ],
        timeoutMs: 90_000,
      });
  let acc = '';
  let promptTokens = 0;
  let completionTokens = 0;
  for await (const chunk of gen) {
    acc += chunk.delta;
    if (chunk.usage?.promptTokens != null) promptTokens = chunk.usage.promptTokens;
    if (chunk.usage?.completionTokens != null) completionTokens = chunk.usage.completionTokens;
  }
  // 计价上报（图片 token 归因进 costTracker，二-4② 计价链路覆盖图片）
  if (promptTokens > 0 || completionTokens > 0) {
    try {
      getCostTracker().recordUsage({
        conversationId: 'document-parse',
        userId: 'system',
        model: req.config.model,
        usage: {
          promptTokens,
          completionTokens,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          imageTokens: estimateImageTokens(1),
        },
        roundCount: 0,
        intent: 'document_d_route',
      });
    } catch {
      // 计价失败不影响识读主流程
    }
  }
  if (!acc.trim()) throw new Error('empty model response');
  return acc;
}

// ---------------------------------------------------------------------------
// 并发执行（简单的有界并发池）
// ---------------------------------------------------------------------------

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 执行 D 路线识读（仅在调用方判定触发后执行——显式触发、不全量烧 token）。
 *
 * 流程：解析配置 → vision 检查 → 截断页数 → 渲染页面 → 并发识读 → 拼接。
 * 任一环节不可用 → 返回 degraded（A 路线文本 + 显式提示），绝不产出残缺 D 文本。
 */
export async function runDRoute(input: DRouteInput): Promise<DRouteOutcome> {
  const deps: DRouteDeps = {
    resolveConfig: input.deps?.resolveConfig ?? defaultResolveConfig,
    renderPages: input.deps?.renderPages ?? defaultRenderPages,
    readPage: input.deps?.readPage ?? defaultReadPage,
    ...(input.deps?.supportsVision ? { supportsVision: input.deps.supportsVision } : {}),
  };
  const fallback = input.fallbackText;

  // 1. 配置解析（注入优先；默认实现动态加载 DB/解密模块）
  let config: DRouteModelConfig | null;
  try {
    config = input.userId ? await deps.resolveConfig(input.userId) : null;
  } catch {
    config = null;
  }
  if (!config) {
    return { status: 'degraded', reason: 'no-config', text: fallback, notice: dRouteNotice('no-config') };
  }

  // 2. vision 检查（不支持 → 降级 A 路线纯文本 + 显式提示，不发请求）
  const visionCheck = deps.supportsVision ?? supportsVision;
  const visionOk = visionCheck(config.model);
  if (!visionOk) {
    return {
      status: 'degraded',
      reason: 'no-vision',
      text: fallback,
      notice: dRouteNotice('no-vision', config.model),
    };
  }

  // 3. 页数上限截断（显式记录，进提示）
  // pageCount <= 0 表示页数未知（如 .doc 渲染前不可知）→ 渲染全部页后按上限截断
  const knownPages = input.pageCount > 0;
  const totalPagesKnown = knownPages ? Math.floor(input.pageCount) : 0;
  const pagesToRead = knownPages ? Math.min(totalPagesKnown, MAX_D_ROUTE_PAGES) : 0;
  const truncatedKnown = knownPages ? totalPagesKnown - pagesToRead : 0;
  if (knownPages && pagesToRead === 0) {
    return { status: 'degraded', reason: 'render-failed', text: fallback, notice: dRouteNotice('render-failed') };
  }
  // 空数组 = 全部页（页数未知路径）
  const pageNumbers = knownPages ? Array.from({ length: pagesToRead }, (_, i) => i + 1) : [];

  // 4. 渲染页面
  let rendered: Array<{ pageNum: number; base64: string }>;
  try {
    rendered = await deps.renderPages(input.buffer, pageNumbers);
  } catch {
    return { status: 'degraded', reason: 'render-failed', text: fallback, notice: dRouteNotice('render-failed') };
  }
  if (!rendered || rendered.length === 0) {
    return { status: 'degraded', reason: 'render-failed', text: fallback, notice: dRouteNotice('render-failed') };
  }
  // 未知页数路径：渲染结果按上限截断
  const capped = knownPages ? rendered : rendered.slice(0, MAX_D_ROUTE_PAGES);
  const totalPages = knownPages ? totalPagesKnown : capped.length + Math.max(0, rendered.length - capped.length);
  const readCount = capped.length;
  const truncatedPages = knownPages ? truncatedKnown : Math.max(0, rendered.length - capped.length);
  rendered = capped;

  // 5. 并发识读（有界并发；任一页失败 → 整体降级，不产出残缺文本）
  // 系统级结构化要求并入页 prompt —— 两条协议分支共用同一提示词（表格/数据强制输出）
  const promptFor = (pageNum: number): string =>
    `${D_ROUTE_SYSTEM_PROMPT}\n${input.reason ? `【触发原因：${input.reason}】\n` : ''}请将本图片（文档 ${input.fileName} 第 ${pageNum} 页，共 ${totalPages} 页）转换为结构化 Markdown。`;

  try {
    const parts = await mapWithConcurrency(rendered, D_ROUTE_CONCURRENCY, async (page) =>
      deps.readPage({
        config,
        pageNum: page.pageNum,
        totalPages,
        imageBase64: page.base64,
        prompt: promptFor(page.pageNum),
      })
    );

    // 6. 拼接 + pageOffsets
    const segments: string[] = [];
    const pageOffsets: number[] = [];
    let len = 0;
    for (let i = 0; i < parts.length; i++) {
      pageOffsets.push(len);
      const seg = parts[i].trim();
      segments.push(seg);
      len += seg.length + 2; // '\n\n'
    }
    let text = segments.join('\n\n');
    if (truncatedPages > 0) {
      text += `\n\n> 注：文档共 ${totalPages} 页，多模态识读仅覆盖前 ${readCount} 页。`;
    }
    return {
      status: 'used',
      text,
      pageOffsets,
      pagesRendered: rendered.length,
      truncatedPages,
      estimatedTokens: estimateDRouteTokens(readCount),
    };
  } catch {
    return { status: 'degraded', reason: 'llm-failed', text: fallback, notice: dRouteNotice('llm-failed') };
  }
}

// 供调用方复用阈值语义（避免重复常量漂移）
export { TABLE_CONFIDENCE_THRESHOLD };

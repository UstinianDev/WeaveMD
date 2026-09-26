// ============================================
// WeaveMD — D 路线（远程多模态）TDD（doc-pipeline B7 二-4）
// ============================================
// 覆盖：触发后显式执行路径、页数上限与并发、按页 token 成本估算
// （复用 B6 estimateImageTokens）、vision 不支持降级 A 路线纯文本 +
// 显式提示（不静默出垃圾）、渲染/识读失败降级、结构化表格输出提示词。
// 全程注入 deps —— 不加载 native、不发网络请求。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- B7 默认依赖生产路径覆盖用 mock（全部用例注入 deps 时零影响） ---
const hoisted = vi.hoisted(() => ({
  recordUsage: vi.fn(),
  getAiConfig: vi.fn(),
  decryptApiKey: vi.fn(),
  liteparseScreenshot: vi.fn(),
  streamChatCompletion: vi.fn(),
  streamAnthropicCompletion: vi.fn(),
}));
vi.mock('@main/ai/costTracker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/ai/costTracker')>();
  return {
    ...actual,
    getCostTracker: vi.fn(() => ({ recordUsage: hoisted.recordUsage })),
  };
});
vi.mock('@main/db/ai', () => ({ getAiConfig: hoisted.getAiConfig }));
vi.mock('@main/ai/secureConfig', () => ({ decryptApiKey: hoisted.decryptApiKey }));
vi.mock('@llamaindex/liteparse', () => ({
  LiteParse: class {
    screenshot = hoisted.liteparseScreenshot;
  },
  default: class {
    screenshot = hoisted.liteparseScreenshot;
  },
}));
vi.mock('@main/ai/llm/llmClient', () => ({
  streamChatCompletion: hoisted.streamChatCompletion,
}));
vi.mock('@main/ai/llm/anthropicClient', () => ({
  streamAnthropicCompletion: hoisted.streamAnthropicCompletion,
}));

import { estimateImageTokens } from '@main/ai/costTracker';
import {
  D_ROUTE_CONCURRENCY,
  D_ROUTE_SYSTEM_PROMPT,
  MAX_D_ROUTE_PAGES,
  estimateDRouteTokens,
  runDRoute,
  type DRouteDeps,
  type DRouteModelConfig,
  type DRouteOutcome,
  type DRoutePageRequest,
} from '@main/ai/files/multimodalParse';

// ---------------------------------------------------------------------------
// 测试装置
// ---------------------------------------------------------------------------

const MODEL_OK: DRouteModelConfig = {
  model: 'gpt-4o',
  baseUrl: 'https://api.example.com/v1',
  protocol: 'openai',
  apiKey: 'sk-test',
};

const A_TEXT = 'A-route plain text fallback';

function makeDeps(overrides: Partial<DRouteDeps> = {}): DRouteDeps {
  return {
    resolveConfig: vi.fn(() => MODEL_OK),
    renderPages: vi.fn(async (_buffer: Buffer, pageNums: number[]) =>
      pageNums.map((n) => ({ pageNum: n, base64: `png-page-${n}` }))
    ),
    readPage: vi.fn(async (req: DRoutePageRequest) => `[page ${req.pageNum}] structured content`),
    ...overrides,
  };
}

async function run(
  deps: DRouteDeps,
  overrides: Partial<Parameters<typeof runDRoute>[0]> = {}
): Promise<DRouteOutcome> {
  return runDRoute({
    buffer: Buffer.from('fake-pdf'),
    fileName: 'report.pdf',
    fileType: 'pdf',
    pageCount: 2,
    fallbackText: A_TEXT,
    userId: 'u1',
    deps,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 1. 成功路径
// ---------------------------------------------------------------------------

describe('runDRoute — 成功识读', () => {
  it('渲染并识读全部页，按页拼接输出与 pageOffsets', async () => {
    const deps = makeDeps();
    const out = await run(deps, { pageCount: 3 });
    expect(out.status).toBe('used');
    if (out.status !== 'used') return;
    expect(out.text).toContain('[page 1]');
    expect(out.text).toContain('[page 2]');
    expect(out.text).toContain('[page 3]');
    // 页起点单调且首 0
    expect(out.pageOffsets.length).toBe(3);
    expect(out.pageOffsets[0]).toBe(0);
    expect(out.pageOffsets[1]).toBeGreaterThan(0);
    expect(out.pageOffsets[1]).toBeLessThan(out.pageOffsets[2]);
    expect(out.pagesRendered).toBe(3);
    // 页 2 内容从 offset[1] 开始
    expect(out.text.slice(out.pageOffsets[1])).toContain('[page 2]');
    expect(out.text.slice(out.pageOffsets[1])).not.toContain('[page 1]');
  });

  it('token 成本按页估算（复用 B6 计价）', async () => {
    const deps = makeDeps();
    const out = await run(deps, { pageCount: 4 });
    expect(out.status).toBe('used');
    if (out.status !== 'used') return;
    expect(out.estimatedTokens).toBeGreaterThanOrEqual(estimateImageTokens(4));
    expect(out.estimatedTokens).toBe(estimateDRouteTokens(4));
  });

  it('识读提示词要求结构化表格/数据输出而非感想', async () => {
    expect(D_ROUTE_SYSTEM_PROMPT).toContain('表格');
    expect(D_ROUTE_SYSTEM_PROMPT).toMatch(/Markdown/);
    expect(D_ROUTE_SYSTEM_PROMPT).toMatch(/评论|感想|总结/);
    const deps = makeDeps();
    await run(deps);
    const readFn = deps.readPage as ReturnType<typeof vi.fn>;
    expect(readFn.mock.calls.length).toBeGreaterThan(0);
    const req = readFn.mock.calls[0][0] as DRoutePageRequest;
    expect(req.prompt).toContain('表格');
    expect(req.imageBase64).toContain('png-page-');
  });

  it('.doc 文件同样可走 D 路线（Q3：D 优先）', async () => {
    const deps = makeDeps();
    const out = await runDRoute({
      buffer: Buffer.from('fake-doc'),
      fileName: 'legacy.doc',
      fileType: 'doc',
      pageCount: 1,
      fallbackText: '',
      userId: 'u1',
      deps,
    });
    expect(out.status).toBe('used');
  });
});

// ---------------------------------------------------------------------------
// 2. 页数上限与并发（二-4②）
// ---------------------------------------------------------------------------

describe('runDRoute — 页数上限与并发', () => {
  it('超过上限的页被截断并给出显式提示', async () => {
    const deps = makeDeps();
    const out = await run(deps, { pageCount: MAX_D_ROUTE_PAGES + 5 });
    expect(out.status).toBe('used');
    if (out.status !== 'used') return;
    expect(out.pagesRendered).toBe(MAX_D_ROUTE_PAGES);
    expect(out.truncatedPages).toBe(5);
    const renderFn = deps.renderPages as ReturnType<typeof vi.fn>;
    const nums = (renderFn.mock.calls[0][1] as number[]) ?? [];
    expect(nums.length).toBe(MAX_D_ROUTE_PAGES);
    expect(nums[nums.length - 1]).toBe(MAX_D_ROUTE_PAGES);
  });

  it('单页调用并发不超过 D_ROUTE_CONCURRENCY', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gateDeps = makeDeps({
      readPage: vi.fn(async (req: DRoutePageRequest) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return `ok ${req.pageNum}`;
      }),
    });
    const out = await run(gateDeps, { pageCount: 6 });
    expect(out.status).toBe('used');
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(D_ROUTE_CONCURRENCY);
  });
});

// ---------------------------------------------------------------------------
// 3. 降级路径（显式提示，不静默出垃圾）
// ---------------------------------------------------------------------------

describe('runDRoute — 降级路径', () => {
  it('未配置模型 → no-config 降级，保留 A 路线文本 + 显式提示', async () => {
    const deps = makeDeps({ resolveConfig: vi.fn(() => null) });
    const out = await run(deps);
    expect(out.status).toBe('degraded');
    if (out.status !== 'degraded') return;
    expect(out.reason).toBe('no-config');
    expect(out.text).toBe(A_TEXT);
    expect(out.notice).toContain('未配置');
    // 未配置不渲染不识读（不烧 token）
    expect(deps.renderPages).not.toHaveBeenCalled();
    expect(deps.readPage).not.toHaveBeenCalled();
  });

  it('模型不支持 vision → no-vision 降级，显式提示含模型名', async () => {
    const deps = makeDeps({
      resolveConfig: vi.fn(() => ({ ...MODEL_OK, model: 'deepseek-chat' })),
    });
    const out = await run(deps);
    expect(out.status).toBe('degraded');
    if (out.status !== 'degraded') return;
    expect(out.reason).toBe('no-vision');
    expect(out.text).toBe(A_TEXT);
    expect(out.notice).toContain('deepseek-chat');
    expect(out.notice).toMatch(/不支持|视觉|图片理解/);
    expect(deps.readPage).not.toHaveBeenCalled();
  });

  it('无 userId → 同 no-config 降级', async () => {
    const deps = makeDeps();
    const out = await runDRoute({
      buffer: Buffer.from('x'),
      fileName: 'a.pdf',
      fileType: 'pdf',
      pageCount: 1,
      fallbackText: A_TEXT,
      deps,
    });
    expect(out.status).toBe('degraded');
    if (out.status !== 'degraded') return;
    expect(out.reason).toBe('no-config');
  });

  it('页面渲染失败 → render-failed 降级', async () => {
    const deps = makeDeps({
      renderPages: vi.fn(async () => {
        throw new Error('pdfium boom');
      }),
    });
    const out = await run(deps);
    expect(out.status).toBe('degraded');
    if (out.status !== 'degraded') return;
    expect(out.reason).toBe('render-failed');
    expect(out.text).toBe(A_TEXT);
    expect(out.notice).toMatch(/渲染失败/);
    expect(deps.readPage).not.toHaveBeenCalled();
  });

  it('识读调用失败 → llm-failed 降级（不产出残缺文本）', async () => {
    const deps = makeDeps({
      readPage: vi.fn(async () => {
        throw new Error('500 server error');
      }),
    });
    const out = await run(deps);
    expect(out.status).toBe('degraded');
    if (out.status !== 'degraded') return;
    expect(out.reason).toBe('llm-failed');
    expect(out.text).toBe(A_TEXT);
    expect(out.notice).toMatch(/识读失败|失败/);
  });
});

// ---------------------------------------------------------------------------
// 4. 成本估算纯函数
// ---------------------------------------------------------------------------

describe('estimateDRouteTokens', () => {
  it('= 图片 token（B6 计价）+ 每页文本预算', () => {
    expect(estimateDRouteTokens(3)).toBe(estimateImageTokens(3) + 3 * 120);
    expect(estimateDRouteTokens(0)).toBe(0);
  });
});


// ---------------------------------------------------------------------------
// B7 默认依赖生产路径（动态 import 的真实现覆盖 —— 新增代码 ≥80%）
// ---------------------------------------------------------------------------

describe('runDRoute — 默认依赖生产路径', () => {
  beforeEach(() => {
    hoisted.getAiConfig.mockReset();
    hoisted.decryptApiKey.mockReset();
    hoisted.liteparseScreenshot.mockReset();
    hoisted.streamChatCompletion.mockReset();
    hoisted.streamAnthropicCompletion.mockReset();
    hoisted.recordUsage.mockReset();
  });

  /** 只注入 supportsVision/readPage，逼 resolveConfig/renderPages 走默认实现。 */
  function depsFor(overrides: Partial<DRouteDeps> = {}): Partial<DRouteDeps> {
    return {
      supportsVision: vi.fn(() => false),
      ...overrides,
    };
  }

  it('defaultResolveConfig 读 ai_config + safeStorage 解密（不注入 resolveConfig）', async () => {
    hoisted.getAiConfig.mockReturnValue({
      model: 'gpt-4o',
      remoteBaseUrl: 'https://api.example.com/v1',
      protocol: 'openai',
      apiKeyEnc: 'enc-blob',
    });
    hoisted.decryptApiKey.mockReturnValue('sk-plain');
    const out = await runDRoute({
      buffer: Buffer.from('x'),
      fileName: 'a.pdf',
      fileType: 'pdf',
      pageCount: 1,
      fallbackText: 'A',
      userId: 'u1',
      deps: depsFor(), // supportsVision: false → 解析成功后停在 no-vision
    });
    expect(out.status).toBe('degraded');
    if (out.status === 'degraded') {
      expect(out.reason).toBe('no-vision');
      expect(out.notice).toContain('gpt-4o');
    }
    expect(hoisted.getAiConfig).toHaveBeenCalledWith('u1');
    expect(hoisted.decryptApiKey).toHaveBeenCalledWith('enc-blob');
  });

  it('ai_config 缺失 → no-config 降级（不触达解密与渲染）', async () => {
    hoisted.getAiConfig.mockReturnValue(null);
    const out = await runDRoute({
      buffer: Buffer.from('x'),
      fileName: 'a.pdf',
      fileType: 'pdf',
      pageCount: 1,
      fallbackText: 'A',
      userId: 'u1',
      deps: depsFor(),
    });
    expect(out.status).toBe('degraded');
    if (out.status === 'degraded') expect(out.reason).toBe('no-config');
    expect(hoisted.decryptApiKey).not.toHaveBeenCalled();
    expect(hoisted.liteparseScreenshot).not.toHaveBeenCalled();
  });

  it('decryptApiKey 抛错 → apiKey 缺省降级到 vision 判定（不中断）', async () => {
    hoisted.getAiConfig.mockReturnValue({
      model: 'deepseek-chat',
      remoteBaseUrl: 'https://api.deepseek.com',
      protocol: 'openai',
      apiKeyEnc: 'bad',
    });
    hoisted.decryptApiKey.mockImplementation(() => {
      throw new Error('decrypt fail');
    });
    const out = await runDRoute({
      buffer: Buffer.from('x'),
      fileName: 'a.pdf',
      fileType: 'pdf',
      pageCount: 1,
      fallbackText: 'A',
      userId: 'u1',
      deps: depsFor(),
    });
    expect(out.status).toBe('degraded');
    if (out.status === 'degraded') expect(out.reason).toBe('no-vision');
  });

  it('defaultRenderPages：页数未知（pageCount=0）→ screenshot 全页（null 语义）', async () => {
    hoisted.getAiConfig.mockReturnValue({
      model: 'gpt-4o',
      remoteBaseUrl: 'https://api.example.com/v1',
      protocol: 'openai',
      apiKeyEnc: null,
    });
    hoisted.liteparseScreenshot.mockResolvedValue([
      { pageNum: 1, imageBuffer: Buffer.from('png1') },
      { pageNum: 2, imageBuffer: Buffer.from('png2') },
    ]);
    const out = await runDRoute({
      buffer: Buffer.from('x'),
      fileName: 'legacy.doc',
      fileType: 'doc',
      pageCount: 0,
      fallbackText: '',
      userId: 'u1',
      deps: depsFor({ supportsVision: vi.fn(() => true), readPage: vi.fn(async (r) => `ok:${r.pageNum}`) }),
    });
    expect(out.status).toBe('used');
    // 全页调用：第二参为 null/undefined（native null 语义）
    const args = hoisted.liteparseScreenshot.mock.calls[0];
    expect(args.length === 1 || args[1] == null).toBe(true);
    if (out.status === 'used') {
      expect(out.pagesRendered).toBe(2);
      expect(out.text).toContain('ok:1');
      expect(out.text).toContain('ok:2');
    }
  });

  it('defaultRenderPages：已知页数 → screenshot 指定页子集', async () => {
    hoisted.getAiConfig.mockReturnValue({
      model: 'gpt-4o',
      remoteBaseUrl: 'https://api.example.com/v1',
      protocol: 'openai',
      apiKeyEnc: null,
    });
    hoisted.liteparseScreenshot.mockResolvedValue([
      { pageNum: 1, imageBuffer: Buffer.from('p1') },
      { pageNum: 2, imageBuffer: Buffer.from('p2') },
    ]);
    const out = await runDRoute({
      buffer: Buffer.from('x'),
      fileName: 'a.pdf',
      fileType: 'pdf',
      pageCount: 2,
      fallbackText: '',
      userId: 'u1',
      deps: depsFor({ supportsVision: vi.fn(() => true), readPage: vi.fn(async () => 'text') }),
    });
    expect(out.status).toBe('used');
    expect(hoisted.liteparseScreenshot.mock.calls[0][1]).toEqual([1, 2]);
  });

  it('defaultReadPage：OpenAI 流累加 delta + 计价上报（图片 token 归因）', async () => {
    hoisted.getAiConfig.mockReturnValue({
      model: 'gpt-4o',
      remoteBaseUrl: 'https://api.example.com/v1',
      protocol: 'openai',
      apiKeyEnc: null,
    });
    hoisted.liteparseScreenshot.mockResolvedValue([
      { pageNum: 1, imageBuffer: Buffer.from('p1') },
    ]);
    hoisted.streamChatCompletion.mockImplementation(async function* () {
      yield { delta: 'structured ' };
      yield { delta: 'markdown', usage: { promptTokens: 100, completionTokens: 20 } };
    });
    const out = await runDRoute({
      buffer: Buffer.from('x'),
      fileName: 'a.pdf',
      fileType: 'pdf',
      pageCount: 1,
      fallbackText: '',
      userId: 'u1',
      deps: depsFor({ supportsVision: vi.fn(() => true) }), // readPage 走默认
    });
    expect(out.status).toBe('used');
    if (out.status === 'used') expect(out.text).toContain('structured markdown');
    expect(hoisted.streamChatCompletion).toHaveBeenCalledTimes(1);
    // 计价：图片 token 归因进 costTracker（二-4② 计价链路覆盖图片）
    expect(hoisted.recordUsage).toHaveBeenCalledTimes(1);
    const usageArg = hoisted.recordUsage.mock.calls[0][0];
    expect(usageArg.usage.imageTokens).toBe(estimateImageTokens(1));
    expect(usageArg.intent).toBe('document_d_route');
  });

  it('defaultReadPage：anthropic protocol 分流到 streamAnthropicCompletion', async () => {
    hoisted.getAiConfig.mockReturnValue({
      model: 'claude-sonnet-4',
      remoteBaseUrl: 'https://api.anthropic.com',
      protocol: 'anthropic',
      apiKeyEnc: null,
    });
    hoisted.liteparseScreenshot.mockResolvedValue([
      { pageNum: 1, imageBuffer: Buffer.from('p1') },
    ]);
    hoisted.streamAnthropicCompletion.mockImplementation(async function* () {
      yield { delta: 'anthropic ok' };
    });
    const out = await runDRoute({
      buffer: Buffer.from('x'),
      fileName: 'a.pdf',
      fileType: 'pdf',
      pageCount: 1,
      fallbackText: '',
      userId: 'u1',
      deps: depsFor({ supportsVision: vi.fn(() => true) }),
    });
    expect(out.status).toBe('used');
    expect(hoisted.streamAnthropicCompletion).toHaveBeenCalledTimes(1);
    expect(hoisted.streamChatCompletion).not.toHaveBeenCalled();
    if (out.status === 'used') expect(out.text).toContain('anthropic ok');
  });

  it('defaultReadPage：空响应抛错 → llm-failed 降级（不产出空 D 文本）', async () => {
    hoisted.getAiConfig.mockReturnValue({
      model: 'gpt-4o',
      remoteBaseUrl: 'https://api.example.com/v1',
      protocol: 'openai',
      apiKeyEnc: null,
    });
    hoisted.liteparseScreenshot.mockResolvedValue([
      { pageNum: 1, imageBuffer: Buffer.from('p1') },
    ]);
    hoisted.streamChatCompletion.mockImplementation(async function* () {
      yield { delta: '' };
    });
    const out = await runDRoute({
      buffer: Buffer.from('x'),
      fileName: 'a.pdf',
      fileType: 'pdf',
      pageCount: 1,
      fallbackText: 'fallback text',
      userId: 'u1',
      deps: depsFor({ supportsVision: vi.fn(() => true) }),
    });
    expect(out.status).toBe('degraded');
    if (out.status === 'degraded') {
      expect(out.reason).toBe('llm-failed');
      expect(out.text).toBe('fallback text');
    }
  });
});

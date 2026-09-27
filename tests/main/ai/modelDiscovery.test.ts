// ============================================
// B6 五-1：vision 能力检测（发送前降级判据）
// ============================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverModels,
  guessCapabilities,
  resolveVisionSupport,
  supportsVision,
} from '@main/ai/llm/modelDiscovery';

describe('modelDiscovery.supportsVision（B6 发送前检测 + remedial 判定链）', () => {
  it('accepts known vision-capable model ids（能力表含扩展项）', () => {
    expect(supportsVision('claude-sonnet-4')).toBe(true);
    expect(supportsVision('claude-3-5-sonnet-20241022')).toBe(true);
    expect(supportsVision('gpt-4o')).toBe(true);
    expect(supportsVision('gpt-4-turbo')).toBe(true);
    expect(supportsVision('o1-mini')).toBe(true);
    expect(supportsVision('qwen-vl-max')).toBe(true);
    expect(supportsVision('gemini-2.0-flash')).toBe(true);
    expect(supportsVision('deepseek-vl2')).toBe(true);
    expect(supportsVision('my-custom-vision-model')).toBe(true);
    // 能力表扩展（诊断 B-1：模式表漏判的多模态命名）
    expect(supportsVision('glm-4v')).toBe(true);
    expect(supportsVision('minicpm-v')).toBe(true);
    // 参数量命名但带 vision 标识 → vision 模式优先命中
    expect(supportsVision('llama-3.2-11b-vision')).toBe(true);
  });

  it('rejects known text-only models（已知非 vision 能力表）', () => {
    expect(supportsVision('deepseek-chat')).toBe(false);
    expect(supportsVision('deepseek-reasoner')).toBe(false);
    expect(supportsVision('gpt-3.5-turbo')).toBe(false);
    expect(supportsVision('qwen2.5-7b-instruct')).toBe(false);
    expect(supportsVision('qwen-plus')).toBe(false);
    expect(supportsVision('glm-4')).toBe(false);
    expect(supportsVision('llama-3.1-8b')).toBe(false);
    expect(supportsVision('text-embedding-3-small')).toBe(false);
    expect(supportsVision('')).toBe(false);
  });

  it('is optimistic on unclassifiable ids（未知模型默认乐观注入，既有降级链兜底）', () => {
    expect(supportsVision('my-finetune-20260101')).toBe(true);
    expect(supportsVision('my-private-deploy')).toBe(true);
    expect(supportsVision('gpt-5')).toBe(true);
  });

  it('resolveVisionSupport 判定链：覆盖优先 → 能力表 → 未知乐观', () => {
    // 用户覆盖强制开（已知非 vision 也被翻转）
    expect(resolveVisionSupport('deepseek-chat', true)).toBe(true);
    // 用户覆盖强制关（已知 vision 也被压住）
    expect(resolveVisionSupport('claude-sonnet-4', false)).toBe(false);
    // 无覆盖 → 能力表
    expect(resolveVisionSupport('deepseek-chat')).toBe(false);
    expect(resolveVisionSupport('claude-sonnet-4')).toBe(true);
    // 无覆盖 → 未知乐观
    expect(resolveVisionSupport('some-unknown-model')).toBe(true);
    expect(resolveVisionSupport('some-unknown-model', false)).toBe(false);
    // 未设置（undefined）与显式 false 区分：undefined 不强制
    expect(resolveVisionSupport('qwen-vl-max', undefined)).toBe(true);
  });

  it('guessCapabilities marks vision for supported ids (B6 检测复用同一判定)', () => {
    expect(guessCapabilities('claude-sonnet-4')).toContain('vision');
    expect(guessCapabilities('gpt-4o')).toContain('vision');
    expect(guessCapabilities('deepseek-chat')).not.toContain('vision');
    expect(guessCapabilities('deepseek-chat')).toContain('text');
    // 同源：未知模型乐观 → 能力标注同步含 vision
    expect(guessCapabilities('my-private-deploy')).toContain('vision');
  });
});

describe('modelDiscovery.discoverModels（OpenAI /models 列表 + 能力标注）', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('maps model ids with provider and capabilities（vision 标注与 supportsVision 同源）', async () => {
    globalThis.fetch = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({ data: [{ id: 'claude-sonnet-4' }, { id: 'deepseek-chat' }] }),
      }) as unknown as Response
    ) as unknown as typeof fetch;
    const models = await discoverModels('https://api.example.com', 'k');
    expect(models).toHaveLength(2);
    expect(models[0].capabilities).toContain('vision');
    expect(models[1].capabilities).not.toContain('vision');
    expect(models[1].capabilities).toContain('text');
  });

  it('returns [] on non-ok response and on thrown errors（不抛断链路）', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(discoverModels('https://api.example.com', 'k')).resolves.toEqual([]);
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(discoverModels('https://api.example.com', 'k')).resolves.toEqual([]);
  });

  it('returns [] when payload is not a model list', async () => {
    globalThis.fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ nope: 1 }) }) as unknown as Response
    ) as unknown as typeof fetch;
    await expect(discoverModels('https://api.example.com', 'k')).resolves.toEqual([]);
  });
});

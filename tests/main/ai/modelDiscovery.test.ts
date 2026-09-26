// ============================================
// B6 五-1：vision 能力检测（发送前降级判据）
// ============================================
import { describe, expect, it } from 'vitest';
import { guessCapabilities, supportsVision } from '@main/ai/llm/modelDiscovery';

describe('modelDiscovery.supportsVision（B6 发送前检测）', () => {
  it('accepts known vision-capable model ids', () => {
    expect(supportsVision('claude-sonnet-4')).toBe(true);
    expect(supportsVision('claude-3-5-sonnet-20241022')).toBe(true);
    expect(supportsVision('gpt-4o')).toBe(true);
    expect(supportsVision('gpt-4-turbo')).toBe(true);
    expect(supportsVision('o1-mini')).toBe(true);
    expect(supportsVision('qwen-vl-max')).toBe(true);
    expect(supportsVision('gemini-2.0-flash')).toBe(true);
    expect(supportsVision('deepseek-vl2')).toBe(true);
    expect(supportsVision('my-custom-vision-model')).toBe(true);
  });

  it('rejects text-only models', () => {
    expect(supportsVision('deepseek-chat')).toBe(false);
    expect(supportsVision('deepseek-reasoner')).toBe(false);
    expect(supportsVision('gpt-3.5-turbo')).toBe(false);
    expect(supportsVision('qwen2.5-7b-instruct')).toBe(false);
    expect(supportsVision('')).toBe(false);
  });

  it('is conservative on unclassifiable ids（未知模型按不支持处理，避免整条请求被 API 拒绝）', () => {
    expect(supportsVision('my-finetune-20260101')).toBe(false);
    expect(supportsVision('llama-3.1-8b')).toBe(false);
  });

  it('guessCapabilities marks vision for supported ids (B6 检测复用同一判定)', () => {
    expect(guessCapabilities('claude-sonnet-4')).toContain('vision');
    expect(guessCapabilities('gpt-4o')).toContain('vision');
    expect(guessCapabilities('deepseek-chat')).not.toContain('vision');
    expect(guessCapabilities('deepseek-chat')).toContain('text');
  });
});

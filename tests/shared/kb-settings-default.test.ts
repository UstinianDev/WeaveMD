import { describe, expect, it } from 'vitest';
import { DEFAULT_KB_SETTINGS, normalizeKbSettings, type IKbSettings } from '@shared/ai';

/**
 * 第 6 期批次 1：KB 参数持久化默认值工厂。
 * DEFAULT_KB_SETTINGS 与 agentStore RESET_FIELDS、主进程迁移 DEFAULT 单一真值。
 */
describe('DEFAULT_KB_SETTINGS / normalizeKbSettings（批次1 新增）', () => {
  it('DEFAULT_KB_SETTINGS 与 IKbSettings 六字段对齐', () => {
    const d = DEFAULT_KB_SETTINGS;
    expect(d.topK).toBe(5);
    expect(d.fuse).toBe(0.5);
    expect(d.threshold).toBe(0.6);
    expect(d.pinnedWeight).toBe(1.5);
    expect(d.embeddingHost).toBe('http://localhost:11434');
    expect(d.embeddingModel).toBe('nomic-embed-text');
  });

  it('undefined/null 入参返回默认值', () => {
    expect(normalizeKbSettings(undefined)).toEqual(DEFAULT_KB_SETTINGS);
    expect(normalizeKbSettings(null)).toEqual(DEFAULT_KB_SETTINGS);
  });

  it('部分字段补齐，其余回落默认', () => {
    const out = normalizeKbSettings({ topK: 12, fuse: 0.7 });
    expect(out.topK).toBe(12);
    expect(out.fuse).toBe(0.7);
    expect(out.threshold).toBe(0.6);
    expect(out.pinnedWeight).toBe(1.5);
    expect(out.embeddingHost).toBe('http://localhost:11434');
    expect(out.embeddingModel).toBe('nomic-embed-text');
  });

  it('非法数值与空串回落默认', () => {
    const out = normalizeKbSettings({
      topK: NaN,
      fuse: Number.POSITIVE_INFINITY,
      embeddingHost: '',
      embeddingModel: '',
    } as unknown as Partial<IKbSettings>);
    expect(out.topK).toBe(5);
    expect(out.fuse).toBe(0.5);
    expect(out.embeddingHost).toBe('http://localhost:11434');
    expect(out.embeddingModel).toBe('nomic-embed-text');
  });

  it('完整合法入参原样透传', () => {
    const full: IKbSettings = { ...DEFAULT_KB_SETTINGS, topK: 20, threshold: 0.4 };
    expect(normalizeKbSettings(full)).toEqual(full);
  });
});

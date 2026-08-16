// ============================================
// WeaveMD — B2 (phase-7): 命名「代理」→「智能体」
// 验收：界面任何对用户展示处不再出现「代理」，统一「智能体」（en 保持 Agent/Assistant）
// 锁定的关键字为 ai.tab.agent（Tab 标签 + 会话 chip 兜底名）。
// ============================================

import { describe, expect, it } from 'vitest';
import type { LanguageType } from '@shared/types';
import en from '@render/i18n/en.json';
import zhCN from '@render/i18n/zh-CN.json';
import zhTW from '@render/i18n/zh-TW.json';

type Translations = Record<string, string>;

const dicts: Array<{ lang: LanguageType; dict: Translations }> = [
  { lang: 'en', dict: en as Translations },
  { lang: 'zh-CN', dict: zhCN as Translations },
  { lang: 'zh-TW', dict: zhTW as Translations },
];

describe('i18n 键集一致性（B2 要求：三文件键集一致）', () => {
  it('en / zh-CN / zh-TW 键集完全一致且次序一致', () => {
    const keys = (d: Translations) => Object.keys(d).join('|');
    const [enDict, cnDict, twDict] = dicts.map((d) => d.dict);
    expect(keys(enDict)).toBe(keys(cnDict));
    expect(keys(cnDict)).toBe(keys(twDict));
    expect(keys(enDict)).toBe(keys(twDict));
    expect(Object.keys(cnDict).length).toBeGreaterThan(0);
  });
});

describe('B2 验收：界面对人展示处统一「智能体」，不再出现「代理」', () => {
  it('zh-CN / zh-TW 的 ai.tab.agent 为「智能体」（zh-TW 用繁体「智能體」）', () => {
    expect(zhCN['ai.tab.agent']).toBe('智能体');
    expect(zhTW['ai.tab.agent']).toBe('智能體');
  });

  it('en 的 ai.tab.agent 保持英文（Agent）', () => {
    expect(en['ai.tab.agent']).toBe('Agent');
  });

  it('ai.* 域所有展示键在 zh-CN / zh-TW 中不含「代理」', () => {
    for (const { lang, dict } of dicts) {
      const offendingAiKeys = Object.entries(dict)
        .filter(([key]) => key.startsWith('ai.'))
        .filter(([, val]) => val.includes('代理'));
      // 中文文案不应再出现「代理」；en 无「代理」字样天然通过
      expect(
        offendingAiKeys,
        `${lang} 仍含「代理」的 ai.* 键: ${offendingAiKeys.map(([k]) => k).join(', ')}`
      ).toEqual([]);
    }
  });

  it('zh-CN / zh-TW 全文（非 ai.* 之外亦然）不得有「代理」展示键', () => {
    for (const { lang, dict } of dicts) {
      const offending = Object.entries(dict).filter(([, val]) => val.includes('代理'));
      expect(
        offending,
        `${lang} 仍含「代理」的键: ${offending.map(([k]) => k).join(', ')}`
      ).toEqual([]);
    }
  });
});

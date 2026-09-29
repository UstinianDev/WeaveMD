import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  generateClarifyQuestions,
  needsClarification,
  refineQuery,
  buildClarificationContext,
} from '@main/ai/knowledge/knowledgeClarify';
import type { IQueryUnderstanding, AmbiguityType } from '@shared/ai/kb';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const SOURCE_REL = path.join('src', 'main', 'ai', 'knowledge', 'knowledgeClarify.ts');

/** 构造 IQueryUnderstanding，默认值取「无歧义 + 高置信」。 */
function makeUnderstanding(over: Partial<IQueryUnderstanding> = {}): IQueryUnderstanding {
  return {
    intent: 'fact',
    intents: ['fact'],
    standalone: '如何配置 TypeScript 严格模式',
    expanded: [],
    ambiguities: [],
    confidence: 0.9,
    ...over,
  };
}

const ALL_AMBIGUITIES: AmbiguityType[] = [
  'pronoun_reference',
  'missing_subject',
  'broad_scope',
  'too_short',
  'semantic_ambiguity',
];

// ---------------------------------------------------------------------------
// 1. needsClarification 规则分支（源码 :75-86，按实际分支逐条覆盖）
// ---------------------------------------------------------------------------

describe('needsClarification 分支', () => {
  it('分支1：搜索被拒 + 有歧义 → true', () => {
    const u = makeUnderstanding({ ambiguities: ['pronoun_reference'], confidence: 0.9 });
    expect(needsClarification(u, true)).toBe(true);
  });

  it('分支2：未被拒 + 置信度 < 0.5 → true', () => {
    const u = makeUnderstanding({ confidence: 0.49 });
    expect(needsClarification(u, false)).toBe(true);
  });

  it('分支2 边界：置信度恰为 0.5 不触发', () => {
    const u = makeUnderstanding({ confidence: 0.5 });
    expect(needsClarification(u, false)).toBe(false);
  });

  it('分支3：搜索被拒 + standalone 长度 < 4 → true（置信度高且无歧义）', () => {
    const u = makeUnderstanding({ standalone: 'abc', confidence: 0.9 });
    expect(needsClarification(u, true)).toBe(true);
  });

  it('分支3 边界：搜索被拒 + standalone 长度 = 4 → false', () => {
    const u = makeUnderstanding({ standalone: 'abcd', confidence: 0.9 });
    expect(needsClarification(u, true)).toBe(false);
  });

  it('仅歧义、未被拒 → false（歧义不单独触发澄清）', () => {
    const u = makeUnderstanding({ ambiguities: ['broad_scope'], confidence: 0.9 });
    expect(needsClarification(u, false)).toBe(false);
  });

  it('未被拒 + 无歧义 + 高置信 → false', () => {
    expect(needsClarification(makeUnderstanding(), false)).toBe(false);
  });

  it('未被拒 + 短查询但高置信 → false（分支3 要求 searchRefused）', () => {
    const u = makeUnderstanding({ standalone: 'abc', confidence: 0.9 });
    expect(needsClarification(u, false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. questionsForAmbiguity 模板占位符（经 generateClarifyQuestions 暴露）
// ---------------------------------------------------------------------------

describe('澄清问题模板占位符', () => {
  it('五种歧义各生成 1 条问题，顺序与输入一致', () => {
    const u = makeUnderstanding({ ambiguities: [...ALL_AMBIGUITIES] });
    const qs = generateClarifyQuestions(u);
    expect(qs).toHaveLength(5);
    expect(qs.map((q) => q.id.split('-')[1])).toEqual([
      'pronoun',
      'subject',
      'scope',
      'short',
      'semantic',
    ]);
  });

  it('插值模板统一使用「」，不出现『』（方向文档误写口径）', () => {
    const query = '它有什么优势';
    const u = makeUnderstanding({ ambiguities: [...ALL_AMBIGUITIES], standalone: query });
    const qs = generateClarifyQuestions(u);

    // 全部模板文本均不得含直角引号的镜像变体
    for (const q of qs) {
      expect(q.text).not.toContain('『');
      expect(q.text).not.toContain('』');
    }

    // 三条插值模板逐字校验占位符形态
    expect(qs[0].text).toBe(`你提到的「${query}」具体指的是什么？`);
    expect(qs[2].text).toBe(`你想了解「${query}」的哪个方面？`);
    expect(qs[4].text).toBe(
      `你提到的「${query}」可能有多种理解，能否说明你具体指的是哪个方面？`
    );

    // 插值模板必然成对含「与」
    for (const idx of [0, 2, 4]) {
      expect(qs[idx].text).toContain('「');
      expect(qs[idx].text).toContain('」');
    }
  });

  it('各歧义类型的问题类型与选项符合实现', () => {
    const getOne = (a: AmbiguityType) =>
      generateClarifyQuestions(makeUnderstanding({ ambiguities: [a] }))[0];

    expect(getOne('pronoun_reference')).toMatchObject({ type: 'text' });
    expect(getOne('missing_subject')).toEqual({
      id: expect.stringMatching(/^clarify-subject-\d+$/),
      text: '能否提供更多细节？你具体想了解什么？',
      type: 'text',
    });
    expect(getOne('too_short').text).toBe('请描述更详细一些，你想查找什么信息？');
    expect(getOne('broad_scope')).toMatchObject({
      type: 'choice',
      options: ['概念解释', '操作步骤', '技术细节', '最佳实践'],
    });
    expect(getOne('semantic_ambiguity').type).toBe('text');
  });

  it('无歧义 + 置信度 < 0.6 → 通用 choice 兜底', () => {
    const qs = generateClarifyQuestions(makeUnderstanding({ confidence: 0.55 }));
    expect(qs).toHaveLength(1);
    expect(qs[0]).toEqual({
      id: expect.stringMatching(/^clarify-confidence-\d+$/),
      text: '检索结果不太确定，你想查找的是以下哪种内容？',
      type: 'choice',
      options: ['相关文档', '操作指南', '技术原理', '其他'],
    });
  });

  it('有歧义时即使置信度低也不追加兜底问题', () => {
    const qs = generateClarifyQuestions(
      makeUnderstanding({ ambiguities: ['too_short'], confidence: 0.2 })
    );
    expect(qs).toHaveLength(1);
    expect(qs[0].id).toMatch(/^clarify-short-/);
  });

  it('无歧义 + 置信度 ≥ 0.6 → 不生成任何问题', () => {
    expect(generateClarifyQuestions(makeUnderstanding({ confidence: 0.6 }))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. 有历史上下文时不误触发澄清（本文件自身规则口径）
// ---------------------------------------------------------------------------

describe('历史上下文与澄清门控', () => {
  it('源文件不含任何 history 引用（门控在 queryPlanner.ts:432）', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), SOURCE_REL), 'utf-8');
    expect(src).not.toMatch(/\bhistory\b/);
  });

  it('历史已消解歧义的理解结果（无歧义 + 高置信 + 未被拒）不触发澄清', () => {
    const resolved = makeUnderstanding({ ambiguities: [], confidence: 0.92 });
    expect(needsClarification(resolved, false)).toBe(false);
    expect(generateClarifyQuestions(resolved)).toHaveLength(0);
    expect(buildClarificationContext(resolved, false)).toBeNull();
  });

  it('歧义残留且搜索被拒（等价无历史可消歧）时照常触发澄清', () => {
    const residual = makeUnderstanding({ ambiguities: ['pronoun_reference'], confidence: 0.4 });
    expect(needsClarification(residual, true)).toBe(true);
    expect(buildClarificationContext(residual, true)).not.toBeNull();
  });

  it('置信度 0.5~0.6 区间：不需澄清但已有问题，context 仍为 null（两处阈值独立）', () => {
    const u = makeUnderstanding({ confidence: 0.55 });
    expect(needsClarification(u, false)).toBe(false);
    expect(generateClarifyQuestions(u).length).toBeGreaterThan(0);
    expect(buildClarificationContext(u, false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. refineQuery
// ---------------------------------------------------------------------------

describe('refineQuery', () => {
  it('空答案 / 全空串 → 原样返回', () => {
    expect(refineQuery('如何配置 ESLint', {})).toBe('如何配置 ESLint');
    expect(refineQuery('如何配置 ESLint', { q1: '', q2: '   ' })).toBe('如何配置 ESLint');
  });

  it('追加新关键词并去首尾空白', () => {
    expect(refineQuery('如何配置 ESLint', { q1: ' flat config ' })).toBe(
      '如何配置 ESLint flat config'
    );
  });

  it('关键词已包含 → 不重复追加', () => {
    expect(refineQuery('如何配置 ESLint', { q1: 'ESLint' })).toBe('如何配置 ESLint');
  });
});

// ---------------------------------------------------------------------------
// 5. buildClarificationContext（分轮策略）
// ---------------------------------------------------------------------------

describe('buildClarificationContext', () => {
  const it2 = (a: AmbiguityType, b: AmbiguityType) =>
    makeUnderstanding({ ambiguities: [a, b], confidence: 0.9 });

  it('不需要澄清 → null', () => {
    expect(buildClarificationContext(makeUnderstanding(), false)).toBeNull();
  });

  it('需要澄清但无问题可出 → null（被拒 + 短查询 + 高置信 + 无歧义）', () => {
    const u = makeUnderstanding({ standalone: 'abc', confidence: 0.9 });
    expect(needsClarification(u, true)).toBe(true);
    expect(buildClarificationContext(u, true)).toBeNull();
  });

  it('仅 text 类 → 第1轮（核心歧义消解），无第2轮', () => {
    const out = buildClarificationContext(it2('pronoun_reference', 'missing_subject'), true);
    expect(out).not.toBeNull();
    expect(out).toContain('第1轮（核心歧义消解）');
    expect(out).not.toContain('第2轮');
    expect(out).toContain('1. [text]');
    expect(out).toContain('2. [text]');
  });

  it('仅 choice 类 → 第1轮（范围细化），选项以 / 连接', () => {
    const out = buildClarificationContext(makeUnderstanding({ ambiguities: ['broad_scope'] }), false);
    // 单独歧义不触发澄清，改用「被拒 + 歧义」路径
    const out2 = buildClarificationContext(
      makeUnderstanding({ ambiguities: ['broad_scope'] }),
      true
    );
    expect(out).toBeNull();
    expect(out2).toContain('第1轮（范围细化）');
    expect(out2).not.toContain('第2轮');
    expect(out2).toContain('（概念解释/操作步骤/技术细节/最佳实践）');
  });

  it('text + choice 混合 → 第1轮 text、第2轮 choice，序号连续', () => {
    const out = buildClarificationContext(
      it2('missing_subject', 'broad_scope'),
      true
    );
    expect(out).toContain('第1轮（核心歧义消解）');
    expect(out).toContain('第2轮（范围细化）');
    expect(out).toContain('1. [text]');
    expect(out).toContain('2. [choice]');
  });

  it('每轮最多 2 题：text 与 choice 均被截断', () => {
    const out = buildClarificationContext(
      makeUnderstanding({
        ambiguities: ['pronoun_reference', 'missing_subject', 'too_short', 'semantic_ambiguity'],
        confidence: 0.9,
      }),
      true
    );
    expect(out).toContain('1. [text]');
    expect(out).toContain('2. [text]');
    expect(out).not.toContain('3. [text]');

    const outChoice = buildClarificationContext(
      makeUnderstanding({
        ambiguities: ['broad_scope', 'broad_scope', 'broad_scope'],
        confidence: 0.9,
      }),
      true
    );
    expect(outChoice).toContain('1. [choice]');
    expect(outChoice).toContain('2. [choice]');
    expect(outChoice).not.toContain('3. [choice]');
  });

  it('头部提示含 ask_question_card 与分轮约束，返回值已 trim', () => {
    const out = buildClarificationContext(
      makeUnderstanding({ ambiguities: ['pronoun_reference'], confidence: 0.9 }),
      true
    );
    expect(out).toContain('[知识库检索发现歧义');
    expect(out).toContain('ask_question_card');
    expect(out).toContain('最多2轮，每轮最多2个问题');
    expect(out?.endsWith('\n')).toBe(false);
    expect(out?.startsWith('[知识库检索发现歧义')).toBe(true);
  });
});

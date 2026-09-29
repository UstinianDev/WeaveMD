// ============================================
// WeaveMD — Agent Prompt Builder Tests (agent-cost-optimize)
// ============================================
// A1 域规则 / A2 回答格式条件化 / A3 强制铺陈改写 / A4 长度上限 / A5 模板改写
// B1 文档上下文意图门控谓词
// 质量护栏：豁免关键词必须在位

import { describe, expect, it } from 'vitest';
import {
  buildAgentSystemPrompt,
  buildDocumentContext,
  shouldInjectDocumentContext,
  CHAT_SYSTEM_PROMPT,
  FILE_OP_NARRATION_TOKEN_LIMIT,
  FILE_OP_NARRATION_TOKEN_LIMITS,
} from '@main/ai/agent/agentPromptBuilder';

const prompt = buildAgentSystemPrompt('', '', false);
const clarificationPrompt = buildAgentSystemPrompt('', '', true);

// ---------------------------------------------------------------------------
// A1 文件操作叙述域规则
// ---------------------------------------------------------------------------

describe('A1 — 文件操作后的回复 域规则', () => {
  it('包含域规则段标题', () => {
    expect(prompt).toContain('## 文件操作后的回复');
  });

  it('列举全部写工具', () => {
    for (const tool of [
      'createFile', 'createFolder', 'editBlocks', 'editLocalFile',
      'renameFile', 'moveFile', 'deleteFile', 'deleteLocalFile',
      'preview_file_revision', 'preview_patch_files',
    ]) {
      expect(prompt).toContain(tool);
    }
  });

  it('禁止复述 diff 卡片已展示的变更内容', () => {
    expect(prompt).toContain('diff');
    expect(prompt).toMatch(/禁止在回复中复述/);
  });

  it('规定 2 行上限', () => {
    expect(prompt).toMatch(/不超过\s*2\s*行/);
  });

  it('不加标题/列表/总结段/后续建议', () => {
    expect(prompt).toContain('标题');
    expect(prompt).toContain('总结段');
    expect(prompt).toContain('后续建议');
  });
});

// ---------------------------------------------------------------------------
// A2 回答格式条件化
// ---------------------------------------------------------------------------

describe('A2 — 回答格式 条件化', () => {
  it('保留原有的结构化 Markdown 规则（未删除）', () => {
    expect(prompt).toContain('善用标题');
    expect(prompt).toContain('fenced code block');
  });

  it('结构化规则限定在知识类回答', () => {
    expect(prompt).toContain('知识类回答');
  });

  it('文件操作轮次指向域规则而非结构化报告', () => {
    expect(prompt).toContain('文件操作轮次');
    expect(prompt).toContain('## 文件操作后的回复');
  });
});

// ---------------------------------------------------------------------------
// A3 强制铺陈规则改写
// ---------------------------------------------------------------------------

describe('A3 — 写入规则改写', () => {
  it('不再要求「直接执行并告知结果」', () => {
    expect(prompt).not.toContain('直接执行并告知结果');
  });

  it('不再要求删除前说明内容和原因', () => {
    expect(prompt).not.toContain('必须在回复中说明即将删除的内容和原因');
  });

  it('结果告知降为执行成功即可', () => {
    expect(prompt).toContain('执行成功即可');
  });

  it('保留高风险操作的确认等待', () => {
    expect(prompt).toContain('等待用户确认');
  });

  it('保留删除强制确认卡片说明', () => {
    expect(prompt).toContain('强制弹出确认卡片');
  });

  it('目标不唯一时才列清单', () => {
    expect(prompt).toContain('删除目标不唯一');
    expect(prompt).toContain('将删清单');
  });
});

// ---------------------------------------------------------------------------
// A4 长度上限常量
// ---------------------------------------------------------------------------

describe('A4 — 叙述长度硬上限', () => {
  it('导出默认档位 80 tokens', () => {
    expect(FILE_OP_NARRATION_TOKEN_LIMIT).toBe(80);
  });

  it('导出可调档位 0/40/80/160', () => {
    expect([...FILE_OP_NARRATION_TOKEN_LIMITS]).toEqual([0, 40, 80, 160]);
  });

  it('默认值落在档位内', () => {
    expect(FILE_OP_NARRATION_TOKEN_LIMITS).toContain(
      FILE_OP_NARRATION_TOKEN_LIMIT as (typeof FILE_OP_NARRATION_TOKEN_LIMITS)[number]
    );
  });

  it('把上限写进系统提示', () => {
    expect(prompt).toContain(`${FILE_OP_NARRATION_TOKEN_LIMIT}`);
    expect(prompt).toContain('tokens');
  });
});

// ---------------------------------------------------------------------------
// A5 参考 rules 模板改写（写作 Agent 适配）
// ---------------------------------------------------------------------------

describe('A5 — 参考模板改写并入', () => {
  it('保留回复风格域：禁寒暄', () => {
    expect(prompt).toContain('寒暄');
  });

  it('保留回复风格域：结论先行', () => {
    expect(prompt).toContain('结论');
  });

  it('保留回复风格域：不解释基础概念', () => {
    expect(prompt).toContain('基础概念');
  });

  it('保留格式域：列表不超过 5 项', () => {
    expect(prompt).toMatch(/列表不超过\s*5\s*项/);
  });

  it('保留格式域：段落最多 3 句话', () => {
    expect(prompt).toMatch(/段落最多\s*3\s*句话/);
  });

  it('保留原有禁 emoji 条款', () => {
    expect(prompt).toContain('emoji');
  });

  it('未注入代码开发专用规则（只出 diff / 新建才出全量 / 叙述性注释）', () => {
    expect(prompt).not.toContain('只输出 diff 或变更部分');
    expect(prompt).not.toContain('新建文件时才输出完整代码');
    expect(prompt).not.toContain('叙述性注释');
  });

  it('澄清场景下域规则同样生效', () => {
    expect(clarificationPrompt).toContain('## 文件操作后的回复');
    expect(clarificationPrompt).toContain('寒暄');
  });
});

// ---------------------------------------------------------------------------
// 质量护栏 — 豁免清单
// ---------------------------------------------------------------------------

describe('质量护栏 — 豁免项必须在位', () => {
  it('护栏 2：ask_question_card 澄清提问不受域规则限制', () => {
    expect(prompt).toContain('ask_question_card');
    expect(prompt).toMatch(/提问文本.*不适用|不适用于.*提问文本/);
  });

  it('护栏 1：产物 payload 不受域规则限制', () => {
    expect(prompt).toMatch(/payload.*不适用|不适用.*payload/);
    expect(prompt).toContain('createFile.content');
  });

  it('护栏 2：分轮澄清策略未被削减', () => {
    expect(prompt).toContain('分轮澄清策略');
    expect(prompt).toContain('每轮最多 2 个问题');
    expect(prompt).toContain('round 和 totalRounds');
  });

  it('护栏 4：错误与安全警告未被削减', () => {
    expect(prompt).toContain('此操作不可恢复');
  });

  it('护栏 5：知识类回答仍可用完整结构化格式', () => {
    const seg = prompt.slice(prompt.indexOf('## 回答格式'));
    expect(seg).toContain('知识类回答');
    expect(seg).toContain('Markdown');
  });

  it('护栏：铁律提问工具未被削减', () => {
    expect(prompt).toContain('【铁律】');
    expect(prompt).toContain('ask_question_card 工具');
  });
});

// ---------------------------------------------------------------------------
// B1 — 文档上下文意图门控
// ---------------------------------------------------------------------------

describe('B1 — shouldInjectDocumentContext 意图门控', () => {
  it('写作意图注入', () => {
    expect(shouldInjectDocumentContext('rewrite', '正文')).toBe(true);
    expect(shouldInjectDocumentContext('create', '正文')).toBe(true);
    expect(shouldInjectDocumentContext('tech', '正文')).toBe(true);
  });

  it('非写作意图不注入', () => {
    expect(shouldInjectDocumentContext('chat', '正文')).toBe(false);
    expect(shouldInjectDocumentContext('kbQa', '正文')).toBe(false);
    expect(shouldInjectDocumentContext('web', '正文')).toBe(false);
  });

  it('缺文档或空白文档不注入', () => {
    expect(shouldInjectDocumentContext('rewrite', undefined)).toBe(false);
    expect(shouldInjectDocumentContext('rewrite', '')).toBe(false);
    expect(shouldInjectDocumentContext('rewrite', '   \n  ')).toBe(false);
  });

  it('buildDocumentContext 空文档仍返回 null（行为不变）', () => {
    expect(buildDocumentContext('')).toBeNull();
    expect(buildDocumentContext(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B9 三-1② — 文件引用模式：只带文件名+路径+摘要，正文不整篇内联
// ---------------------------------------------------------------------------

describe('B9 三-1 — buildDocumentContext 文件引用模式', () => {
  const longDoc = [
    '# 深度指南',
    '',
    '开头段落第一行。',
    ...Array.from({ length: 36 }, (_, i) => `第${i + 4}行内容。`),
    'TAIL_MARKER_XYZ',
    '结尾行。',
  ].join('\n');

  it('带 fileRef：注入文件名+路径+摘要，不整篇内联（正文标记不出现）', () => {
    const out = buildDocumentContext(longDoc, { name: 'huge.md', path: '/ws/docs/huge.md' });
    expect(out).not.toBeNull();
    const text = out ?? '';
    expect(text).toContain('huge.md');
    expect(text).toContain('/ws/docs/huge.md');
    expect(text).toContain('readLocalFile');
    // 规模统计 + 标题大纲 + 开头若干行 = 摘要构成
    expect(text).toMatch(/共\s*\d+\s*行/);
    expect(text).toContain('# 深度指南');
    expect(text).toContain('开头段落第一行。');
    // 正文深处不内联
    expect(text).not.toContain('TAIL_MARKER_XYZ');
    // 有界：摘要不会随文档规模线性膨胀
    expect(text.length).toBeLessThan(2500);
  });

  it('短文档带 fileRef 同样走引用模式（不因篇幅短而整篇内联）', () => {
    const out = buildDocumentContext('# 短文\n\n只有两行。', {
      name: 's.md',
      path: '/ws/s.md',
    });
    expect(out).toContain('/ws/s.md');
    expect(out).toContain('只有两行。');
    expect(out).toContain('readLocalFile');
  });

  it('无 fileRef 保持旧行为（DB 文档无磁盘路径，整篇注入+超长截断）', () => {
    const legacy = buildDocumentContext('# 标题\n\n首段内容');
    expect(legacy).toContain('# 标题\n\n首段内容');
    const huge = '字'.repeat(20_008);
    const cut = buildDocumentContext(huge);
    expect(cut).toContain('文档过长已截断');
  });

  it('空文档即使带 fileRef 也返回 null', () => {
    expect(buildDocumentContext('', { name: 'n.md', path: '/ws/n.md' })).toBeNull();
    expect(buildDocumentContext(undefined, { name: 'n.md', path: '/ws/n.md' })).toBeNull();
  });

  it('超长单行文档：摘要按字符上限截断（防单行爆量）', () => {
    const oneLine = `# x ${'字'.repeat(50_000)}`;
    const out = buildDocumentContext(oneLine, { name: 'big.md', path: '/ws/big.md' }) ?? '';
    expect(out.length).toBeLessThan(2500);
    expect(out).toContain('big.md');
  });
});

// ---------------------------------------------------------------------------
// P0-2 — 反上下文文案移除（四处同批；本文件覆盖三处：核心规则 / 澄清变体 / CHAT）
// ---------------------------------------------------------------------------

/** P0-2 统一措辞（四处同批改写的目标文案）。 */
const UNIFIED_WORDING = '历史与摘要仅用于理解当前问题中的指代与上下文，不要延续上一轮未完成的作答';

describe('P0-2 — 去反上下文统一措辞', () => {
  const targets: Array<[string, string]> = [
    ['buildAgentSystemPrompt', buildAgentSystemPrompt('', '', false)],
    ['buildAgentSystemPrompt(需澄清)', buildAgentSystemPrompt('', '', true)],
    ['CHAT_SYSTEM_PROMPT', CHAT_SYSTEM_PROMPT],
  ];

  for (const [name, text] of targets) {
    it(`${name} 不含反上下文表述`, () => {
      expect(text).not.toContain('忽略之前的所有对话');
      expect(text).not.toContain('独立的新');
      expect(text).not.toContain('不要延续之前的问题');
    });

    it(`${name} 保留防串题条款 + 统一措辞`, () => {
      expect(text).toContain('必须且只能回答用户的最后一条消息');
      expect(text).toContain(UNIFIED_WORDING);
    });
  }

  it('核心规则条目编号与其余规则不动', () => {
    expect(prompt).toContain('【核心规则】');
    expect(prompt).toContain('1. 你必须且只能回答用户的最后一条消息');
    expect(prompt).toContain(`2. ${UNIFIED_WORDING}`);
    expect(prompt).toContain('3. 用户消息中的指代词（如“它”“这个”）结合历史与摘要理解所指对象');
    expect(prompt).toContain('4. 当看到 "=== 当前用户问题 ===" 标记时，那是你必须回答的问题');
  });

  it('CHAT 核心规则条目编号不动', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('1. 你必须且只能回答用户的最后一条消息');
    expect(CHAT_SYSTEM_PROMPT).toContain(`2. ${UNIFIED_WORDING}`);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/\n3\. /);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/\n4\. /);
  });

  it('CHAT 注意力锚点与工具禁令保持不变', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('【核心规则】');
    expect(CHAT_SYSTEM_PROMPT).toContain('【注意力锚点】');
    expect(CHAT_SYSTEM_PROMPT).toContain('不要提及工具、文件或文档');
  });
});

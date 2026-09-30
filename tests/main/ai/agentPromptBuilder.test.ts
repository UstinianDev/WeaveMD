// ============================================
// WeaveMD — Agent Prompt Builder Tests (agent-cost-optimize)
// ============================================
// A1 域规则 / A2 回答格式条件化 / A3 强制铺陈改写 / A4 长度上限 / A5 模板改写
// B1 文档上下文意图门控谓词
// 质量护栏：豁免关键词必须在位

import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import {
  buildAgentSystemPrompt,
  buildChatSystemPrompt,
  buildDocumentContext,
  shouldInjectDocumentContext,
  CHAT_SYSTEM_PROMPT,
  FILE_OP_NARRATION_TOKEN_LIMIT,
  FILE_OP_NARRATION_TOKEN_LIMITS,
  GLOBAL_FILES_TOKEN_LIMIT,
  PROFILE_TOKEN_LIMIT,
} from '@main/ai/agent/agentPromptBuilder';
import { estimateTokens } from '@main/ai/utils/tokenEstimator';

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

// ---------------------------------------------------------------------------
// A1 — soul/memory/style 三文件注入 system prompt（Q2 三文件同批 / Q3 落点 / Q4 上限）
// ---------------------------------------------------------------------------

/** Q4：全局 Agent 文件块 token 硬上限。 */
const TOKEN_LIMIT = 2000;

/** TDD 前实测的改动前基线（sha256 逐字比对，防「不传参输出变了」）。
 *  C1（memory-2 子批）在【工具规则】新增 memory_read/memory_write 一条 →
 *  plain/clarify/withSnapshots 三个 agent 提示基线按新文案重测；chat 基线不含工具规则，保持不变。 */
const BASELINE_SHA256 = {
  plain: '68df4ba5b41d3cbc3a4a627164020e53d4b66377bea8fe2b2b35990ff484907e',
  clarify: '1ff5fd335de174add360069553ad7b36662d1bc47e029eb5ed75855ad020618e',
  withSnapshots: 'a5d8ba19ccec43f0438f1d82798edb0b0dd6c68e0acac1d98b797ad41fd278ea',
  chat: '5fe8db450e65ee999f8ea943b730d6577194db0c50997e1ebc55bcefa101210d',
};

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('A1 — 全局 Agent 文件（soul/memory/style）注入', () => {
  const SOUL = 'SOUL_MARKER_保持直接冷静';
  const MEMORY = 'MEMORY_MARKER_用户偏好与已确认决策';
  const STYLE = 'STYLE_MARKER_写作风格保留事实';
  const block = [
    '【全局 Agent 文件】以下为用户配置的全局 Agent 文件。',
    '',
    [`=== soul.md（性格） ===\n${SOUL}`, `=== memory.md（记忆） ===\n${MEMORY}`, `=== style.md（风格） ===\n${STYLE}`].join('\n\n'),
  ].join('\n');

  it('三文件内容进输出，且位于【核心规则】之后、## 工作流 之前', () => {
    const out = buildAgentSystemPrompt('', '', false, '', block);
    const idxCore = out.indexOf('【核心规则】');
    const idxBlock = out.indexOf(SOUL);
    const idxWorkflow = out.indexOf('## 工作流');
    expect(idxCore).toBeGreaterThan(-1);
    expect(idxBlock).toBeGreaterThan(idxCore);
    expect(idxWorkflow).toBeGreaterThan(idxBlock);
    expect(out).toContain(MEMORY);
    expect(out).toContain(STYLE);
    expect(out).toContain('soul.md');
    expect(out).toContain('memory.md');
    expect(out).toContain('style.md');
  });

  it('不传第 5 参（或传空串）输出与改动前逐字一致（sha256 基线）', () => {
    expect(sha256(buildAgentSystemPrompt('', '', false))).toBe(BASELINE_SHA256.plain);
    expect(sha256(buildAgentSystemPrompt('', '', true))).toBe(BASELINE_SHA256.clarify);
    expect(sha256(buildAgentSystemPrompt('FILELIST', 'TREE', false, 'ATTMANIFEST'))).toBe(
      BASELINE_SHA256.withSnapshots
    );
    expect(sha256(CHAT_SYSTEM_PROMPT)).toBe(BASELINE_SHA256.chat);
    // 空串与不传参等价（agentContext 读取失败时的降级路径）
    expect(sha256(buildAgentSystemPrompt('', '', false, '', ''))).toBe(BASELINE_SHA256.plain);
    // 纯空白块同样不注入（不产生空行噪音）
    expect(sha256(buildAgentSystemPrompt('', '', false, '', '   \n  '))).toBe(
      BASELINE_SHA256.plain
    );
  });

  it('超过 2000 token 触发截断并在块尾标注', () => {
    const huge = `【全局 Agent 文件】\n${'很长的记忆内容'.repeat(4000)}`;
    expect(estimateTokens(huge)).toBeGreaterThan(TOKEN_LIMIT);
    const out = buildAgentSystemPrompt('', '', false, '', huge);
    expect(out).toContain('已截断');
    expect(out).toContain('完整内容见设置页');
    // 截断后的块（含标注）不超上限
    const seg = out
      .slice(out.indexOf('【全局 Agent 文件】'), out.indexOf('## 工作流'))
      .trim();
    expect(estimateTokens(seg)).toBeLessThanOrEqual(TOKEN_LIMIT);
    expect(estimateTokens(seg)).toBeGreaterThan(0);
  });

  it('2000 token 以内的块不截断（标注不出现）', () => {
    const small = `【全局 Agent 文件】\n${SOUL}`;
    expect(estimateTokens(small)).toBeLessThanOrEqual(TOKEN_LIMIT);
    const out = buildAgentSystemPrompt('', '', false, '', small);
    expect(out).toContain(SOUL);
    expect(out).not.toContain('已截断');
  });

  it('导出的 token 上限为 2000（Q4 裁定值）', () => {
    expect(GLOBAL_FILES_TOKEN_LIMIT).toBe(2000);
    expect(TOKEN_LIMIT).toBe(GLOBAL_FILES_TOKEN_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// A1 追加（用户裁定）— chat 意图同样注入三文件：buildChatSystemPrompt
// ---------------------------------------------------------------------------

describe('A1 chat — buildChatSystemPrompt 全局 Agent 文件注入', () => {
  const SOUL = 'SOUL_CHAT_MARKER_性格';
  const MEMORY = 'MEMORY_CHAT_MARKER_记忆';
  const STYLE = 'STYLE_CHAT_MARKER_风格';
  const chatBlock = [
    '【全局 Agent 文件】以下为用户配置的全局 Agent 文件。',
    '',
    [`=== soul.md（性格） ===\n${SOUL}`, `=== memory.md（记忆） ===\n${MEMORY}`, `=== style.md（风格） ===\n${STYLE}`].join('\n\n'),
  ].join('\n');

  it('不传参 / 传空串 / 传纯空白 → 与 CHAT_SYSTEM_PROMPT 逐字一致（sha256 基线）', () => {
    expect(sha256(buildChatSystemPrompt())).toBe(BASELINE_SHA256.chat);
    expect(sha256(buildChatSystemPrompt(''))).toBe(BASELINE_SHA256.chat);
    expect(sha256(buildChatSystemPrompt('   \n  '))).toBe(BASELINE_SHA256.chat);
    expect(buildChatSystemPrompt()).toBe(CHAT_SYSTEM_PROMPT);
    // 常量本身也未被改动（既有 4 条护栏断言的对象）
    expect(sha256(CHAT_SYSTEM_PROMPT)).toBe(BASELINE_SHA256.chat);
  });

  it('传块 → 三文件内容出现，且位于【核心规则】之后、【注意力锚点】之前', () => {
    const out = buildChatSystemPrompt(chatBlock);
    const idxCore = out.indexOf('【核心规则】');
    const idxBlock = out.indexOf(SOUL);
    const idxAnchor = out.indexOf('【注意力锚点】');
    expect(idxCore).toBeGreaterThan(-1);
    expect(idxBlock).toBeGreaterThan(idxCore);
    expect(idxAnchor).toBeGreaterThan(idxBlock);
    expect(out).toContain(MEMORY);
    expect(out).toContain(STYLE);
    // 基线正文逐字保留
    expect(out).toContain('1. 你必须且只能回答用户的最后一条消息');
    expect(out).toContain('4. 与当前问题无关的历史话题不主动展开');
    // 锚点仍在最后一行（recency bias 不被块挤到中间）
    expect(out.endsWith('那是你必须回答的问题。')).toBe(true);
  });

  it('chat 侧同样受 2000 token 硬上限约束并带截断标注', () => {
    const huge = `【全局 Agent 文件】\n${'很长的记忆内容'.repeat(4000)}`;
    const out = buildChatSystemPrompt(huge);
    expect(out).toContain('已截断');
    expect(out).toContain('完整内容见设置页');
    const seg = out
      .slice(out.indexOf('【全局 Agent 文件】'), out.indexOf('【注意力锚点】'))
      .trim();
    expect(estimateTokens(seg)).toBeLessThanOrEqual(TOKEN_LIMIT);
  });

  it('chat 块插入不改变基线正文本体（去块后与 CHAT_SYSTEM_PROMPT 一致）', () => {
    const out = buildChatSystemPrompt(chatBlock);
    const stripped = out
      .split('\n')
      .filter((l) => l !== SOUL && l !== MEMORY && l !== STYLE)
      .join('\n');
    expect(stripped).toContain('【核心规则】');
    expect(stripped).toContain('【注意力锚点】当看到 "=== 当前用户问题 ===" 标记时，那是你必须回答的问题。');
    // 基线的 9 行结构：4 条核心规则 + 锚点全部在位
    for (const line of CHAT_SYSTEM_PROMPT.split('\n')) {
      if (line.trim().length > 0) expect(stripped).toContain(line);
    }
  });
});

// ---------------------------------------------------------------------------
// B4 — 画像层（profileBlock）注入（req §二 B4 / 总指挥裁定 1~3）
// 落点与 A1 的 globalFilesBlock 同通道，紧跟其后；两者同属「用户个性化层」。
// ---------------------------------------------------------------------------

/** 画像块稳定小节标题（位置断言与占位噪音断言共用锚点）。 */
const PROFILE_HEADER = '【用户画像】';

/** 画像块样例（agentContext `buildProfileBlock` 同款产出格式）。 */
const PROFILE_BLOCK = [
  `${PROFILE_HEADER}以下为从长期记忆读出的当前有效画像，用于个性化作答。`,
  '- 用户职业：后端工程师',
  '- 常用技术栈：TypeScript / SQLite',
].join('\n');

describe('B4 — 画像层 profileBlock 注入（buildAgentSystemPrompt）', () => {
  const GLOBAL_BLOCK = ['【全局 Agent 文件】以下为用户配置的全局 Agent 文件。', '', '=== soul.md（性格） ===\nSOUL_B4_MARKER'].join('\n');

  it('画像内容进输出，且位于【核心规则】之后、全局文件块之后、## 工作流 之前', () => {
    const out = buildAgentSystemPrompt('', '', false, '', GLOBAL_BLOCK, PROFILE_BLOCK);
    const idxCore = out.indexOf('【核心规则】');
    const idxGlobal = out.indexOf('SOUL_B4_MARKER');
    const idxProfile = out.indexOf(PROFILE_HEADER);
    const idxWorkflow = out.indexOf('## 工作流');
    expect(idxCore).toBeGreaterThan(-1);
    expect(idxGlobal).toBeGreaterThan(idxCore);
    expect(idxProfile).toBeGreaterThan(idxGlobal); // 紧跟 A1 块之后
    expect(idxWorkflow).toBeGreaterThan(idxProfile);
    expect(out).toContain('- 用户职业：后端工程师');
    expect(out).toContain('- 常用技术栈：TypeScript / SQLite');
  });

  it('画像仅有一个段落（单个小节标题，不产生重复/嵌套噪音）', () => {
    const out = buildAgentSystemPrompt('', '', false, '', '', PROFILE_BLOCK);
    expect(out.split(PROFILE_HEADER).length - 1).toBe(1);
  });

  it('不传第 6 参 / 传空串 / 传纯空白 → 输出与改动前逐字一致（sha256 基线）', () => {
    expect(sha256(buildAgentSystemPrompt('', '', false))).toBe(BASELINE_SHA256.plain);
    expect(sha256(buildAgentSystemPrompt('', '', true))).toBe(BASELINE_SHA256.clarify);
    expect(sha256(buildAgentSystemPrompt('FILELIST', 'TREE', false, 'ATTMANIFEST'))).toBe(
      BASELINE_SHA256.withSnapshots
    );
    // 三文件块在、画像缺省/为空 → 与只传三文件块时逐字一致（等价降级）
    const withGlobal = sha256(buildAgentSystemPrompt('', '', false, '', GLOBAL_BLOCK));
    expect(sha256(buildAgentSystemPrompt('', '', false, '', GLOBAL_BLOCK, undefined))).toBe(withGlobal);
    expect(sha256(buildAgentSystemPrompt('', '', false, '', GLOBAL_BLOCK, ''))).toBe(withGlobal);
    // 三文件块也缺省 + 画像空 → 回到 A1 之前的纯基线
    expect(sha256(buildAgentSystemPrompt('', '', false, '', '', ''))).toBe(BASELINE_SHA256.plain);
    expect(sha256(buildAgentSystemPrompt('', '', false, '', '', '  \n  '))).toBe(BASELINE_SHA256.plain);
  });

  it('空画像不产生占位噪音与空行残留（与 A1 未配置文件时一致）', () => {
    const out = buildAgentSystemPrompt('', '', false, '', '', '');
    expect(out).not.toContain(PROFILE_HEADER);
    expect(out).not.toContain('画像');
    expect(out).toContain('4. 当看到 "=== 当前用户问题 ===" 标记时，那是你必须回答的问题\n## 工作流');
  });

  it('画像块超 PROFILE_TOKEN_LIMIT 触发截断并在块尾标注', () => {
    const huge = `${PROFILE_HEADER}\n${'很长的画像内容'.repeat(4000)}`;
    expect(estimateTokens(huge)).toBeGreaterThan(PROFILE_TOKEN_LIMIT);
    const out = buildAgentSystemPrompt('', '', false, '', '', huge);
    expect(out).toContain('画像过长已截断');
    const seg = out.slice(out.indexOf(PROFILE_HEADER), out.indexOf('## 工作流')).trim();
    expect(estimateTokens(seg)).toBeLessThanOrEqual(PROFILE_TOKEN_LIMIT);
    expect(estimateTokens(seg)).toBeGreaterThan(0);
  });

  it('PROFILE_TOKEN_LIMIT 导出为 2000（与 A1 同一口径）', () => {
    expect(PROFILE_TOKEN_LIMIT).toBe(2000);
    expect(PROFILE_TOKEN_LIMIT).toBe(GLOBAL_FILES_TOKEN_LIMIT);
  });

  it('画像在 2000 token 内不截断（无标注）', () => {
    const small = `${PROFILE_HEADER}\n- 用户职业：后端工程师`;
    const out = buildAgentSystemPrompt('', '', false, '', '', small);
    expect(out).toContain('- 用户职业：后端工程师');
    expect(out).not.toContain('画像过长已截断');
  });
});

describe('B4 chat — buildChatSystemPrompt 画像层', () => {
  it('画像出现在【核心规则】之后、全局文件块之后、【注意力锚点】之前，锚点仍居末行', () => {
    const globalBlock = ['【全局 Agent 文件】以下为用户配置的全局 Agent 文件。', 'SOUL_CHAT_B4'].join('\n');
    const out = buildChatSystemPrompt(globalBlock, PROFILE_BLOCK);
    const idxCore = out.indexOf('【核心规则】');
    const idxGlobal = out.indexOf('SOUL_CHAT_B4');
    const idxProfile = out.indexOf(PROFILE_HEADER);
    const idxAnchor = out.indexOf('【注意力锚点】');
    expect(idxProfile).toBeGreaterThan(idxGlobal);
    expect(idxGlobal).toBeGreaterThan(idxCore);
    expect(idxAnchor).toBeGreaterThan(idxProfile);
    expect(out.endsWith('那是你必须回答的问题。')).toBe(true);
  });

  it('chat 缺省画像 / 画像为空 → 与 A1 改动后输出逐字一致', () => {
    const globalBlock = ['【全局 Agent 文件】以下为用户配置的全局 Agent 文件。', 'SOUL_CHAT_B4'].join('\n');
    const withGlobal = buildChatSystemPrompt(globalBlock);
    expect(buildChatSystemPrompt(globalBlock, undefined)).toBe(withGlobal);
    expect(buildChatSystemPrompt(globalBlock, '')).toBe(withGlobal);
    expect(buildChatSystemPrompt(globalBlock, '   \n ')).toBe(withGlobal);
    // 三文件块也缺省 → A1 基线（sha256 锁定）
    expect(sha256(buildChatSystemPrompt(undefined, PROFILE_BLOCK))).not.toBe(BASELINE_SHA256.chat);
    expect(sha256(buildChatSystemPrompt())).toBe(BASELINE_SHA256.chat);
    expect(sha256(buildChatSystemPrompt('', ''))).toBe(BASELINE_SHA256.chat);
  });

  it('chat 侧画像同样受 token 硬上限约束并带截断标注', () => {
    const huge = `${PROFILE_HEADER}\n${'很长的画像内容'.repeat(4000)}`;
    const out = buildChatSystemPrompt('', huge);
    expect(out).toContain('画像过长已截断');
    const seg = out.slice(out.indexOf(PROFILE_HEADER), out.indexOf('【注意力锚点】')).trim();
    expect(estimateTokens(seg)).toBeLessThanOrEqual(PROFILE_TOKEN_LIMIT);
  });

  it('画像仅注入时锚点仍在最后一行（recency bias 不被挤走）', () => {
    const out = buildChatSystemPrompt('', PROFILE_BLOCK);
    expect(out).toContain(PROFILE_HEADER);
    expect(out.endsWith('那是你必须回答的问题。')).toBe(true);
  });
});

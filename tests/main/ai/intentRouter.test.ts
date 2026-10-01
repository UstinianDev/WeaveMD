import { describe, expect, it } from 'vitest';
import { classifyIntent, detectMultiIntentGate } from '@main/ai/intentRouter';

describe('intentRouter.classifyIntent', () => {
  it('classifies rewrite intents', () => {
    expect(classifyIntent('帮我润色这段文字').intent).toBe('rewrite');
    expect(classifyIntent('缩写一下这个段落').intent).toBe('rewrite');
    expect(classifyIntent('请扩写这段话').intent).toBe('rewrite');
    expect(classifyIntent('rewrite this paragraph').intent).toBe('rewrite');
  });

  it('A1b: classifies optimization/smooth-touch keywords as rewrite (not chat)', () => {
    // 用户说「帮我优化这篇文档」不得落 chat fallback
    expect(classifyIntent('帮我优化这篇文档').intent).toBe('rewrite');
    expect(classifyIntent('帮我整理一下这篇文档').intent).toBe('rewrite');
    expect(classifyIntent('美化一下这个页面').intent).toBe('rewrite');
    expect(classifyIntent('改进这段内容').intent).toBe('rewrite');
    expect(classifyIntent('润一润这段文字').intent).toBe('rewrite');
    expect(classifyIntent('优化一下开头段落').intent).toBe('rewrite');
    expect(classifyIntent('improve this paragraph').intent).toBe('rewrite');
    expect(classifyIntent('refine the wording').intent).toBe('rewrite');
    expect(classifyIntent('clean up the style').intent).toBe('rewrite');
  });

  it('A1b: rewrite keywords out-prioritize create when both hit (optimize wins)', () => {
    // 「优化一下」+「文档」命中 rewrite；即便含类似写意的词，rewrite 优先级在前
    expect(classifyIntent('帮我优化这段文稿').intent).toBe('rewrite');
  });

  it('classifies kbQa intents', () => {
    expect(classifyIntent('在我的笔记里搜索 agent 相关的内容').intent).toBe('kbQa');
    expect(classifyIntent('根据知识库回答这个问题').intent).toBe('kbQa');
    expect(classifyIntent('哪些笔记提到了 FTS5').intent).toBe('kbQa');
  });

  it('classifies tech intents', () => {
    expect(classifyIntent('这段代码抛了什么错').intent).toBe('tech');
    expect(classifyIntent('解释下 React 的 hooks').intent).toBe('tech');
    expect(classifyIntent('这个 api 怎么用').intent).toBe('tech');
  });

  it('classifies web intents', () => {
    expect(classifyIntent('抓取这个网页的内容').intent).toBe('web');
    expect(classifyIntent('联网搜索这篇在线资料').intent).toBe('web');
    expect(classifyIntent('scrape this url').intent).toBe('web');
  });

  it('classifies create intents', () => {
    expect(classifyIntent('写一篇关于春天的文章').intent).toBe('create');
    expect(classifyIntent('起草一份活动文案').intent).toBe('create');
    expect(classifyIntent('生成一个营销标题').intent).toBe('create');
  });

  it('classifies colloquial create intents (口语化创建)', () => {
    expect(classifyIntent('给我一个文件').intent).toBe('create');
    expect(classifyIntent('我要一个笔记').intent).toBe('create');
    expect(classifyIntent('来个新文档').intent).toBe('create');
    expect(classifyIntent('弄一个新笔记').intent).toBe('create');
    expect(classifyIntent('建一个文档').intent).toBe('create');
  });

  it('classifies colloquial rewrite/delete intents (口语化修改/删除)', () => {
    expect(classifyIntent('改变一下这个').intent).toBe('rewrite');
    expect(classifyIntent('弄一下这个').intent).toBe('rewrite');
    expect(classifyIntent('丢掉这个文件').intent).toBe('rewrite');
    expect(classifyIntent('扔掉这个笔记').intent).toBe('rewrite');
    expect(classifyIntent('删了这个').intent).toBe('rewrite');
    expect(classifyIntent('去掉这个').intent).toBe('rewrite');
  });

  it('falls back to chat when no keyword hits', () => {
    const res = classifyIntent('今天天气怎么样');
    expect(res.intent).toBe('chat');
  });

  it('returns fuzzy candidates for ambiguous input with low confidence', () => {
    // 「写一个 react 组件」同时命中 create(写) 与 tech(react)，贴近 -> 模糊候选
    const res = classifyIntent('写一个 react 组件');
    expect(res.candidates).toBeDefined();
    expect(res.candidates?.length).toBeGreaterThanOrEqual(2);
    expect(res.confidence).toBeLessThan(0.6);
  });

  it('returns high confidence when a single rule dominates', () => {
    const res = classifyIntent('帮我润色、缩写并扩写这段报告文字');
    expect(res.intent).toBe('rewrite');
    expect(res.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('P0-3: 有历史时零命中 chat 兜底不再被长度门触发', () => {
    // 「它有什么优势」6 字，零关键词命中 -> 落 chat 兜底；有历史可依时不得仅凭字数置位
    const res = classifyIntent('它有什么优势', { hasHistory: true });
    expect(res.intent).toBe('chat');
    expect(res.needsClarification ?? false).toBe(false);
  });

  it('P0-3: 无历史 / 缺省调用保持现状（仍需澄清）', () => {
    expect(classifyIntent('它有什么优势', { hasHistory: false }).needsClarification).toBe(true);
    expect(classifyIntent('它有什么优势').needsClarification).toBe(true);
  });

  it('P0-3: length<6 长度门仅在无历史时生效', () => {
    // 单关键词命中，confidence=1
    expect(classifyIntent('改一下', { hasHistory: false }).needsClarification).toBe(true);
    expect(classifyIntent('改一下').needsClarification).toBe(true);
    expect(classifyIntent('改一下', { hasHistory: true }).needsClarification ?? false).toBe(false);
  });

  it('P0-3: confidence<0.85 && length<10 长度门仅在无历史时生效', () => {
    // 修改/优化/整理 3 命中 + tech 1 命中 -> 0.75，长度 8
    expect(classifyIntent('修改优化整理代码', { hasHistory: false }).needsClarification).toBe(true);
    expect(classifyIntent('修改优化整理代码', { hasHistory: true }).needsClarification ?? false).toBe(false);
  });

  it('P0-3: confidence < 0.7 在有历史时无条件保留', () => {
    expect(classifyIntent('写一个 react 组件', { hasHistory: true }).needsClarification).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// agent-multi-intent 任务 2 — 规则预检门 detectMultiIntentGate（Q6 / plan §1.4）
// 开闸 ⇔ 命中意图类 ≥2；连接词单独命中或仅 1 类一律不开闸（单意图零 LLM 调用）。
// classifyIntent 本体与签名不动（Q8 两套并存）。
// ---------------------------------------------------------------------------

describe('intentRouter.detectMultiIntentGate — 多意图预检门', () => {
  it('①双意图（查笔记 + 写文件）→ 开闸', () => {
    // kbQa(笔记里) + create(写个) ≥2 类
    expect(detectMultiIntentGate('查一下笔记里的TODO然后帮我写个周报')).toBe(true);
  });

  it('②三意图（笔记检索 + 网页抓取 + 创作）→ 开闸', () => {
    // kbQa(笔记里) + web(抓取/网页) + create(写一篇) = 3 类
    expect(
      detectMultiIntentGate('在笔记里搜 FTS5 的内容，同时抓取这个网页上的教程，另外写一篇总结')
    ).toBe(true);
  });

  it('③连接词分句触发（每分句不同意图类）→ 开闸', () => {
    // 分句1 rewrite(润色) / 分句2 kbQa(知识库)；无整句关键词并列也应累计 ≥2 类
    expect(detectMultiIntentGate('润色这个段落，然后在知识库中查一下相关资料')).toBe(true);
  });

  it('⑤单意图零触发（无连接词、单类命中）→ 不开闸', () => {
    expect(detectMultiIntentGate('润色这篇文档')).toBe(false);
    // kbQa 单类（刻意避开 tech 关键词「库」，否则规则层本就该判 2 类）
    expect(detectMultiIntentGate('根据笔记查一下会议纪要')).toBe(false);
  });

  it('⑥连接词反例：连接词单独命中（零意图类）→ 不开闸', () => {
    expect(detectMultiIntentGate('然后？')).toBe(false);
    expect(detectMultiIntentGate('顺便')).toBe(false);
  });

  it('⑥连接词反例：连接词命中但仅 1 类意图 → 不开闸', () => {
    // rewrite(润色/精简) 同类并列，连接词不构成开闸证据
    expect(detectMultiIntentGate('润色并且精简这段文字')).toBe(false);
    expect(detectMultiIntentGate('抓取这个网页，然后搜一下相关资料')).toBe(false);
  });

  it('空输入 / 无关键词 → 不开闸', () => {
    expect(detectMultiIntentGate('')).toBe(false);
    expect(detectMultiIntentGate('   ')).toBe(false);
    expect(detectMultiIntentGate('今天天气怎么样')).toBe(false);
  });

  it('URL 单独命中归 web（与 classifyIntent URL 规则同口径），仍需 ≥2 类才开闸', () => {
    expect(detectMultiIntentGate('打开这个链接 https://example.com 看看')).toBe(false);
    expect(detectMultiIntentGate('打开 https://example.com 然后写一篇分析')).toBe(true);
  });

  it('classifyIntent 与 gate 两套语义并存（Q8）：模糊单意图仍出候选，gate 不因此放宽', () => {
    // 「写一个 react 组件」create+tech 并列 → gate 开（规则层证据），候选卡逻辑不受影响
    const fuzzy = classifyIntent('写一个 react 组件');
    expect(fuzzy.candidates).toBeDefined();
    expect(detectMultiIntentGate('写一个 react 组件')).toBe(true);
    // 单类模糊输入（零命中 chat 兜底）→ gate 关
    expect(detectMultiIntentGate('它有什么优势')).toBe(false);
  });
});

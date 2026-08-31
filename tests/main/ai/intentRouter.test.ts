import { describe, expect, it } from 'vitest';
import { classifyIntent } from '@main/ai/intentRouter';

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
});

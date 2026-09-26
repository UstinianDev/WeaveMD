// ============================================
// B6 五-1：Anthropic content 数组分流（image block）
// ============================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  convertToAnthropicFormat,
  buildAnthropicRequest,
  isAnthropicModel,
} from '@main/ai/llm/anthropicCompat';

describe('anthropicCompat.convertToAnthropicFormat', () => {
  let imgDir: string;
  let imgPath: string;

  beforeEach(() => {
    imgDir = mkdtempSync(join(tmpdir(), 'weavemd-b6-anth-'));
    imgPath = join(imgDir, 'shot.jpg');
    writeFileSync(imgPath, Buffer.from('ffd8ffe000104a464946', 'hex'));
  });
  afterEach(() => {
    rmSync(imgDir, { recursive: true, force: true });
  });

  it('keeps plain string content unchanged（纯文本链路回归）', () => {
    const { system, messages } = convertToAnthropicFormat([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' },
    ]);
    expect(system).toBe('你是助手');
    expect(messages).toEqual([{ role: 'user', content: '你好' }]);
  });

  it('converts text + data URL image parts into text/image blocks', () => {
    const { messages } = convertToAnthropicFormat([
      {
        role: 'user',
        content: [
          { type: 'text', text: '这张图是什么' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
        ],
      },
    ]);
    expect(messages[0].content).toEqual([
      { type: 'text', text: '这张图是什么' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
    ]);
  });

  it('reads local image path into base64 image block', () => {
    const { messages } = convertToAnthropicFormat([
      { role: 'user', content: [{ type: 'image_url', image_url: { url: imgPath } }] },
    ]);
    const blocks = messages[0].content as Array<{
      type: string;
      source?: { type: string; media_type: string; data: string };
    }>;
    expect(blocks[0].type).toBe('image');
    expect(blocks[0].source?.type).toBe('base64');
    expect(blocks[0].source?.media_type).toBe('image/jpeg');
    expect(blocks[0].source?.data).toBe(Buffer.from('ffd8ffe000104a464946', 'hex').toString('base64'));
  });

  it('keeps http(s) image as url source', () => {
    const { messages } = convertToAnthropicFormat([
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x.y/a.png' } }] },
    ]);
    expect(messages[0].content).toEqual([
      { type: 'image', source: { type: 'url', url: 'https://x.y/a.png' } },
    ]);
  });

  it('falls back to placeholder text when local image cannot be read', () => {
    const { messages } = convertToAnthropicFormat([
      { role: 'user', content: [{ type: 'image_url', image_url: { url: join(imgDir, 'none.png') } }] },
    ]);
    const blocks = messages[0].content as Array<{ type: string; text?: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].text).toContain('none.png');
  });
});

describe('anthropicCompat.buildAnthropicRequest / isAnthropicModel', () => {
  it('builds request with array content preserved', () => {
    const req = buildAnthropicRequest({
      model: 'claude-sonnet-4',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ],
      maxTokens: 100,
    });
    expect(req.messages[0].content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(req.max_tokens).toBe(100);
  });

  it('detects anthropic models by id', () => {
    expect(isAnthropicModel('claude-sonnet-4')).toBe(true);
    expect(isAnthropicModel('deepseek-chat')).toBe(false);
  });
});

// ============================================
// B6 五-3：agentMedia 接活（图片 part 注入 + 媒体读取）
// 真实文件系统 + 绝对路径，断言 vision 降级 / 缺失文件 / GIF 提示 / 历史图片限额。
// ============================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { IAttachmentMeta } from '@shared/ai';
import {
  buildImageParts,
  formatImageForLlm,
  imagePartFromPath,
  injectImagesIntoMessages,
  processMedia,
  selectRecentImageIds,
} from '@main/ai/agent/agentMedia';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function imgMeta(path: string, name = 'shot.png', id = 'i1'): IAttachmentMeta {
  return { id, type: 'image', name, path };
}

describe('agentMedia.buildImageParts（五-3 注入接线点）', () => {
  let dir: string;
  let png: string;
  let gif: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'weavemd-media-'));
    png = join(dir, 'shot.png');
    gif = join(dir, 'anim.gif');
    writeFileSync(png, PNG_BYTES);
    writeFileSync(gif, Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('emits image_url parts pointing at local files when the model supports vision', () => {
    const res = buildImageParts([imgMeta(png)], { supportsVision: true });
    expect(res.degraded).toBe(false);
    expect(res.imageCount).toBe(1);
    expect(res.unreadable).toEqual([]);
    expect(res.parts).toEqual([{ type: 'image_url', image_url: { url: png } }]);
  });

  it('degrades to pure text (no parts) with explicit flag when vision is unsupported', () => {
    const res = buildImageParts([imgMeta(png)], { supportsVision: false });
    expect(res.parts).toEqual([]);
    expect(res.degraded).toBe(true);
    expect(res.imageCount).toBe(0);
  });

  it('reports missing files instead of emitting broken image parts', () => {
    const res = buildImageParts([imgMeta(join(dir, 'gone.png'), 'gone.png')], {
      supportsVision: true,
    });
    expect(res.parts).toEqual([]);
    expect(res.unreadable).toEqual(['gone.png']);
    expect(res.degraded).toBe(false);
  });

  it('appends an explicit first-frame note for GIF images', () => {
    const res = buildImageParts([imgMeta(gif, 'anim.gif')], { supportsVision: true });
    expect(res.parts).toHaveLength(2);
    expect(res.parts[0]).toEqual({ type: 'image_url', image_url: { url: gif } });
    expect(res.parts[1].type).toBe('text');
    expect((res.parts[1] as { text: string }).text).toContain('首帧');
    expect(res.imageCount).toBe(1);
  });

  it('ignores non-image attachments and empty input（纯文本链路不受影响）', () => {
    expect(buildImageParts([], { supportsVision: true })).toEqual({
      parts: [],
      unreadable: [],
      degraded: false,
      imageCount: 0,
    });
    const fileMeta: IAttachmentMeta = { id: 'f1', type: 'file', name: 'a.pdf' };
    expect(buildImageParts([fileMeta], { supportsVision: false }).degraded).toBe(false);
  });
});

describe('agentMedia.selectRecentImageIds（历史图片限额，Q4 同口径）', () => {
  const rows = (ids: string[]): Array<{ attachments?: IAttachmentMeta[] }> =>
    ids.map((id) => ({ attachments: [{ id, type: 'image' as const, name: `${id}.png`, path: `/${id}.png` }] }));

  it('keeps only the newest N image ids (walking backwards)', () => {
    expect([...selectRecentImageIds(rows(['a', 'b', 'c', 'd']), 3)]).toEqual(['d', 'c', 'b']);
  });

  it('returns all ids when under the limit', () => {
    expect([...selectRecentImageIds(rows(['a', 'b']), 3)].sort()).toEqual(['a', 'b']);
  });

  it('handles rows without attachments', () => {
    expect(selectRecentImageIds([{ attachments: undefined }, {}], 3).size).toBe(0);
  });
});

describe('agentMedia 媒体读取（processMedia / formatImageForLlm 接活）', () => {
  let dir: string;
  let png: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'weavemd-media2-'));
    png = join(dir, 'shot.png');
    writeFileSync(png, PNG_BYTES);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('processMedia reads an image into base64 MediaInfo', () => {
    const media = processMedia(png, 'shot.png');
    expect(media).not.toBeNull();
    expect(media?.type).toBe('image');
    expect(media?.mimeType).toBe('image/png');
    expect(media?.base64).toBe(PNG_BYTES.toString('base64'));
    expect(media?.fileName).toBe('shot.png');
  });

  it('processMedia returns null for missing files', () => {
    expect(processMedia(join(dir, 'nope.png'))).toBeNull();
  });

  it('formatImageForLlm builds an OpenAI-compatible image_url part', () => {
    const part = formatImageForLlm(PNG_BYTES.toString('base64'), 'image/png');
    expect(part.type).toBe('image_url');
    expect(part.image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('imagePartFromPath keeps the local path (resolved at send time by llmClient)', () => {
    expect(imagePartFromPath(png)).toEqual({ type: 'image_url', image_url: { url: png } });
  });
});

// ---------------------------------------------------------------------------
// B-c P0-4：injectImagesIntoMessages 的 tool_calls 透传（回读链路第二跳）
// ---------------------------------------------------------------------------
describe('agentMedia.injectImagesIntoMessages — tool_calls 透传', () => {
  const CALL = {
    id: 'call_0_0',
    type: 'function' as const,
    function: { name: 'searchKB', arguments: '{"query":"SQLite 优势"}' },
  };

  it('无图片的 assistant(tool_calls) 行原样透传（早退分支不丢字段）', () => {
    const res = injectImagesIntoMessages(
      [{ role: 'assistant', content: '', tool_calls: [CALL] }],
      { supportsVision: false, treatLastAsCurrent: false }
    );
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0].tool_calls).toEqual([CALL]);
  });

  it('带图片的行同样透传 tool_calls（base 展开后随 part 组装保留）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weavemd-media3-'));
    const png = join(dir, 'shot.png');
    writeFileSync(png, PNG_BYTES);
    try {
      const res = injectImagesIntoMessages(
        [
          {
            role: 'assistant',
            content: '',
            tool_calls: [CALL],
            attachments: [imgMeta(png, 'shot.png', 'i9')],
          },
        ],
        { supportsVision: true, treatLastAsCurrent: false }
      );
      expect(Array.isArray(res.messages[0].content)).toBe(true);
      expect(res.messages[0].tool_calls).toEqual([CALL]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tool 行的 tool_call_id 既有透传零回归', () => {
    const res = injectImagesIntoMessages(
      [{ role: 'tool', content: '结果', tool_call_id: 'call_0_0' }],
      { supportsVision: false, treatLastAsCurrent: false }
    );
    expect(res.messages[0].tool_call_id).toBe('call_0_0');
    expect(res.messages[0].tool_calls).toBeUndefined();
  });
});

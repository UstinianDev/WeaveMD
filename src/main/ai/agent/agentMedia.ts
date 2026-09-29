// ============================================
// WeaveMD — Agent 媒体处理
// ============================================
// 处理 Agent 对话中的媒体（图片 base64 编码、附件解析）。
// 用于媒体处理（A11）。

import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';

import type { IAttachmentMeta } from '@shared/ai';
import type { ContentImagePart, ContentPart, MessageContent } from '../llm/llmClient';
import { KEEP_RECENT_IMAGES } from '../contextManager';
import { resolveStoredPath } from '../image/imageStorage';
// 仅类型依赖（编译期擦除，无运行期环）：回读链的 tool_calls 与发给 LLM 的同形
import type { AgentLlmMessage } from './agentLoop';

export interface MediaInfo {
  type: 'image' | 'document' | 'unknown';
  mimeType: string;
  base64?: string;
  text?: string;
  fileName: string;
  filePath: string;
}

/** MIME 类型映射。 */
const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

/** 获取文件 MIME 类型。 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/** 判断是否为图片文件。 */
function isImageFile(filePath: string): boolean {
  const mime = getMimeType(filePath);
  return mime.startsWith('image/');
}

/** 读取文件为 base64。 */
function readFileAsBase64(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const buffer = readFileSync(filePath);
    return buffer.toString('base64');
  } catch {
    return null;
  }
}

/** 读取文件为文本。 */
function readFileAsText(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 处理媒体文件：读取文件内容并返回结构化信息。
 * 图片：返回 base64 编码。
 * 文档：返回文本内容。
 */
export function processMedia(filePath: string, fileName?: string): MediaInfo | null {
  if (!existsSync(filePath)) return null;

  const name = fileName ?? filePath.split(/[/\\]/).pop() ?? 'unknown';
  const mime = getMimeType(filePath);

  if (isImageFile(filePath)) {
    const base64 = readFileAsBase64(filePath);
    if (!base64) return null;
    return {
      type: 'image',
      mimeType: mime,
      base64,
      fileName: name,
      filePath,
    };
  }

  // 文本类文件
  if (mime.startsWith('text/') || mime.includes('document') || mime.includes('pdf')) {
    const text = readFileAsText(filePath);
    if (!text) return null;
    return {
      type: 'document',
      mimeType: mime,
      text,
      fileName: name,
      filePath,
    };
  }

  return {
    type: 'unknown',
    mimeType: mime,
    fileName: name,
    filePath,
  };
}

/** 将图片 base64 编码为 OpenAI 兼容格式（识别链路即时调用）。 */
export function formatImageForLlm(base64: string, mimeType: string): ContentImagePart {
  return {
    type: 'image_url',
    image_url: {
      url: `data:${mimeType};base64,${base64}`,
    },
  };
}

// ---------------------------------------------------------------------------
// B6 五-3：上下文图片注入（Chat/Agent/Skill 共用的主进程接线点）
// ---------------------------------------------------------------------------

/** GIF 首帧提示（五-2②：gif 按首帧处理 + 显式提示）。 */
export const GIF_FIRST_FRAME_NOTE = '（GIF 动图，模型按首帧处理）';

/** vision 不支持时的降级提示（随 system 消息注入，五-1②）。 */
export const VISION_DEGRADED_NOTICE =
  '【提示】当前模型不支持图片理解，本次消息中的图片未送入模型，仅保留了文字占位符。回答时请说明无法查看图片内容。';

/** 本地路径 → 图片 part（路径在发送前由 llmClient 解析为 data URL；事件持久化只存路径）。 */
export function imagePartFromPath(filePath: string): ContentImagePart {
  return { type: 'image_url', image_url: { url: filePath } };
}

export interface BuildImagePartsResult {
  /** 待追加到消息 content 的 part 数组（含 GIF 提示文本） */
  parts: ContentPart[];
  /** 文件缺失/不可读的图片名（渲染失败态用） */
  unreadable: string[];
  /** 模型不支持 vision → 降级纯文本（调用方注入 VISION_DEGRADED_NOTICE） */
  degraded: boolean;
  /** 实际注入的图片张数 */
  imageCount: number;
}

/**
 * 附件图片 → LLM 图片 part（**主进程接线点**，保证 Chat/Agent 链路一致，五-3②）。
 * - vision 不支持：不产 part，degraded=true（调用方显式提示，不静默丢图）
 * - 文件缺失：计入 unreadable，不产出坏 part
 * - 附件存相对路径时按附件根重建绝对路径
 * - gif 追加首帧提示文本 part
 */
export function buildImageParts(
  attachments: IAttachmentMeta[],
  opts: { supportsVision: boolean }
): BuildImagePartsResult {
  const images = attachments.filter((a) => a.type === 'image');
  if (images.length === 0) {
    return { parts: [], unreadable: [], degraded: false, imageCount: 0 };
  }
  if (!opts.supportsVision) {
    return { parts: [], unreadable: [], degraded: true, imageCount: 0 };
  }

  const parts: ContentPart[] = [];
  const unreadable: string[] = [];
  for (const att of images) {
    const abs = att.path ? resolveStoredPath(att.path) : '';
    if (!abs || !existsSync(abs)) {
      unreadable.push(att.name);
      continue;
    }
    parts.push(imagePartFromPath(abs));
    if (/\.gif$/i.test(abs) || /\.gif$/i.test(att.name)) {
      parts.push({ type: 'text', text: GIF_FIRST_FRAME_NOTE });
    }
  }
  return { parts, unreadable, degraded: false, imageCount: images.length - unreadable.length };
}

/** 注入结果消息行（content 可为纯文本或多模态 part 数组）。 */
export interface InjectedImageRow {
  role: string;
  content: MessageContent;
  tool_call_id?: string;
  /** P0-4：assistant 的工具调用轨迹，回读链路透传给 LLM（不随图片注入丢失）。 */
  tool_calls?: AgentLlmMessage['tool_calls'];
}

export interface InjectImagesResult {
  messages: InjectedImageRow[];
  /** 存在图片但模型不支持 vision → 已降级（调用方注入 VISION_DEGRADED_NOTICE） */
  degraded: boolean;
  /** 文件缺失/不可读的图片名 */
  unreadable: string[];
}

/**
 * 为消息行注入图片 part（**Chat/Agent 两链路共用接线点**，五-3②）：
 * - 最后一行视为当前轮：图片全量注入（用户刚发送的内容不受限额影响）
 * - 更早的历史行：仅保留最近 keepImages 张（Q4 同口径，其余保持文本占位符）
 * - vision 不支持：不注入任何 part 并返回 degraded，绝不静默丢图
 */
export function injectImagesIntoMessages(
  rows: Array<{
    role: string;
    content: string;
    attachments?: IAttachmentMeta[];
    tool_call_id?: string;
    tool_calls?: AgentLlmMessage['tool_calls'];
  }>,
  opts: { supportsVision: boolean; keepImages?: number; treatLastAsCurrent?: boolean }
): InjectImagesResult {
  const keepImages = opts.keepImages ?? KEEP_RECENT_IMAGES;
  const treatLast = opts.treatLastAsCurrent ?? true;
  const historyRows = treatLast ? rows.slice(0, -1) : rows;
  const allowedHistoryIds = selectRecentImageIds(historyRows, keepImages);

  let degraded = false;
  const unreadable: string[] = [];

  const messages = rows.map((row, idx): InjectedImageRow => {
    const base: InjectedImageRow = {
      role: row.role,
      content: row.content,
      ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
      // P0-4：tool_calls 透传（无图片的早退分支也必须带上，否则回读丢轨迹）
      ...(row.tool_calls ? { tool_calls: row.tool_calls } : {}),
    };
    const images = (row.attachments ?? []).filter((a) => a.type === 'image');
    if (images.length === 0) return base;

    const isCurrent = treatLast && idx === rows.length - 1;
    const selected = isCurrent ? images : images.filter((a) => allowedHistoryIds.has(a.id));
    if (selected.length === 0) return base;

    const built = buildImageParts(selected, { supportsVision: opts.supportsVision });
    if (built.degraded) degraded = true;
    unreadable.push(...built.unreadable);
    if (built.parts.length === 0) return base;

    const textPart: ContentPart = { type: 'text', text: row.content };
    return { ...base, content: [textPart, ...built.parts] };
  });

  return { messages, degraded, unreadable };
}

/**
 * 历史图片限额（Q4 同口径）：从**最新**消息倒推，取最近 limit 个图片附件 id。
 * 当前轮消息不受此限额（用户刚发送的图片全量注入）。
 */
export function selectRecentImageIds(
  rows: Array<{ attachments?: IAttachmentMeta[] }>,
  limit: number = KEEP_RECENT_IMAGES
): Set<string> {
  const ids = new Set<string>();
  let budget = limit;
  for (let i = rows.length - 1; i >= 0 && budget > 0; i -= 1) {
    const atts = rows[i].attachments;
    if (!atts) continue;
    for (let j = atts.length - 1; j >= 0 && budget > 0; j -= 1) {
      const att = atts[j];
      if (att.type === 'image' && att.path) {
        ids.add(att.id);
        budget -= 1;
      }
    }
  }
  return ids;
}

// ============================================
// WeaveMD — 图片识别（doc-pipeline B6 五-3 死代码接活）
// ============================================
// 接活要点（全库零 import 教训）：
// - 读图统一走 agentMedia.processMedia / formatImageForLlm（一处 MIME、一处 base64）
// - createRecognitionLlmCall 提供**真实** llmCall（按 protocol 分流 + usage 上报计价）
// - recognizeImageAttachments 是发送链路接线点（Chat/Agent 两条 IPC 链路共用）：
//   模型不支持 vision → 不发请求直接标「未成功识别」；LLM 失败 → 同样显式失败态
//   识别结果写入 parsed_attachments.content（气泡三态 / 附件入 KB 的可检索文本）。

import { basename } from 'path';

import type { IAttachmentMeta } from '@shared/ai';
import { decryptApiKey } from '../secureConfig';
import { streamAnthropicCompletion } from '../llm/anthropicClient';
import { streamChatCompletion, type MessageContent } from '../llm/llmClient';
import { resolveVisionSupport } from '../llm/modelDiscovery';
import { resolveModelProtocol } from '../llm/anthropicCompat';
import { estimateImageTokens, getCostTracker } from '../costTracker';
import { formatImageForLlm, processMedia } from '../agent/agentMedia';
import {
  updateParsedAttachmentContent,
  updateParsedAttachmentStatus,
} from '../../db/attachments';
import { resolveStoredPath } from './imageStorage';

export interface ImageRecognitionResult {
  description: string;
  tags: string[];
  confidence: number;
}

/** 识别提示词（描述对象/场景/文字，供气泡展示与附件入 KB 检索）。 */
export const RECOGNIZE_IMAGE_PROMPT =
  '请描述这张图片的内容，包括主要对象、场景与画面中的文字信息。用中文回答，50 字以内。';

/** 识别失败（模型不支持 / 调用失败）时回写的消息前缀。 */
export const IMAGE_RECOGNITION_FAILED = '图片未成功识别';

/**
 * 识别图片内容（使用多模态 LLM）。
 * 无 llmCall 时返回占位描述（历史兼容分支）；发送链路恒传 createRecognitionLlmCall 的真实实现。
 */
export async function recognizeImage(
  filePath: string,
  llmCall?: (messages: Array<{ role: string; content: MessageContent }>) => Promise<string>
): Promise<ImageRecognitionResult | null> {
  // 读图复用 agentMedia（processMedia），不重复实现 MIME/base64 逻辑
  const media = processMedia(filePath, basename(filePath));
  if (!media || media.type !== 'image' || !media.base64) return null;

  if (!llmCall) {
    return {
      description: '图片已上传，需要多模态 LLM 支持以进行识别。',
      tags: ['image'],
      confidence: 0,
    };
  }

  try {
    const imagePart = formatImageForLlm(media.base64, media.mimeType);
    const response = await llmCall([
      {
        role: 'user',
        content: [
          { type: 'text', text: RECOGNIZE_IMAGE_PROMPT },
          imagePart,
        ],
      },
    ]);

    return {
      description: response,
      tags: extractTags(response),
      confidence: 0.8,
    };
  } catch {
    return null;
  }
}

/** 从描述中提取标签。 */
function extractTags(description: string): string[] {
  const tags: string[] = [];
  const keywords = ['图片', '照片', '截图', '文档', '表格', '图表', '人物', '风景', '文字'];

  for (const keyword of keywords) {
    if (description.includes(keyword)) {
      tags.push(keyword);
    }
  }

  return tags.length > 0 ? tags : ['image'];
}

/** 检查文件是否为支持的图片格式。 */
export function isSupportedImageFormat(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext ?? '');
}

// ---------------------------------------------------------------------------
// 真实 llmCall 工厂（五-3②「接入真实 llmCall」）
// ---------------------------------------------------------------------------

export type RecognitionLlmCall = (
  messages: Array<{ role: string; content: MessageContent }>
) => Promise<string>;

export interface RecognitionLlmOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** 协议分流：anthropic → /v1/messages，缺省 OpenAI 兼容 */
  protocol?: 'openai' | 'anthropic';
  timeoutMs?: number;
  signal?: AbortSignal;
  /** usage 上报（图片 token 归因 → costTracker，五-1 计价） */
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    imageTokens: number;
  }) => void;
}

/** 构造识别用的真实 LLM 调用（累加 delta，末尾上报 usage）。 */
export function createRecognitionLlmCall(opts: RecognitionLlmOptions): RecognitionLlmCall {
  return async (messages) => {
    const imageCount = messages.reduce((n, m) => {
      if (!Array.isArray(m.content)) return n;
      return n + m.content.filter((p) => p.type === 'image_url').length;
    }, 0);

    const req = {
      baseUrl: opts.baseUrl,
      model: opts.model,
      apiKey: opts.apiKey,
      messages,
      timeoutMs: opts.timeoutMs ?? 60_000,
      ...(opts.signal ? { signal: opts.signal } : {}),
    };
    const gen =
      resolveModelProtocol({ protocol: opts.protocol, model: opts.model }) === 'anthropic'
        ? streamAnthropicCompletion(req)
        : streamChatCompletion(req);

    let acc = '';
    let promptTokens = 0;
    let completionTokens = 0;
    for await (const chunk of gen) {
      acc += chunk.delta;
      if (chunk.usage?.promptTokens != null) promptTokens = chunk.usage.promptTokens;
      if (chunk.usage?.completionTokens != null) completionTokens = chunk.usage.completionTokens;
    }
    if (opts.onUsage && (promptTokens > 0 || completionTokens > 0 || imageCount > 0)) {
      opts.onUsage({
        promptTokens,
        completionTokens,
        imageTokens: estimateImageTokens(imageCount),
      });
    }
    return acc;
  };
}

// ---------------------------------------------------------------------------
// 发送链路接线（Chat / Agent 共用）
// ---------------------------------------------------------------------------

export interface RecognizeImagesOptions {
  userId: string;
  conversationId: string;
  attachments: IAttachmentMeta[];
  config: {
    remoteBaseUrl: string;
    model: string;
    protocol?: 'openai' | 'anthropic';
    /** Bug B：vision 覆盖三态（缺省自动判定，与注入链同一判定源） */
    visionOverride?: boolean;
  };
  apiKeyEnc?: string | null;
  signal?: AbortSignal;
}

/**
 * 发送链路识别图片附件（五-3 接线点）：
 * - 已落盘失败（parseStatus error）/ 无路径 → 跳过，保留原失败原因
 * - 模型不支持 vision → 不发请求，直接写「未成功识别」提示（避免注定失败的请求）
 * - 成功 → description 写 parsed_attachments.content（气泡成功态 + 附件入 KB 可检索文本）
 * - 失败 → parseStatus error + 显式「图片未成功识别」
 * 返回更新后的附件元数据（供 attachments_json 落库 / 回执渲染）。
 */
export async function recognizeImageAttachments(
  opts: RecognizeImagesOptions
): Promise<IAttachmentMeta[]> {
  const { userId, attachments, config } = opts;
  if (attachments.length === 0) return attachments;

  // Bug B：与注入链统一判定源（覆盖 → 能力表 → 未知乐观）
  const visionOk = resolveVisionSupport(config.model, config.visionOverride);
  let apiKey: string | undefined;
  if (opts.apiKeyEnc) {
    try {
      apiKey = decryptApiKey(opts.apiKeyEnc);
    } catch {
      apiKey = undefined;
    }
  }
  const llmCall = createRecognitionLlmCall({
    baseUrl: config.remoteBaseUrl,
    model: config.model,
    ...(apiKey ? { apiKey } : {}),
    ...(config.protocol ? { protocol: config.protocol } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    // 五-1 计价：识别调用的 token（含图片归因）进 costTracker
    onUsage: (usage) => {
      try {
        getCostTracker().recordUsage({
          conversationId: opts.conversationId,
          userId,
          model: config.model,
          usage: {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            ...(usage.imageTokens > 0 ? { imageTokens: usage.imageTokens } : {}),
          },
          roundCount: 0,
          intent: 'image_recognition',
        });
      } catch {
        // 计价失败不影响识别主流程
      }
    },
  });

  const out: IAttachmentMeta[] = [];
  for (const att of attachments) {
    if (att.type !== 'image') {
      out.push(att);
      continue;
    }
    // 落盘已失败 / 无路径：保留原失败态，不再尝试识别
    if (att.parseStatus === 'error' || !att.path) {
      out.push(att);
      continue;
    }
    if (!visionOk) {
      const error = `当前模型（${config.model}）不支持图片理解，${IMAGE_RECOGNITION_FAILED}`;
      try {
        updateParsedAttachmentStatus(att.id, userId, 'error');
      } catch { /* 状态回写失败不影响发送 */ }
      out.push({ ...att, parseStatus: 'error', error });
      continue;
    }

    try {
      const abs = resolveStoredPath(att.path);
      const result = await recognizeImage(abs, llmCall);
      if (result && result.description && result.confidence > 0) {
        try {
          updateParsedAttachmentContent(att.id, userId, result.description, 'done');
        } catch { /* 正文回写失败不影响发送 */ }
        out.push({ ...att, parseStatus: 'done' });
      } else {
        throw new Error('empty recognition');
      }
    } catch {
      try {
        updateParsedAttachmentStatus(att.id, userId, 'error');
      } catch { /* 状态回写失败不影响发送 */ }
      out.push({ ...att, parseStatus: 'error', error: IMAGE_RECOGNITION_FAILED });
    }
  }
  return out;
}

// ============================================
// WeaveMD — 图片识别
// ============================================
// 图片识别功能（O2）。
// 使用多模态 LLM 进行图片内容识别和描述。

import { readFileSync } from 'fs';
import { existsSync } from 'fs';

export interface ImageRecognitionResult {
  description: string;
  tags: string[];
  confidence: number;
}

/** 将图片转换为 base64。 */
function imageToBase64(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const buffer = readFileSync(filePath);
    return buffer.toString('base64');
  } catch {
    return null;
  }
}

/** 获取图片 MIME 类型。 */
function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop();
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return mimeMap[ext ?? ''] ?? 'image/jpeg';
}

/**
 * 识别图片内容（使用多模态 LLM）。
 * 需要外部 LLM 调用，此处提供接口定义。
 */
export async function recognizeImage(
  filePath: string,
  llmCall?: (messages: Array<{ role: string; content: unknown }>) => Promise<string>
): Promise<ImageRecognitionResult | null> {
  const base64 = imageToBase64(filePath);
  if (!base64) return null;

  // 如果没有提供 LLM 调用函数，返回默认描述
  if (!llmCall) {
    return {
      description: '图片已上传，需要多模态 LLM 支持以进行识别。',
      tags: ['image'],
      confidence: 0,
    };
  }

  try {
    const mimeType = getMimeType(filePath);
    const response = await llmCall([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请描述这张图片的内容，包括主要对象、场景、颜色等信息。用中文回答。',
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
            },
          },
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

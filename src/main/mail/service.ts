// ============================================
// WeaveMD — 邮件发送服务（QQ 邮箱 SMTP 自收）
// ============================================
// 每次 send 现建现关 transport（transporter.close()），避免授权码常驻内存。
// 从/to 均 FEEDBACK_TARGET_EMAIL（自收）；subject 固定前缀 + 时间戳。
// 图片经 stat 尺寸前置校验后 readFileSync 为 Buffer 附件；超限不整读文件。
// 错误分类为 MailErrorCode，绝不把原始 SMTP error 外透到渲染层。

import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import {
  FEEDBACK_TARGET_EMAIL,
  MAIL_SUBJECT_PREFIX,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_TIMEOUT_MS,
} from './config';
import { validateImages } from './validateImages';

export type MailErrorCode =
  | 'not_configured'
  | 'auth_failed'
  | 'network'
  | 'timeout'
  | 'invalid_image'
  | 'send_failed';

export interface MailError {
  code: MailErrorCode;
  message: string;
}

export interface SendMailInput {
  /** 16 位 QQ 邮箱授权码（明文只在主进程瞬态，绝不落渲染） */
  authCode: string;
  body: string;
  imagePaths: string[];
}

export type SendMailResult =
  | { success: true; messageId?: string }
  | { success: false; error: MailError };

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

/** 创建 SMTP transport（smtp.qq.com:465 SSL）。调用方必须在用完（send）后 close。 */
export function createTransporter(authCode: string): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    requireTLS: true,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    auth: {
      user: FEEDBACK_TARGET_EMAIL,
      pass: authCode,
    },
  });
}

/** classifyError：把 nodemailer/SMTP 原始错误映射为稳定 MailErrorCode。不外透原始文本。 */
function classifyError(err: unknown): MailError {
  const e = err as { code?: string; responseCode?: number; message?: string } | null | undefined;
  if (e?.code === 'EAUTH' || e?.responseCode === 535) {
    return { code: 'auth_failed', message: 'SMTP 授权码错误，请检查授权码' };
  }
  if (e?.code === 'ETIMEDOUT') {
    return { code: 'timeout', message: '连接邮件服务器超时，请检查网络后重试' };
  }
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ENOTFOUND' || e?.responseCode === 421) {
    return { code: 'network', message: '无法连接邮件服务器，请检查网络' };
  }
  // 其余（含 554 拒绝、未知 SMTP 错误）统一 send_failed，抹掉原始 error 细节
  return { code: 'send_failed', message: '邮件发送失败，请稍后重试' };
}

/**
 * 发送问题反馈邮件。现建现关 transport；图片先 stat 校验（权威），超限/缺失
 * 返回 invalid_image 且不创建 transport、不 readFileSync。
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (!input.authCode || input.authCode.trim().length === 0) {
    return { success: false, error: { code: 'not_configured', message: '未配置授权码' } };
  }

  // ---- 图片权威校验（stat 前置，不整读超限文件） ----
  const fileInfos = input.imagePaths.map((p) => {
    try {
      const stat = fs.statSync(p);
      return { path: p, size: stat.isFile() ? stat.size : null };
    } catch {
      return { path: p, size: null };
    }
  });
  const validation = validateImages(fileInfos);
  if (!validation.ok) {
    return {
      success: false,
      error: { code: 'invalid_image', message: validation.message },
    };
  }

  // ---- 组装 attachments（Buffer form） ----
  const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> =
    input.imagePaths.map((p) => {
      const content = fs.readFileSync(p);
      const ext = path.extname(p).toLowerCase();
      return {
        filename: path.basename(p),
        content,
        ...(IMAGE_CONTENT_TYPES[ext] ? { contentType: IMAGE_CONTENT_TYPES[ext] } : {}),
      };
    });

  const subject = `${MAIL_SUBJECT_PREFIX} ${new Date().toISOString()}`;
  const mail: nodemailer.SendMailOptions = {
    from: FEEDBACK_TARGET_EMAIL,
    to: FEEDBACK_TARGET_EMAIL,
    subject,
    text: input.body,
    attachments,
  };

  const transporter = createTransporter(input.authCode);
  try {
    const info = await transporter.sendMail(mail);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    return { success: false, error: classifyError(err) };
  } finally {
    // 用完即关：释放授权码与 socket，防止常驻内存
    transporter.close();
  }
}

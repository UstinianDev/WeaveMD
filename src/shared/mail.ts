// ============================================
// WeaveMD — 邮件共享类型（渲染/主进程共用）
// ============================================
// 铁律：绝不把授权码明文落到渲染层。MAIL_GET 仅回 { hasAuthCode } 布尔标记。
// 错误分类 MailErrorCode 与主进程 service.ts 保持一致，供渲染映射 i18n。
// 复用 shared/types.ts 的 IpcResponse<T>。

/** 稳定错误分类（与 src/main/mail/service.ts 同步） */
export type MailErrorCode =
  | 'not_configured'
  | 'auth_failed'
  | 'network'
  | 'timeout'
  | 'invalid_image'
  | 'send_failed';

/** MAIL_GET 返回：仅暴露是否已配置授权码（不含明文） */
export interface MailAuthStatus {
  hasAuthCode: boolean;
}

/** MAIL_GET 入参 */
export interface MailGetRequest {
  userId: string;
}

/** MAIL_SET 入参（authCode 空串 === 清除已存授权码） */
export interface MailSetRequest {
  userId: string;
  authCode: string;
}

/** MAIL_SEND 入参（imagePaths 为本地绝对路径数组，明文 content 由主进程读取） */
export interface MailSendRequest {
  userId: string;
  body: string;
  imagePaths: string[];
}

/** MAIL_SEND 返回 */
export interface MailSendResult {
  success: boolean;
  messageId?: string;
  error?: {
    code: MailErrorCode;
    message: string;
  };
}

/** MAIL_PICK_IMAGES 返回：用户选中的本地图片路径数组；取消返回 null */
export type MailPickImagesResult = string[] | null;

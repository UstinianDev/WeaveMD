// ============================================
// WeaveMD — 邮件服务配置（问题反馈收件）
// ============================================
// QQ 邮箱 SMTP 自收：FEEDBACK_TARGET_EMAIL 以自身 SMTP 向自己发送。
// 绝对不在此处 hardcode 授权码；授权码由用户填写，safeStorage 加密存 SQLite。
// 图片上限常量：数量/单图/合计，渲染与主进程校验共享。

export const FEEDBACK_TARGET_EMAIL = '2762943351@qq.com';

export const SMTP_HOST = 'smtp.qq.com';
export const SMTP_PORT = 465; // SSL
export const SMTP_SECURE = true;
export const SMTP_TIMEOUT_MS = 15_000;

export const MAIL_SUBJECT_PREFIX = '[WeaveMD 问题反馈]';

// --- 图片上限 ---
export const MAX_FEEDBACK_IMAGES = 5;
export const MAX_IMAGE_SIZE_MB = 10;
export const MAX_TOTAL_SIZE_MB = 20;
export const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
export const MAX_TOTAL_SIZE_BYTES = MAX_TOTAL_SIZE_MB * 1024 * 1024;

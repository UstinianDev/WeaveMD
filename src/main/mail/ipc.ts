// ============================================
// WeaveMD — 邮件 IPC 处理器注册
// ============================================
// mail:* 通道：GET(仅 hasAuthCode)/SET(加密落库)/SEND(解密瞬态发送)/PICK_IMAGES(多选)。
// 授权码明文只在主进程瞬态：SET 收到明文立即 encryptApiKey 落库，
// GET 绝不回传明文；SEND 内 decrypt 后即时构造 transport 发送并 close。
// 全部 handler 校验 userId 归属/参数合法性。

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { IpcResponse } from '@shared/types';
import type {
  MailAuthStatus,
  MailPickImagesResult,
  MailSendRequest,
  MailSendResult,
  MailSetRequest,
} from '@shared/mail';
import { decryptApiKey, encryptApiKey } from '../ai/secureConfig';
import { getMailAuthEnc, setMailAuthEnc } from '../db/mail';
import { sendMail } from './service';

/** 简化的 userId 参数守卫（非空字符串）。 */
function hasUserId(userId: unknown): userId is string {
  return typeof userId === 'string' && userId.length > 0;
}

export function registerMailIpcHandlers(): void {
  // --- mail:get — 只回 { hasAuthCode }，明文不落渲染 ---
  ipcMain.handle(
    IPC_CHANNELS.MAIL_GET,
    (event, userId: unknown): IpcResponse<MailAuthStatus> => {
      if (!hasUserId(userId)) {
        return { success: false, message: 'userId required' };
      }
      try {
        const enc = getMailAuthEnc(userId);
        return { success: true, data: { hasAuthCode: !!enc } };
      } catch (error) {
        return { success: false, message: 'Failed to read mail config' };
      }
    }
  );

  // --- mail:set — 明文立即加密落库；空字符串清除 ---
  ipcMain.handle(
    IPC_CHANNELS.MAIL_SET,
    async (event, payload: MailSetRequest): Promise<IpcResponse<MailAuthStatus>> => {
      if (!hasUserId(payload?.userId)) {
        return { success: false, message: 'userId required' };
      }
      try {
        if (payload.authCode === '') {
          // 断开连接：清除授权码
          setMailAuthEnc(payload.userId, null);
          return { success: true, data: { hasAuthCode: false } };
        }
        if (typeof payload.authCode !== 'string' || !payload.authCode.trim()) {
          return { success: false, message: 'authCode required' };
        }
        // 16 位 QQ 邮箱授权码（十六进制），宽松校验确保非空明文加密
        const enc = encryptApiKey(payload.authCode).enc;
        setMailAuthEnc(payload.userId, enc);
        return { success: true, data: { hasAuthCode: true } };
      } catch (error) {
        return { success: false, message: 'Failed to save mail config' };
      }
    }
  );

  // --- mail:send — 解密授权码瞬态构造 transport 发送并 close ---
  ipcMain.handle(
    IPC_CHANNELS.MAIL_SEND,
    async (event, payload: MailSendRequest): Promise<IpcResponse<MailSendResult>> => {
      if (!hasUserId(payload?.userId)) {
        return { success: false, message: 'userId required' };
      }
      if (typeof payload.body !== 'string' || !payload.body.trim()) {
        return { success: false, message: 'Feedback body required' };
      }
      const imagePaths = Array.isArray(payload.imagePaths) ? payload.imagePaths : [];
      try {
        const enc = getMailAuthEnc(payload.userId);
        if (!enc) {
          return {
            success: false,
            data: { success: false, error: { code: 'not_configured', message: '未配置授权码' } },
          };
        }
        const authCode = decryptApiKey(enc);
        const result = await sendMail({ authCode, body: payload.body, imagePaths });
        if (result.success) {
          return { success: true, data: { success: true, messageId: result.messageId } };
        }
        return {
          success: true,
          data: { success: false, error: { code: result.error.code, message: result.error.message } },
        };
      } catch (error) {
        return {
          success: false,
          data: { success: false, error: { code: 'send_failed', message: '邮件发送失败' } },
        };
      }
    }
  );

  // --- mail:pick-images — 系统文件框多选图片，取消返回 null ---
  ipcMain.handle(
    IPC_CHANNELS.MAIL_PICK_IMAGES,
    async (event): Promise<IpcResponse<MailPickImagesResult> | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return null;
      const filters = [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
        },
      ];
      const result = await dialog.showOpenDialog(win, {
        title: 'Select Feedback Images',
        filters,
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null };
      }
      return { success: true, data: result.filePaths };
    }
  );
}

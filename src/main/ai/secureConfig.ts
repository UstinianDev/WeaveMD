// ============================================
// WeaveMD — AI API Key secure storage wrapper
// ============================================
// API key 经 Electron safeStorage 加解密。明文只在主进程出现（本模块内），
// 绝不通过 IPC 落到渲染进程。存储形式为 base64 编码的 Buffer。

import { safeStorage } from 'electron';

export type KeyEncryptionBackend = 'ok' | 'basic_text';

export interface EncryptedKey {
  enc: string;
  backend: KeyEncryptionBackend;
}

function isBasicText(): boolean {
  try {
    return safeStorage.getSelectedStorageBackend() === 'basic_text';
  } catch {
    return false;
  }
}

/** 加密明文 API key；返回密文(base64) + 降级标记。 */
export function encryptApiKey(plain: string): EncryptedKey {
  if (!plain) return { enc: '', backend: 'ok' };
  const enc = safeStorage.encryptString(plain).toString('base64');
  return { enc, backend: isBasicText() ? 'basic_text' : 'ok' };
}

/** 解密 API key 密文(base64) 为明文。仅主进程使用。 */
export function decryptApiKey(enc: string): string {
  if (!enc) return '';
  return safeStorage.decryptString(Buffer.from(enc, 'base64'));
}

/** safeStorage 是否可用于加密（app ready 前为 false；basic_text 视为可用但降级）。 */
export function isEncryptionAvailable(): boolean {
  try {
    const available = safeStorage.isEncryptionAvailable();
    return !!available;
  } catch {
    return false;
  }
}

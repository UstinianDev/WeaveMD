// ============================================
// AI IPC 处理器注册（re-export）
// ============================================
// 按业务域拆分至 ipc/ 子目录，本文件仅保持向后兼容的 re-export。
// 详见 ipc/index.ts。

export { registerAiIpcHandlers, initAgentQueue, cleanupAgentQueue } from './ipc/index';

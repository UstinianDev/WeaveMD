// ============================================
// Model List IPC Handler
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import { getAiConfig } from '../../db/ai';
import { listModelsForUser } from '../modelList';

export function registerModelHandlers(): void {
  // --- model list（ai-panel-redesign M1, 需求 R17: 能力模型下拉实时拉取） ---
  // 失败/无 key/超时 → 空数组（不阻断），渲染侧降级为「当前配置 model + 手动输入」。
  ipcMain.handle(
    IPC_CHANNELS.AI_LIST_MODELS,
    async (_event, userId: string) => {
      try {
        if (!userId || typeof userId !== 'string' || !userId) {
          return { success: false, message: 'userId required' };
        }
        const row = getAiConfig(userId);
        const models = await listModelsForUser(row);
        return { success: true, data: models };
      } catch (error) {
        return { success: true, data: [] };
      }
    }
  );
}

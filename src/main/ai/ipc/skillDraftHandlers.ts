// ============================================
// Skill 草稿 IPC Handlers（agent-memory-optimize-3 D3 六.1：人工确认入口）
// ============================================
// 三通道：
//   ai:skilldraft:list    —— 列出 `_auto/_drafts/` 下的提炼草稿（只读）
//   ai:skilldraft:approve —— 确认：草稿 → `_auto/<name>.md`（status: active），技能即刻生效
//   ai:skilldraft:reject  —— 驳回：删除草稿文件
//
// 安全口径（SECURITY.md「IPC」，**照抄第二批 C3 `memoryHandlers.ts` 范式**）：
//   1. 不接受渲染进程传入的 userId —— 当前用户一律由**已签名 JWT** 解出
//      （`resolveUserId`，与 memoryHandlers / ipc-handlers 同一条信任链）；
//   2. 校验调用来源：`event.sender` 必须能解析为本应用存活的 BrowserWindow（`isTrustedSender`）；
//   3. 技能名必须匹配 `auto_[a-z0-9_]+`，且解析后的绝对路径必须落在目标目录内
//      （`skillAutoStore` 的正则闸 + `isPathInside` 双重防线）——防目录穿越；
//   4. 全程零 SQL（存储是纯文件系统），路径不接受渲染层拼接，只接受 name。
//
// 半自动铁律（req Q4）：LLM 提炼只写草稿；**本模块是草稿变生效的唯一入口**，
// 未确认的草稿不进 ctx.skills / list_skills / runSkill / 任何 prompt。

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { ISkillDraft } from '@shared/ai';
import type { IpcResponse } from '@shared/types';
import {
  listDraftSkills,
  approveDraftSkill,
  rejectDraftSkill,
  type SkillDraftFile,
} from '../skills/skillAutoStore';
import { isTrustedSender, resolveUserId } from './memoryHandlers';

/** 磁盘行 → 下发行（结构一致，仅做类型收窄，不下发任何路径）。 */
function toSkillDraft(file: SkillDraftFile): ISkillDraft {
  return {
    name: file.name,
    description: file.description,
    instructions: file.instructions,
    status: file.status,
    source: file.source,
    updatedAt: file.updatedAt,
  };
}

/** 非法技能名（类型 / 空白 / 前缀）统一在 handler 层先拒一次（defense in depth）。 */
function isSafeSkillName(name: unknown): name is string {
  return typeof name === 'string' && /^auto_[a-z0-9_]{1,60}$/.test(name);
}

export function registerSkillDraftHandlers(): void {
  // --- ai:skilldraft:list（入参只有当前用户认证上下文，不接收 userId） ---
  ipcMain.handle(
    IPC_CHANNELS.AI_SKILL_DRAFT_LIST,
    (event: Electron.IpcMainInvokeEvent, authToken: unknown): IpcResponse<ISkillDraft[]> => {
      if (!isTrustedSender(event)) {
        return { success: false, message: 'untrusted caller' };
      }
      if (!resolveUserId(authToken)) {
        return { success: false, message: 'unauthorized' };
      }
      try {
        return { success: true, data: listDraftSkills().map(toSkillDraft) };
      } catch (err) {
        console.error('[skillDraftHandlers] list failed:', err);
        return { success: false, message: 'Failed to list skill drafts' };
      }
    }
  );

  // --- ai:skilldraft:approve（草稿 → 生效） ---
  ipcMain.handle(
    IPC_CHANNELS.AI_SKILL_DRAFT_APPROVE,
    (
      event: Electron.IpcMainInvokeEvent,
      authToken: unknown,
      name: unknown
    ): IpcResponse<{ approved: boolean }> => {
      if (!isTrustedSender(event)) {
        return { success: false, message: 'untrusted caller' };
      }
      if (!resolveUserId(authToken)) {
        return { success: false, message: 'unauthorized' };
      }
      if (!isSafeSkillName(name)) {
        return { success: false, message: 'invalid_name' };
      }
      try {
        const result = approveDraftSkill(name);
        if (!result.ok) {
          return { success: false, message: result.reason };
        }
        return { success: true, data: { approved: true } };
      } catch (err) {
        console.error('[skillDraftHandlers] approve failed:', err);
        return { success: false, message: 'Failed to approve skill draft' };
      }
    }
  );

  // --- ai:skilldraft:reject（删除草稿） ---
  ipcMain.handle(
    IPC_CHANNELS.AI_SKILL_DRAFT_REJECT,
    (
      event: Electron.IpcMainInvokeEvent,
      authToken: unknown,
      name: unknown
    ): IpcResponse<{ rejected: boolean }> => {
      if (!isTrustedSender(event)) {
        return { success: false, message: 'untrusted caller' };
      }
      if (!resolveUserId(authToken)) {
        return { success: false, message: 'unauthorized' };
      }
      if (!isSafeSkillName(name)) {
        return { success: false, message: 'invalid_name' };
      }
      try {
        const result = rejectDraftSkill(name);
        if (!result.ok) {
          return { success: false, message: result.reason };
        }
        return { success: true, data: { rejected: true } };
      } catch (err) {
        console.error('[skillDraftHandlers] reject failed:', err);
        return { success: false, message: 'Failed to reject skill draft' };
      }
    }
  );
}

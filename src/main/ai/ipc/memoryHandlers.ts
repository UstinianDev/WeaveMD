// ============================================
// Agent Memory IPC Handlers（agent-memory-optimize 第二批 C3：可见性入口）
// ============================================
// 两通道：
//   ai:memory:list    —— 列出当前用户全部记忆行（含 valid_to 已关闭行，供 UI 展示「已失效」）
//   ai:memory:delete  —— 单条物理 DELETE（req 裁定：设置页用户显式删除走物理删，非 Ledger 关闭）
//
// D5 追加三通道（六.3 防线二：三态审核，鉴权逐条照抄上面两条）：
//   ai:memory:similar:list   —— 列出跨 subject 相似合并建议组（已驳回的组不再出现）
//   ai:memory:similar:accept —— 确认采纳：执行合并（服务端按 ids 重算，不信任渲染层）
//   ai:memory:similar:reject —— 驳回：给组内行打 merge_skip 标记，此后不再自动合并
//
// 安全口径（SECURITY.md「IPC」）：
//   1. 不接受渲染进程传入的 userId —— 当前用户一律由**已签名 JWT** 解出，
//      与 `ipc-handlers.ts` 的 AUTH_VALIDATE_TOKEN 同一条信任链；
//   2. 校验调用来源：`event.sender` 必须能解析为本应用存活的 BrowserWindow；
//   3. 删除 id 必须是安全整数且 > 0，逐项拒绝；
//   4. SQL 全部走 `@main/db/agentMemory` 的 `?` 参数化查询，本模块零字符串拼接。
//
// 与铁律一（笔记写入须逐条确认）解耦：记忆是后台自动写入，不进 FORCE_CONFIRM_TOOLS，
// 但必须有可见可删入口 —— 即本模块 + 设置页「自动记忆」栏。

import crypto from 'crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import jwt from 'jsonwebtoken';
import { IPC_CHANNELS } from '@shared/constants';
import type { IAgentMemory, IMemoryMergeGroup } from '@shared/ai';
import type { IpcResponse } from '@shared/types';
import { getDatabase } from '../../db/index';
import { findById } from '../../db/users';
import { deleteMemory, listMemories } from '../../db/agentMemory';
import type { AgentMemoryRow } from '../../db/agentMemory';
import {
  findSimilarMergeGroups,
  mergeMemoryGroup,
  rejectMemoryGroup,
  type MemoryMergeGroup,
} from '../agent/memoryPolicy';

/**
 * JWT secret 推导，**与 `src/main/ipc-handlers.ts` 的 `getJwtSecret` 同源**
 * （sha256(userData 路径)，每台机器唯一、跨重启稳定）。
 * 改动必须两处同步，否则登录态与本模块的鉴权会同时失效。
 */
function getJwtSecret(): string {
  return crypto.createHash('sha256').update(app.getPath('userData')).digest('hex');
}

/**
 * 调用来源校验：`event.sender` 必须解析为存活的 BrowserWindow。
 * 非本应用窗口（伪造 sender、已销毁窗口）一律拒绝。
 */
export function isTrustedSender(event: Electron.IpcMainInvokeEvent | null | undefined): boolean {
  if (!event || !event.sender) return false;
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win !== null && !win.isDestroyed();
  } catch {
    return false;
  }
}

/**
 * 由已签名 JWT 解出当前用户 id。
 * 任何异常（缺失 / 非字符串 / 签名不符 / 过期 / 用户已删除）一律返回 null —— fail-closed。
 * 导出供同范式的 IPC 模块复用（D3 skillDraftHandlers）—— 保证 JWT 口径只有一处实现。
 */
export function resolveUserId(authToken: unknown): string | null {
  if (typeof authToken !== 'string' || authToken.length === 0) return null;
  try {
    const decoded = jwt.verify(authToken, getJwtSecret()) as { userId?: unknown };
    const userId = decoded?.userId;
    if (typeof userId !== 'string' || userId.length === 0) return null;
    if (!findById(userId)) return null;
    return userId;
  } catch {
    return null;
  }
}

/** DAO 行 → 下发行（裁掉 userId / fingerprint / conversationId）。 */
function toAgentMemory(row: AgentMemoryRow): IAgentMemory {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    content: row.content,
    source: row.source,
    validFrom: row.validFrom,
    validTo: row.validTo,
    writtenAt: row.writtenAt,
  };
}

/** 非法 id 判定：必须是安全整数且 > 0（拒绝 0 / 负数 / 小数 / 非数字 / 超安全整数）。 */
function isValidMemoryId(id: unknown): id is number {
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
}

/**
 * 三态审核入参校验：必须是**长度 2~{@link MAX_MERGE_GROUP_IDS} 的安全整数数组且无重复**。
 * 单条不构成组、越界或含非法值一律拒绝 —— **校验不通过不落到策略层**。
 */
const MAX_MERGE_GROUP_IDS = 32;

function isValidIdArray(ids: unknown): ids is number[] {
  if (!Array.isArray(ids)) return false;
  if (ids.length < 2 || ids.length > MAX_MERGE_GROUP_IDS) return false;
  if (!ids.every((id) => isValidMemoryId(id))) return false;
  return new Set(ids).size === ids.length;
}

/** 策略组 → 下发行（key 仅作展示与回传锚点，主进程不据此授权）。 */
function toMergeGroup(group: MemoryMergeGroup): IMemoryMergeGroup {
  return {
    key: [...group.members]
      .map((row) => row.id)
      .sort((a, b) => a - b)
      .join(','),
    kind: group.kind,
    score: group.score,
    winnerId: group.winnerId,
    members: group.members.map(toAgentMemory),
  };
}

export function registerMemoryHandlers(): void {
  // --- ai:memory:list（入参只有当前用户认证上下文，不接收 userId） ---
  ipcMain.handle(
    IPC_CHANNELS.AI_MEMORY_LIST,
    (event: Electron.IpcMainInvokeEvent, authToken: unknown): IpcResponse<IAgentMemory[]> => {
      if (!isTrustedSender(event)) {
        return { success: false, message: 'untrusted caller' };
      }
      const userId = resolveUserId(authToken);
      if (!userId) {
        return { success: false, message: 'unauthorized' };
      }
      try {
        const rows = listMemories(getDatabase(), userId);
        return { success: true, data: rows.map(toAgentMemory) };
      } catch (err) {
        console.error('[memoryHandlers] list failed:', err);
        return { success: false, message: 'Failed to list memories' };
      }
    }
  );

  // --- ai:memory:delete（id 必须安全整数且 > 0；带 user_id 条件物理 DELETE） ---
  ipcMain.handle(
    IPC_CHANNELS.AI_MEMORY_DELETE,
    (
      event: Electron.IpcMainInvokeEvent,
      authToken: unknown,
      id: unknown
    ): IpcResponse<{ deleted: boolean }> => {
      if (!isTrustedSender(event)) {
        return { success: false, message: 'untrusted caller' };
      }
      const userId = resolveUserId(authToken);
      if (!userId) {
        return { success: false, message: 'unauthorized' };
      }
      if (!isValidMemoryId(id)) {
        return { success: false, message: 'invalid memory id' };
      }
      try {
        const deleted = deleteMemory(getDatabase(), userId, id);
        return { success: true, data: { deleted } };
      } catch (err) {
        console.error('[memoryHandlers] delete failed:', err);
        return { success: false, message: 'Failed to delete memory' };
      }
    }
  );

  // --- ai:memory:similar:list（D5 防线二：列合并建议，不接收 userId） ---
  ipcMain.handle(
    IPC_CHANNELS.AI_MEMORY_SIMILAR_LIST,
    (event: Electron.IpcMainInvokeEvent, authToken: unknown): IpcResponse<IMemoryMergeGroup[]> => {
      if (!isTrustedSender(event)) {
        return { success: false, message: 'untrusted caller' };
      }
      const userId = resolveUserId(authToken);
      if (!userId) {
        return { success: false, message: 'unauthorized' };
      }
      try {
        const groups = findSimilarMergeGroups(getDatabase(), userId);
        return { success: true, data: groups.map(toMergeGroup) };
      } catch (err) {
        console.error('[memoryHandlers] similar list failed:', err);
        return { success: false, message: 'Failed to list memory merge suggestions' };
      }
    }
  );

  // --- ai:memory:similar:accept（D5 防线二：确认采纳 → 执行合并） ---
  ipcMain.handle(
    IPC_CHANNELS.AI_MEMORY_SIMILAR_ACCEPT,
    (
      event: Electron.IpcMainInvokeEvent,
      authToken: unknown,
      ids: unknown
    ): IpcResponse<{ merged: number; winnerId: number }> => {
      if (!isTrustedSender(event)) {
        return { success: false, message: 'untrusted caller' };
      }
      const userId = resolveUserId(authToken);
      if (!userId) {
        return { success: false, message: 'unauthorized' };
      }
      if (!isValidIdArray(ids)) {
        return { success: false, message: 'invalid ids' };
      }
      try {
        // 归属 + active + 同 kind + 连通相似组四条在服务端重算，不信任渲染层传来的组
        const result = mergeMemoryGroup(getDatabase(), userId, ids);
        if (!result) {
          return { success: false, message: 'not a similar group' };
        }
        return { success: true, data: result };
      } catch (err) {
        console.error('[memoryHandlers] similar accept failed:', err);
        return { success: false, message: 'Failed to accept memory merge' };
      }
    }
  );

  // --- ai:memory:similar:reject（D5 防线二：驳回 → 打 merge_skip 标记，不再自动合并） ---
  ipcMain.handle(
    IPC_CHANNELS.AI_MEMORY_SIMILAR_REJECT,
    (
      event: Electron.IpcMainInvokeEvent,
      authToken: unknown,
      ids: unknown
    ): IpcResponse<{ rejected: number }> => {
      if (!isTrustedSender(event)) {
        return { success: false, message: 'untrusted caller' };
      }
      const userId = resolveUserId(authToken);
      if (!userId) {
        return { success: false, message: 'unauthorized' };
      }
      if (!isValidIdArray(ids)) {
        return { success: false, message: 'invalid ids' };
      }
      try {
        const rejected = rejectMemoryGroup(getDatabase(), userId, ids);
        if (rejected === null) {
          return { success: false, message: 'not a similar group' };
        }
        return { success: true, data: { rejected } };
      } catch (err) {
        console.error('[memoryHandlers] similar reject failed:', err);
        return { success: false, message: 'Failed to reject memory merge' };
      }
    }
  );
}

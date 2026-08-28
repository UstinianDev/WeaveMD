// ============================================
// WeaveMD — 全局 Agent 文件管理
// ============================================
// 管理全局 Agent 文件：soul.md / memory.md / style.md。
// 存储位置：~/.weavemd/agent/ 目录。
// soul.md — Agent 人格/角色定义
// memory.md — Agent 长期记忆
// style.md — Agent 输出风格偏好

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import type { IGlobalAgentFiles } from '@shared/ai';

const AGENT_DIR_NAME = 'agent';
const FILE_NAMES: Record<keyof IGlobalAgentFiles, string> = {
  soul: 'soul.md',
  memory: 'memory.md',
  style: 'style.md',
};

const DEFAULT_CONTENT: IGlobalAgentFiles = {
  soul: '',
  memory: '',
  style: '',
};

/** 获取全局 Agent 文件目录路径。 */
function getAgentDir(): string {
  const homeDir = app.getPath('home');
  return join(homeDir, '.weavemd', AGENT_DIR_NAME);
}

/** 确保目录存在。 */
function ensureDir(): void {
  const dir = getAgentDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** 读取单个全局 Agent 文件内容。 */
function readAgentFile(key: keyof IGlobalAgentFiles): string {
  try {
    const dir = getAgentDir();
    const filePath = join(dir, FILE_NAMES[key]);
    if (!existsSync(filePath)) return DEFAULT_CONTENT[key];
    return readFileSync(filePath, 'utf-8');
  } catch {
    return DEFAULT_CONTENT[key];
  }
}

/** 写入单个全局 Agent 文件。 */
function writeAgentFile(key: keyof IGlobalAgentFiles, content: string): void {
  ensureDir();
  const dir = getAgentDir();
  const filePath = join(dir, FILE_NAMES[key]);
  writeFileSync(filePath, content, 'utf-8');
}

/** 读取全部全局 Agent 文件。 */
export function getGlobalAgentFiles(): IGlobalAgentFiles {
  return {
    soul: readAgentFile('soul'),
    memory: readAgentFile('memory'),
    style: readAgentFile('style'),
  };
}

/** 更新全局 Agent 文件（部分更新，仅写入提供的字段）。 */
export function setGlobalAgentFiles(
  updates: Partial<IGlobalAgentFiles>
): IGlobalAgentFiles {
  if (updates.soul !== undefined) writeAgentFile('soul', updates.soul);
  if (updates.memory !== undefined) writeAgentFile('memory', updates.memory);
  if (updates.style !== undefined) writeAgentFile('style', updates.style);
  return getGlobalAgentFiles();
}

/** 获取全局文件目录路径（供 agentLoop system prompt 注入）。 */
export function getGlobalAgentFilesDir(): string {
  return getAgentDir();
}

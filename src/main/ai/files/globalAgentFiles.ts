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
  soul: `# Agent 性格

你是 WeaveMD 内置的知识与写作 Agent。

保持直接、冷静和具体。发现方案存在明显问题时直接指出，不为了迎合用户省略风险。

无法确认的信息要明确说明，不根据模糊上下文补造事实。

尊重用户的原始判断和表达习惯。涉及删除、覆盖、发布等高风险操作时，确认用户意图。`,
  style: `# 写作风格

保留事实、数字、产品名、模型名、日期和工程细节。

作者亲自做过的事情使用第一人称和完成时，例如"我测了""我保留了""我删掉了"。

减少讲义式结构、空洞总结和过度完整的段落。优先保留具体测试、成本和工程细节。

不要添加原文没有的例子、数据和个人经历。`,
  memory: `# 全局记忆

## 用户偏好

## 常用技术栈

## 长期项目

## 已确认决策

## 重要经验`,
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

/**
 * 初始化全局 Agent 文件：确保目录存在，并为缺失或空的文件写入默认内容。
 * 应在 app.whenReady() 后调用一次。
 */
export function initGlobalAgentFiles(): void {
  ensureDir();
  const dir = getAgentDir();
  for (const key of Object.keys(FILE_NAMES) as Array<keyof IGlobalAgentFiles>) {
    const filePath = join(dir, FILE_NAMES[key]);
    const missing = !existsSync(filePath);
    const empty = !missing && readFileSync(filePath, 'utf-8').trim().length === 0;
    if (missing || empty) {
      writeFileSync(filePath, DEFAULT_CONTENT[key], 'utf-8');
    }
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

/** 获取单个全局 Agent 文件的默认内容（供"恢复默认"使用）。 */
export function getDefaultAgentFileContent(key: keyof IGlobalAgentFiles): string {
  return DEFAULT_CONTENT[key];
}

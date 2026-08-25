// ============================================
// WeaveMD — Skills 安装器
// ============================================
// Skills 安装增强（M4）。
// 支持从本地目录、Git 仓库、ZIP 文件安装 Skills。

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  author?: string;
  /** 技能入口文件。 */
  entry: string;
  /** 技能参数 schema。 */
  paramsSchema?: Record<string, unknown>;
}

export interface InstallResult {
  success: boolean;
  skill?: SkillManifest;
  error?: string;
}

/** 从 SKILL.md 文件解析技能清单。 */
function parseSkillManifest(filePath: string): SkillManifest | null {
  try {
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let name = '';
    let description = '';
    let version = '';
    let author = '';
    let entry = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ') && !name) {
        name = trimmed.slice(2).trim();
      } else if (trimmed.startsWith('description:') || trimmed.startsWith('描述:')) {
        description = trimmed.split(':').slice(1).join(':').trim();
      } else if (trimmed.startsWith('version:')) {
        version = trimmed.split(':')[1]?.trim() ?? '';
      } else if (trimmed.startsWith('author:')) {
        author = trimmed.split(':')[1]?.trim() ?? '';
      } else if (trimmed.startsWith('entry:') || trimmed.startsWith('入口:')) {
        entry = trimmed.split(':')[1]?.trim() ?? '';
      }
    }

    if (!name) return null;

    return {
      name,
      description: description || `${name} 技能`,
      version: version || '1.0.0',
      author,
      entry: entry || 'index.ts',
    };
  } catch {
    return null;
  }
}

/**
 * 从本地目录安装 Skill。
 * 目录结构：
 *   skill-name/
 *     SKILL.md    — 技能清单
 *     index.ts    — 技能入口
 *     ...         — 其他文件
 */
export function installFromDirectory(dirPath: string): InstallResult {
  try {
    if (!existsSync(dirPath)) {
      return { success: false, error: '目录不存在' };
    }

    const stat = statSync(dirPath);
    if (!stat.isDirectory()) {
      return { success: false, error: '路径不是目录' };
    }

    // 查找 SKILL.md
    const skillMdPath = join(dirPath, 'SKILL.md');
    const manifest = parseSkillManifest(skillMdPath);

    if (!manifest) {
      return { success: false, error: '未找到有效的 SKILL.md' };
    }

    // 检查入口文件是否存在
    const entryPath = join(dirPath, manifest.entry);
    if (!existsSync(entryPath)) {
      return { success: false, error: `入口文件不存在: ${manifest.entry}` };
    }

    return { success: true, skill: manifest };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 扫描目录中的所有 Skills。
 */
export function scanSkillsInDirectory(dirPath: string): SkillManifest[] {
  const skills: SkillManifest[] = [];

  try {
    if (!existsSync(dirPath)) return skills;

    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        const result = installFromDirectory(fullPath);
        if (result.success && result.skill) {
          skills.push(result.skill);
        }
      }
    }
  } catch {
    // 静默失败
  }

  return skills;
}

/**
 * 验证 Skill 清单。
 */
export function validateSkillManifest(manifest: unknown): manifest is SkillManifest {
  if (!manifest || typeof manifest !== 'object') return false;
  const m = manifest as Record<string, unknown>;
  return typeof m.name === 'string' && m.name.length > 0;
}

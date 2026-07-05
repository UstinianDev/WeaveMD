// ============================================
// WeaveMD — Settings Database Operations
// ============================================

import { randomUUID } from 'crypto';
import { getDatabase } from './index';
import type { ISettings, ThemeType, LanguageType } from '../../shared/types';

export function getSettings(userId: string): ISettings | undefined {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM settings WHERE user_id = ?')
    .get(userId) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  return {
    id: row.id as string,
    userId: row.user_id as string,
    theme: (row.theme as ThemeType) || 'dark',
    language: (row.language as LanguageType) || 'zh-CN',
    customColors: row.custom_colors as string | null,
  };
}

export function updateSettings(
  userId: string,
  updates: {
    theme?: ThemeType;
    language?: LanguageType;
    customColors?: string | null;
  }
): ISettings {
  const db = getDatabase();
  const existing = getSettings(userId);

  if (existing) {
    const theme = updates.theme ?? existing.theme;
    const language = updates.language ?? existing.language;
    const customColors = updates.customColors !== undefined ? updates.customColors : existing.customColors;

    db.prepare(
      'UPDATE settings SET theme = ?, language = ?, custom_colors = ? WHERE user_id = ?'
    ).run(theme, language, customColors, userId);
  } else {
    const id = randomUUID();
    const theme = updates.theme || 'dark';
    const language = updates.language || 'zh-CN';
    const customColors = updates.customColors || null;

    db.prepare(
      'INSERT INTO settings (id, user_id, theme, language, custom_colors) VALUES (?, ?, ?, ?, ?)'
    ).run(id, userId, theme, language, customColors);
  }

  return getSettings(userId) as ISettings;
}

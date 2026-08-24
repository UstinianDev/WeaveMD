// ============================================
// WeaveMD — 消息时间戳格式化工具
// ============================================
// 参考 Notus messageTimestamps.js，按日期距离分级显示：
// - 今天：HH:mm
// - 昨天：昨天 HH:mm
// - 7 天内：周X HH:mm
// - 更早：YYYY-MM-DD HH:mm
// 处理 SQLite UTC 时区偏移（无时区标识的字符串补 Z）。

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 解析 ISO 时间字符串，处理 SQLite UTC 格式（无时区标识补 Z）。
 * SQLite datetime('now') 保存 UTC 但不带时区标识，不补 Z 会产生 8 小时偏移。
 */
function parseTimestamp(raw: string): Date {
  // 匹配 SQLite UTC 格式：2026-08-24 14:30:45 或 2026-08-24T14:30:45
  const sqliteUtc = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/);
  if (sqliteUtc) {
    return new Date(`${sqliteUtc[1]}T${sqliteUtc[2]}Z`);
  }
  return new Date(raw);
}

/**
 * 计算两个日期的天数距离（基于本地时区的日期比较）。
 */
function dayDistance(a: Date, b: Date): number {
  const aDate = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bDate = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round(Math.abs(bDate.getTime() - aDate.getTime()) / 86_400_000);
}

/**
 * 格式化消息时间戳。
 * - 今天：HH:mm
 * - 昨天：昨天 HH:mm
 * - 7 天内：周X HH:mm
 * - 更早：YYYY-MM-DD HH:mm
 */
export function formatMessageTimestamp(
  value: string | undefined,
  { now = new Date() } = {}
): string {
  if (!value) return '';
  const date = parseTimestamp(value);
  if (isNaN(date.getTime())) return '';

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const time = `${pad(hours)}:${pad(minutes)}`;

  const dist = dayDistance(date, now);

  if (dist === 0) return time;
  if (dist === 1) return `昨天 ${time}`;
  if (dist < 7) return `${WEEKDAY_LABELS[date.getDay()]} ${time}`;

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day} ${time}`;
}

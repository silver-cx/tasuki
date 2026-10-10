// 显示用的小工具：配速、日期。

/** 秒/公里 → "6:27" */
export function fmtPace(secPerKm: number | null): string {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return "—";
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 一次跑步的配速（秒/公里），没有距离时为 null */
export function paceOf(durationSec: number, distanceM: number | null): number | null {
  return distanceM ? durationSec / (distanceM / 1000) : null;
}

/** ISO 时间 → 指定时区的 "YYYY-MM-DD" */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** "2026-09-21" → "9/21" */
export function shortDate(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/** 秒 → "32:15"，超过一小时 → "1:02:03" */
export function fmtDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "30:00" / "1:45:00" → 秒；格式不对返回 null */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isInteger(p) || p < 0)) {
    return null;
  }
  return parts.reduce((total, p) => total * 60 + p, 0);
}

/** 距离的显示名：5000 → "5 km"，21097.5 → "半程马拉松" */
export function distanceName(m: number): string {
  if (Math.abs(m - 21097.5) < 50) return "半程马拉松";
  if (Math.abs(m - 42195) < 50) return "全程马拉松";
  const km = m / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

// ---------- 日期运算（只处理 "YYYY-MM-DD" 字符串，按日历日计算，不受时区影响） ----------

/** "2026-10-11" + 3 → "2026-10-14" */
export function addDays(ymd: string, days: number): string {
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + days * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

/** 星期几：1 = 周一 … 7 = 周日 */
export function isoWeekday(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** 这一天所在那周的周一 */
export function mondayOf(ymd: string): string {
  return addDays(ymd, 1 - isoWeekday(ymd));
}

export const WEEKDAY_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
